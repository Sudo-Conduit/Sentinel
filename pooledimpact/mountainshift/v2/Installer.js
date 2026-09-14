/**
 * @file Installer.js
 * @author Will Fobbs
 * @version 1.1.0
 * @description Runs an ISO's install manifest onto a fresh FileFsX-backed
 *   volume, named per BootDeviceScan's meshui-vol-<id> convention so the
 *   result is immediately findable by a subsequent boot scan. Stateless
 *   static utility, not a BaseClassX subclass — same reasoning as
 *   BootDeviceScan/FileFsBootAdapter: this performs host filesystem
 *   writes, there's no domain state of its own to schema-track (the ISO
 *   being installed already is one).
 *
 *   v1.1.0 (C.1, MSOS Cleanup Roadmap): options.privateKey (a CryptoKey)
 *   ADDITIONALLY writes a real ECDSA "<path>.sig" sidecar alongside the
 *   existing "<path>.sha" hash sidecar, never replacing it -- the
 *   authenticity half of "checksum -> signature upgrade," matched by
 *   FileFsBootAdapter.js's own opt-in signature check on the boot side.
 *   Without options.privateKey (the default), behavior is UNCHANGED from
 *   v1.0.0: only the hash sidecar is written, every existing caller/test
 *   unaffected.
 * @docs Kernel-Machine-Architecture.md
 * @tests test/NextInjection.audit.test.js
 * @tests test/Signature.test.js
 */
(function(root, factory)
{
    if (typeof define === 'function' && define.amd)
    {
        define(['./Signature.js'], factory);
    }
    else if (typeof module === 'object' && module.exports)
    {
        module.exports = factory(require('./Signature.js'));
    }
    else
    {
        root.Installer = factory(root.Signature);
    }
}(typeof self !== 'undefined' ? self : this, function(Signature)
{
    'use strict';

    const DEFAULT_PREFIX = 'meshui-vol-';

    // Same small hash FileFsBootAdapter.js checks against — duplicated
    // deliberately, same reasoning as there: standalone utility file, not
    // worth a shared dependency for one function.
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

    class Installer
    {
        static name = 'Installer';
        static author = 'Will Fobbs';
        static version = '1.1.0';
        static description = 'Runs an ISO\'s install manifest onto a fresh FileFsX-backed volume, named per BootDeviceScan\'s meshui-vol-<id> convention.';
        static docs = ['Kernel-Machine-Architecture.md'];
        static tests = ['test/NextInjection.audit.test.js', 'test/Signature.test.js'];

        /**
         * @param {Object} iso - an ISO instance (must pass verifyIntegrity())
         * @param {Object} [options={}] - options.FileFS (required, the FileFsX FileFS class),
         *   options.surface ('idb' | 'opfs' | 'cache', default 'idb'), options.id (volume id,
         *   becomes key `<prefix><id>`, default 'root'), options.removable (writes under the
         *   USB naming-convention prefix instead of the fixed-volume one, when
         *   BootDeviceScan.js is loaded), options.privateKey (a CryptoKey -- ADDITIONALLY
         *   writes a real ECDSA "<path>.sig" sidecar per file, see file header),
         *   options.publicKey (a CryptoKey -- ADDITIONALLY requires iso.verifyManifestSignature()
         *   to pass, on top of the existing iso.verifyIntegrity() check)
         * @returns {Promise<{surface: string, id: string, key: string, removable: boolean, installedFiles: string[]}>} install result summary
         * @throws {Error} if options.FileFS is not provided, iso.verifyIntegrity() fails,
         *   or (when options.publicKey is given) iso.verifyManifestSignature() fails
         */
        static async install(iso, options = {})
        {
            const FileFS = options.FileFS;
            if (!FileFS)
            {
                throw new Error('Installer.install requires a FileFsX FileFS class (options.FileFS)');
            }
            iso.verifyIntegrity();
            // Additive authenticity check (C.1): only required when a trusted
            // publicKey is actually supplied -- an ISO's own internal
            // consistency (verifyIntegrity()) never implies it came from a
            // trusted source, only that it wasn't accidentally corrupted.
            if (options.publicKey)
            {
                await iso.verifyManifestSignature(options.publicKey);
            }

            const surface = options.surface || 'idb';
            const id = options.id || 'root';
            const hasBDS = typeof BootDeviceScan !== 'undefined';
            const prefix = options.removable
                ? (hasBDS && BootDeviceScan.USB_PREFIX) || 'meshui-usb-'
                : (hasBDS && BootDeviceScan.VOLUME_PREFIX) || DEFAULT_PREFIX;
            const key = prefix + id;

            const fs = await FileFS.create({ backend: surface, key });
            const installedFiles = [];
            for (const file of iso.manifest)
            {
                const dir = file.path.split('/').slice(0, -1).join('/');
                if (dir && dir !== '')
                {
                    await fs.mkdir(dir, { recursive: true }).catch(() => {});
                }
                await fs.writeFile(file.path, file.content);
                // Sidecar checksum, checked by FileFsBootAdapter on every boot
                // (not just here, at install time) — see its findBootEntry.
                // Integrity only, not authenticity (C.1) -- always written,
                // unconditionally, matching v1.0.0's behavior exactly.
                await fs.writeFile(file.path + '.sha', _hash(file.content));
                // Real authenticity, opt-in: only written when options.privateKey
                // was supplied. FileFsBootAdapter's own signature check is
                // symmetric -- opt-in there too, via options.publicKey.
                if (options.privateKey)
                {
                    const sig = await Signature.sign(options.privateKey, file.content);
                    await fs.writeFile(file.path + '.sig', sig);
                }
                installedFiles.push(file.path);
            }

            return { surface, id, key, removable: !!options.removable, installedFiles };
        }
    }

    return Installer;
}));
