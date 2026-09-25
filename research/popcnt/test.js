// Verification suite for PopcntUnicode.js. Runs real encode/decode/file ops
// and reads results back — no "didn't throw" passes. `node test.js`, exits
// non-zero on any failure.
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const P = require('./PopcntUnicode.js');

let pass = 0, fail = 0;
function ok(name, cond) { console.log((cond ? 'PASS' : 'FAIL'), name); cond ? pass++ : fail++; }

// Proxy invariant: Object.keys works; internals hidden; instance immutable.
(function () {
  const pu = P();
  let keys = null, threw = false;
  try { keys = Object.keys(pu); } catch (e) { threw = true; }
  ok('Object.keys works (no Proxy invariant error)',
     !threw && JSON.stringify(keys) === JSON.stringify(['run', 'version', 'stdout', 'stderr', 'audit']));
  ok('internals hidden', pu.keys === undefined && pu.encrypt === undefined);
  let imm = false; try { pu.x = 1; } catch (e) { imm = true; } ok('instance immutable', imm);
})();

// Self-describing escape-safe unicode packer: round-trips through JSON + --text,
// no --bitLength needed, N as block capacity (payload < N).
(function () {
  const pu = P();
  pu.run('keygen --seed 12345 --N 200 --M 16 --id k1');
  const enc = pu.run("encode --key k1 --payload 'Hello World'");
  const dec = pu.run('decode --key k1 --text ' + JSON.stringify(enc.value));
  ok("unicode packer round-trip via --text, N>payload -> 'Hello World'",
     String.fromCharCode.apply(null, dec.value) === 'Hello World');
})();

// Every text packer round-trips.
(function () {
  const s = 'The quick brown fox jumps over the lazy dog 0123456789';
  for (const pk of ['base64', 'hex', 'unicode']) {
    const pu = P();
    pu.run('keygen --seed 7 --N ' + (s.length * 8) + ' --M 16 --id k1');
    const enc = pu.run('encode --key k1 --packer ' + pk + ' --payload ' + JSON.stringify(s));
    const dec = pu.run('decode --key k1 --packer ' + pk + ' --text ' + JSON.stringify(enc.value));
    ok('packer ' + pk + ' round-trip', String.fromCharCode.apply(null, dec.value) === s);
  }
})();

// FsMixin: byte-exact file encrypt/decrypt through a Node-shaped fs (raw packer).
(function () {
  const bin = path.join(__dirname, '.t.bin'), enc = path.join(__dirname, '.t.enc'), dec = path.join(__dirname, '.t.dec');
  const plain = zlib.gzipSync(Buffer.from('PAYLOAD '.repeat(500) + '\x00\x01\x02\xff'));
  fs.writeFileSync(bin, plain);
  const pu = P({ mixins: [P.FsMixin(fs)] });
  pu.run('keygen --seed 42 --N ' + (plain.length * 8) + ' --M 16 --id fk');
  pu.run('encrypt-file --in ' + bin + ' --out ' + enc + ' --key fk --packer raw');
  pu.run('decrypt-file --in ' + enc + ' --out ' + dec + ' --key fk --packer raw');
  const orig = fs.readFileSync(bin), out = fs.readFileSync(dec), ct = fs.readFileSync(enc);
  ok('file: encrypted differs from plaintext', Buffer.compare(orig, ct) !== 0);
  ok('file: decrypted is byte-exact', Buffer.compare(orig, out) === 0);
  for (const f of [bin, enc, dec]) { try { fs.unlinkSync(f); } catch (e) {} }
})();

// Gate chain (option-b composition point): auth token gate is fail-closed.
(function () {
  const Auth = (req) => (api) => api.addGate((c) => { if (req[c.cmd] && c.token !== req[c.cmd]) throw new Error('auth'); });
  const pu = P({ mixins: [Auth({ encode: 'S' })] });
  pu.run('keygen --seed 1 --N 200 --id k1');
  ok('auth gate blocks without token', pu.run('encode --key k1 --payload hi').type === 'error');
  ok('auth gate allows with token', pu.run('encode --key k1 --payload hi --token S').type === 'text');
})();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
