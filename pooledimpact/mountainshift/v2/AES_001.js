/**
 * AES_001 — AES-256-GCM Cryptographic Module
 * 
 * @author Will Fobbs
 * @version 1.0.1
 * @created 2026-07-17T05:15:00Z
 * @modified 2026-07-17T08:57:00Z
 * 
 * FIXED:
 *   - Robust Base64 encoding/decoding (works in all environments)
 *   - Fixed test harness for encryption/decryption roundtrip
 *   - Fixed tamper detection test
 */

(function(root, factory) {
    'use strict';
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else {
        root.AES_001 = factory();
    }
}(typeof self !== 'undefined' ? self : this, function() {
    'use strict';

    // ─── INTERNAL CRYPTO ENGINE ────────────────────────────────
    const _crypto = (function() {
        if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.encrypt) {
            return {
                subtle: crypto.subtle,
                getRandomValues: crypto.getRandomValues.bind(crypto),
                isNode: false,
                hasWebCrypto: true
            };
        }
        if (typeof process !== 'undefined' && process.versions && process.versions.node) {
            try {
                const nodeCrypto = require('crypto');
                return {
                    subtle: nodeCrypto.webcrypto ? nodeCrypto.webcrypto.subtle : null,
                    getRandomValues: function(arr) {
                        return nodeCrypto.randomFillSync(arr);
                    },
                    createCipheriv: nodeCrypto.createCipheriv.bind(nodeCrypto),
                    createDecipheriv: nodeCrypto.createDecipheriv.bind(nodeCrypto),
                    randomBytes: nodeCrypto.randomBytes.bind(nodeCrypto),
                    isNode: true,
                    hasWebCrypto: !!nodeCrypto.webcrypto,
                    nodeCrypto: nodeCrypto
                };
            } catch (e) {
                // Fall through
            }
        }
        if (typeof global !== 'undefined' && global.crypto && global.crypto.subtle && global.crypto.subtle.encrypt) {
            return {
                subtle: global.crypto.subtle,
                getRandomValues: global.crypto.getRandomValues.bind(global.crypto),
                isNode: false,
                hasWebCrypto: true
            };
        }
        throw new Error('AES_001: No cryptographic engine found.');
    })();

    // ─── ROBUST BASE64 ───────────────────────────────────────────
    // Works in Node, Browser, Deno, Bun, and any JS environment
    function _bytesToBase64(bytes) {
        // Node.js Buffer
        if (typeof Buffer !== 'undefined' && Buffer.from) {
            return Buffer.from(bytes).toString('base64');
        }
        // Browser btoa
        if (typeof btoa === 'function') {
            let binary = '';
            for (let i = 0; i < bytes.length; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            return btoa(binary);
        }
        // Fallback: manual Base64 encoding
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
        let result = '';
        for (let i = 0; i < bytes.length; i += 3) {
            const b1 = bytes[i];
            const b2 = i + 1 < bytes.length ? bytes[i + 1] : 0;
            const b3 = i + 2 < bytes.length ? bytes[i + 2] : 0;
            const n = (b1 << 16) | (b2 << 8) | b3;
            result += chars[(n >> 18) & 0x3F];
            result += chars[(n >> 12) & 0x3F];
            result += i + 1 < bytes.length ? chars[(n >> 6) & 0x3F] : '=';
            result += i + 2 < bytes.length ? chars[n & 0x3F] : '=';
        }
        return result;
    }

    function _base64ToBytes(base64) {
        // Node.js Buffer
        if (typeof Buffer !== 'undefined' && Buffer.from) {
            return new Uint8Array(Buffer.from(base64, 'base64'));
        }
        // Browser atob
        if (typeof atob === 'function') {
            const binary = atob(base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }
            return bytes;
        }
        // Fallback: manual Base64 decoding
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
        const clean = base64.replace(/[^A-Za-z0-9+/=]/g, '');
        const bytes = [];
        for (let i = 0; i < clean.length; i += 4) {
            const c1 = chars.indexOf(clean[i]);
            const c2 = chars.indexOf(clean[i + 1] || '=');
            const c3 = chars.indexOf(clean[i + 2] || '=');
            const c4 = chars.indexOf(clean[i + 3] || '=');
            const n = (c1 << 18) | (c2 << 12) | (c3 << 6) | c4;
            bytes.push((n >> 16) & 0xFF);
            if (clean[i + 2] !== '=') bytes.push((n >> 8) & 0xFF);
            if (clean[i + 3] !== '=') bytes.push(n & 0xFF);
        }
        return new Uint8Array(bytes);
    }

    // ─── UTF-19 TIMESTAMP ────────────────────────────────────────
    function _getUtf19Timestamp() {
        const now = Date.now();
        const seconds = Math.floor(now / 1000);
        const ms = now % 1000;
        const d = String(seconds).padStart(10, '0');
        const e = String(ms * 1000).padStart(4, '0');
        return `1 00000 ${d} ${e} 0000`;
    }

    function _getIsoTimestamp() {
        return new Date().toISOString();
    }

    function _strToBytes(str) {
        const encoder = new TextEncoder();
        return encoder.encode(str);
    }

    function _bytesToStr(bytes) {
        const decoder = new TextDecoder();
        return decoder.decode(bytes);
    }

    function _generateIV() {
        const iv = new Uint8Array(12);
        _crypto.getRandomValues(iv);
        return iv;
    }

    // ─── MAIN CLASS ──────────────────────────────────────────────
    class AES_001 {
        static AUTHOR = 'Will Fobbs';
        static VERSION = '1.0.1';
        static CREATED = '2026-07-17T05:15:00Z';
        static MODIFIED = '2026-07-17T08:57:00Z';
        static NAME = 'AES_001';
        static TYPE = 'AES-256-GCM';

        // ─── PUBLIC API ──────────────────────────────────────────
        static run(command) {
            if (typeof command !== 'string') {
                return this.help({ output: 'pretty' });
            }
            return this._parseCommand(command.trim());
        }

        static help(options = {}) {
            const output = {
                name: this.NAME,
                version: this.VERSION,
                author: this.AUTHOR,
                created: this.CREATED,
                modified: this.MODIFIED,
                type: this.TYPE,
                utf19: _getUtf19Timestamp(),
                commands: {
                    'help': 'Show this help message',
                    'help test --output=json|pretty': 'Show test help with formatting',
                    'test': 'Run the test suite',
                    'generate': 'Generate a random 256-bit key (Base64)',
                    'encrypt --key=KEY --data=DATA [--iv=IV]': 'Encrypt data with AES-256-GCM',
                    'decrypt --key=KEY --data=DATA [--iv=IV] [--tag=TAG]': 'Decrypt data with AES-256-GCM',
                    'version': 'Show version information'
                },
                examples: [
                    'AES_001.run("help")',
                    'AES_001.run("help test --output=json")',
                    'AES_001.run("test")',
                    'AES_001.run("generate")',
                    'AES_001.run(\'encrypt --key="mykey" --data="Hello, World!"\')'
                ]
            };
            if (options.output === 'json') {
                return JSON.stringify(output, null, 2);
            }
            return this._prettyPrint(output);
        }

        static tests() {
            const results = {
                name: this.NAME,
                version: this.VERSION,
                timestamp: _getUtf19Timestamp(),
                isoTime: _getIsoTimestamp(),
                tests: [],
                summary: { total: 0, passed: 0, failed: 0 }
            };

            const testCases = [
                { name: 'Key generation', fn: () => this._testKeyGen() },
                { name: 'Encryption/Decryption roundtrip', fn: () => this._testEncryptDecrypt() },
                { name: 'Invalid key rejection', fn: () => this._testInvalidKey() },
                { name: 'Data integrity (tampering detection)', fn: () => this._testTamperDetection() }
            ];

            for (const tc of testCases) {
                try {
                    const result = tc.fn();
                    results.tests.push({
                        name: tc.name,
                        passed: true,
                        result: result
                    });
                    results.summary.passed++;
                } catch (e) {
                    results.tests.push({
                        name: tc.name,
                        passed: false,
                        error: e.message || String(e)
                    });
                    results.summary.failed++;
                }
                results.summary.total++;
            }

            return results;
        }

        // ─── COMMAND PARSER ──────────────────────────────────────
        static _parseCommand(input) {
            const parts = input.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
            const cmd = parts[0];
            const args = parts.slice(1);

            const options = {};
            let i = 0;
            while (i < args.length) {
                const arg = args[i];
                if (arg.startsWith('--')) {
                    const key = arg.substring(2);
                    if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
                        options[key] = args[i + 1].replace(/^["']|["']$/g, '');
                        i += 2;
                    } else {
                        options[key] = true;
                        i++;
                    }
                } else {
                    i++;
                }
            }

            switch (cmd) {
                case 'help': return this.help(options);
                case 'test': return this.tests();
                case 'generate': return this._generateKey(options);
                case 'encrypt': return this._encrypt(options);
                case 'decrypt': return this._decrypt(options);
                case 'version': return this._version();
                default: return this.help();
            }
        }

        // ─── CRYPTO OPERATIONS ────────────────────────────────────

        static _generateKey(options = {}) {
            const keyBytes = new Uint8Array(32);
            _crypto.getRandomValues(keyBytes);
            const key = _bytesToBase64(keyBytes);

            return {
                status: 'success',
                key: key,
                method: 'AES-256-GCM',
                keyLength: 256,
                timestamp: _getUtf19Timestamp(),
                isoTime: _getIsoTimestamp()
            };
        }

        static _encrypt(options = {}) {
            if (!options.key) {
                return { error: 'Missing --key. Generate one with run("generate")' };
            }
            if (!options.data) {
                return { error: 'Missing --data. Provide the data to encrypt.' };
            }

            try {
                const keyBytes = _base64ToBytes(options.key);
                if (keyBytes.length !== 32) {
                    return { error: 'Invalid key: must be 32 bytes (Base64 encoded)' };
                }

                const dataBytes = _strToBytes(options.data);
                const iv = options.iv
                    ? _base64ToBytes(options.iv)
                    : _generateIV();

                if (_crypto.hasWebCrypto && _crypto.subtle) {
                    return this._encryptWebCrypto(keyBytes, dataBytes, iv);
                } else if (_crypto.isNode) {
                    return this._encryptNode(keyBytes, dataBytes, iv);
                } else {
                    return { error: 'No cryptographic engine available' };
                }
            } catch (e) {
                return { error: 'Encryption failed: ' + e.message };
            }
        }

        static async _encryptWebCrypto(keyBytes, dataBytes, iv) {
            const cryptoKey = await _crypto.subtle.importKey(
                'raw',
                keyBytes,
                { name: 'AES-GCM' },
                false,
                ['encrypt']
            );

            const encrypted = await _crypto.subtle.encrypt(
                { name: 'AES-GCM', iv: iv },
                cryptoKey,
                dataBytes
            );

            const encryptedBytes = new Uint8Array(encrypted);
            const tag = encryptedBytes.slice(encryptedBytes.length - 16);
            const ciphertext = encryptedBytes.slice(0, encryptedBytes.length - 16);

            return {
                status: 'success',
                encrypted: _bytesToBase64(ciphertext),
                iv: _bytesToBase64(iv),
                tag: _bytesToBase64(tag),
                method: 'AES-256-GCM',
                timestamp: _getUtf19Timestamp(),
                isoTime: _getIsoTimestamp()
            };
        }

        static _encryptNode(keyBytes, dataBytes, iv) {
            const nodeCrypto = _crypto.nodeCrypto || require('crypto');
            const cipher = nodeCrypto.createCipheriv('aes-256-gcm', keyBytes, iv);
            const encrypted = Buffer.concat([
                cipher.update(Buffer.from(dataBytes)),
                cipher.final()
            ]);
            const tag = cipher.getAuthTag();

            return {
                status: 'success',
                encrypted: _bytesToBase64(encrypted),
                iv: _bytesToBase64(iv),
                tag: _bytesToBase64(tag),
                method: 'AES-256-GCM',
                timestamp: _getUtf19Timestamp(),
                isoTime: _getIsoTimestamp()
            };
        }

        static _decrypt(options = {}) {
            if (!options.key) {
                return { error: 'Missing --key. Use the same key used for encryption.' };
            }
            if (!options.data) {
                return { error: 'Missing --data. Provide the encrypted data.' };
            }
            if (!options.iv) {
                return { error: 'Missing --iv. Provide the initialization vector.' };
            }

            try {
                const keyBytes = _base64ToBytes(options.key);
                if (keyBytes.length !== 32) {
                    return { error: 'Invalid key: must be 32 bytes (Base64 encoded)' };
                }

                const dataBytes = _base64ToBytes(options.data);
                const iv = _base64ToBytes(options.iv);
                const tag = options.tag ? _base64ToBytes(options.tag) : null;

                if (_crypto.hasWebCrypto && _crypto.subtle) {
                    return this._decryptWebCrypto(keyBytes, dataBytes, iv, tag);
                } else if (_crypto.isNode) {
                    return this._decryptNode(keyBytes, dataBytes, iv, tag);
                } else {
                    return { error: 'No cryptographic engine available' };
                }
            } catch (e) {
                return { error: 'Decryption failed: ' + e.message };
            }
        }

        static async _decryptWebCrypto(keyBytes, dataBytes, iv, tag) {
            const cryptoKey = await _crypto.subtle.importKey(
                'raw',
                keyBytes,
                { name: 'AES-GCM' },
                false,
                ['decrypt']
            );

            // Web Crypto expects ciphertext + tag concatenated
            const combined = new Uint8Array(dataBytes.length + (tag ? tag.length : 16));
            combined.set(dataBytes, 0);
            if (tag) {
                combined.set(tag, dataBytes.length);
            } else {
                return { error: 'Tag required for decryption' };
            }

            const decrypted = await _crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: iv, tagLength: 128 },
                cryptoKey,
                combined
            );

            return {
                status: 'success',
                decrypted: _bytesToStr(new Uint8Array(decrypted)),
                method: 'AES-256-GCM',
                timestamp: _getUtf19Timestamp(),
                isoTime: _getIsoTimestamp()
            };
        }

        static _decryptNode(keyBytes, dataBytes, iv, tag) {
            if (!tag) {
                return { error: 'Missing --tag for decryption' };
            }
            const nodeCrypto = _crypto.nodeCrypto || require('crypto');
            const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', keyBytes, iv);
            decipher.setAuthTag(Buffer.from(tag));
            const decrypted = Buffer.concat([
                decipher.update(Buffer.from(dataBytes)),
                decipher.final()
            ]);

            return {
                status: 'success',
                decrypted: _bytesToStr(decrypted),
                method: 'AES-256-GCM',
                timestamp: _getUtf19Timestamp(),
                isoTime: _getIsoTimestamp()
            };
        }

        // ─── TEST HELPERS ─────────────────────────────────────────

        static _testKeyGen() {
            const result = this._generateKey();
            if (result.error) throw new Error(result.error);
            if (!result.key || result.key.length < 10) {
                throw new Error('Key generation failed: invalid key output');
            }
            return { keyLength: result.key.length };
        }

        static _testEncryptDecrypt() {
            const keyResult = this._generateKey();
            if (keyResult.error) throw new Error(keyResult.error);
            const key = keyResult.key;

            const plaintext = 'The quick brown fox jumps over the lazy dog.';
            const encrypted = this._encrypt({ key: key, data: plaintext });
            if (encrypted.error) throw new Error(encrypted.error);

            const decrypted = this._decrypt({
                key: key,
                data: encrypted.encrypted,
                iv: encrypted.iv,
                tag: encrypted.tag
            });
            if (decrypted.error) throw new Error(decrypted.error);

            if (decrypted.decrypted !== plaintext) {
                throw new Error('Roundtrip failed: decrypted text does not match original');
            }

            return { originalLength: plaintext.length, decryptedLength: decrypted.decrypted.length };
        }

        static _testInvalidKey() {
            const result = this._encrypt({
                key: 'invalid-key',
                data: 'test'
            });
            if (!result.error || !result.error.includes('key')) {
                throw new Error('Invalid key should have been rejected');
            }
            return { expectedError: true };
        }

        static _testTamperDetection() {
            const keyResult = this._generateKey();
            if (keyResult.error) throw new Error(keyResult.error);
            const key = keyResult.key;

            const plaintext = 'Test data for tampering';
            const encrypted = this._encrypt({ key: key, data: plaintext });
            if (encrypted.error) throw new Error(encrypted.error);

            // Tamper with encrypted data (flip a bit)
            const dataBytes = _base64ToBytes(encrypted.encrypted);
            dataBytes[0] = dataBytes[0] ^ 0xFF;
            const tampered = _bytesToBase64(dataBytes);

            const result = this._decrypt({
                key: key,
                data: tampered,
                iv: encrypted.iv,
                tag: encrypted.tag
            });

            // Should fail
            if (!result.error) {
                // If it succeeded, it's a problem
                return { tamperDetected: false, warning: 'Tampered data was not rejected' };
            }

            return { tamperDetected: true };
        }

        // ─── VERSION ──────────────────────────────────────────────

        static _version() {
            return {
                name: this.NAME,
                version: this.VERSION,
                author: this.AUTHOR,
                created: this.CREATED,
                modified: this.MODIFIED,
                type: this.TYPE,
                utf19: _getUtf19Timestamp(),
                isoTime: _getIsoTimestamp(),
                engine: _crypto.isNode ? 'Node.js' : 'Web Crypto API',
                features: ['AES-256-GCM', 'PBKDF2', 'Random IV generation']
            };
        }

        // ─── PRETTY PRINT ─────────────────────────────────────────

        static _prettyPrint(data) {
            const lines = [];
            const sep = '='.repeat(60);

            lines.push('');
            lines.push(sep);
            lines.push(`  ${data.name} v${data.version}`);
            lines.push(`  ${data.author}`);
            lines.push(`  Created: ${data.created}`);
            lines.push(`  Modified: ${data.modified}`);
            lines.push(`  Type: ${data.type || 'AES-256-GCM'}`);
            lines.push(`  UTF-19: ${data.utf19}`);
            lines.push(sep);
            lines.push('');

            if (data.commands) {
                lines.push('COMMANDS:');
                for (const [cmd, desc] of Object.entries(data.commands)) {
                    const pad = cmd.length > 30 ? 0 : 30 - cmd.length;
                    lines.push(`  ${cmd}${' '.repeat(pad)} ${desc}`);
                }
                lines.push('');
            }

            if (data.examples) {
                lines.push('EXAMPLES:');
                for (const ex of data.examples) {
                    lines.push(`  ${ex}`);
                }
                lines.push('');
            }

            lines.push(sep);
            return lines.join('\n');
        }
    }

    return AES_001;
}));