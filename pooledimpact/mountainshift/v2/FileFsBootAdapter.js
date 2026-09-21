/**
 * @file FileFsBootAdapter.js
 * @author Will Fobbs
 * @version 1.1.0
 * @description Closes the gap BIOS.js's boot sequence left open: turns a
 *   BootDeviceScan hit (a same-named artifact on a storage surface) into a
 *   CONFIRMED boot entry by actually mounting it through FileFsX and
 *   checking for a real ESP/bootloader marker inside it. Without this,
 *   BootDeviceScan can only say "something named meshui-vol-<id> exists on
 *   this surface" — it can't tell a bootable volume from a same-named
 *   artifact that happens to share the naming convention but holds no OS.
 *   Implements the findBootEntry(device, firmwareType) contract BIOS.boot()
 *   already calls.
 *
 *   v1.1.0 (C.1, MSOS Cleanup Roadmap): optional real ECDSA signature
 *   verification via Signature.js, ADDITIVE to the existing `.sha` hash
 *   sidecar check, never replacing it. The hash sidecar alone is
 *   integrity-only: anyone who tampers with a marker's content can just
 *   recompute a matching `.sha` for their tampered version -- there is no
 *   secret involved, so a mismatched hash only ever catches accidental
 *   corruption, never deliberate tampering. Passing `options.publicKey`
 *   (a CryptoKey) to the constructor additionally requires a matching
 *   `.sig` sidecar (as written by Installer.js when given a privateKey)
 *   to verify against that key before a hit is confirmed bootable -- a
 *   hit with a valid hash but no genuine signature is rejected exactly
 *   like a missing/mismatched hash always was. Without a publicKey
 *   (the default), behavior is UNCHANGED from v1.0.0: today's hash-only
 *   check, every existing caller/test unaffected.
 * @docs Kernel-Machine-Architecture.md
 * @tests test/NextInjection.audit.test.js
 * @tests test/Signature.test.js
 */
