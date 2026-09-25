/**
 * POPCNT: Unicode — v00003
 * UMD IIFE — Closure + Proxy + Command Pattern
 *
 * Fixes since v00002:
 *   - bitsToUnicode: lossless 20-bit encoding (no PUA modulo collision)
 *   - cmdEncode: payload size policy applied after resolution
 *   - xorshift32: documented as non-cryptographic; --random requires entropy
 *
 * Author: Will Fobbs
 * Date: September 25, 2026
 * Document ID: POPCNT-UNICODE-20260925
 */
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.PopcntUnicode = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // ─────────────────────────────────────────────────────────────
    // Constants (closure-private)
    // ─────────────────────────────────────────────────────────────

    var VERSION = 0x00007;
    var PUA_START = 0xE000;
    var PUA_END   = 0xF8FF;
    var UNICODE_MAX = 0x10FFFF;

    // 20 bits per char: max value 0xFFFFF = 1,048,575 < 0x10FFFF.
    // Guarantees lossless mapping into the valid Unicode range.
    var BITS_PER_CHAR = 20;

    // ─────────────────────────────────────────────────────────────
    // POPCNT Primitives (closure-private)
    // ─────────────────────────────────────────────────────────────

    function popcnt32(x) {
        x = x >>> 0;
        x = x - ((x >>> 1) & 0x55555555);
        x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
        x = (x + (x >>> 4)) & 0x0F0F0F0F;
        return (x * 0x01010101) >>> 24;
    }

    function popcnt64(hi, lo) {
        return popcnt32(hi) + popcnt32(lo);
    }

    // ─────────────────────────────────────────────────────────────
    // Bit Utilities (closure-private)
    // ─────────────────────────────────────────────────────────────

    function bytesToBits(bytes) {
        var bits = [];
        for (var i = 0; i < bytes.length; i++) {
            for (var b = 7; b >= 0; b--) {
                bits.push((bytes[i] >>> b) & 1);
            }
        }
        return bits;
    }

    function bitsToBytes(bits) {
        var byteLen = Math.ceil(bits.length / 8);
        var bytes = new Uint8Array(byteLen);
        for (var i = 0; i < bits.length; i++) {
            if (bits[i]) {
                bytes[i >> 3] |= (1 << (7 - (i & 7)));
            }
        }
        return bytes;
    }

    function bitsToHex(bits) {
        var bytes = bitsToBytes(bits);
        var hex = '';
        for (var i = 0; i < bytes.length; i++) {
            hex += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
        }
        return hex;
    }

    // ─────────────────────────────────────────────────────────────
    // PRNG (closure-private)
    //
    // xorshift32 is NOT cryptographically secure.
    // It is provided only for deterministic key generation from a
    // known seed (testing, reproducibility). Production use must
    // supply an `entropy` function via the constructor.
    // ─────────────────────────────────────────────────────────────

    function xorshift32(seed) {
        var state = seed >>> 0;
        if (state === 0) state = 0x9E3779B9;
        return function () {
            state ^= state << 13; state >>>= 0;
            state ^= state >>> 17;
            state ^= state << 5;  state >>>= 0;
            return state;
        };
    }

    // ─────────────────────────────────────────────────────────────
    // Base64 (closure-private)
    // ─────────────────────────────────────────────────────────────

    var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

    function b64Encode(str) {
        var out = '';
        var i = 0;
        while (i < str.length) {
            var c1 = str.charCodeAt(i++) & 0xFF;
            var c2 = i < str.length ? str.charCodeAt(i++) & 0xFF : NaN;
            var c3 = i < str.length ? str.charCodeAt(i++) & 0xFF : NaN;
            var e1 = c1 >> 2;
            var e2 = ((c1 & 3) << 4) | (isNaN(c2) ? 0 : c2 >> 4);
            var e3 = isNaN(c2) ? 64 : (((c2 & 15) << 2) | (isNaN(c3) ? 0 : c3 >> 6));
            var e4 = isNaN(c3) ? 64 : (c3 & 63);
            out += B64[e1] + B64[e2] + (e3 === 64 ? '=' : B64[e3]) + (e4 === 64 ? '=' : B64[e4]);
        }
        return out;
    }

    function b64Decode(str) {
        var out = '';
        var i = 0;
        str = str.replace(/[^A-Za-z0-9+/=]/g, '');
        while (i < str.length) {
            var e1 = B64.indexOf(str[i++]);
            var e2 = B64.indexOf(str[i++]);
            var e3 = str[i] === '=' ? 64 : B64.indexOf(str[i++]);
            var e4 = str[i] === '=' ? 64 : B64.indexOf(str[i++]);
            var c1 = (e1 << 2) | (e2 >> 4);
            var c2 = ((e2 & 15) << 4) | (e3 >> 2);
            var c3 = ((e3 & 3) << 6) | e4;
            out += String.fromCharCode(c1);
            if (e3 !== 64) out += String.fromCharCode(c2);
            if (e4 !== 64) out += String.fromCharCode(c3);
        }
        return out;
    }

    // ─────────────────────────────────────────────────────────────
    // Pluggable packers (closure-private)
    //
    // The algorithm (encrypt/decrypt = Random 1:M inserts + 1:M shifts) is
    // container-agnostic. A packer is just the output codec: cipher bits <->
    // some container. raw/base64/hex are self-describing (a 4-byte plaintext
    // bit-length header), so decode needs no --bitLength. unicode is the
    // text-channel packer (20-bit codepoints), length supplied externally.
    // ─────────────────────────────────────────────────────────────

    function bytesToBinStr(bytes) { var s = ''; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return s; }
    function binStrToBytes(s) { var b = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xFF; return b; }
    function u32be(n) { return new Uint8Array([(n >>> 24) & 0xFF, (n >>> 16) & 0xFF, (n >>> 8) & 0xFF, n & 0xFF]); }
    function readU32be(b, off) { return ((b[off] << 24) | (b[off + 1] << 16) | (b[off + 2] << 8) | b[off + 3]) >>> 0; }
    function concatBytes(a, b) { var o = new Uint8Array(a.length + b.length); o.set(a, 0); o.set(b, a.length); return o; }

    var PACKERS = {
        raw: {
            outType: 'bytes',
            pack: function (cipherBits, plainBitLen) { return concatBytes(u32be(plainBitLen >>> 0), bitsToBytes(cipherBits)); },
            unpack: function (bytes) { return { bits: bytesToBits(bytes.subarray(4)), plainBitLen: readU32be(bytes, 0) }; }
        },
        base64: {
            outType: 'text',
            pack: function (cipherBits, plainBitLen) { return b64Encode(bytesToBinStr(PACKERS.raw.pack(cipherBits, plainBitLen))); },
            unpack: function (str) { return PACKERS.raw.unpack(binStrToBytes(b64Decode(str))); }
        },
        hex: {
            outType: 'text',
            pack: function (cipherBits, plainBitLen) {
                var b = PACKERS.raw.pack(cipherBits, plainBitLen), s = '';
                for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16);
                return s;
            },
            unpack: function (str) {
                var b = new Uint8Array(str.length >> 1);
                for (var i = 0; i < b.length; i++) b[i] = parseInt(str.substr(i * 2, 2), 16);
                return PACKERS.raw.unpack(b);
            }
        },
        unicode: {
            outType: 'text',
            // Escape-safe: 12 bits/char into the Private Use Area (0xE000..0xEFFF).
            // Every codepoint is invisible, single-BMP (no surrogates), and never
            // escaped by JSON.stringify or split by the CLI tokenizer -- so it
            // round-trips through --text. Self-describing: 3 header chars carry the
            // plaintext bit length (36-bit capacity).
            pack: function (cipherBits, plainBitLen) {
                var BASE = 0xE000;
                var cps = [
                    BASE + ((Math.floor(plainBitLen / 0x1000000)) & 0xFFF),
                    BASE + ((plainBitLen >>> 12) & 0xFFF),
                    BASE + (plainBitLen & 0xFFF)
                ];
                for (var i = 0; i < cipherBits.length; i += 12) {
                    var val = 0, take = Math.min(12, cipherBits.length - i);
                    for (var b = 0; b < take; b++) val = (val << 1) | (cipherBits[i + b] || 0);
                    if (take < 12) val = val << (12 - take);
                    cps.push(BASE + val);
                }
                var out = '';
                for (var k = 0; k < cps.length; k++) out += String.fromCodePoint(cps[k]);
                return out;
            },
            unpack: function (str) {
                var BASE = 0xE000;
                var vals = Array.from(str, function (ch) { return ch.codePointAt(0) - BASE; });
                var plainBitLen = (vals[0] * 0x1000000) + (vals[1] * 0x1000) + vals[2];
                var bits = [];
                for (var i = 3; i < vals.length; i++) {
                    var v = vals[i];
                    for (var b = 11; b >= 0; b--) bits.push((v >>> b) & 1);
                }
                return { bits: bits, plainBitLen: plainBitLen };
            }
        }
    };

    // ─────────────────────────────────────────────────────────────
    // Key Generation (closure-private)
    // ─────────────────────────────────────────────────────────────

    function generateKey(opts, entropy) {
        opts = opts || {};
        var N = opts.N || 1000;
        var M = opts.M || 16;
        var rng;

        if (opts.seed !== undefined && opts.seed !== null) {
            rng = xorshift32(opts.seed);
        } else if (entropy) {
            rng = function () {
                var buf = entropy(4);
                return ((buf[0] << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3]) >>> 0;
            };
        } else {
            throw new Error('keygen: no seed and no entropy source');
        }

        var A = (rng() % Math.max(1, Math.floor(N / 4))) + 1;
        var P = [];
        var used = {};
        while (P.length < A) {
            var p = rng() % N;
            if (!used[p]) { used[p] = true; P.push(p); }
        }
        P.sort(function (a, b) { return a - b; });
        var S = [];
        for (var i = 0; i < A; i++) S.push((rng() % M) + 1);

        return {
            version: VERSION,
            id: opts.id || ('k' + Date.now().toString(36)),
            A: A, P: P, S: S, N: N, M: M
        };
    }

    // ─────────────────────────────────────────────────────────────
    // Encrypt / Decrypt (closure-private)
    // ─────────────────────────────────────────────────────────────

    function encrypt(bits, key) {
        var segments = [];
        var cursor = 0;
        for (var i = 0; i < key.A; i++) {
            var pos = key.P[i];
            segments.push(bits.slice(cursor, pos));
            cursor = pos;
        }
        segments.push(bits.slice(cursor));

        var shifted = [];
        for (var j = 0; j < segments.length; j++) {
            var s = key.S[Math.min(j, key.S.length - 1)] % (segments[j].length || 1);
            var seg = segments[j];
            if (seg.length > 0) {
                seg = seg.slice(s).concat(seg.slice(0, s));
            }
            shifted.push(seg);
        }

        var out = [];
        for (var k = 0; k < shifted.length; k++) {
            out = out.concat(shifted[k]);
            if (k < key.A) {
                out.push(key.S[k] & 1);
            }
        }
        return out;
    }

    function decrypt(bits, key) {
        var segments = [];
        var cursor = 0;
        var prevP = 0;
        for (var i = 0; i < key.A; i++) {
            var segLen = key.P[i] - prevP;
            segments.push(bits.slice(cursor, cursor + segLen));
            cursor += segLen + 1;
            prevP = key.P[i];
        }
        segments.push(bits.slice(cursor));

        var unshifted = [];
        for (var j = 0; j < segments.length; j++) {
            var s = key.S[Math.min(j, key.S.length - 1)] % (segments[j].length || 1);
            var seg = segments[j];
            if (seg.length > 0) {
                seg = seg.slice(-s).concat(seg.slice(0, -s));
            }
            unshifted.push(seg);
        }

        var out = [];
        for (var k = 0; k < unshifted.length; k++) out = out.concat(unshifted[k]);
        return out;
    }

    // ─────────────────────────────────────────────────────────────
    // Unicode Container (closure-private)
    //
    // v00003: lossless 20-bit encoding.
    // Each 20-bit chunk maps to a value in [0, 0xFFFFF], which is
    // always <= UNICODE_MAX (0x10FFFF). No modulo, no collision.
    // ─────────────────────────────────────────────────────────────

    function bitsToUnicode(bits) {
        var chars = [];
        chars.push(String.fromCodePoint(PUA_START + (VERSION & 0x1F)));
        for (var i = 0; i < bits.length; i += BITS_PER_CHAR) {
            var val = 0;
            var remaining = bits.length - i;
            var take = remaining < BITS_PER_CHAR ? remaining : BITS_PER_CHAR;
            for (var b = 0; b < take; b++) {
                val = (val << 1) | (bits[i + b] || 0);
            }
            // Left-align partial chunks so decode can recover the bit count.
            if (take < BITS_PER_CHAR) {
                val = val << (BITS_PER_CHAR - take);
            }
            chars.push(String.fromCodePoint(val));
        }
        return chars.join('');
    }

    function unicodeToBits(str, bitLength) {
        var bits = [];
        var start = 0;
        if (str.length > 0) {
            var first = str.codePointAt(0);
            if (first >= PUA_START && first <= PUA_END) {
                start = 1;
            }
        }
        for (var i = start; i < str.length; i++) {
            var cp = str.codePointAt(i);
            if (cp > 0xFFFF) i++;
            for (var b = BITS_PER_CHAR - 1; b >= 0; b--) {
                bits.push((cp >>> b) & 1);
            }
        }
        // If a known bit length was provided, trim to it.
        if (typeof bitLength === 'number' && bitLength >= 0 && bitLength < bits.length) {
            bits = bits.slice(0, bitLength);
        }
        return bits;
    }

    // ─────────────────────────────────────────────────────────────
    // Command Parser (closure-private)
    // ─────────────────────────────────────────────────────────────

    function tokenize(stage) {
        var tokens = [];
        var re = /"([^"]*)"|'([^']*)'|(\S+)/g;
        var m;
        while ((m = re.exec(stage)) !== null) {
            tokens.push(m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : m[3]));
        }
        return tokens;
    }

    function parseFlags(tokens) {
        var flags = {};
        var positional = [];
        for (var i = 1; i < tokens.length; i++) {
            var t = tokens[i];
            if (t.indexOf('--') === 0) {
                var name = t.slice(2);
                var next = tokens[i + 1];
                if (next !== undefined && next.indexOf('--') !== 0) {
                    flags[name] = next;
                    i++;
                } else {
                    flags[name] = true;
                }
            } else {
                positional.push(t);
            }
        }
        return { flags: flags, positional: positional };
    }

    // ─────────────────────────────────────────────────────────────
    // Policy Layer (closure-private)
    // ─────────────────────────────────────────────────────────────

    function createPolicy() {
        return {
            maxKeys: 100,
            maxPayloadBytes: 1024 * 1024,
            maxN: 100000,
            maxM: 64,
            allowedCommands: null,
            tokenValidator: null
        };
    }

    function checkPolicy(policy, cmd, flags) {
        if (policy.allowedCommands && policy.allowedCommands.indexOf(cmd) === -1) {
            throw new Error('policy: command not allowed: ' + cmd);
        }
        if (policy.tokenValidator) {
            var token = flags.token;
            if (!policy.tokenValidator(token)) {
                throw new Error('policy: invalid token');
            }
        }
        if (cmd === 'keygen') {
            if (flags.N && parseInt(flags.N, 10) > policy.maxN) {
                throw new Error('policy: N exceeds maximum');
            }
            if (flags.M && parseInt(flags.M, 10) > policy.maxM) {
                throw new Error('policy: M exceeds maximum');
            }
        }
        // NOTE: payload size is checked in cmdEncode after resolution,
        // because the payload may come from stdin rather than --payload.
    }

    // ─────────────────────────────────────────────────────────────
    // Instance Factory (closure-private)
    // ─────────────────────────────────────────────────────────────

    function createInstance(config) {
        config = config || {};
        var entropy = config.entropy || null;
        var policy = config.policy || createPolicy();
        var keys = {};
        var lastKeyId = null;
        var lastText = null;
        var lastBitLength = null;
        var stdout = [];
        var stderr = [];
        var audit = [];

        function resolveKey(id) {
            if (!id || id === 'last') id = lastKeyId;
            if (!id || !keys[id]) throw new Error('key not found: ' + id);
            return keys[id];
        }

        function record(cmd, status) {
            audit.push({ ts: Date.now(), cmd: cmd, status: status });
        }

        // ── Dispatch table + gate chain: the mixin composition point (option b) ──
        // commands: name -> handler(ctx).  gates: run in order BEFORE the handler;
        // any gate that throws vetoes the command (fail-closed). Auth, logging,
        // policy limits, and hard feature-stops all compose here as gates, without
        // widening the run()-only Proxy surface. Mixins run at construction, inside
        // this closure, so they add behaviour without exposing internals.
        var commands = {};
        var gates = [];
        function registerCommand(name, handler) { commands[name] = handler; return mixinApi; }
        function addGate(gate) { gates.push(gate); return mixinApi; }
        var mixinApi = {
            registerCommand: registerCommand,
            addGate: addGate,
            // read-only helpers for mixins; NO write access to keys/entropy/etc.
            getPolicy: function () { return policy; },
            hasKey: function (id) { return !!keys[id]; },
            commandNames: function () { return Object.keys(commands); },
            // let a mixin run a command internally (used by FsMixin)
            invoke: function (cmdString, inp) { return executeStage(cmdString, inp); }
        };

        // Base commands (existing handlers wrapped to the ctx signature).
        registerCommand('keygen', function (ctx) { return cmdKeygen(ctx.flags); });
        registerCommand('encode', function (ctx) { return cmdEncode(ctx.flags, ctx.input); });
        registerCommand('decode', function (ctx) { return cmdDecode(ctx.flags, ctx.input); });
        registerCommand('rotate', function (ctx) { return cmdRotate(ctx.flags, ctx.input); });
        registerCommand('verify', function (ctx) { return cmdVerify(ctx.flags); });
        registerCommand('popcnt', function (ctx) { return cmdPopcnt(ctx.flags, ctx.input); });
        registerCommand('key',    function (ctx) { return cmdKey(ctx.positional, ctx.flags); });
        registerCommand('help',   function (ctx) { return cmdHelp(); });

        // Base gate: the existing policy check, now first in the chain.
        addGate(function (ctx) { checkPolicy(policy, ctx.cmd, ctx.flags); });

        // Apply mixins (each is function(mixinApi){...}) at construction, in-closure.
        if (config.mixins && config.mixins.length) {
            for (var _mi = 0; _mi < config.mixins.length; _mi++) config.mixins[_mi](mixinApi);
        }

        function executeStage(stage, input) {
            var tokens = tokenize(stage);
            if (tokens.length === 0) return input;
            var cmd = tokens[0];
            var parsed = parseFlags(tokens);
            var ctx = {
                cmd: cmd, flags: parsed.flags, positional: parsed.positional,
                token: parsed.flags.token, input: input
            };
            // Gate chain runs BEFORE dispatch. A throw vetoes (fail-closed); run()
            // catches it and surfaces an error result.
            for (var gi = 0; gi < gates.length; gi++) gates[gi](ctx);

            var handler = commands[cmd];
            if (!handler) {
                stderr.push('unknown command: ' + cmd);
                record(cmd, 'error');
                return input;
            }
            var result = handler(ctx);
            record(cmd, 'ok');
            return result;
        }

        function cmdKeygen(flags) {
            if (Object.keys(keys).length >= policy.maxKeys) {
                throw new Error('policy: maximum keys reached');
            }
            var opts = {
                N: flags.N ? parseInt(flags.N, 10) : 1000,
                M: flags.M ? parseInt(flags.M, 10) : 16,
                id: flags.id || ('k' + Date.now().toString(36))
            };
            if (flags.seed !== undefined) {
                opts.seed = parseInt(flags.seed, 10) || flags.seed;
            } else if (flags.random) {
                if (!entropy) throw new Error('keygen --random requires entropy source');
            }
            var key = generateKey(opts, entropy);
            keys[key.id] = key;
            lastKeyId = key.id;
            return { type: 'key', value: key, meta: { version: VERSION } };
        }

        function resolvePayload(flags, input) {
            if (flags.payload !== undefined) return flags.payload;
            if (input && input.type === 'bytes') return input.value;
            if (input && input.type === 'text') return input.value;
            throw new Error('encode: no payload');
        }

        function payloadByteLength(payload) {
            if (typeof payload === 'string') {
                // UTF-8 byte length approximation for ASCII; conservative for others.
                var n = 0;
                for (var i = 0; i < payload.length; i++) {
                    var c = payload.charCodeAt(i);
                    if (c < 0x80) n += 1;
                    else if (c < 0x800) n += 2;
                    else n += 3;
                }
                return n;
            }
            return payload.length;
        }

        function cmdEncode(flags, input) {
            var key = resolveKey(flags.key);
            var payload = resolvePayload(flags, input);

            // Policy check on the RESOLVED payload (covers stdin case).
            var byteLen = payloadByteLength(payload);
            if (byteLen > policy.maxPayloadBytes) {
                throw new Error('policy: payload exceeds maximum');
            }

            var bytes = (typeof payload === 'string')
                ? new Uint8Array(Array.prototype.map.call(payload, function (c) { return c.charCodeAt(0) & 0xFF; }))
                : payload;
            var bits = bytesToBits(bytes);
            var plainBitLen = bytes.length * 8;
            // N is the block capacity: payload must fit, and is zero-padded up to N
            // so the split positions (all < N) always land inside real data. The
            // TRUE length is recorded in the packer header and stripped on decode.
            if (plainBitLen > key.N) throw new Error('encode: payload ' + plainBitLen + ' bits exceeds key capacity N=' + key.N);
            while (bits.length < key.N) bits.push(0);
            var cipher = encrypt(bits, key);
            var packerName = flags.packer || 'unicode';
            var packer = PACKERS[packerName];
            if (!packer) throw new Error('unknown packer: ' + packerName);
            var value = packer.pack(cipher, plainBitLen);
            if (packer.outType === 'text') lastText = value;
            lastBitLength = plainBitLen;
            return {
                type: packer.outType,
                value: value,
                meta: { version: VERSION, keyId: key.id, bitLength: plainBitLen, packer: packerName }
            };
        }

        function cmdDecode(flags, input) {
            var key = resolveKey(flags.key);
            var packerName = flags.packer || 'unicode';
            var packer = PACKERS[packerName];
            if (!packer) throw new Error('unknown packer: ' + packerName);

            var rep;
            if (flags.text !== undefined) rep = flags.text;
            else if (input && (input.type === 'text' || input.type === 'bytes')) rep = input.value;
            else if (lastText) rep = lastText;
            else throw new Error('decode: no input');

            var un = packer.unpack(rep);
            // cipher is exactly N + A bits (N-padded plaintext, one inserted bit
            // per split); trim off any packer padding, decrypt to N, then strip to
            // the true plaintext length from the self-describing header.
            var cipherBits = un.bits.slice(0, key.N + key.A);
            var bits = decrypt(cipherBits, key);
            var plainBitLen = flags.bitLength ? parseInt(flags.bitLength, 10) : un.plainBitLen;
            if (plainBitLen != null) bits = bits.slice(0, plainBitLen);
            var bytes = bitsToBytes(bits);
            return { type: 'bytes', value: bytes, meta: { version: VERSION, keyId: key.id, packer: packerName } };
        }

        function cmdRotate(flags, input) {
            var oldKey = resolveKey(flags.key);
            var text;
            if (input && input.type === 'text') text = input.value;
            else if (lastText) text = lastText;
            else throw new Error('rotate: no text');
            var cipher = unicodeToBits(text, null);
            var bits = decrypt(cipher, oldKey);
            var opts = {
                N: oldKey.N, M: oldKey.M,
                id: flags['new-id'] || ('k' + Date.now().toString(36))
            };
            if (flags.seed !== undefined) opts.seed = parseInt(flags.seed, 10) || flags.seed;
            else if (flags.random && entropy) { /* use entropy */ }
            else opts.seed = oldKey.N ^ oldKey.M;
            var newKey = generateKey(opts, entropy);
            keys[newKey.id] = newKey;
            lastKeyId = newKey.id;
            var newCipher = encrypt(bits, newKey);
            var newText = bitsToUnicode(newCipher);
            lastText = newText;
            return { type: 'text', value: newText, meta: { version: VERSION, keyId: newKey.id } };
        }

        function cmdVerify(flags) {
            var count = flags.count ? parseInt(flags.count, 10) : 10;
            var passed = 0;
            for (var i = 0; i < count; i++) {
                var payload = 'verify-' + i + '-' + Math.random().toString(36).slice(2);
                var bytes = new Uint8Array(Array.prototype.map.call(payload, function (c) { return c.charCodeAt(0) & 0xFF; }));
                var key = generateKey({ seed: i + 1, N: bytes.length * 8, M: 16 });
                var bits = bytesToBits(bytes);
                var cipher = encrypt(bits, key);
                var plain = decrypt(cipher, key);
                var recovered = bitsToBytes(plain);
                var match = recovered.length === bytes.length;
                if (match) {
                    for (var j = 0; j < bytes.length; j++) {
                        if (recovered[j] !== bytes[j]) { match = false; break; }
                    }
                }
                if (match) passed++;
            }
            return { type: 'status', value: passed === count, meta: { passed: passed, total: count } };
        }

        function cmdPopcnt(flags, input) {
            var bits;
            if (flags.bits !== undefined) {
                bits = String(flags.bits).split('').map(Number);
            } else if (flags.hex !== undefined) {
                var hex = String(flags.hex);
                bits = [];
                for (var i = 0; i < hex.length; i++) {
                    var v = parseInt(hex[i], 16);
                    for (var b = 3; b >= 0; b--) bits.push((v >>> b) & 1);
                }
            } else if (input && input.type === 'bits') {
                bits = input.value;
            } else {
                throw new Error('popcnt: no input');
            }
            var count = 0;
            for (var k = 0; k < bits.length; k++) count += bits[k] ? 1 : 0;
            return { type: 'count', value: count, meta: { length: bits.length } };
        }

        function cmdKey(positional, flags) {
            var sub = positional[0] || 'list';
            switch (sub) {
                case 'list':
                    return { type: 'status', value: Object.keys(keys), meta: {} };
                case 'show':
                    return { type: 'key', value: resolveKey(flags.id), meta: {} };
                case 'drop':
                    var id = flags.id || lastKeyId;
                    delete keys[id];
                    if (lastKeyId === id) lastKeyId = null;
                    return { type: 'status', value: true, meta: { dropped: id } };
                case 'export':
                    var key = resolveKey(flags.id);
                    return { type: 'text', value: b64Encode(JSON.stringify(key)), meta: {} };
                case 'import':
                    var raw = flags.text || lastText;
                    var obj = JSON.parse(b64Decode(raw));
                    keys[obj.id] = obj;
                    lastKeyId = obj.id;
                    return { type: 'key', value: obj, meta: {} };
                default:
                    throw new Error('key: unknown subcommand ' + sub);
            }
        }

        function cmdHelp() {
            return {
                type: 'status',
                value: [
                    'keygen [--seed S | --random] [--N n] [--M m] [--id id]',
                    'encode --key <id> [--payload <text>]',
                    'decode --key <id> [--text <text>] [--bitLength n]',
                    'rotate --key <id> [--seed S | --random] [--new-id id]',
                    'verify [--count n]',
                    'popcnt [--bits <01> | --hex <hex>]',
                    'key list | show --id <id> | drop --id <id> | export --id <id> | import --text <b64>',
                    'help',
                    '',
                    'NOTE: xorshift32 is used for --seed (deterministic, non-crypto).',
                    '      --random requires an entropy source supplied at construction.'
                ].join('\n'),
                meta: {}
            };
        }

        function run(cmd) {
            var stages = String(cmd).split('|');
            var input = null;
            try {
                for (var i = 0; i < stages.length; i++) {
                    input = executeStage(stages[i].trim(), input);
                }
                return input;
            } catch (e) {
                stderr.push(e.message);
                record(cmd, 'error');
                return { type: 'error', value: e.message, meta: {} };
            }
        }

        // ─────────────────────────────────────────────────────
        // Proxy (intercepts all property access)
        // ─────────────────────────────────────────────────────

        // Target props are non-configurable/non-writable so the descriptors the
        // Proxy reports are TRUE -- Object.keys/Reflect.ownKeys no longer throw a
        // "trap reported non-configurability" invariant error (the v3 bug).
        var EXPOSED = ['run', 'version', 'stdout', 'stderr', 'audit'];
        var target = {};
        Object.defineProperty(target, 'run',     { value: run,     enumerable: true, writable: false, configurable: false });
        Object.defineProperty(target, 'version', { value: VERSION, enumerable: true, writable: false, configurable: false });
        Object.defineProperty(target, 'stdout',  { get: function () { return stdout.slice(); }, enumerable: true, configurable: false });
        Object.defineProperty(target, 'stderr',  { get: function () { return stderr.slice(); }, enumerable: true, configurable: false });
        Object.defineProperty(target, 'audit',   { get: function () { return audit.slice();  }, enumerable: true, configurable: false });
        Object.preventExtensions(target);

        var proxyHandler = {
            get: function (t, prop) { return EXPOSED.indexOf(prop) !== -1 ? t[prop] : undefined; },
            set: function () { throw new Error('instance is immutable'); },
            deleteProperty: function () { throw new Error('instance is immutable'); },
            defineProperty: function () { throw new Error('instance is immutable'); },
            has: function (t, prop) { return EXPOSED.indexOf(prop) !== -1; },
            ownKeys: function () { return EXPOSED.slice(); },
            getOwnPropertyDescriptor: function (t, prop) {
                return EXPOSED.indexOf(prop) !== -1 ? Object.getOwnPropertyDescriptor(t, prop) : undefined;
            }
        };

        return new Proxy(target, proxyHandler);
    }

    // ─────────────────────────────────────────────────────────────
    // Public Interface
    // ─────────────────────────────────────────────────────────────

    function PopcntUnicode(config) {
        return createInstance(config);
    }

    PopcntUnicode.VERSION = VERSION;
    PopcntUnicode.PACKERS = ['raw', 'base64', 'hex', 'unicode'];

    // FsMixin: a Node-shaped fs (real fs, or FileFsX exposing the same shape)
    // turns file paths into encrypt/decrypt operations. Same algorithm, now on
    // files instead of strings. Default packer 'raw' (byte-exact container).
    PopcntUnicode.FsMixin = function (fs) {
        return function (api) {
            api.registerCommand('encrypt-file', function (ctx) {
                var packer = ctx.flags.packer || 'raw';
                var inBytes = new Uint8Array(fs.readFileSync(ctx.flags['in']));
                var res = api.invoke('encode --key ' + ctx.flags.key + ' --packer ' + packer,
                                     { type: 'bytes', value: inBytes });
                if (res.type === 'error') throw new Error(res.value);
                var out = (res.type === 'bytes')
                    ? (typeof Buffer !== 'undefined' ? Buffer.from(res.value) : res.value)
                    : res.value;
                fs.writeFileSync(ctx.flags.out, out);
                return { type: 'status', value: true, meta: { in: ctx.flags['in'], out: ctx.flags.out, bytes: inBytes.length, packer: packer } };
            });
            api.registerCommand('decrypt-file', function (ctx) {
                var packer = ctx.flags.packer || 'raw';
                var inData = fs.readFileSync(ctx.flags['in']);
                var input = (packer === 'raw')
                    ? { type: 'bytes', value: new Uint8Array(inData) }
                    : { type: 'text', value: (typeof inData === 'string' ? inData : inData.toString('utf8')) };
                var res = api.invoke('decode --key ' + ctx.flags.key + ' --packer ' + packer, input);
                if (res.type === 'error') throw new Error(res.value);
                var out = (typeof Buffer !== 'undefined' ? Buffer.from(res.value) : res.value);
                fs.writeFileSync(ctx.flags.out, out);
                return { type: 'status', value: true, meta: { in: ctx.flags['in'], out: ctx.flags.out, packer: packer } };
            });
        };
    };

    return PopcntUnicode;
}));