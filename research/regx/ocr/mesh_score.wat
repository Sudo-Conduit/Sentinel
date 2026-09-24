;; mesh_score.wat -- the popcount identity (score = 72 - 2*popcount(bits XOR canon))
;; as a real WASM module, compiled ONCE and called many times (no per-call
;; compile/instantiate cost, unlike RegX's compileAndRun path). 72 bits fits
;; in two i64 halves, and i64.popcnt is core WASM MVP -- no SIMD proposal
;; needed for this specific op.
(module
  (func $mesh_score (export "mesh_score")
    (param $bits_lo i64) (param $bits_hi i64)
    (param $canon_lo i64) (param $canon_hi i64)
    (result i32)
    (local $xor_lo i64)
    (local $xor_hi i64)
    (local $hamming i32)
    (local.set $xor_lo (i64.xor (local.get $bits_lo) (local.get $canon_lo)))
    (local.set $xor_hi (i64.xor (local.get $bits_hi) (local.get $canon_hi)))
    (local.set $hamming
      (i32.add
        (i32.wrap_i64 (i64.popcnt (local.get $xor_lo)))
        (i32.wrap_i64 (i64.popcnt (local.get $xor_hi)))))
    (i32.sub (i32.const 72) (i32.mul (i32.const 2) (local.get $hamming)))
  )
)