(function(root, factory)
{
    if (typeof define === 'function' && define.amd)
    {
        define(['./BootDeviceScan.js', './Signature.js'], factory);
    }
    else if (typeof module === 'object' && module.exports)
    {
        module.exports = factory(require('./BootDeviceScan.js'), require('./Signature.js'));
    }
    else
    {
        root.FileFsBootAdapter = factory(root.BootDeviceScan, root.Signature);
    }
}(typeof self !== 'undefined' ? self : this, function(BootDeviceScan, Signature)
{
    'use strict';
    if (!BootDeviceScan)
    {
        throw new Error('FileFsBootAdapter requires BootDeviceScan.js to be loaded first');
    }

    // Sub-order within the 'disk' step, most-automatic first. 'picker' (a
    // real filesystem via the File System Access API) is last and, for now,
    // always skipped in automatic scanning: it requires an interactive user
    // gesture to grant access and cannot be probed headlessly — confirmed
    // unavailable in this environment. The seam stays open for a future UI
    // flow that calls the picker explicitly, on a real user click.
    const DISK_SUB_ORDER = ['idb', 'opfs', 'cache', 'picker'];

    // Every BootDeviceScan surface is now mountable through FileFsX.
    const MOUNTABLE_SURFACES = ['idb', 'opfs', 'cache'];

    function markerPathFor(firmwareType)
    {
        return firmwareType === 'BIOS-L' ? '/boot/boot.bin' : '/EFI/BOOT/BOOTX64.EFI';
    }

    // Same small hash used by ISO.js (via BaseClassX.hashString) and
    // Installer.js — duplicated here deliberately: this is a standalone
    // utility file, not a BaseClassX subclass, so it carries its own copy
    // rather than taking on a shared dependency for one function.
    function _hash(str)
    {
        let hash = 0;
        for (let i = 0; i < str.length; i++)
        {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash).toString(36);
    }

    class FileFsBootAdapter
    {
        static name = 'FileFsBootAdapter';
        static author = 'Will Fobbs';
        static version = '1.1.0';
        static description = 'Turns a BootDeviceScan hit into a CONFIRMED boot entry by mounting it through FileFsX and checking for a real ESP/bootloader marker.';
        static docs = ['Kernel-Machine-Architecture.md'];
        static tests = ['test/NextInjection.audit.test.js', 'test/Signature.test.js'];

        /**
         * @param {Object} FileFS - the FileFsX FileFS class
         * @param {Object} [options={}] - options.publicKey (a CryptoKey, see file header) enables real signature verification, additive to the hash check
         * @throws {Error} if FileFS is not provided
         */
        constructor(FileFS, options)
        {
            if (!FileFS)
            {
                throw new Error('FileFsBootAdapter requires the FileFsX FileFS class');
            }
            this.FileFS = FileFS;
            this.publicKey = (options && options.publicKey) || null;
        }

        /**
         * Implements the findBootEntry(device, firmwareType) contract
         * BIOS.boot() already calls.
         * @param {string} device - boot device step, e.g. 'disk' ('esp'/'network' lookups not implemented yet)
         * @param {string} firmwareType - firmware type, used to pick the bootloader marker path
         * @returns {Promise<{surface: string, id: string, removable: boolean, path: string, confirmed: boolean}|null>} the confirmed boot entry, or null if none found
         */
        async findBootEntry(device, firmwareType)
        {
            if (device !== 'disk')
            {
                return null; // 'esp'/'network' lookups not implemented yet
            }
            const hits = (await BootDeviceScan.scanAll()).filter(h => MOUNTABLE_SURFACES.includes(h.surface));
            const marker = markerPathFor(firmwareType);

            // Removable media first (step 5's real-BIOS convention: a bootable
            // USB stick, when present, is used before falling through to fixed
            // media), DISK_SUB_ORDER as the surface-priority tiebreak within
            // each removable/fixed group.
            const bySurfaceRank = s => { const i = DISK_SUB_ORDER.indexOf(s); return i === -1 ? DISK_SUB_ORDER.length : i; };
            const ordered = [...hits].sort((a, b) =>
            {
                if (a.removable !== b.removable)
                {
                    return a.removable ? -1 : 1;
                }
                return bySurfaceRank(a.surface) - bySurfaceRank(b.surface);
            });

            for (const hit of ordered)
            {
                try
                {
                    const fs = await this.FileFS.create({ backend: hit.surface, key: (hit.removable ? BootDeviceScan.USB_PREFIX : BootDeviceScan.VOLUME_PREFIX) + hit.id });
                    await fs.stat(marker);
                    // Content check, not just presence: real firmware re-checks
                    // before handoff (step 6) on EVERY boot — not only once, at
                    // install time, the way ISO.verifyIntegrity() runs.
                    // Installer.js writes a "<marker>.sha" sidecar alongside every
                    // installed file; a missing or mismatched sidecar means this
                    // marker is unconfirmed, even though a file exists at the path.
                    // This is an INTEGRITY check only, not authenticity (C.1,
                    // MSOS Cleanup Roadmap) -- anyone who tampers with the
                    // content can just recompute a matching hash for their
                    // tampered version, since no secret is involved.
                    const content = await fs.readFile(marker, 'utf8');
                    let sidecarOk = false;
                    try
                    {
                        const sidecar = await fs.readFile(marker + '.sha', 'utf8');
                        sidecarOk = sidecar === _hash(content);
                    }
                    catch (e)
                    {
                        sidecarOk = false;
                    }
                    if (!sidecarOk)
                    {
                        continue; // present but corrupted/tampered — not bootable, try the next hit
                    }

                    // Real authenticity, opt-in: only checked when this instance
                    // was configured with a trusted publicKey. A hit with a
                    // VALID hash but no genuine `.sig` signed by the matching
                    // private key is rejected exactly like a bad hash always
                    // was -- closing the actual gap the hash-only check above
                    // cannot: forging a matching hash is trivial, forging a
                    // matching signature requires the private key.
                    if (this.publicKey)
                    {
                        let sigOk = false;
                        try
                        {
                            const sig = await fs.readFile(marker + '.sig', 'utf8');
                            sigOk = await Signature.verify(this.publicKey, sig, content);
                        }
                        catch (e)
                        {
                            sigOk = false;
                        }
                        if (!sigOk)
                        {
                            continue; // hash matched, but not authentically signed — not bootable, try the next hit
                        }
                    }

                    return { surface: hit.surface, id: hit.id, removable: hit.removable, path: marker, confirmed: true };
                }
                catch (e)
                {
                    // no marker at that path on this volume — not bootable, try the next hit
                }
            }
            return null;
        }
    }

    return FileFsBootAdapter;
}));
