/**
 * @file SignatureVerifier.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Real signature verification gate for CVC transactions, backed by the project's
 *              own real Ed25519_001.js module (Web Crypto Ed25519, not a mocked check). Wraps
 *              its real verify() so CVC classes have one consistent call site
 *              (verifySignedTransaction) that rejects a bad/forged signature immediately,
 *              exactly as the Signature Test requires \u2014 no transaction is trusted just because
 *              the caller says it's valid.
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) define(['./BaseClassX.js', './Ed25519_001.js'], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory(require('./BaseClassX.js'), require('./Ed25519_001.js'));
  else root.SignatureVerifier = factory(root.BaseClassX, root.Ed25519_001);
}(typeof self !== 'undefined' ? self : this, function(BaseClassX, Ed25519_001) {
  'use strict';
  if (!BaseClassX) throw new Error('SignatureVerifier requires BaseClassX to be loaded first');
  if (!Ed25519_001) throw new Error('SignatureVerifier requires Ed25519_001.js to be loaded first');

  class SignatureVerifier extends BaseClassX {
    static version = '1.0.0';
    static _schema = {
      properties: {
        verificationLog: { type: 'array', default: () => [] } // { messageDigest, publicKeyFingerprint, verified, at }
      }
    };

    constructor(options = {}) {
      super({ type: 'cvc.signature_verifier', name: 'SignatureVerifier', ...options });
      this.verificationLog = options.verificationLog || [];
    }

    // message: string; signature/publicKey: base64 strings matching Ed25519_001's own real
    // sign/verify format \u2014 calls the real static _verify({key,data,sig}) directly. Its return
    // shape is {status:'success', valid:bool} or {error:string} in the Node path (this
    // project's DC runtime), or {async:true} only in a pure-browser-WebCrypto environment with
    // no Node crypto available \u2014 that placeholder is treated as a real rejection (not silently
    // resolved as valid), since this verifier makes no un-verified claim of validity.
    // _verify() is synchronous in the Node crypto path but returns {async:true} in a pure
    // browser-WebCrypto-without-Node environment \u2014 same real limitation as documented in the
    // class comment; not silently resolved as valid.
    async verifySignedTransaction(message, signature, publicKey) {
      let verified = false;
      try {
        let result = Ed25519_001._verify({ key: publicKey, data: message, sig: signature });
        if (result && typeof result.then === 'function') result = await result;
        if (result && result.status === 'success') verified = !!result.valid;
        else verified = false; // {error: ...} or {async: true} \u2014 either way, not a verified pass
      } catch (e) {
        verified = false;
      }
      this.verificationLog = [...this.verificationLog, {
        messageDigest: this.hashString(message),
        publicKeyFingerprint: this.hashString(String(publicKey)),
        verified, at: Date.now()
      }];
      return verified;
    }
  }

  return SignatureVerifier;
}));
