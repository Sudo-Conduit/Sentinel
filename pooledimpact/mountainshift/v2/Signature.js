/**
 * @file Signature.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description C.1 (MSOS Cleanup Roadmap): real cryptographic signing,
 *   the "checksum -> signature upgrade" ISO.verifyIntegrity() and
 *   FileFsBootAdapter's `.sha` sidecar were both named as needing --
 *   integrity-only (does this content match what was hashed?) is not
 *   authenticity (was this content produced by someone holding the
 *   private key, as opposed to any attacker who can recompute the same
 *   non-cryptographic hash BaseClassX.hashString()/this file's own
 *   duplicated `_hash()` helper produce over content THEY tampered with)?
 *   Anyone can regenerate a matching `.sha` sidecar for content they just
 *   modified -- that is the actual gap this file closes.
 *
 *   ECDSA (P-256, SHA-256) via the standard Web Crypto API
 *   (`crypto.subtle`) -- not a hand-rolled algorithm, not an external
 *   dependency. Confirmed live in this environment: Node 22's global
 *   `crypto.subtle` already IS a real, spec-compliant SubtleCrypto
 *   implementation (`crypto.webcrypto` under the hood), identical to a
 *   real browser's -- so this file needs no Node/Browser branching for
 *   the crypto operations themselves, only a defensive fallback to
 *   `require('crypto').webcrypto.subtle` for an older Node that has not
 *   yet exposed `crypto` as a global.
 *
 *   Deliberately ADDITIVE to ISO.js/FileFsBootAdapter.js/Installer.js,
 *   never replacing their existing checksum/hash behavior: a caller who
 *   never supplies a keypair sees ZERO behavior change (today's
 *   integrity-only checks keep working exactly as before); signature
 *   verification is opt-in, activated only by actually providing a
 *   publicKey. The private key never needs to leave whatever "signing
 *   authority" calls sign() -- only the public key is ever distributed to
 *   a boot-time verifier, and importPublicKeyJWK()'s imported key is
 *   deliberately usages-restricted to ['verify'] only, never ['sign'].
 * @docs Kernel-Machine-Architecture.md
 * @tests test/Signature.test.js
 */
(function(root, factory)
{
    if (typeof define === 'function' && define.amd)
    {
        define([], factory);
    }
    else if (typeof module === 'object' && module.exports)
    {
        module.exports = factory();
    }
    else
    {
        root.Signature = factory();
    }
}(typeof self !== 'undefined' ? self : this, function()
{
    'use strict';

    // Real, spec-compliant Web Crypto in both environments -- Node 22's
    // global `crypto` already IS this (confirmed live before writing this
    // file); the require() branch only matters for an older Node that has
    // not yet exposed it globally.
    const subtle = (typeof crypto !== 'undefined' && crypto.subtle)
        ? crypto.subtle
        : require('crypto').webcrypto.subtle;

    const ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' };
    const SIGN_PARAMS = { name: 'ECDSA', hash: 'SHA-256' };

    /**
     * @param {ArrayBuffer} buffer
     * @returns {string} base64
     */
    function bufferToBase64(buffer)
    {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++)
        {
            binary += String.fromCharCode(bytes[i]);
        }
        return typeof btoa === 'function' ? btoa(binary) : Buffer.from(binary, 'binary').toString('base64');
    }

    /**
     * @param {string} base64
     * @returns {Uint8Array}
     */
    function base64ToBuffer(base64)
    {
        const binary = typeof atob === 'function' ? atob(base64) : Buffer.from(base64, 'base64').toString('binary');
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++)
        {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }

    class Signature
    {
        static name = 'Signature';
        static author = 'Will Fobbs';
        static version = '1.0.0';
        static description = 'Real ECDSA (P-256/SHA-256) signing via the Web Crypto API -- the authenticity layer checksum-only integrity checks are missing.';
        static docs = ['Kernel-Machine-Architecture.md'];
        static tests = ['test/Signature.test.js'];

        /**
         * @returns {Promise<{publicKey: CryptoKey, privateKey: CryptoKey}>} a fresh ECDSA P-256 keypair
         */
        static async generateKeyPair()
        {
            return subtle.generateKey(ALGORITHM, true, ['sign', 'verify']);
        }

        /**
         * @param {CryptoKey} privateKey
         * @param {string} content - the real content being signed, as-is (not pre-hashed -- ECDSA hashes internally per SIGN_PARAMS)
         * @returns {Promise<string>} base64-encoded signature
         */
        static async sign(privateKey, content)
        {
            const data = new TextEncoder().encode(content);
            const sig = await subtle.sign(SIGN_PARAMS, privateKey, data);
            return bufferToBase64(sig);
        }

        /**
         * @param {CryptoKey} publicKey
         * @param {string} signatureBase64 - as produced by sign()
         * @param {string} content - the content to verify the signature against
         * @returns {Promise<boolean>} true only if signatureBase64 is a genuine ECDSA signature of EXACTLY this content, made by the matching private key
         */
        static async verify(publicKey, signatureBase64, content)
        {
            const data = new TextEncoder().encode(content);
            const sig = base64ToBuffer(signatureBase64);
            return subtle.verify(SIGN_PARAMS, publicKey, sig, data);
        }

        /**
         * @param {CryptoKey} publicKey
         * @returns {Promise<Object>} a JSON-serializable JWK -- safe to persist/distribute, contains no private material
         */
        static async exportPublicKeyJWK(publicKey)
        {
            return subtle.exportKey('jwk', publicKey);
        }

        /**
         * Imports a public key JWK with usage restricted to ['verify'] ONLY --
         * deliberately never ['sign'], since a public key must never be able
         * to produce a signature, only check one.
         * @param {Object} jwk - as produced by exportPublicKeyJWK()
         * @returns {Promise<CryptoKey>}
         */
        static async importPublicKeyJWK(jwk)
        {
            return subtle.importKey('jwk', jwk, ALGORITHM, true, ['verify']);
        }
    }

    return Signature;
}));
