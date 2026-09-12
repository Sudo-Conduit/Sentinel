/**
 * @file ISO.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description An install image: an ordered file manifest (kernel/initrd
 *   equivalent, install script, the bootloader marker) plus a checksum for
 *   the boot sequence's step 6 integrity check. BaseClassX subclass —
 *   unlike CPU.js/MockUSBDrive.js, this IS domain state worth schema-
 *   tracking and fingerprinting (an install image's identity/version/
 *   provenance matters), not a high-frequency runtime engine.
 * @docs Kernel-Machine-Architecture.md
 * @tests test/NextInjection.audit.test.js
 */
(function(root, factory)
{
    if (typeof define === 'function' && define.amd)
    {
        define(['./BaseClassX.js'], factory);
    }
    else if (typeof module === 'object' && module.exports)
    {
        module.exports = factory(require('./BaseClassX.js'));
    }
    else
    {
        root.ISO = factory(root.BaseClassX);
    }
}(typeof self !== 'undefined' ? self : this, function(BaseClassX)
{
    'use strict';
    if (!BaseClassX)
    {
        throw new Error('ISO requires BaseClassX to be loaded first');
    }

    // A plain, closure-scoped function -- not a class method, private or
    // otherwise (next()-injection audit, A.4). #computeChecksum() (a true
    // private method, CPU.js's #registerInstructions() pattern) fixed the
    // constructor-self-call case, but introduced a NEW, worse failure: called
    // from verifyIntegrity() (a normal DISPATCHED method) once ISO is
    // composed via ExtendX.extend(), `this` there is ExtendX's frame Proxy,
    // and private-field/method brand checks do not forward through a Proxy
    // wrapper at all -- confirmed live: "Receiver must be an instance of
    // class ISO", thrown by the engine itself, not this code. So #private
    // only ever covers "called from the raw, un-proxied constructor"; it
    // does NOT generalize to "called from any other composed method's body",
    // which is exactly what verifyIntegrity() needs. A plain function that
    // takes manifest/hashFn as real parameters has no `this`, no class
    // brand, and therefore nothing for any Proxy layer to reject -- it works
    // identically whether called from the constructor or from a dispatched
    // method, proven in test/NextInjection.audit.test.js.
    function computeChecksumOf(manifest, hashFn)
    {
        const sorted = [...manifest].sort((a, b) => a.path.localeCompare(b.path));
        const data = sorted.map(f => f.path + '|' + f.content).join('\n');
        return hashFn(data);
    }

    class ISO extends BaseClassX
    {
        static name = 'ISO';
        static author = 'Will Fobbs';
        static version = '1.0.0';
        static domain = 'machine.iso';
        static description = 'An install image: ordered file manifest plus checksum for the boot sequence\'s step 6 integrity check.';
        static docs = ['Kernel-Machine-Architecture.md'];
        static tests = ['test/NextInjection.audit.test.js'];
        static _schema = { properties: {
            name: { type: 'string', default: '' },
            isoVersion: { type: 'string', default: '1.0.0' },
            firmwareType: { type: 'string', default: 'UEFI' },
            manifest: { type: 'array', default: [] },   // [{ path, content }]
            checksum: { type: 'string', default: '' }
        }};

        constructor(options = {})
        {
            super({ type: 'machine.iso', name: options.name || 'ISO' });
            this.name = options.name || '';
            this.isoVersion = options.isoVersion || '1.0.0';
            this.firmwareType = options.firmwareType || 'UEFI';
            this.manifest = options.manifest || [];
            this.checksum = options.checksum || computeChecksumOf(this.manifest, (d) => this.hashString(d));
        }

        /**
         * Deterministic checksum over manifest contents (sorted by path first,
         * so insertion order never affects the result).
         * @returns {string} the computed checksum
         */
        computeChecksum()
        {
            return computeChecksumOf(this.manifest, (d) => this.hashString(d));
        }

        /**
         * Step 6 of the boot sequence: verify integrity after checks. Throws
         * rather than returning false -- a failed integrity check is treated
         * with the same severity as a schema validation failure elsewhere in
         * this project, not silently ignored.
         * @returns {boolean} true if the checksum matches
         * @throws {Error} if the recomputed checksum does not match
         */
        verifyIntegrity()
        {
            const recomputed = computeChecksumOf(this.manifest, (d) => this.hashString(d));
            if (recomputed !== this.checksum)
            {
                throw new Error('ISO integrity check failed for "' + this.name + '": checksum mismatch (expected ' + this.checksum + ', got ' + recomputed + ')');
            }
            return true;
        }

        /**
         * Convenience: an ISO guaranteed to carry the UEFI bootloader marker
         * FileFsBootAdapter checks for, without every caller having to
         * remember the exact path.
         * @param {Object} [options={}] - same options as the constructor
         * @returns {ISO} a new ISO with the bootloader marker in its manifest
         */
        static withDefaultUEFIBootloader(options = {})
        {
            const manifest = options.manifest ? [...options.manifest] : [];
            if (!manifest.some(f => f.path === '/EFI/BOOT/BOOTX64.EFI'))
            {
                manifest.push({ path: '/EFI/BOOT/BOOTX64.EFI', content: options.bootloaderContent || 'stub-bootloader' });
            }
            return new ISO({ ...options, manifest });
        }
    }

    return ISO;
}));
