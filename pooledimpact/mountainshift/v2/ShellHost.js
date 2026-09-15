/**
 * @file ShellHost.js
 * @author Will Fobbs
 * @version 3.2.0
 * @description shell.wasm has ZERO imports -- `WebAssembly.Module.
 *   imports()` on it returns an empty array. There is no host surface
 *   at all for this file to implement, because shell.c makes no calls
 *   out during execution; there is nothing to call out TO. The only
 *   thing this file (or any host) ever does is:
 *
 *     1. write a request blob into the module's own linear memory
 *     2. call run(ptr, len)
 *     3. read a response blob back out of a fixed offset
 *
 *   (see WasmBlobProtocol.js, which now owns that mechanics -- the
 *   exact same encode/call/decode logic JobTable.js needs too, for a
 *   module it has to keep alive across many calls instead of one-shot).
 *
 *   Request/response blob shapes: see WasmBlobProtocol.js's header.
 *   shell.wasm's response is either the normal new_cwd/rc/stdout shape,
 *   or, when it doesn't implement the parsed command itself, EXEC\0
 *   cmdline\0 -- a delegation, not an answer.
 *
 *   shell.wasm is Native-only: it parses and runs the pipeline stages
 *   it owns (cd, cat, grep, whoami, which, exit), but a command like
 *   `ls` lives in its own small single-purpose module (ls.wasm)
 *   instead. Deciding what's Native vs. VFS vs. machine-to-machine is
 *   never shell.c's job -- this file owns all of that, same as a real
 *   shell process owns job control while the kernel just runs
 *   processes. Concretely, that means THIS file also parses the
 *   pipeline (a cheap top-level split on `|`, see splitPipeline()
 *   below) before ever calling shell.wasm, so it can route each stage
 *   to the right place up front instead of finding out mid-pipeline --
 *   the same reason a real local shell never asks a remote shell to
 *   parse a pipeline that mixes local and remote stages: `ssh host
 *   'ls | grep x'` runs entirely on the remote side because the WHOLE
 *   quoted pipeline was handed to one shell; splitting it any other
 *   way isn't how Unix does this. A stage this file resolves to a
 *   command module (see commands/*.js, each a base64-embedded .wasm +
 *   a name, decoded and instantiated fully synchronously since every
 *   command module is also zero-import) runs as its own atomic unit;
 *   everything else is grouped into the largest contiguous run
 *   shell.wasm can execute as one real pipeline, with the previous
 *   group's stdout threaded in as the next group's stdinlen/stdin
 *   field. shell.wasm's own EXEC marker still exists as a fallback for
 *   a single unsplit call (e.g. a direct caller that skips the
 *   splitter) but the splitter resolves routing before shell.wasm ever
 *   sees an ambiguous stage.
 *
 *   Only ONE-SHOT command modules (ls.wasm, curl.wasm: fresh instance
 *   per call, no state to preserve BETWEEN separate command
 *   invocations) are registered here and reachable through a normal
 *   pipeline. A STATEFUL module like top.wasm -- one that has to keep
 *   the same instance alive across many calls of the SAME invocation
 *   so its own linear memory can hold state (a running tick count)
 *   between them -- isn't something a one-shot run()/runDetailed()
 *   call can express at all; that's JobTable.js's job, not this file's.
 *
 *   curl.wasm is one-shot but not single-round-trip: it can respond
 *   with its OWN delegation marker, SOCKET\0host\0port\0tls\0
 *   requestlen\0<raw bytes>, when it needs a real network round-trip
 *   it can't do itself (no live import exists to make one mid-call).
 *   This file's entire response to that is a dumb byte relay -- open a
 *   real TCP/TLS connection to host:port, write the exact bytes it was
 *   given, collect everything until the peer closes -- never any HTTP
 *   interpretation here; curl.wasm gets the raw response back as a
 *   file (/dev/socket_response, same mechanism whoami uses for
 *   /etc/passwd) and parses status/headers/body itself on a second
 *   call. This is why runExternal() and therefore run()/runDetailed()
 *   are async now: a real socket round-trip can't be synchronous.
 *
 *   node.wasm/php.wasm are the same idea one level up: SPAWN\0program\0
 *   argc\0(arg\0){argc}stdinlen\0<bytes> asks the host to run a real
 *   external PROGRAM (never taken from argv -- node.c/php.c each
 *   hardcode the one program they exist to run, same as curl.c always
 *   builds an HTTP request but never lets argv name an arbitrary raw
 *   byte target). The host enforces an explicit whitelist
 *   (ALLOWED_SPAWN_PROGRAMS) before honoring it -- defense in depth,
 *   since the module could in principle be recompiled to ask for
 *   anything, and the host is the actual authority here, same as it
 *   would be for a socket target. This file's job on seeing SPAWN is
 *   still a dumb relay: run the real process via child_process.spawn,
 *   feed it the exact stdin bytes, collect real stdout/stderr until it
 *   exits, hand the exit code + bytes back as a file
 *   (/dev/exec_response) for the module's own second call to parse.
 *
 *   This file never reads a file. It does not require('fs') at all,
 *   and nothing here gathers disk content ahead of time to stage for a
 *   module to find. A command that wants a directory or a file opens
 *   it and reads it itself -- see wasm/lsreal.c, which does its own
 *   fd_readdir, and native/msos.c, which does the same work through
 *   the raw syscall instruction. The two builds are the same logic
 *   written against different syscall ABIs.
 *
 *     const { createShell } = require('./ShellHost.js');
 *     const shell = await createShell({ wasmUrl: 'http://localhost:PORT/shell.wasm' });
 *     var a = await shell.run('ls /tmp');
 *     console.log(a);
 *
 * @tests test/Shell.wasm.test.js, test/Curl.wasm.test.js, test/Spawn.wasm.test.js
 */
