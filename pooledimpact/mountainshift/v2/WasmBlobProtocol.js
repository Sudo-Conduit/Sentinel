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
 *   Built entirely on Uint8Array/TextEncoder/TextDecoder/atob --
 *   standard JS, not Node's Buffer. Buffer is a Node-only convenience
 *   wrapper around Uint8Array; the standard typed array is what a
 *   WebAssembly.Memory's buffer actually is, what every WASM host API
 *   actually wants, and what runs unmodified in a browser (no Buffer
 *   global exists there at all) -- which matters concretely here,
 *   since this exact file is what Shell-Terminal-artifact reuses
 *   client-side. Node's own net/tls/child_process APIs still hand back
 *   real Node Buffer instances from their own callbacks (that's their
 *   contract, not a choice this file or ShellHost.js makes) -- Buffer
 *   already IS-A Uint8Array, so those chunks flow through this file's
 *   Uint8Array-based helpers (concatBytes, etc.) with no special
 *   casing needed.
 *
 *   Request blob: cwd\0 uid\0 home\0 PATH\0 cmdline\0 stdinlen\0
 *     <stdinlen raw bytes> nfiles\0 (path\0 length\0 <length raw
 *     bytes>){nfiles}
 *   Response blob: new_cwd\0 rc\0 <remaining bytes are stdout>
 */
'use strict';

const RESPONSE_CAP = 1024 * 1024; // must match shell.c's/ls.c's/top.c's own output_cap

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8');

/** @param {string} str @returns {Uint8Array} */
function utf8Bytes(str)
{
    return textEncoder.encode(str);
}

/** @param {Uint8Array} bytes @param {number} [start] @param {number} [end] @returns {string} */
function bytesToUtf8(bytes, start, end)
{
    return textDecoder.decode(bytes.subarray(start, end));
}

/** @param {Uint8Array[]} arrays @returns {Uint8Array} */
function concatBytes(arrays)
{
    let total = 0;
    for (const a of arrays) total += a.length;
    const out = new Uint8Array(total);
    let offset = 0;
    for (const a of arrays) { out.set(a, offset); offset += a.length; }
    return out;
}

/**
 * Standard base64 decode -- `atob` is a real cross-runtime global (Node
 * 16+, every browser), not a Node-specific API, unlike `Buffer.from(s,
 * 'base64')`.
 * @param {string} base64 @returns {Uint8Array}
 */
function base64ToBytes(base64)
{
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

function buildRequest({ cwd, uid, home, path, cmdline, stdin, files })
{
    stdin = stdin || new Uint8Array(0);
    files = files || {};

    const parts = [];
    parts.push(utf8Bytes((cwd || '/') + '\0'));
    parts.push(utf8Bytes(String(uid !== undefined ? uid : 0) + '\0'));
    parts.push(utf8Bytes((home || '') + '\0'));
    parts.push(utf8Bytes((path || '') + '\0'));
    parts.push(utf8Bytes(cmdline + '\0'));
    parts.push(utf8Bytes(String(stdin.length) + '\0'));
    parts.push(stdin);

    const fileEntries = Object.keys(files);
    parts.push(utf8Bytes(String(fileEntries.length) + '\0'));
    for (const filePath of fileEntries)
    {
        const content = files[filePath] instanceof Uint8Array ? files[filePath] : utf8Bytes(files[filePath]);
        parts.push(utf8Bytes(filePath + '\0'));
        parts.push(utf8Bytes(String(content.length) + '\0'));
        parts.push(content);
    }
    return concatBytes(parts);
}

// Runs one request/response cycle against ANY zero-import module that
// speaks this blob protocol. Returns the raw response bytes (a live
// view over the module's own linear memory, same as before); parsing
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
    return new Uint8Array(memory.buffer, responseOffset, responseLen);
}

function parseAnswer(response)
{
    let i = 0;
    const nulAt = (from) => { let j = from; while (response[j] !== 0) j++; return j; };
    const cwdEnd = nulAt(i);
    const newCwd = bytesToUtf8(response, i, cwdEnd);
    i = cwdEnd + 1;
    const rcEnd = nulAt(i);
    const rc = parseInt(bytesToUtf8(response, i, rcEnd), 10);
    i = rcEnd + 1;
    const stdout = bytesToUtf8(response, i, response.length);
    return { rc, stdout, newCwd };
}

// Compiling a base64-embedded module and instantiating it are both
// synchronous (zero imports means instantiation needs nothing wired) --
// no fetch, no await, anywhere in this file.
function compile(base64)
{
    return new WebAssembly.Module(base64ToBytes(base64));
}

function instantiate(compiledModule)
{
    const instance = new WebAssembly.Instance(compiledModule, {});
    return { instance, memory: instance.exports.memory };
}

module.exports = {
    RESPONSE_CAP, buildRequest, callModule, parseAnswer, compile, instantiate,
    utf8Bytes, bytesToUtf8, concatBytes, base64ToBytes
};
