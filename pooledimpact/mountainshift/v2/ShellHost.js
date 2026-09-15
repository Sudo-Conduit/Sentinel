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
            const request = buildRequest(cmdline);
            const totalBytes = memory.buffer.byteLength;
            const requestOffset = totalBytes - RESPONSE_CAP; // top 1MB: request region
            if (request.length > RESPONSE_CAP) throw new Error('request too large for the fixed request region');
            new Uint8Array(memory.buffer, requestOffset, request.length).set(request);

            const responseLen = instance.exports.run(requestOffset, request.length);

            const responseOffset = totalBytes - 2 * RESPONSE_CAP; // the 1MB region just below it
            const response = Buffer.from(memory.buffer, responseOffset, responseLen);

            let i = 0;
            const nulAt = (from) => { let j = from; while (response[j] !== 0) j++; return j; };
            const cwdEnd = nulAt(i);
            const newCwd = response.toString('utf8', i, cwdEnd);
            i = cwdEnd + 1;
            const rcEnd = nulAt(i);
            const rc = parseInt(response.toString('utf8', i, rcEnd), 10);
            i = rcEnd + 1;
            const stdout = response.toString('utf8', i, responseLen);

            cwd = newCwd;
            return { rc, stdout, cwd };
        }
    };
}

module.exports = { createShell };
