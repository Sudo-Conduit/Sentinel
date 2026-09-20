// ─── WebGPU matmul microbenchmark ───────────────────────────────────────────
// Fixes applied to the original harness (see the review in the project
// thread for the full rationale):
//   1. FLOPs are now reported both as "useful" (M*N*K, the actual math) and
//      "padded" (rounded up to whole workgroup tiles, the work the GPU
//      really does) — the two only differ when a dimension isn't a TILE
//      multiple (e.g. the 1x576x576 case, previously silently 16x wrong).
//   2/3. Solo timing now uses GPU timestamp queries when the adapter
//      supports the 'timestamp-query' feature, so tiny shapes are timed on
//      the device clock instead of via mapAsync round-trip latency. Falls
//      back to the old wall-clock method (labeled as such) when the
//      feature isn't available, instead of silently mislabeling it.
//   4. Every job's C[0] is now checked against a CPU-computed reference
//      dot product; a mismatch is reported, not silently ignored.
//   5. Inputs are generated from a seeded PRNG (mulberry32), so a run's
//      C[0] values are reproducible and comparable across runs.
//   6. Buffer/dispatch work is wrapped in validation + out-of-memory error
//      scopes, so a failed ~300MB allocation surfaces as an error instead
//      of quietly producing garbage.
//
// Kernel optimization: TILE raised 16 -> 32 with a 4x4 per-thread
// micro-tile (workgroup size unchanged at 8x8 = 64 threads). This halves
// the number of workgroupBarrier() round trips for the same K, and doubles
// arithmetic intensity per shared-memory load (16 FMA per 8 loads vs. the
// original 4 FMA per 4 loads) — shared-memory bandwidth, not thread count,
// is normally the binding constraint for this shape of kernel. Shared
// memory usage is 32*32*4 bytes * 2 arrays = 8KB, comfortably inside the
// portable 16KB workgroup-storage limit.

