// Individual-class (white-box) test: Signature.js (C.1, MSOS Cleanup
// Roadmap) and its wiring into ISO.js/Installer.js/FileFsBootAdapter.js --
// the "checksum -> signature upgrade" the roadmap named both files as
// needing. Full life-cycle proof: real ECDSA sign/verify/tamper-detection/
// wrong-key-rejection/JWK round-trip -> ISO.signManifest()/
// verifyManifestSignature() -> the full Installer-writes/FileFsBootAdapter-
// verifies path, including the actual proof this closes a real gap a hash
// alone cannot: a forged hash defeats the OLD check, but not a forged
// signature.
//
// NOTE: helpers.js's check() only catches SYNCHRONOUS throws -- every
// async outcome below is awaited to a settled value first.
//
// Run with: node test/Signature.test.js
'use strict';
const path = require('path');
const V2 = path.join(__dirname, '..');
require(path.join(V2, 'BaseClassX.js'));
const Signature = require(path.join(V2, 'Signature.js'));
const ISO = require(path.join(V2, 'ISO.js'));
const Installer = require(path.join(V2, 'Installer.js'));
const BootDeviceScan = require(path.join(V2, 'BootDeviceScan.js'));
const FileFsBootAdapter = require(path.join(V2, 'FileFsBootAdapter.js'));
const { check, report } = require('./helpers.js');

// Minimal in-memory fake of the FileFsX FileFS contract Installer.install()/
// FileFsBootAdapter.findBootEntry() actually use (create/mkdir/writeFile/
// readFile/stat) -- there is no real FileFsX.js in this Node-side project,
// same reason every other boot-chain test in this suite fakes its I/O.
function makeFakeFileFS() {
    const volumes = new Map(); // key -> Map<path, content>
    return {
        create: async ({ key }) => {
            if (!volumes.has(key)) {
                volumes.set(key, new Map());
            }
            const files = volumes.get(key);
            return {
                mkdir: async () => {},
                writeFile: async (p, content) => { files.set(p, content); },
                readFile: async (p) => {
                    if (!files.has(p)) throw new Error('ENOENT: ' + p);
                    return files.get(p);
                },
                stat: async (p) => {
                    if (!files.has(p)) throw new Error('ENOENT: ' + p);
                    return {};
                },
                _files: files // test-only escape hatch for direct tamper simulation
            };
        }
    };
}