'use strict';

const net = require('net');
const tls = require('tls');
const { spawn } = require('child_process');
const proto = require('./WasmBlobProtocol.js');
const { createProcessTable } = require('./ProcessTable.js');
const TOP_MODULE = require('./commands/top.js'); // stateful -- deliberately not in COMMAND_MODULES, see below

const DEFAULT_WASM_URL = 'file://' + __dirname + '/wasm/shell.wasm';

// One-shot command modules -- each a {name, base64} pair, the base64
// being that command's own compiled .wasm bytes (also zero imports,
// same request/response blob shape). Registering a new one-shot
// command.wasm is exactly: build it, embed it, add its module here.
// No other change to this file or to shell.c. (Stateful modules like
// top.wasm are NOT listed here -- see the file header and JobTable.js.)
const COMMAND_MODULES = [
    require('./commands/ls.js'),
    require('./commands/curl.js'),
    require('./commands/node.js'),
    require('./commands/php.js')
];

function findCommandModule(name)
{
    for (const mod of COMMAND_MODULES) if (mod.name === name) return mod;
    return null;
}

// The real authority over what node.wasm/php.wasm are allowed to spawn
// -- exported so it can be tested directly, not just exercised through
// a full command run. A module can only ever ASK for its own hardcoded
// program name; this is what actually decides whether that ask is
// honored.
const ALLOWED_SPAWN_PROGRAMS = new Set(['node', 'php']);
function isProgramAllowed(program)
{
    return ALLOWED_SPAWN_PROGRAMS.has(program);
}

// Real curl respects HTTPS_PROXY too -- this environment's own egress
// policy requires it (outbound TCP to the open internet is only
// reachable through a local CONNECT proxy; see /root/.ccr/README.md).
// Honoring it here is the same "dumb transport" contract, just with
// one more hop: CONNECT establishes a raw byte tunnel to the real
// origin, opaque to the proxy, before any TLS/HTTP happens inside it.
const PROXY_URL = process.env.HTTPS_PROXY || process.env.https_proxy || null;
// TLS is re-terminated at the proxy in this sandbox, so its CA has to be
// trusted. That trust is established by Node itself, at process start,
// from NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt -- this file reads
// no certificate, and no file, ever.
const NO_PROXY_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