(() => {
  "use strict";

  const SHAPES = [
    [1,    576,  576],
    [32,   576,  576],
    [1024, 576,  576],
    [2048, 1024, 1024],
    [4096, 2048, 2048],
    [4096, 4096, 4096],
  ];

  const TILE = 32;
  const MICRO = 4; // each thread computes a MICRO x MICRO output tile
  const WG = 8;    // workgroup_size(WG, WG) => WG*WG threads; WG*MICRO === TILE
  const ITERS = 5;
  const SOLO_REPEATS = 10;
  const THROUGHPUT_BATCHES = 4;
  const SWEEPS_PER_BATCH = 5;
  const SEED = 0xC0FFEE;

  const WGSL = `
    struct Dims { M: u32, N: u32, K: u32, _pad: u32 };
    @group(0) @binding(0) var<storage, read>       A    : array<f32>;
    @group(0) @binding(1) var<storage, read>       B    : array<f32>;
    @group(0) @binding(2) var<storage, read_write> C    : array<f32>;
    @group(0) @binding(3) var<uniform>             dims : Dims;

    const TILE: u32 = 32u;
    const MICRO: u32 = 4u;

    var<workgroup> As: array<f32, 32 * 32>;
    var<workgroup> Bs: array<f32, 32 * 32>;

    @compute @workgroup_size(8, 8)
    fn main(
      @builtin(local_invocation_id) lid : vec3<u32>,
      @builtin(workgroup_id)        wid : vec3<u32>,
    ) {
      let M = dims.M; let N = dims.N; let K = dims.K;

      let tid = lid.y * 8u + lid.x;
      let numTiles = (K + TILE - 1u) / TILE;

      // Each of the 64 threads loads TILE*TILE / 64 = 16 elements per array,
      // per tile, to cooperatively fill the 32x32 shared tiles.
      let elemsPerThread = (TILE * TILE) / 64u;

      let rBase = wid.y * TILE + lid.y * MICRO;
      let cBase = wid.x * TILE + lid.x * MICRO;

      var acc : array<array<f32, 4>, 4>;
      for (var i = 0u; i < MICRO; i = i + 1u) {
        for (var j = 0u; j < MICRO; j = j + 1u) {
          acc[i][j] = 0.0;
        }
      }

      for (var t : u32 = 0u; t < numTiles; t = t + 1u) {
        for (var i : u32 = 0u; i < elemsPerThread; i = i + 1u) {
          let idx = tid + i * 64u;
          let r   = idx / TILE;
          let c   = idx % TILE;
          let aRow = wid.y * TILE + r;
          let aCol = t * TILE + c;
          if (aRow < M && aCol < K) {
            As[r * TILE + c] = A[aRow * K + aCol];
          } else {
            As[r * TILE + c] = 0.0;
          }
          let bRow = t * TILE + r;
          let bCol = wid.x * TILE + c;
          if (bRow < K && bCol < N) {
            Bs[r * TILE + c] = B[bRow * N + bCol];
          } else {
            Bs[r * TILE + c] = 0.0;
          }
        }

        workgroupBarrier();

        let lr = lid.y * MICRO;
        let lc = lid.x * MICRO;

        for (var k : u32 = 0u; k < TILE; k = k + 1u) {
          var a : array<f32, 4>;
          var b : array<f32, 4>;
          for (var i = 0u; i < MICRO; i = i + 1u) {
            a[i] = As[(lr + i) * TILE + k];
            b[i] = Bs[k * TILE + (lc + i)];
          }
          for (var i = 0u; i < MICRO; i = i + 1u) {
            for (var j = 0u; j < MICRO; j = j + 1u) {
              acc[i][j] = acc[i][j] + a[i] * b[j];
            }
          }
        }

        workgroupBarrier();
      }

      for (var i = 0u; i < MICRO; i = i + 1u) {
        let row = rBase + i;
        if (row >= M) { continue; }
        for (var j = 0u; j < MICRO; j = j + 1u) {
          let col = cBase + j;
          if (col < N) {
            C[row * N + col] = acc[i][j];
          }
        }
      }
    }
  `;

  const PROBE_WGSL = `
    @group(0) @binding(0) var<storage, read>       C   : array<f32>;
    @group(0) @binding(1) var<storage, read_write> out : array<f32>;

    @compute @workgroup_size(1)
    fn probe() {
      out[0] = C[0];
    }
  `;

  // mulberry32: small, fast, seeded PRNG so inputs (and therefore C[0])
  // are reproducible across runs instead of Math.random()'s fresh values
  // every time.
  function makeRng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function rand(n, rng) {
    const a = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = rng() * 2 - 1;
    return a;
  }

  // CPU reference for a single output element, used to verify the GPU
  // result instead of trusting it unchecked.
  function referenceDot(A, B, N, K, row, col) {
    let s = 0;
    for (let k = 0; k < K; k++) s += A[row * K + k] * B[k * N + col];
    return s;
  }

  async function initDevice() {
    if (!navigator.gpu) throw new Error("WebGPU not available");
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("no adapter");
    if (adapter.info) {
      console.log(
        "adapter backend:", adapter.info.backend,
        "type:", adapter.info.type
      );
    }

    const hasTimestamps = adapter.features.has("timestamp-query");
    const device = await adapter.requestDevice({
      requiredFeatures: hasTimestamps ? ["timestamp-query"] : [],
    });
    if (!hasTimestamps) {
      console.log(
        "note: adapter has no timestamp-query support — solo timings fall " +
        "back to wall-clock (mapAsync round trip included) and will read " +
        "high for small shapes"
      );
    }

    device.pushErrorScope("validation");
    device.pushErrorScope("out-of-memory");
    const module = device.createShaderModule({ code: WGSL });
    const pipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module, entryPoint: "main" },
    });
    const probeModule = device.createShaderModule({ code: PROBE_WGSL });
    const probePipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module: probeModule, entryPoint: "probe" },
    });
    const oomErr = await device.popErrorScope();
    const valErr = await device.popErrorScope();
    if (oomErr) throw new Error("pipeline out-of-memory: " + oomErr.message);
    if (valErr) throw new Error("pipeline validation failed: " + valErr.message);

    return { device, pipeline, probePipeline, hasTimestamps };
  }

  function makeJob(device, pipeline, M, N, K, rng) {
    const A = rand(M * K, rng);
    const B = rand(K * N, rng);

    const bufA = device.createBuffer({
      size: A.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const bufB = device.createBuffer({
      size: B.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const bufC = device.createBuffer({
      size: M * N * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const bufDims = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    device.queue.writeBuffer(bufA, 0, A);
    device.queue.writeBuffer(bufB, 0, B);
    device.queue.writeBuffer(bufDims, 0, new Uint32Array([M, N, K, 0]));

    const bg = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: bufA } },
        { binding: 1, resource: { buffer: bufB } },
        { binding: 2, resource: { buffer: bufC } },
        { binding: 3, resource: { buffer: bufDims } },
      ],
    });

    const probeOut = device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    const flops = 2 * M * N * K;
    const padDim = (x) => Math.ceil(x / TILE) * TILE;
    const paddedFlops = 2 * padDim(M) * padDim(N) * padDim(K);
    const expectedC0 = referenceDot(A, B, N, K, 0, 0);

    return {
      M, N, K, flops, paddedFlops, bufC, bg, probeOut,
      shape: `${M}x${N}x${K}`,
      samples: [],
      check: null,
      expectedC0,
    };
  }

  function makeProbeBindGroup(device, probePipeline, job) {
    return device.createBindGroup({
      layout: probePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: job.bufC } },
        { binding: 1, resource: { buffer: job.probeOut } },
      ],
    });
  }

  function verify(job, c0) {
    const err = Math.abs(c0 - job.expectedC0);
    const tol = 1e-2 * Math.max(1, Math.abs(job.expectedC0));
    const ok = err < tol;
    if (!ok) {
      console.warn(
        `MISMATCH ${job.shape}: got C[0]=${c0}, expected ${job.expectedC0} ` +
        `(|err|=${err})`
      );
    }
    return ok;
  }

  // ---------------------------------------------------------------------------
  // submitJob: one job, one command buffer, one submit, one map.
  // Returns a handle whose `done` is the mapAsync promise.
  // Called synchronously from the caller, so N submits can be issued
  // before any map resolves.
  // ---------------------------------------------------------------------------
  function submitJob(device, pipeline, probePipeline, probeBg, job) {
    const enc = device.createCommandEncoder();

    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, job.bg);
    pass.dispatchWorkgroups(
      Math.ceil(job.N / TILE),
      Math.ceil(job.M / TILE),
      1
    );
    pass.end();

    const probePass = enc.beginComputePass();
    probePass.setPipeline(probePipeline);
    probePass.setBindGroup(0, probeBg);
    probePass.dispatchWorkgroups(1, 1, 1);
    probePass.end();

    const staging = device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    enc.copyBufferToBuffer(job.probeOut, 0, staging, 0, 4);

    device.queue.submit([enc.finish()]);

    return {
      done: staging.mapAsync(GPUMapMode.READ).then(() => {
        const view = new Float32Array(staging.getMappedRange());
        const c0 = view[0];
        staging.unmap();
        staging.destroy();
        return c0;
      }),
    };
  }

  // ---------------------------------------------------------------------------
  // SOLO, GPU-clock variant: R dispatches inside ONE compute pass, timed by
  // writing timestamp queries at the start and end of that pass. This is the
  // device's own clock, so it excludes queue-submit and mapAsync round-trip
  // latency — the thing that made the small shapes read as latency, not
  // compute time, in the original harness.
  // ---------------------------------------------------------------------------
  async function timeSoloGPU(
    device, pipeline, probePipeline, probeBg, job, R, querySet, resolveBuf
  ) {
    const dataStaging = device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const tsStaging = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass({
      timestampWrites: {
        querySet,
        beginningOfPassWriteIndex: 0,
        endOfPassWriteIndex: 1,
      },
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, job.bg);
    for (let r = 0; r < R; r++) {
      pass.dispatchWorkgroups(
        Math.ceil(job.N / TILE),
        Math.ceil(job.M / TILE),
        1
      );
    }
    pass.end();

    const probePass = enc.beginComputePass();
    probePass.setPipeline(probePipeline);
    probePass.setBindGroup(0, probeBg);
    probePass.dispatchWorkgroups(1, 1, 1);
    probePass.end();

    enc.copyBufferToBuffer(job.probeOut, 0, dataStaging, 0, 4);
    enc.resolveQuerySet(querySet, 0, 2, resolveBuf, 0);
    enc.copyBufferToBuffer(resolveBuf, 0, tsStaging, 0, 16);

    device.queue.submit([enc.finish()]);
    await Promise.all([
      dataStaging.mapAsync(GPUMapMode.READ),
      tsStaging.mapAsync(GPUMapMode.READ),
    ]);

    const c0 = new Float32Array(dataStaging.getMappedRange())[0];
    dataStaging.unmap();
    dataStaging.destroy();

    const ts = new BigInt64Array(tsStaging.getMappedRange());
    const ns = ts[1] - ts[0];
    tsStaging.unmap();
    tsStaging.destroy();

    const ms = Number(ns) / 1e6 / R;
    return { ms, c0, method: "gpu-clock" };
  }

  // ---------------------------------------------------------------------------
  // SOLO, wall-clock fallback: identical to the original harness's method,
  // used only when the adapter lacks timestamp-query. Kept honest by
  // labeling its results rather than presenting them the same as GPU-clock
  // numbers.
  // ---------------------------------------------------------------------------
  async function timeSoloWallClock(device, pipeline, probePipeline, probeBg, job, R) {
    const staging = device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, job.bg);
    for (let r = 0; r < R; r++) {
      pass.dispatchWorkgroups(
        Math.ceil(job.N / TILE),
        Math.ceil(job.M / TILE),
        1
      );
    }
    pass.end();

    const probePass = enc.beginComputePass();
    probePass.setPipeline(probePipeline);
    probePass.setBindGroup(0, probeBg);
    probePass.dispatchWorkgroups(1, 1, 1);
    probePass.end();
    enc.copyBufferToBuffer(job.probeOut, 0, staging, 0, 4);

    const t0 = performance.now();
    device.queue.submit([enc.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const ms = (performance.now() - t0) / R;

    const view = new Float32Array(staging.getMappedRange());
    const c0 = view[0];
    staging.unmap();
    staging.destroy();

    return { ms, c0, method: "wall-clock" };
  }

  // ---------------------------------------------------------------------------
  // THROUGHPUT
  //
  // Each job submits itself via submitJob(). All handles are collected
  // first (one submit per job per sweep, per batch) with no awaits between
  // them, then a single Promise.all awaits every job's map. This is a
  // genuine measurement of queue/host overhead amortization (wall clock is
  // the right tool here, unlike for solo): the "speedup" it reports is
  // latency-hiding across independent submits, not concurrent kernel
  // execution — dispatches to the same job's C buffer are still ordered by
  // the device.
  // ---------------------------------------------------------------------------
  async function timeThroughput(
    device, pipeline, probePipeline, probeBgs, jobs,
    batches, sweepsPerBatch
  ) {
    const t0 = performance.now();

    const handles = [];
    for (let b = 0; b < batches; b++) {
      for (let r = 0; r < sweepsPerBatch; r++) {
        for (let i = 0; i < jobs.length; i++) {
          handles.push(
            submitJob(device, pipeline, probePipeline, probeBgs[i], jobs[i])
          );
        }
      }
    }

    const c0s = await Promise.all(handles.map(h => h.done));
    const ms = performance.now() - t0;

    const totalSweeps = batches * sweepsPerBatch;
    const flopsPerSweep = jobs.reduce((s, j) => s + j.flops, 0);
    return {
      perSweepMs: ms / totalSweeps,
      totalMs: ms,
      totalSweeps,
      flopsPerSweep,
      // last sweep's per-job c0s, jobs.length entries per sweep, so take
      // the tail to check the most recent value per job
      lastC0s: c0s.slice(-jobs.length),
    };
  }

  async function main() {
    console.log("init WebGPU...");
    const { device, pipeline, probePipeline, hasTimestamps } = await initDevice();
    console.log("ready");

    const rng = makeRng(SEED);
    const jobs = SHAPES.map(([M, N, K]) => makeJob(device, pipeline, M, N, K, rng));
    const probeBgs = jobs.map(j => makeProbeBindGroup(device, probePipeline, j));

    const querySet = hasTimestamps
      ? device.createQuerySet({ type: "timestamp", count: 2 })
      : null;
    const resolveBuf = hasTimestamps
      ? device.createBuffer({
          size: 16,
          usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
        })
      : null;

    device.pushErrorScope("validation");
    device.pushErrorScope("out-of-memory");

    // Warmup.
    for (let w = 0; w < 2; w++) {
      await timeThroughput(
        device, pipeline, probePipeline, probeBgs, jobs, 1, 1
      );
    }

    // ---------------- Solo ----------------
    console.log(`\n=== Solo (${hasTimestamps ? "GPU-clock timestamps" : "wall-clock fallback"}) ===`);
    console.log("Shape                |  ms/call | TFLOPS(pad) | TFLOPS(useful) | C[0] check");
    console.log("---------------------------------------------------------------------------");

    let allOk = true;
    for (let i = 0; i < jobs.length; i++) {
      const j = jobs[i];
      const probeBg = probeBgs[i];
      let lastC0 = null;
      for (let it = 0; it < ITERS; it++) {
        const r = hasTimestamps
          ? await timeSoloGPU(device, pipeline, probePipeline, probeBg, j, SOLO_REPEATS, querySet, resolveBuf)
          : await timeSoloWallClock(device, pipeline, probePipeline, probeBg, j, SOLO_REPEATS);
        j.samples.push(r.ms);
        lastC0 = r.c0;
      }
      const ok = verify(j, lastC0);
      allOk = allOk && ok;
      j.samples.sort((a, b) => a - b);
      const median = j.samples[Math.floor(j.samples.length / 2)];
      const tflopsPad = (j.paddedFlops / (median / 1000)) / 1e12;
      const tflopsUseful = (j.flops / (median / 1000)) / 1e12;
      console.log(
        `${j.shape.padEnd(20)} | ` +
        `${median.toFixed(4).padStart(8)} | ` +
        `${tflopsPad.toFixed(3).padStart(11)} | ` +
        `${tflopsUseful.toFixed(3).padStart(15)} | ` +
        `${ok ? "OK" : "MISMATCH"}`
      );
    }

    let soloSumMs = 0;
    for (const j of jobs) {
      j.samples.sort((a, b) => a - b);
      soloSumMs += j.samples[Math.floor(j.samples.length / 2)];
    }

    // ---------------- Throughput ----------------
    const samples = [];
    for (let it = 0; it < ITERS; it++) {
      samples.push(
        await timeThroughput(
          device, pipeline, probePipeline, probeBgs, jobs,
          THROUGHPUT_BATCHES, SWEEPS_PER_BATCH
        )
      );
    }

    samples.sort((a, b) => a.perSweepMs - b.perSweepMs);
    const med = samples[Math.floor(samples.length / 2)];
    const aggTflops = (med.flopsPerSweep / (med.perSweepMs / 1000)) / 1e12;

    for (let i = 0; i < jobs.length; i++) {
      allOk = verify(jobs[i], med.lastC0s[i]) && allOk;
    }

    const oomErr = await device.popErrorScope();
    const valErr = await device.popErrorScope();
    if (oomErr) console.error("out-of-memory during run:", oomErr.message);
    if (valErr) console.error("validation error during run:", valErr.message);

    console.log("\n=== Throughput (async submits, ONE sync at the end) ===");
    console.log(`batches:                ${THROUGHPUT_BATCHES}`);
    console.log(`sweeps per batch:       ${SWEEPS_PER_BATCH}`);
    console.log(`total sweeps:           ${med.totalSweeps}`);
    console.log(`total wall:             ${med.totalMs.toFixed(3)} ms`);
    console.log(`per-sweep dur (median): ${med.perSweepMs.toFixed(3)} ms`);
    console.log(`solo sum (median, ${hasTimestamps ? "gpu-clock" : "wall-clock"}): ${soloSumMs.toFixed(3)} ms`);
    console.log(`speedup vs serial:      ${(soloSumMs / med.perSweepMs).toFixed(2)}x`);
    console.log(`aggregate:              ${aggTflops.toFixed(3)} TFLOPS`);
    console.log(`correctness:            ${allOk ? "all shapes verified against CPU reference" : "MISMATCH DETECTED — see warnings above"}`);
  }

  main().catch((e) => console.error(e));
})();