async function run() {
    // ═══ Signature.js core primitives ═══
    const { publicKey, privateKey } = await Signature.generateKeyPair();
    const sig = await Signature.sign(privateKey, 'real content');

    const verifiedGood = await Signature.verify(publicKey, sig, 'real content');
    check('sign()/verify(): a genuine signature verifies against the correct content and key', () => {
        if (verifiedGood !== true) throw new Error('expected true');
    });
    const verifiedTampered = await Signature.verify(publicKey, sig, 'tampered content');
    check('verify(): a signature does NOT verify against different content -- tamper detection', () => {
        if (verifiedTampered !== false) throw new Error('expected false');
    });
    const other = await Signature.generateKeyPair();
    const verifiedWrongKey = await Signature.verify(other.publicKey, sig, 'real content');
    check('verify(): a signature does NOT verify against the WRONG public key', () => {
        if (verifiedWrongKey !== false) throw new Error('expected false');
    });
    const jwk = await Signature.exportPublicKeyJWK(publicKey);
    const imported = await Signature.importPublicKeyJWK(jwk);
    const verifiedImported = await Signature.verify(imported, sig, 'real content');
    check('exportPublicKeyJWK()/importPublicKeyJWK(): a round-tripped public key still verifies correctly', () => {
        if (verifiedImported !== true) throw new Error('expected true');
    });
    let importedCanSign = true;
    try {
        await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, imported, new TextEncoder().encode('x'));
    } catch (e) {
        importedCanSign = false;
    }
    check('importPublicKeyJWK(): the imported key is usage-restricted to verify only, never sign', () => {
        if (importedCanSign) throw new Error('an imported "public" key should never be able to produce a signature');
    });

    // ═══ ISO.js: signManifest()/verifyManifestSignature() ═══
    const iso = ISO.withDefaultUEFIBootloader({ name: 'test-iso' });
    let noSigError = null;
    try { await iso.verifyManifestSignature(publicKey); } catch (e) { noSigError = e; }
    check('ISO.verifyManifestSignature(): throws when no signature has been set yet', () => {
        if (!noSigError) throw new Error('expected a throw');
    });

    await iso.signManifest(privateKey);
    check('ISO.signManifest(): sets a real, non-empty signature', () => {
        if (!iso.signature || typeof iso.signature !== 'string') throw new Error('expected a real signature string');
    });
    const isoVerified = await iso.verifyManifestSignature(publicKey);
    check('ISO.verifyManifestSignature(): a genuine signature verifies against the correct public key', () => {
        if (isoVerified !== true) throw new Error('expected true');
    });

    const isoWrongKeyIso = ISO.withDefaultUEFIBootloader({ name: 'test-iso-wrongkey' });
    await isoWrongKeyIso.signManifest(privateKey);
    let wrongKeyError = null;
    try { await isoWrongKeyIso.verifyManifestSignature(other.publicKey); } catch (e) { wrongKeyError = e; }
    check('ISO.verifyManifestSignature(): throws against the WRONG public key', () => {
        if (!wrongKeyError) throw new Error('expected a throw');
    });

    check('ISO.verifyIntegrity(): completely UNCHANGED for an ISO that never signs at all (regression guard)', () => {
        const plain = ISO.withDefaultUEFIBootloader({ name: 'plain-iso' });
        if (plain.verifyIntegrity() !== true) throw new Error('expected verifyIntegrity() to still pass unchanged');
        if (plain.signature !== '') throw new Error('expected signature to default to empty string');
    });

    // ═══ Full Installer -> FileFsBootAdapter path ═══

    // --- regression guard: no keys at all -- behavior UNCHANGED from before C.1 ---
    {
        const fakeFS = makeFakeFileFS();
        const plainIso = ISO.withDefaultUEFIBootloader({ name: 'no-keys-iso' });
        await Installer.install(plainIso, { FileFS: fakeFS, id: 'noKeys' });
        BootDeviceScan.scanAll = async () => [{ surface: 'idb', id: 'noKeys', removable: false }];
        const adapter = new FileFsBootAdapter(fakeFS);
        const entry = await adapter.findBootEntry('disk', 'UEFI');
        check('regression: no publicKey configured -- findBootEntry() still confirms via hash alone, exactly as before C.1', () => {
            if (!entry || entry.confirmed !== true) throw new Error('expected a confirmed entry, got ' + JSON.stringify(entry));
        });
    }

    // --- real authenticity: privateKey at install + matching publicKey at
    // the adapter -- confirmed via a genuine signature, not just a hash ---
    {
        const fakeFS = makeFakeFileFS();
        const signedIso = ISO.withDefaultUEFIBootloader({ name: 'signed-iso' });
        await Installer.install(signedIso, { FileFS: fakeFS, id: 'signed', privateKey });
        BootDeviceScan.scanAll = async () => [{ surface: 'idb', id: 'signed', removable: false }];
        const adapter = new FileFsBootAdapter(fakeFS, { publicKey });
        const entry = await adapter.findBootEntry('disk', 'UEFI');
        check('real authenticity: a genuinely signed install confirms via signature verification', () => {
            if (!entry || entry.confirmed !== true) throw new Error('expected a confirmed entry, got ' + JSON.stringify(entry));
        });
    }

    // --- the actual gap being closed: a hash can be trivially forged by
    // anyone who tampers with the content; a signature cannot ---
    {
        const fakeFS = makeFakeFileFS();
        const signedIso = ISO.withDefaultUEFIBootloader({ name: 'tampered-after-sign' });
        await Installer.install(signedIso, { FileFS: fakeFS, id: 'tampered', privateKey });
        BootDeviceScan.scanAll = async () => [{ surface: 'idb', id: 'tampered', removable: false }];

        // Simulate an attacker: tamper with the marker's content AND forge a
        // matching .sha for it (trivial -- no secret needed), but they do NOT
        // have the private key, so the REAL .sig sidecar is left untouched
        // and now signs content that no longer matches.
        const fs = await fakeFS.create({ key: 'meshui-vol-tampered' });
        const marker = '/EFI/BOOT/BOOTX64.EFI';
        const tamperedContent = 'malicious-payload';
        function forgeHash(str) {
            let hash = 0;
            for (let i = 0; i < str.length; i++) { hash = ((hash << 5) - hash) + str.charCodeAt(i); hash |= 0; }
            return Math.abs(hash).toString(36);
        }
        fs._files.set(marker, tamperedContent);
        fs._files.set(marker + '.sha', forgeHash(tamperedContent)); // attacker CAN forge this

        const adapterNoKey = new FileFsBootAdapter(fakeFS);
        const entryNoKey = await adapterNoKey.findBootEntry('disk', 'UEFI');
        check('THE GAP: hash-only verification (no publicKey configured) is fooled by a forged hash -- confirms the OLD check alone is insufficient', () => {
            if (!entryNoKey || entryNoKey.confirmed !== true) throw new Error('expected the hash-only check to be fooled, proving the gap exists');
        });

        const adapterWithKey = new FileFsBootAdapter(fakeFS, { publicKey });
        const entryWithKey = await adapterWithKey.findBootEntry('disk', 'UEFI');
        check('THE FIX: with a publicKey configured, the SAME forged-hash tampering is REJECTED -- the attacker cannot forge a matching signature without the private key', () => {
            if (entryWithKey !== null) throw new Error('expected null (rejected), got ' + JSON.stringify(entryWithKey));
        });
    }

    // --- a valid hash+content but a signature from a DIFFERENT keypair is
    // also rejected (not just "missing signature") ---
    {
        const fakeFS = makeFakeFileFS();
        const signedIso = ISO.withDefaultUEFIBootloader({ name: 'wrong-signer' });
        await Installer.install(signedIso, { FileFS: fakeFS, id: 'wrongSigner', privateKey: other.privateKey });
        BootDeviceScan.scanAll = async () => [{ surface: 'idb', id: 'wrongSigner', removable: false }];
        const adapter = new FileFsBootAdapter(fakeFS, { publicKey }); // trusts the ORIGINAL keypair, not "other"
        const entry = await adapter.findBootEntry('disk', 'UEFI');
        check('a hash+content signed by a DIFFERENT (untrusted) private key is rejected by the configured publicKey', () => {
            if (entry !== null) throw new Error('expected null (rejected), got ' + JSON.stringify(entry));
        });
    }

    // --- missing .sig sidecar entirely (e.g. installed without a
    // privateKey) while a publicKey IS configured on the adapter ---
    {
        const fakeFS = makeFakeFileFS();
        const unsignedIso = ISO.withDefaultUEFIBootloader({ name: 'unsigned-install' });
        await Installer.install(unsignedIso, { FileFS: fakeFS, id: 'unsigned' }); // no privateKey -- no .sig written
        BootDeviceScan.scanAll = async () => [{ surface: 'idb', id: 'unsigned', removable: false }];
        const adapter = new FileFsBootAdapter(fakeFS, { publicKey });
        const entry = await adapter.findBootEntry('disk', 'UEFI');
        check('a valid hash with NO .sig sidecar at all is rejected once a publicKey is configured', () => {
            if (entry !== null) throw new Error('expected null (rejected), got ' + JSON.stringify(entry));
        });
    }

    // --- Installer.install() itself: options.publicKey requires the ISO's
    // OWN manifest signature to verify before any files are written ---
    {
        const fakeFS = makeFakeFileFS();
        const unsignedIsoForInstall = ISO.withDefaultUEFIBootloader({ name: 'unsigned-iso-for-install' });
        let installError = null;
        try {
            await Installer.install(unsignedIsoForInstall, { FileFS: fakeFS, id: 'shouldFail', publicKey });
        } catch (e) {
            installError = e;
        }
        check('Installer.install(): options.publicKey requires iso.verifyManifestSignature() to pass BEFORE writing any files', () => {
            if (!installError) throw new Error('expected install() to throw for an unsigned ISO when a publicKey is required');
        });
    }

    report();
}

run().catch((err) => {
    console.error('Signature.test.js failed:', err);
    process.exitCode = 1;
});
