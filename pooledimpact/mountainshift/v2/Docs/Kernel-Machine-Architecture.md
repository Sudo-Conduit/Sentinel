# Kernel/Machine Architecture — Analysis & Plan

## The two systems

**App-end stack** (built so far): App → UI → OS UI (Darwin-style shell) → OS (macOS-style) → Unix (GNU) → Kernel → Memory → Registry → Bits.

**Machine-end stack** (today's focus): Kernel ←— Handoff —→ Machine: BIOS → Physical [Hardware, Energy].

The Kernel is the seam. Everything built to date (VB6IDE, Terminal, FileFsX, TopMonitor) lives above it, treating "kernel" as a metaphor. Nothing below Kernel — Memory, Registry, Bits, BIOS, Physical — exists as real BaseClassX domain objects yet.

## What already exists, remapped

- **Terminal** = the Unix/GNU shell layer. Talks to `session`/`vfs` context objects, not a real kernel.
- **FileFsX** = filesystem abstraction with pluggable backends (OPFS/IDB/localStorage/picker). This is *storage*, not *memory* — it persists across reloads by design, whereas Memory (below) should be volatile, address-space-shaped, and reset on "reboot."
- **TopMonitor** = job control (`jobs`/`fg`/`bg`/`kill`). This is the closest thing to a scheduler today, but it's ad hoc — no process table, no real Kernel object owns it.
- **BaseClassX** = already the right substrate for Kernel/Memory/Registry: schema-tracked state, fingerprinting, history/trace, versioning — same reasons it underlies every domain class so far.

## Gaps — new domain classes needed

1. **Kernel.js** — owns a process table (PID → process descriptor: owner uid/gid from the v0019 session work, state: running/blocked/zombie, priority), a scheduler (run queue, currently simulated by TopMonitor's jobs), and a syscall dispatch surface (`read`/`write`/`fork`/`exec` as the seam Terminal commands actually call through, instead of touching `vfs` directly).
2. **Memory.js** — an address-space model: allocated regions, a simple paging/segment table, volatile (wiped on reboot, unlike FileFsX). Processes from Kernel.js get a Memory instance.
3. **Registry.js** — machine-level persistent key/value state (boot config, device table, env defaults) — parallel to FileFsX but *not* file-shaped, the way a real OS registry/NVRAM differs from a filesystem.
4. **Bits** — not a class; the terminal representation. Modeled as typed byte arrays inside Memory/Registry, not a BaseClassX instance of its own.
5. **BIOS.js** — the boot sequence class: POST → device enumeration → bootloader handoff → constructs and returns a Kernel instance. This is literally the `Handoff` in the diagram.
6. **Physical.js** — hardware + energy resource model: CPU/RAM/storage capacity ceilings Kernel.js schedules against, plus an energy budget. (Notable cross-portfolio tie: this is the same shape CleanEnergy's future fleet-monitoring dashboard would need — worth keeping the model generic.)

## Handoff semantics

`Kernel ←— Handoff —→ Machine` is the boundary where BaseClassX-owned simulation ends and where, in a real machine, actual hardware takes over. In-browser, `BIOS.boot()` is the handoff: it's the one call that's allowed to reach outside BaseClassX's normal schema-Proxy world to seed Kernel.js with whatever Physical.js reports (a stand-in for real hardware detection).

## Proposed dependency direction (new)

```
BIOS.boot() → Kernel (owns) → Memory (per-process)
                     ↓
                Registry (machine-level config)
                     ↓
        Terminal/TopMonitor/FileFsX (existing App-end, now callers not owners)
```

TopMonitor's job control becomes a thin view over Kernel.js's process table instead of holding its own. Terminal syscalls route through Kernel.js instead of hitting `vfs` directly.

## Reference analysis: CPU.js as the literal Machine-end

The pasted CPU.js (UMD+IIFE) resolves the open "how literal" question decisively: **functionally real, not conceptual.** It's a real register/memory/interrupt interpreter — EAX–EDX/ESI/EDI/EBP/ESP/EIP/EFLAGS, segment registers, CR0–CR4, MSRs, a PIC (master/slave), an IDT, a flat byte-array memory space, a fetch→decode→execute loop, and a real instruction set (MOV/ADD/SUB/PUSH/POP/JMP/CALL/RET/CMP/JE/JNE/INT/STI/CLI/HLT/IN/OUT/RDMSR/WRMSR/LIDT/…). `boot()`/`reset()` load a literal bootstrap byte sequence at `0x7C00` and fire `INT 0x10` — that IS the Handoff, instantiated, not just diagrammed. This is the same shape a WASM interpreter takes (linear memory + opcode dispatch loop + register file), just x86-flavored instead of WASM's ISA — a legitimate stand-in until/unless a real WASM VM is embedded.

Mapping onto the planned classes:
- **BIOS.js** → `boot()`/`reset()` + the raw `bios[]` byte load + `INT 0x10` sequence, already built.
- **Physical.js** → the register file + PIC + IDT + MSRs. This *is* the hardware surface Physical.js was meant to describe — CPU.js already IS Physical.js's engine, not a stub to build separately.
- **Memory.js** → `this.memory` flat array + `memoryRead`/`memoryWrite`. Memory.js (paging/segments, volatile) should wrap this array, not reinvent it.
- **Registry.js** → naming collision worth resolving: MSRs (`this.MSR`) are literally hardware model-specific registers, functionally what "machine-level registry" means. Decide whether Registry.js *is* the MSR table plus boot config, or a separate layer above it.
- **Kernel.js** → not present yet. CPU.js gets to real-mode execution + interrupt dispatch, no process table/scheduler. The empty `this.substrate = {tokens, capabilities, processes, stack, sp, bp, run}` is the deliberate seam — exactly where Kernel.js's process table attaches.

Architectural fit with BaseClassX: CPU.js runs entirely outside BaseClassX's Proxy/schema/trace world — by design, the same way FileFsX/LoadingIcon keep high-frequency runtime state (DOM refs, timers) in a WeakMap outside the schema Proxy. Register/memory writes happen too fast and too low-level to be schema-validated per write. The right seam: a `Kernel` BaseClassX instance holds a CPU.js instance as a runtime handle (WeakMap, not a schema property), exposes lifecycle (`boot`/`reset`/`run`) through normal BaseClassX methods, and only the *process table* (PID/owner/state/priority) becomes real schema-tracked children — not individual register writes.

## Boot sequence spec (native UNIX reference)

1. CPU.js intentionally does NOT extend BaseClassX — confirmed. It's the runtime engine a Kernel instance holds by reference (WeakMap), not a schema-tracked domain object.
2. **POST** — BIOS gets hardware ready: enumerate/init CPU, RAM, chipset, attached devices. Failures here halt before anything filesystem-aware can run.
3. **NVRAM/CMOS read** — BIOS reads its own persisted environment: boot device priority list, hardware config flags, time/date, any saved settings. This is Registry.js's real referent, not the MSR table (correction to the earlier analysis) — NVRAM is small, persistent, non-file-shaped machine config; MSRs are live CPU control state. Keep them as two separate things.
4. **Ephemeral memory** — everything BIOS touches (POST results, device tables, its own working state) lives in volatile RAM, gone on power-cycle. Matches Memory.js's "volatile, reset on reboot" design already planned.
5. **Kernel search order** — BIOS/UEFI never searches for "a kernel" directly; it searches for a *bootable stage* per device, in NVRAM's configured priority (typically: removable/optical media first during install, then fixed disk once installed; UEFI adds network/PXE as an option). Per device, the real check differs by scheme:
   - **Legacy/MBR**: read the device's first 512-byte sector, verify the `0x55AA` boot signature, hand off to whatever bootloader code lives there.
   - **UEFI/GPT**: read the EFI System Partition, resolve either a saved NVRAM boot entry or the default `/EFI/BOOT/BOOTX64.EFI`.
   First device that yields a valid signature/entry wins; BIOS stops searching. The *kernel itself* is found later, by the bootloader (step 6), per its own config — not by BIOS.
6. **Handoff to bootloader, post integrity check** — BIOS validates the signature/entry (the "integrity check"), then transfers control. For a fresh install, that bootloader is the ISO's own (ISOLINUX/GRUB via El Torito spec, or UEFI's `BOOTX64.EFI`), which reads its bundled config to locate the installer kernel + initrd on the ISO itself.
7. **ISO install process(es)** — partitioning, base filesystem population, kernel + initrd copy to the target disk, bootloader install to the target disk's MBR/ESP.
8. **Reboot #1** — this time BIOS's device-priority scan (step 5) finds the *target disk's* bootloader instead of the ISO, because a real kernel+OS now live on that disk's filesystem.
9. **OS setup** — first-boot configuration (locale, users, services) running under the now-installed kernel.
10. **Reboot #2** — clean boot of the fully installed system.
11. **Welcome screen.**
12. **Login.**

Mapping to earlier classes: step 2 → Physical.js (CPU.js's POST-equivalent init). Step 3 → Registry.js, now scoped specifically to NVRAM-shaped boot config (not MSRs). Step 5–6 → BIOS.js's `boot()` plus a new small "boot device scan" concept — worth modeling as an ordered list BIOS.js consults, not a single hardcoded path like CPU.js's current literal `0x7C00` load. Step 7 onward is Kernel/OS territory, out of BIOS.js's scope entirely.

## Firmware decision: UEFI

Using UEFI as the default `firmwareType` on `BIOS.js`. No strong reason for BIOS-L (legacy MBR/CSM) surfaced — this is a fresh simulated machine with no legacy-hardware constraint, and ISO installers already default to UEFI+GPT+ESP. `BIOS-L` stays available as an explicit opt-in for a deliberate legacy scenario, not the default path.

## Stub classes built (v0023)

- `CPU.js` — the reference engine, saved as-is (register/memory/interrupt interpreter), minus the self-executing demo boot script at the bottom (that was a scratch harness, not part of the module). Confirmed intentionally NOT extending BaseClassX.
- `Environment.js` — BaseClassX subclass; `Environment.detect()` reads `navigator` (browser/worker) or `process`/`os` (Node) — the boot sequence's step 3.
- `Physical.js` — BaseClassX subclass wrapping CPU.js as a WeakMap runtime handle; schema tracks capacity/RAM/storage/energy figures only. `post()` powers on and constructs the CPU.
- `Memory.js` — BaseClassX subclass; schema-tracked `regions` ledger, backing byte store (a Physical's CPU.memory, or standalone) held in a WeakMap, wiped on every `attach()`.
- `Kernel.js` — BaseClassX subclass; schema-tracked `processes` table + round-robin `tick()`; Physical/Environment held as WeakMap runtime handles via `attach()`.
- `BIOS.js` — BaseClassX subclass; `boot(physical, fs)` runs POST, reads Environment, scans `bootDeviceOrder` for a boot entry (via an optional `fs.findBootEntry(device, firmwareType)`), then constructs and returns an attached Kernel.

## Registry.js — decided: keep separate

Built as its own class (`Registry.js`), not folded into BIOS.js. Small key/value store (`entries`), seeded with `bootDeviceOrder`/`firmwareType`/`secureBoot` defaults; `BIOS.attachRegistry(registry)` reads it at step 3 and overrides the BIOS instance's own schema defaults when present. No hard dependency between the two files — `attachRegistry` only needs a `get`/`has`-shaped object.

## Reference analysis: MockUSBDrive.js as a device, not a second filesystem

Same fidelity level as CPU.js — a real mechanical stand-in (sector math, FAT16/FAT32/exFAT/NTFS/EXT4 enum, connect/disconnect/mount/unmount/hotplug lifecycle, export/import, tree view), not a conceptual stub. Its `readFile/writeFile/mkdir/readdir/unlink/rmdir/stat/rename` surface is deliberately Node-`fs`-shaped — that's "matches the WASM interface": a WASM module's imported fs calls (or a real IDBFS/OPFS-backed WASI shim) target exactly this surface. Correctly NOT a BaseClassX subclass, same reasoning as CPU.js — this is host-emulation runtime state (sectors, bytes, timing), not domain/business state.

**Overlap to resolve before wiring it in:** MockUSBDrive reimplements its own UTF-8 encode/decode, its own path normalization, and its own Map-based file/directory store — all of which FileFsX already owns, and FileFsX already has a real IndexedDB backend (`FileFsX.create({backend:'idb', key})`, since v0022). Two independent filesystem implementations is the wrong shape here. The plan to back it with IDBFS should mean: **MockUSBDrive becomes a device façade in front of a FileFsX IndexedDB mount**, not a second filesystem with its own IndexedDB store. Keep MockUSBDrive's genuinely new parts — sector/capacity math, the FS-type label, and above all the connect/mount/hotplug lifecycle FileFsX has no concept of — and have its `readFile`/`writeFile`/etc. delegate to the attached FileFsX mount instead of its own `_files`/`_directories` Maps.

**Where it plugs into the Machine-end stack:** a USB stick is a real boot-device candidate. `BIOS.js`'s `bootDeviceOrder` (`['esp','disk','network']`) and its optional `fs.findBootEntry(device, firmwareType)` hook were built for exactly this — MockUSBDrive (as a device façade) implementing `findBootEntry` closes the "always falls through to `bootedFrom: 'none'`" gap already flagged in Next Steps. Also the concrete first real device for whatever Registry.js's `bootDeviceOrder` scan eventually enumerates against.

## Boot device scan: IDB, OPFS, and Cache as one storage surface set

Same treatment as MockUSBDrive: OPFS and the Cache API are hard-drive surfaces exactly like IDB, not special cases. `BootDeviceScan.js` scans all three for entries matching one naming convention (`meshui-vol-<id>` — an IndexedDB database name, an OPFS root directory name, or a Cache API cache name) and returns every hit across all three, since the same volume id can legitimately live on more than one surface. `BIOS.boot()` is now `async`; its 'disk' bootDeviceOrder step calls `BootDeviceScan.scanAll()` when no explicit `fs` adapter is given and finds a match. Everything NOT named with that prefix (FileFsX's own `'FileFsX'` IndexedDB database, in particular) stays invisible to the boot scan — bootable and non-bootable storage share surfaces, not names.

## Step 3 status: FileFsX-backed boot-entry confirmation — done

`FileFsBootAdapter.js` closes this. `BootDeviceScan.scanAll()` alone can only say "something named `meshui-vol-<id>` exists on this surface" — it can't distinguish a real bootable volume from an artifact that happens to share the naming convention. The adapter mounts each IDB/OPFS hit through `FileFsX.create({backend, key})` and checks for a real marker path (`/EFI/BOOT/BOOTX64.EFI` for UEFI, `/boot/boot.bin` for BIOS-L) before calling it confirmed — implementing the exact `findBootEntry(device, firmwareType)` contract `BIOS.boot()` already calls. Pass a `new FileFsBootAdapter(FileFS)` as BIOS.boot()'s `fs` argument to get confirmed lookups; without it, boot() still falls back to BootDeviceScan's unconfirmed raw hit. Known gap, not yet solved: Cache API hits have no FileFsX backend to mount them through, so they're excluded from `MOUNTABLE_SURFACES` for now.

## CacheFS: the Cache API backend — done

`FileFsX.js` gained `backend: 'cache'`, mechanical and parallel to the existing opfs/idb/localstorage branches: `caches.open(this.key)` (cache named after the mount key, matching `BootDeviceScan`'s `meshui-vol-<id>` convention) holding one synthetic `Response` at `/mount.json`. `FileFsBootAdapter.js`'s `MOUNTABLE_SURFACES` now includes `'cache'` — the gap flagged above is closed; all three BootDeviceScan surfaces are mountable and confirmable through FileFsX.

## Disk sub-order: idb → opfs → cache → picker (last, unavailable for now)

`FileFsBootAdapter.js`'s `DISK_SUB_ORDER` fixes the scan order within the 'disk' step across its (now 3-4) storage sub-options: `idb`, `opfs`, `cache` — all probeable automatically — then `picker` (a real filesystem via the File System Access API). `picker` is deliberately last and excluded from `MOUNTABLE_SURFACES`: it requires an interactive user gesture to grant access, confirmed unavailable for headless/automatic scanning in this environment. The seam stays open for a future explicit-gesture UI flow to add it back in as a real, on-click boot option.

## ISO install path: built

`ISO.js` (BaseClassX subclass — an install image IS domain state worth fingerprinting, unlike the stateless machine-layer utilities), `Installer.js` (stateless, writes an ISO's manifest onto a fresh FileFsX volume named per the `meshui-vol-` convention), and `BIOS.js`'s new third `boot(physical, fs, iso)` argument implementing steps 6-8: when nothing bootable is found, `iso.verifyIntegrity()` runs (throws on checksum mismatch — same severity as any other integrity failure in this project), `Installer.install()` writes the manifest to `installTargetSurface`/`installTargetId` (schema-tracked, default `idb`/`root`), then the same `fs.findBootEntry('disk', ...)` call re-runs against what was just written — the post-install reboot (step 8), without an actual page reload. Without an `iso` argument, behavior is unchanged: `bootedFrom: 'none'`, matching real hardware's "no bootable device" outcome.

## Bug fixed: BootDeviceScan.scanIDB() convention mismatch

Original `scanIDB()` scanned `indexedDB.databases()` for names matching `meshui-vol-<id>`, assuming one database per volume. FileFsX's real `idb` backend keeps every mount as a ROW (keyed by mount key) in one shared `'FileFsX'` database's `'mounts'` store, never a separate database per mount — so the original scan could never find a real FileFsX-backed idb volume. Fixed to open `'FileFsX'` and enumerate keys in `'mounts'` instead. Caught by the smoke test's fresh-install path: `post-install bootedFrom` stayed `'none'` after a successful, integrity-checked, traced install — the installed volume existed but the scan couldn't see it.

## Bug fixed: BootDeviceScan.scanOPFS() convention mismatch

Same class of bug as `scanIDB()`. FileFsX's real `opfs` backend stores a mount as a FILE named `<key>.json` at the OPFS root (via `getFileHandle`), never a directory named `<key>` — `scanOPFS()` was only looking for directories, so it could never find a real FileFsX-backed OPFS volume either. Fixed to look for `.json` files and strip the extension before classifying. Caught the same way as the idb bug: a StorageDevice.usb() volume on `opfs` never appeared in scan results, so the removable-preferred sort in step 6 below had nothing removable to prefer.

## USB vs hard-drive, bootloader content check, Registry persistence — built

- `StorageDevice.js`: one class, `removable` flag distinguishes `StorageDevice.usb()` (prefix `meshui-usb-`) from `StorageDevice.hardDrive()` (prefix `meshui-vol-`); both delegate reads/writes to an attached FileFsX mount. `BootDeviceScan.js` now classifies both prefixes across all three surfaces, tagging each hit `removable: true/false`.
- `FileFsBootAdapter.findBootEntry()` sorts hits removable-first (step 5's real-BIOS convention — a bootable USB stick, when present, wins over fixed media), `DISK_SUB_ORDER` as tiebreak within each group. It also now reads the marker file's actual content and compares it against a `<marker>.sha` sidecar checksum — presence alone (`fs.stat()`) is no longer enough to confirm a boot entry; an unsigned or tampered marker is treated as not bootable. `Installer.install()` writes that sidecar for every manifest file at install time.
- `Registry.js` gained opt-in `save(FileFS, options)`/`static load(FileFS, options)` — still in-memory by default and unchanged for any existing caller, but boot config can now be written to and read back from a real FileFsX backend (default `idb`), surviving a full page reload instead of only one `boot()` call.

## Clarification: `removable` is a device property, not a surface property

`removable` describes the volume's identity (`StorageDevice.usb()` vs `.hardDrive()`, via the `meshui-usb-`/`meshui-vol-` naming prefix) — never the storage surface it happens to be backed by. OPFS, IDB, and the Cache API are all persistent, origin-scoped browser storage; none of them has any real removability. Any surface can back either device type — the smoke test backing its simulated USB stick with `opfs` and its simulated hard drive with `cache` was an arbitrary test choice, not a rule. A log line like `{"surface":"opfs","removable":true}` says "this removable-typed volume happens to be stored via OPFS," not "OPFS is removable."

## Kernel.tick() now runs real CPU quanta — done

`tick(quantum)` (default 10 steps) is no longer trace-only. Each running process gets its register context restored into the attached Physical's `cpu` (or `cpu.boot()`'s clean state, for a fresh process with `context: null`), runs `cpu.run(quantum)` — CPU.js's real fetch/decode/execute loop — then has its context captured back out before the next process's turn. One CPU is shared, so this is genuine save/restore context-switching, not per-process CPU instances. `fork()` now initializes `context: null`. Known limitation, not yet solved: every fresh process starts from the same clean register state (no separate program loading/entry point per process yet) — on today's all-zero memory this just advances EIP by `quantum` each tick with no real workload, but the save/restore/execute plumbing is genuinely wired end to end.

## Next steps

1. Rewire Procd (formerly TopMonitor)'s `jobs/fg/bg/kill` to read/write Kernel.js's process table instead of its own state. (Still open — everything below is new.)
2. ~~Registry.js scope~~ — done, kept separate.
3. ~~FileFsX-backed boot-entry confirmation~~ — done (`FileFsBootAdapter.js`).
4. ~~Kernel-Machine-Smoke-Test.html~~ — done, now covers boot/fork/alloc/tick/kill, confirmed + unconfirmed disk lookup, and the fresh-install path.
5. Implement the `'esp'` and `'network'` `bootDeviceOrder` steps in `FileFsBootAdapter.js` — currently only `'disk'` is real; both other devices always return `null`, silently skipped rather than genuinely checked.
6. Distinguish removable (USB) vs fixed (hard-drive) volumes in the disk scan — wire `MockUSBDrive.js` in as the device façade already scoped (sector math, FS-type label, connect/mount/hotplug lifecycle over a FileFsX mount) so `bootDeviceOrder`'s 'disk' step can genuinely prefer removable media during install and fixed media once installed, per step 5's real-BIOS behavior, instead of treating every hit on a surface as interchangeable.
7. Validate the bootloader's actual content, not just its presence — `FileFsBootAdapter.findBootEntry` currently treats any file at the marker path as confirmed (`fs.stat()` only). Real firmware validates a signature; add a minimal content/checksum check on the marker file itself, on every boot, not only during `ISO.verifyIntegrity()` at install time.
8. Persist `Registry.js` to a real FileFsX-backed surface (idb or localstorage) — it's in-memory only today, which contradicts its own "persistent NVRAM-equivalent" description. Boot config should survive a full page reload, not just a `boot()` call within one page session.
9. Wire `Kernel.tick()` to actually execute a CPU timeslice via the attached `Physical`'s `cpu.run(steps)`, turning the round-robin scheduler from a trace-only stub into real quantum-based scheduling — the last major seam between Kernel's process table and CPU.js's real fetch/decode/execute loop.
10. Rewire `Procd`'s job-control demos (`demo top`/`demo lasagna`/etc.) to source their process list from `Kernel.ps()` instead of their own synthetic `_demoProcs()`, once #1 lands — making the terminal's `ps`/`jobs`/`top` output and the Kernel's actual process table the same data, not two parallel fictions.