// Finds the first byte-index of needle (a plain string) inside a
// Uint8Array, from fromIndex -- Uint8Array has no Buffer-style
// indexOf(string), only indexOf(singleByteValue), so this is the
// standard-JS replacement for that one Buffer convenience.
function findBytesIndex(haystack, needle, fromIndex)
{
    const needleBytes = proto.utf8Bytes(needle);
    outer: for (let i = fromIndex || 0; i <= haystack.length - needleBytes.length; i++)
    {
        for (let j = 0; j < needleBytes.length; j++)
        {
            if (haystack[i + j] !== needleBytes[j]) continue outer;
        }
        return i;
    }
    return -1;
}

function connectViaProxyTunnel(proxyUrl, host, port)
{
    return new Promise((resolve, reject) =>
    {
        const proxy = new URL(proxyUrl);
        const socket = net.connect(Number(proxy.port), proxy.hostname, () =>
        {
            socket.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`);
        });

        let buf = new Uint8Array(0);
        const onData = (chunk) =>
        {
            buf = proto.concatBytes([buf, chunk]);
            const headerEnd = findBytesIndex(buf, '\r\n\r\n');
            if (headerEnd === -1) return;
            socket.removeListener('data', onData);

            const statusLine = proto.bytesToUtf8(buf, 0, findBytesIndex(buf, '\r\n'));
            if (!/^HTTP\/1\.[01] 200/.test(statusLine))
            {
                socket.destroy();
                reject(new Error('proxy CONNECT failed: ' + statusLine));
                return;
            }
            resolve(socket);
        };
        socket.on('data', onData);
        socket.on('error', reject);
    });
}

// The one real thing this file ever does outside the WASM boundary
// besides gathering files: open a real socket and move exact bytes.
// No HTTP interpretation happens here -- curl.wasm built the request
// bytes and will parse the response bytes; this is a dumb transport,
// same shape as read()/write() are for the virtual file table, just
// backed by a live connection instead of pre-supplied bytes.
async function performSocketExchange(host, port, useTls, requestBytes)
{
    const useProxy = PROXY_URL && !NO_PROXY_HOSTS.has(host);
    const rawSocket = useProxy ? await connectViaProxyTunnel(PROXY_URL, host, port) : null;

    const socket = useTls
        ? tls.connect({ socket: rawSocket || undefined, host: rawSocket ? undefined : host, port: rawSocket ? undefined : port, servername: host }, () => socket.end(requestBytes))
        : (rawSocket || net.connect({ host, port }));
    if (!useTls) socket.end(requestBytes);

    return new Promise((resolve, reject) =>
    {
        let settled = false;
        const chunks = [];
        const finish = (err) =>
        {
            if (settled) return;
            settled = true;
            if (err) reject(err); else resolve(proto.concatBytes(chunks));
        };
        socket.on('data', (chunk) => chunks.push(chunk));
        socket.on('close', () => finish());
        socket.on('error', (err) => finish(err));
    });
}

// Parses curl.wasm's SOCKET\0host\0port\0tls\0requestlen\0<bytes>
// delegation, if that's what a response is. Same NUL-field shape as
// every other part of this wire protocol.
function parseSocketMarker(response)
{
    if (!(response.length >= 7 && proto.bytesToUtf8(response, 0, 6) === 'SOCKET' && response[6] === 0)) return null;

    let off = 7;
    const nulAt = (from) => { let j = from; while (response[j] !== 0) j++; return j; };

    let end = nulAt(off);
    const host = proto.bytesToUtf8(response, off, end);
    off = end + 1;

    end = nulAt(off);
    const port = parseInt(proto.bytesToUtf8(response, off, end), 10);
    off = end + 1;

    end = nulAt(off);
    const useTls = proto.bytesToUtf8(response, off, end) === '1';
    off = end + 1;

    end = nulAt(off);
    const requestLen = parseInt(proto.bytesToUtf8(response, off, end), 10);
    off = end + 1;

    const requestBytes = response.subarray(off, off + requestLen);
    return { host, port, useTls, requestBytes };
}

// Parses node.wasm's/php.wasm's SPAWN\0program\0argc\0(arg\0){argc}
// stdinlen\0<bytes> delegation, if that's what a response is.
function parseSpawnMarker(response)
{
    if (!(response.length >= 6 && proto.bytesToUtf8(response, 0, 5) === 'SPAWN' && response[5] === 0)) return null;

    let off = 6;
    const nulAt = (from) => { let j = from; while (response[j] !== 0) j++; return j; };

    let end = nulAt(off);
    const program = proto.bytesToUtf8(response, off, end);
    off = end + 1;

    end = nulAt(off);
    const argc = parseInt(proto.bytesToUtf8(response, off, end), 10);
    off = end + 1;

    const args = [];
    for (let i = 0; i < argc; i++)
    {
        end = nulAt(off);
        args.push(proto.bytesToUtf8(response, off, end));
        off = end + 1;
    }

    end = nulAt(off);
    const stdinLen = parseInt(proto.bytesToUtf8(response, off, end), 10);
    off = end + 1;

    const stdinBytes = response.subarray(off, off + stdinLen);
    return { program, args, stdinBytes };
}

// The one real thing this file does for a SPAWN delegation: run the
// real, whitelisted program with real argv and real stdin, and
// collect its real stdout/stderr/exit code. No interpretation of what
// the program does happens here -- node.wasm/php.wasm parse the
// result themselves on their second call, same as curl.wasm parses
// the raw socket response.
//
// `child` is returned synchronously (or null, if the whitelist
// rejected it before anything real started) so a caller backgrounding
// this job can register it for a real kill() immediately, without
// waiting on `done` -- the real OS process runs on its own regardless
// of whether anything is still awaiting its completion.
function spawnProcess(program, args, stdinBytes)
{
    if (!isProgramAllowed(program))
    {
        const result = { exitCode: 127, stdout: new Uint8Array(0), stderr: proto.utf8Bytes('spawn: ' + program + ' is not on the allowed list\n') };
        return { child: null, done: Promise.resolve(result) };
    }

    const child = spawn(program, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const stdoutChunks = [];
    const stderrChunks = [];
    child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk) => stderrChunks.push(chunk));
    const done = new Promise((resolve) =>
    {
        child.on('close', (code) => resolve({ exitCode: code === null ? 1 : code, stdout: proto.concatBytes(stdoutChunks), stderr: proto.concatBytes(stderrChunks) }));
        child.on('error', () => resolve({ exitCode: 127, stdout: new Uint8Array(0), stderr: proto.utf8Bytes('spawn: failed to start ' + program + '\n') }));
    });
    child.stdin.end(stdinBytes);
    return { child, done };
}

async function performProcessSpawn(program, args, stdinBytes)
{
    return spawnProcess(program, args, stdinBytes).done;
}

function buildExecResponseFile(exitCode, stdout, stderr)
{
    return proto.concatBytes([
        proto.utf8Bytes(String(exitCode) + '\0'),
        proto.utf8Bytes(String(stdout.length) + '\0'),
        stdout,
        proto.utf8Bytes(String(stderr.length) + '\0'),
        stderr
    ]);
}

/**
 * @param {Object} [options]
 * @param {string} [options.wasmUrl] - fetched via fetch(); Node's
 *   fetch() only speaks http(s), not file:// -- pass a real URL.
 * @param {string} [options.cwd] - initial working directory
 * @param {number} [options.uid] - the real uid to report; defaults to
 *   process.getuid() where available
 * @returns {Promise<{run: (cmdline: string) => Promise<string>}>}
 */
async function createShell(options)
{
    options = options || {};
    const wasmBytes = await fetch(options.wasmUrl || DEFAULT_WASM_URL).then((r) => r.arrayBuffer());
    const wasmModule = await WebAssembly.compile(wasmBytes);
    const instance = new WebAssembly.Instance(wasmModule, {});
    const memory = instance.exports.memory;

    const uid = options.uid !== undefined ? options.uid : (typeof process !== 'undefined' && process.getuid ? process.getuid() : 0);
    let cwd = options.cwd || '/';

    // The only entries that ever ride along are a delegation's own
    // answer -- /dev/socket_response, /dev/exec_response -- which are
    // the bytes that came back from the knock the module itself asked
    // for. Nothing is gathered ahead of time and staged for a module to
    // find; a module that wants a file reads the file.
    function requestFields(cmdline, stdin, extraFiles)
    {
        return {
            cwd, uid,
            home: options.env && options.env.HOME,
            path: options.env && options.env.PATH,
            cmdline, stdin,
            files: extraFiles || {}
        };
    }

    // Compiles/instantiates the named one-shot command module
    // synchronously (decoding base64 and compiling a zero-import WASM
    // module are both synchronous -- no network, no fetch, nothing to
    // await), runs it fresh, and returns its answer as the final
    // result. Fresh instance every call -- ls.wasm/curl.wasm have
    // nothing that needs to survive between one run and the next, only
    // curl's own two phases within ONE invocation (handled by the
    // recursive extraFiles call below).
    const compiledCommandModules = new Map();
    function getCompiledModule(mod)
    {
        let compiledModule = compiledCommandModules.get(mod.name);
        if (!compiledModule)
        {
            compiledModule = proto.compile(mod.base64);
            compiledCommandModules.set(mod.name, compiledModule);
        }
        return compiledModule;
    }

    // One raw call against a fresh instance of a one-shot module --
    // the shared first step both the normal (foreground, awaited)
    // path and the background-dispatch path need, since backgrounding
    // a SPAWN/SOCKET delegation means doing exactly this part inline
    // (cheap, synchronous) and then NOT awaiting the real socket/
    // process work before returning control to the caller.
    function callFreshModule(mod, subCmdline, stdin, extraFiles)
    {
        const { instance: cmdInstance, memory: cmdMemory } = proto.instantiate(getCompiledModule(mod));
        const response = proto.callModule(cmdInstance, cmdMemory, requestFields(subCmdline, stdin, extraFiles));
        return response;
    }

    async function runExternal(mod, subCmdline, stdin, extraFiles)
    {
        const response = callFreshModule(mod, subCmdline, stdin, extraFiles);

        const socketReq = parseSocketMarker(response);
        if (socketReq)
        {
            const rawResponse = await performSocketExchange(socketReq.host, socketReq.port, socketReq.useTls, socketReq.requestBytes);
            return runExternal(mod, subCmdline, stdin, { '/dev/socket_response': rawResponse });
        }

        const spawnReq = parseSpawnMarker(response);
        if (spawnReq)
        {
            const { exitCode, stdout: procStdout, stderr: procStderr } = await performProcessSpawn(spawnReq.program, spawnReq.args, spawnReq.stdinBytes);
            return runExternal(mod, subCmdline, stdin, { '/dev/exec_response': buildExecResponseFile(exitCode, procStdout, procStderr) });
        }

        const { rc, stdout, newCwd } = proto.parseAnswer(response);
        cwd = newCwd;
        return { rc, stdout, cwd };
    }

    // Job control lives entirely here, in JS -- same split as a real
    // kernel (which only ever understands kill(pid, sig)) and a shell
    // process (which owns bg/fg/jobs bookkeeping the kernel never
    // sees). shell.wasm/command.wasm modules never learn a "job"
    // concept exists.
    const processTable = createProcessTable();

    // Starts a SPAWN/SOCKET-delegating module in the background: does
    // the cheap synchronous phase-1 call inline to learn what real
    // work is needed, kicks that real work off WITHOUT awaiting it,
    // and registers it in the process table immediately. The real
    // socket/process work keeps running regardless of whether anything
    // is still awaiting it -- same as a real backgrounded process
    // keeps running whether or not the shell that spawned it is still
    // watching.
    // Finishes a delegation's second phase WITHOUT touching the shell's
    // own `cwd` -- a background job's completion can land long after
    // the user has `cd`'d elsewhere, and node.wasm/php.wasm/curl.wasm
    // only ever echo back the same cwd they were given anyway (none of
    // them are cd), so there is nothing worth committing from it.
    function finishDelegatedPhase2(mod, subCmdline, stdin, extraFiles)
    {
        const response = callFreshModule(mod, subCmdline, stdin, extraFiles);
        const { rc, stdout } = proto.parseAnswer(response);
        return { rc, stdout };
    }

    function startBackgroundDelegated(mod, subCmdline, stdin)
    {
        const response = callFreshModule(mod, subCmdline, stdin);

        const spawnReq = parseSpawnMarker(response);
        if (spawnReq)
        {
            const { child, done } = spawnProcess(spawnReq.program, spawnReq.args, spawnReq.stdinBytes);
            const finalized = done.then(({ exitCode, stdout: procStdout, stderr: procStderr }) =>
                finishDelegatedPhase2(mod, subCmdline, stdin, { '/dev/exec_response': buildExecResponseFile(exitCode, procStdout, procStderr) }));
            return processTable.startProcess(mod.name, subCmdline, child, finalized);
        }

        const socketReq = parseSocketMarker(response);
        if (socketReq)
        {
            const finalized = performSocketExchange(socketReq.host, socketReq.port, socketReq.useTls, socketReq.requestBytes)
                .then((rawResponse) => finishDelegatedPhase2(mod, subCmdline, stdin, { '/dev/socket_response': rawResponse }));
            return processTable.startProcess(mod.name, subCmdline, null, finalized);
        }

        return null; // nothing to background -- this module answered immediately
    }

    // Runs one call against shell.wasm, honoring its EXEC fallback for
    // the rare case a stage reaches it unresolved (a direct caller that
    // bypassed the splitter, or a registry that's out of sync with
    // shell.c's own external_commands[]). The splitter below is what
    // keeps this from being the normal path.
    async function runNative(groupCmdline, stdin)
    {
        const response = proto.callModule(instance, memory, requestFields(groupCmdline, stdin));

        if (response.length >= 5 && proto.bytesToUtf8(response, 0, 4) === 'EXEC' && response[4] === 0)
        {
            let j = 5;
            while (response[j] !== 0) j++;
            const subCmdline = proto.bytesToUtf8(response, 5, j);
            const subName = subCmdline.split(' ')[0];

            const mod = findCommandModule(subName);
            if (!mod) return { rc: 127, stdout: 'shell: command not found: ' + subName + '\n', cwd };
            return runExternal(mod, subCmdline, stdin);
        }

        const { rc, stdout, newCwd } = proto.parseAnswer(response);
        cwd = newCwd;
        return { rc, stdout, cwd };
    }

    // Splits a pipeline on top-level `|` -- the same, deliberately
    // simple tokenization shell.c's own tokenize_stage()/parse() do (no
    // quoting support on either side yet; curl.wasm does its OWN
    // quote-aware tokenizing of its own stage's cmdline, since that
    // string still carries whatever quote characters were in it).
    function splitPipeline(cmdline)
    {
        return cmdline.split('|').map((s) => s.trim()).filter((s) => s.length > 0);
    }

    function commandNameOf(stageCmdline)
    {
        const sp = stageCmdline.indexOf(' ');
        return sp === -1 ? stageCmdline : stageCmdline.slice(0, sp);
    }

    // Groups pipeline stages into the units that will actually get
    // executed: a stage whose command name is a registered command
    // module is its own atomic group (module.wasm has no pipeline
    // support of its own); everything else joins the largest
    // contiguous run of Native stages, which shell.wasm executes as
    // one real pipeline in one call, exactly as it always has.
    function groupStages(stages)
    {
        const groups = [];
        for (const stageCmdline of stages)
        {
            const mod = findCommandModule(commandNameOf(stageCmdline));
            if (mod)
            {
                groups.push({ type: 'module', mod, cmdline: stageCmdline });
            }
            else if (groups.length > 0 && groups[groups.length - 1].type === 'native')
            {
                groups[groups.length - 1].stages.push(stageCmdline);
            }
            else
            {
                groups.push({ type: 'native', stages: [stageCmdline] });
            }
        }
        return groups;
    }

    // ps/jobs/fg/bg/kill are pure JS builtins, intercepted before any
    // pipeline splitting or WASM call at all -- same as the words
    // themselves only ever mean something to a shell process, never to
    // a kernel (which only understands kill(pid, sig)). Formatting is
    // this file's job precisely because the job table itself is this
    // file's own bookkeeping, not something any WASM module could ever
    // know to format.
    function formatProcessList(kind)
    {
        const jobs = processTable.list();
        if (kind === 'ps')
        {
            let out = 'PID\tSTATE\tCMD\n';
            for (const j of jobs) out += j.pid + '\t' + j.state + '\t' + j.cmdline + '\n';
            return out;
        }
        let out = '';
        for (const j of jobs) out += '[' + j.pid + '] ' + j.state + '  ' + j.cmdline + '  (' + j.detail + ')\n';
        return out;
    }

    return {
        /**
         * Runs one command line and returns its real stdout as a
         * plain string. @param {string} cmdline @returns {Promise<string>}
         */
        async run(cmdline)
        {
            return (await this.runDetailed(cmdline)).stdout;
        },
        /** @returns {Promise<{rc: number, stdout: string, cwd: string}>} */
        async runDetailed(cmdline)
        {
            const trimmed = cmdline.trim();

            if (trimmed === 'ps' || trimmed === 'jobs') return { rc: 0, stdout: formatProcessList(trimmed), cwd };

            const fgMatch = /^fg\s+(\d+)$/.exec(trimmed);
            if (fgMatch)
            {
                const result = await processTable.fg(Number(fgMatch[1]));
                return result ? { rc: result.rc, stdout: result.stdout, cwd } : { rc: 1, stdout: 'fg: no such job\n', cwd };
            }

            const bgMatch = /^bg\s+(\d+)$/.exec(trimmed);
            if (bgMatch)
            {
                const result = processTable.bg(Number(bgMatch[1]));
                return result ? { rc: result.rc, stdout: result.stdout, cwd } : { rc: 1, stdout: 'bg: no such job\n', cwd };
            }

            const killMatch = /^kill\s+(\d+)$/.exec(trimmed);
            if (killMatch)
            {
                const result = processTable.kill(Number(killMatch[1]));
                return result ? { rc: 0, stdout: '', cwd } : { rc: 1, stdout: 'kill: no such job\n', cwd };
            }

            // Trailing `&`: background dispatch, JS-side only -- a
            // single command (not a pipeline; composing a backgrounded
            // pipeline is out of scope here) that's either the stateful
            // top.wasm (auto-ticked on an interval) or a SPAWN/SOCKET-
            // delegating module (node/php/curl: the real work is kicked
            // off and NOT awaited before returning).
            if (trimmed.endsWith('&'))
            {
                const bgStages = splitPipeline(trimmed.slice(0, -1));
                const name = bgStages.length === 1 ? commandNameOf(bgStages[0]) : null;

                if (name === 'top')
                {
                    const started = processTable.startWasmTicking(TOP_MODULE, {
                        cwd, uid, home: options.env && options.env.HOME, path: options.env && options.env.PATH
                    });
                    return { rc: 0, stdout: '[' + started.pid + '] ' + started.pid + '\n', cwd };
                }

                const mod = name ? findCommandModule(name) : null;
                if (mod)
                {
                    const pid = startBackgroundDelegated(mod, bgStages[0], new Uint8Array(0));
                    if (pid !== null) return { rc: 0, stdout: '[' + pid + '] ' + pid + '\n', cwd };
                }

                return { rc: 1, stdout: 'shell: background not supported for this command\n', cwd };
            }

            const stages = splitPipeline(cmdline);
            if (stages.length === 0) return { rc: 0, stdout: '', cwd };

            const groups = groupStages(stages);

            let stdin = new Uint8Array(0);
            let result = { rc: 0, stdout: '', cwd };
            for (const group of groups)
            {
                result = group.type === 'module'
                    ? await runExternal(group.mod, group.cmdline, stdin)
                    : await runNative(group.stages.join(' | '), stdin);
                stdin = proto.utf8Bytes(result.stdout);
            }
            return result;
        }
    };
}

module.exports = { createShell, isProgramAllowed };
