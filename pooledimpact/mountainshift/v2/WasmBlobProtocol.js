/**
 * @file WasmBlobProtocol.js
 * @description The one wire format every zero-import module in this
 *   project speaks (shell.wasm, ls.wasm, top.wasm, and any future
 *   command.wasm): write a request blob into the module's own linear
 *   memory at a fixed offset, call run(ptr, len), read a response blob
 *   back out of another fixed offset. Pulled out of ShellHost.js once
 *   a second consumer (JobTable.js, which has to keep a module
 *   instance alive across many calls instead of one-per-call) needed
 *   the exact same encode/call/decode logic -- one source of truth for
 *   the offset math and field framing, instead of two copies that
 *   could drift.
 *
 *   Request blob: cwd\0 uid\0 home\0 PATH\0 cmdline\0 stdinlen\0
 *     <stdinlen raw bytes> nfiles\0 (path\0 length\0 <length raw
 *     bytes>){nfiles}
 *   Response blob: new_cwd\0 rc\0 <remaining bytes are stdout>
 */
'use strict';

const RESPONSE_CAP = 1024 * 1024; // must match shell.c's/ls.c's/top.c's own output_cap

function buildRequest({ cwd, uid, home, path, cmdline, stdin, files })
{
    stdin = stdin || Buffer.alloc(0);
    files = files || {};

    const parts = [];
    parts.push(Buffer.from((cwd || '/') + '\0', 'utf8'));
    parts.push(Buffer.from(String(uid !== undefined ? uid : 0) + '\0', 'utf8'));
    parts.push(Buffer.from((home || '') + '\0', 'utf8'));
    parts.push(Buffer.from((path || '') + '\0', 'utf8'));
    parts.push(Buffer.from(cmdline + '\0', 'utf8'));
    parts.push(Buffer.from(String(stdin.length) + '\0', 'utf8'));
    parts.push(stdin);

    const fileEntries = Object.keys(files);
    parts.push(Buffer.from(String(fileEntries.length) + '\0', 'utf8'));
    for (const filePath of fileEntries)
    {
        const content = Buffer.isBuffer(files[filePath]) ? files[filePath] : Buffer.from(files[filePath], 'utf8');
        parts.push(Buffer.from(filePath + '\0', 'utf8'));
        parts.push(Buffer.from(String(content.length) + '\0', 'utf8'));
        parts.push(content);
    }
    return Buffer.concat(parts);
}

// Runs one request/response cycle against ANY zero-import module that
// speaks this blob protocol. Returns the raw response bytes; parsing
// them into {rc, stdout, newCwd} (parseAnswer) or checking for
// shell.wasm's EXEC marker is the caller's job.
function callModule(instance, memory, requestFields)
{
    const request = buildRequest(requestFields);
    const totalBytes = memory.buffer.byteLength;
    const requestOffset = totalBytes - RESPONSE_CAP; // top 1MB: request region
    if (request.length > RESPONSE_CAP) throw new Error('request too large for the fixed request region');
    new Uint8Array(memory.buffer, requestOffset, request.length).set(request);

    const responseLen = instance.exports.run(requestOffset, request.length);

    const responseOffset = totalBytes - 2 * RESPONSE_CAP; // the 1MB region just below it
    return Buffer.from(memory.buffer, responseOffset, responseLen);
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

// Compiling a base64-embedded module and instantiating it are both
// synchronous (zero imports means instantiation needs nothing wired) --
// no fetch, no await, anywhere in this file.
function compile(base64)
{
    return new WebAssembly.Module(Buffer.from(base64, 'base64'));
}

function instantiate(compiledModule)
{
    const instance = new WebAssembly.Instance(compiledModule, {});
    return { instance, memory: instance.exports.memory };
}

module.exports = { RESPONSE_CAP, buildRequest, callModule, parseAnswer, compile, instantiate };
