# Vendored from ANEForge

`ane_e5rt_dispatch.mm` and `e5rt_api.h` are copied unmodified from
[sbryngelson/ANEForge](https://github.com/sbryngelson/ANEForge)
(`aneforge/_lib/`), MIT licensed, Copyright (c) 2026 Spencer H. Bryngelson.

This is the dispatch shim that compiles a MIL program and runs it on the ANE
through `Espresso.framework`'s `e5rt_*` C API -- unentitled, reachable via
`dlopen` + `dlsym` from an ordinary process. `ane_provider.mjs` binds its
public C ABI (`ane_e5rt_program_compile` / `set_input_fp16` / `execute` /
`get_output_fp16` / `release`) via koffi.

See ANEForge's own `docs/e5rt-dispatch-reference.md` for the full call
sequence and the ABI discoveries (out-pointer-first argument order, the
`compute_device_types_mask` bitmask, etc.) this project depends on.
