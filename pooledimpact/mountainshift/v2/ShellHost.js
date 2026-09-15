/**
 * @file ShellHost.js
 * @author Will Fobbs
 * @version 3.0.0
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
 *   No function of shell.c's own crosses this boundary in either
 *   direction -- same shape as this project's own memorymap.c: a
 *   shared flat buffer at fixed byte offsets, gated by exported entry
 *   points, not a back-and-forth of imported/exported calls.
 *
 *   Request blob: cwd\0 uid\0 home\0 PATH\0 cmdline\0 nfiles\0
 *     (path\0 length\0 <length raw bytes>){nfiles}
 *   Response blob: new_cwd\0 rc\0 <remaining bytes are stdout>
 *     -- OR, when shell.wasm doesn't implement the command itself --
 *   Response blob: EXEC\0 cmdline\0
 *
 *   shell.wasm is an orchestrator: it parses, and it runs what it owns
 *   internally (cd, cat, grep, whoami, which, exit), but a command like
 *   `ls` lives in its own small single-purpose module (ls.wasm) instead.
 *   When shell.wasm's response is the EXEC marker, this file is the one
 *   that resolves the command name to a command module (see
 *   commands/*.js, each a base64-embedded .wasm + a name, decoded and
 *   instantiated fully synchronously since every command module is also
 *   zero-import), runs IT with the identical request/response blob
 *   protocol, and returns its answer as the final result. shell.wasm
 *   never sees ls.wasm's bytes and ls.wasm never sees shell.wasm's --
 *   this file is the only thing that ever holds both at once, and all it
 *   does with that is relay one cmdline string to the right module and
 *   relay its answer back. Same "pass a string, get a string" shape as
 *   the shell.wasm <-> caller boundary itself, one level down.
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

const DEFAULT_WASM_URL = 'file://' + __dirname + '/shell.wasm';
const RESPONSE_CAP = 1024 * 1024; // must match shell.c's own output_cap

// Command modules shell.wasm delegates to via the EXEC marker -- each a
// {name, base64} pair, the base64 being that command's own compiled
// .wasm bytes (also zero imports, same request/response blob shape).
// Registering a new command.wasm is exactly: build it, embed it, add
// its module here. No other change to this file or to shell.c.
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

    function buildRequest(cmdline)
    {
        const parts = [];
        parts.push(Buffer.from(cwd + '\0', 'utf8'));
        parts.push(Buffer.from(String(uid) + '\0', 'utf8'));
        parts.push(Buffer.from((options.env && options.env.HOME || '') + '\0', 'utf8'));
        parts.push(Buffer.from((options.env && options.env.PATH || '') + '\0', 'utf8'));
        parts.push(Buffer.from(cmdline + '\0', 'utf8'));

        const fileEntries = Object.keys(files);
        parts.push(Buffer.from(String(fileEntries.length) + '\0', 'utf8'));
        for (const path of fileEntries)
        {
            const content = Buffer.from(files[path], 'utf8');
            parts.push(Buffer.from(path + '\0', 'utf8'));
            parts.push(Buffer.from(String(content.length) + '\0', 'utf8'));
            parts.push(content);
        }
        return Buffer.concat(parts);
    }

    // Runs one request/response cycle against ANY zero-import module
    // that speaks this same blob protocol -- shell.wasm or a delegated
    // command.wasm alike. Returns the raw response bytes; parsing them
    // into {rc, stdout} or checking for the EXEC marker is the caller's
    // job, same division shell.c/ls.c themselves don't care about.
    function callModule(moduleInstance, moduleMemory, cmdline)
    {
        const request = buildRequest(cmdline);
        const totalBytes = moduleMemory.buffer.byteLength;
        const requestOffset = totalBytes - RESPONSE_CAP; // top 1MB: request region
        if (request.length > RESPONSE_CAP) throw new Error('request too large for the fixed request region');
        new Uint8Array(moduleMemory.buffer, requestOffset, request.length).set(request);

        const responseLen = moduleInstance.exports.run(requestOffset, request.length);

        const responseOffset = totalBytes - 2 * RESPONSE_CAP; // the 1MB region just below it
        return Buffer.from(moduleMemory.buffer, responseOffset, responseLen);
    }

    function parseAnswer(response)
    {
        let i = 0;
        const nulAt = (from) => { let j = from; while (response[j] !== 0) j++; return j; };
        const cwdEnd = nulAt(i);
        const newCwd = response.toString('utf8', i, cwdEnd);
        i = cwdEnd + 1;
        const rcEnd = nulAt(i);
        const rc = parseInt(response.toString('utf8', i, rcEnd), 10);
        i = rcEnd + 1;
        const stdout = response.toString('utf8', i, response.length);
        return { rc, stdout, newCwd };
    }

    // Compiles/instantiates the named command module synchronously
    // (decoding a base64 string and compiling a zero-import WASM module
    // are both synchronous operations -- no network, no fetch, nothing
    // to await), runs it with the delegated sub-cmdline, and returns its
    // answer as the final result.
    const compiledCommandModules = new Map();
    function runExternal(mod, subCmdline)
    {
        let compiledModule = compiledCommandModules.get(mod.name);
        if (!compiledModule)
        {
            compiledModule = new WebAssembly.Module(Buffer.from(mod.base64, 'base64'));
            compiledCommandModules.set(mod.name, compiledModule);
        }
        const cmdInstance = new WebAssembly.Instance(compiledModule, {});
        const cmdMemory = cmdInstance.exports.memory;

        const response = callModule(cmdInstance, cmdMemory, subCmdline);
        const { rc, stdout, newCwd } = parseAnswer(response);
        cwd = newCwd;
        return { rc, stdout, cwd };
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
            const response = callModule(instance, memory, cmdline);

            // "EXEC\0" -- shell.wasm doesn't own this command itself;
            // it wants the named command module to run it instead.
            if (response.length >= 5 && response.toString('utf8', 0, 4) === 'EXEC' && response[4] === 0)
            {
                let j = 5;
                while (response[j] !== 0) j++;
                const subCmdline = response.toString('utf8', 5, j);
                const subName = subCmdline.split(' ')[0];

                const mod = findCommandModule(subName);
                if (!mod)
                {
                    return { rc: 127, stdout: 'shell: command not found: ' + subName + '\n', cwd };
                }

                return runExternal(mod, subCmdline);
            }

            const { rc, stdout, newCwd } = parseAnswer(response);
            cwd = newCwd;
            return { rc, stdout, cwd };
        }
    };
}

module.exports = { createShell };
