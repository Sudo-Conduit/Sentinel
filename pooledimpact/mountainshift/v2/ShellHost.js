/**
 * @file ShellHost.js
 * @author Will Fobbs
 * @version 3.1.0
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
 *   Only ONE-SHOT command modules (ls.wasm: fresh instance per call,
 *   no state to preserve) are registered here and reachable through a
 *   normal pipeline. A STATEFUL module like top.wasm -- one that has
 *   to keep the same instance alive across calls so its own linear
 *   memory can hold state (a running tick count) between them -- isn't
 *   something a one-shot run()/runDetailed() call can express at all;
 *   that's JobTable.js's job, not this file's.
 *
 *   Real content (file bytes, directory listings, /etc/passwd, the
 *   real uid) never arrives via a call shell.c makes mid-execution --
 *   it can't, there's no import to make it through. Whoever calls
 *   createShell()/run() is responsible for gathering that content
 *   itself (real disk, a real fetch, whatever) entirely OUTSIDE any
 *   WASM interaction, and handing it in via options.files -- a plain
 *   path -> content map this file only ever serializes, never fetches.
 *
 *     const { createShell } = require('./ShellHost.js');
 *     const shell = await createShell({ wasmUrl: 'http://localhost:PORT/shell.wasm' });
 *     var a = shell.run('ls /tmp');
 *     console.log(a);
 *
 * @tests test/Shell.wasm.test.js
 */
'use strict';

const proto = require('./WasmBlobProtocol.js');

const DEFAULT_WASM_URL = 'file://' + __dirname + '/shell.wasm';

// One-shot command modules shell.wasm delegates to via the EXEC marker
// -- each a {name, base64} pair, the base64 being that command's own
// compiled .wasm bytes (also zero imports, same request/response blob
// shape). Registering a new one-shot command.wasm is exactly: build
// it, embed it, add its module here. No other change to this file or
// to shell.c. (Stateful modules like top.wasm are NOT listed here --
// see the file header and JobTable.js.)
const COMMAND_MODULES = [
    require('./commands/ls.js')
];

function findCommandModule(name)
{
    for (const mod of COMMAND_MODULES) if (mod.name === name) return mod;
    return null;
}

/**
 * @param {Object} [options]
 * @param {string} [options.wasmUrl] - fetched via fetch(); Node's
 *   fetch() only speaks http(s), not file:// -- pass a real URL.
 * @param {Object<string,string>} [options.files] - path -> raw string
 *   content, serialized into every request's file table verbatim.
 *   Whoever calls createShell() is responsible for having already
 *   fetched this; this file does no fetching, no formatting, no
 *   enumeration of its own.
 * @param {string} [options.cwd] - initial working directory
 * @param {number} [options.uid] - the real uid to report; defaults to
 *   process.getuid() where available
 * @returns {Promise<{run: (cmdline: string) => string}>}
 */
async function createShell(options)
{
    options = options || {};
    const wasmBytes = await fetch(options.wasmUrl || DEFAULT_WASM_URL).then((r) => r.arrayBuffer());
    const wasmModule = await WebAssembly.compile(wasmBytes);
    const instance = new WebAssembly.Instance(wasmModule, {});
    const memory = instance.exports.memory;

    const files = options.files || {};
    const uid = options.uid !== undefined ? options.uid : (typeof process !== 'undefined' && process.getuid ? process.getuid() : 0);
    let cwd = options.cwd || '/';

    function requestFields(cmdline, stdin)
    {
        return {
            cwd, uid,
            home: options.env && options.env.HOME,
            path: options.env && options.env.PATH,
            cmdline, stdin, files
        };
    }

    // Compiles/instantiates the named one-shot command module
    // synchronously (decoding base64 and compiling a zero-import WASM
    // module are both synchronous -- no network, no fetch, nothing to
    // await), runs it fresh, and returns its answer as the final
    // result. Fresh instance every call -- ls.wasm has nothing that
    // needs to survive between one run and the next.
    const compiledCommandModules = new Map();
    function runExternal(mod, subCmdline, stdin)
    {
        let compiledModule = compiledCommandModules.get(mod.name);
        if (!compiledModule)
        {
            compiledModule = proto.compile(mod.base64);
            compiledCommandModules.set(mod.name, compiledModule);
        }
        const { instance: cmdInstance, memory: cmdMemory } = proto.instantiate(compiledModule);

        const response = proto.callModule(cmdInstance, cmdMemory, requestFields(subCmdline, stdin));
        const { rc, stdout, newCwd } = proto.parseAnswer(response);
        cwd = newCwd;
        return { rc, stdout, cwd };
    }

    // Runs one call against shell.wasm, honoring its EXEC fallback for
    // the rare case a stage reaches it unresolved (a direct caller that
    // bypassed the splitter, or a registry that's out of sync with
    // shell.c's own external_commands[]). The splitter below is what
    // keeps this from being the normal path.
    function runNative(groupCmdline, stdin)
    {
        const response = proto.callModule(instance, memory, requestFields(groupCmdline, stdin));

        if (response.length >= 5 && response.toString('utf8', 0, 4) === 'EXEC' && response[4] === 0)
        {
            let j = 5;
            while (response[j] !== 0) j++;
            const subCmdline = response.toString('utf8', 5, j);
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
    // quoting support on either side yet).
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

    return {
        /**
         * Runs one command line and returns its real stdout as a
         * plain string. @param {string} cmdline @returns {string}
         */
        run(cmdline)
        {
            return this.runDetailed(cmdline).stdout;
        },
        /** @returns {{rc: number, stdout: string, cwd: string}} */
        runDetailed(cmdline)
        {
            const stages = splitPipeline(cmdline);
            if (stages.length === 0) return { rc: 0, stdout: '', cwd };

            const groups = groupStages(stages);

            let stdin = Buffer.alloc(0);
            let result = { rc: 0, stdout: '', cwd };
            for (const group of groups)
            {
                result = group.type === 'module'
                    ? runExternal(group.mod, group.cmdline, stdin)
                    : runNative(group.stages.join(' | '), stdin);
                stdin = Buffer.from(result.stdout, 'utf8');
            }
            return result;
        }
    };
}

module.exports = { createShell };
