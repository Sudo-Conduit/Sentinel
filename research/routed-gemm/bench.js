const { aligned, packWeights, routedGemm, denseGemm } = require('./index.js');
const cfgs = [
  { name: 'Mixtral-ish  E=8',  B: 720,  K: 2048, N: 2048, E: 8  },
  { name: 'fine-grained E=64', B: 720,  K: 2048, N: 2048, E: 64 },
  { name: 'Qwen-ish     E=60', B: 720,  K: 1024, N: 1408, E: 60 },
  { name: 'big batch    E=8',  B: 4096, K: 2048, N: 2048, E: 8  },
];
const med = a => { a = [...a].sort((x,y)=>x-y); const n=a.length;
                   return n%2 ? a[(n-1)/2] : (a[n/2-1]+a[n/2])/2; };
console.log('\nrouted-gemm from Node via koffi, 4 threads, median of 3\n');
console.log('config                 B     E |   dense ms  routed ms |  dense-equiv GFLOPS |  GB/s not moved | speedup');
for (const c of cfgs) {
  const { B,K,N,E } = c;
  const X = aligned(B*K), W = aligned(E*K*N);
  for (let i=0;i<X.length;i++) X[i] = i % 31;
  for (let i=0;i<W.length;i++) W.writeInt8((i % 25) - 12, i);
  const Wp = packWeights(W, K, N, E);
  const route = aligned(B*4);
  for (let b=0;b<B;b++) route.writeInt32LE((b*7 + (b>>3)) % E, b*4);
  const Yr = aligned(B*N*4), Yd = aligned(B*N*4);

  routedGemm(X, Wp, route, Yr, c); denseGemm(X, Wp, route, Yd, c);   // warm + verify
  let bad = 0;
  for (let i=0;i<B*N;i++) if (Yr.readInt32LE(i*4) !== Yd.readInt32LE(i*4)) { bad++; if (bad===1) console.log(`  MISMATCH at ${i}`); }
  const tr=[], td=[];
  for (let r=0;r<3;r++){ let t=process.hrtime.bigint(); routedGemm(X,Wp,route,Yr,c); tr.push(Number(process.hrtime.bigint()-t)/1e6);
                              t=process.hrtime.bigint(); denseGemm (X,Wp,route,Yd,c); td.push(Number(process.hrtime.bigint()-t)/1e6); }
  const d=med(td), rt=med(tr);
  // the work a dense implementation MUST perform to produce this same answer
  const denseWork  = 2*B*E*K*N;
  // the intermediate a dense implementation MUST materialise and read back
  const denseBytes = E*B*N*4;
  const equivGF = denseWork/(rt/1e3)/1e9;
  const avoidGB = (denseBytes - B*N*4)/(rt/1e3)/1e9;
  console.log(`${c.name.padEnd(20)} ${String(B).padStart(5)} ${String(E).padStart(5)} |`
    + `${d.toFixed(1).padStart(10)} ${rt.toFixed(1).padStart(10)} |`
    + `${equivGF.toFixed(0).padStart(19)} |`
    + `${avoidGB.toFixed(1).padStart(16)} |`
    + `${(d/rt).toFixed(1).padStart(7)}x`
    + (bad ? `  *** ${bad} MISMATCHES ***` : '  exact'));
}
console.log();
