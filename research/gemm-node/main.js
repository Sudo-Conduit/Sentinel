const { Worker } = require('worker_threads');
const koffi = require('koffi');
const lib = koffi.load(__dirname + '/libgemm.so');
const pack = lib.func('void pack_b(const int8_t*,int8_t*,int,int)');

const [M,K,N,P,MODE,REPS,PIN] = process.argv.slice(2).map(Number);
const addr = lib.func('uintptr_t addr_of(void*)');
const ALIGN = 64;
/* Node hands back buffers at addr%64==16; offset into an over-allocated SAB so the
   view the kernel sees is 64B aligned (one cache line per 512-bit load). */
function alignedSab(n){
  const s = new SharedArrayBuffer(n + ALIGN);
  const off = (ALIGN - Number(BigInt(addr(Buffer.from(s))) % BigInt(ALIGN))) % ALIGN;
  return { s, off, buf: Buffer.from(s, off, n) };
}
const sab = n => new SharedArrayBuffer(n);
const Bo = alignedSab(K*N), Qo = alignedSab(K*N);
const Bsab=Bo.s, Qsab=Qo.s, B=Bo.buf, Q=Qo.buf;
for (let i=0;i<B.length;i++) B.writeInt8((i%11)-5, i);
pack(B, Q, K, N);                                  // weights packed once, as at model load

const copies = MODE ? P : 1;
const As=[], Cs=[];
for (let c=0;c<copies;c++){
  const ao=alignedSab(M*K), co=alignedSab(M*N*4);
  for (let i=0;i<ao.buf.length;i++) ao.buf[i]=i%17;
  As.push(ao); Cs.push(co);
}
const workers = [];
for (let t=0;t<P;t++){
  const r = Math.ceil(M/P);
  const wd = MODE
    ? { A:As[t].s, Ao:As[t].off, Q:Qsab, Qo:Qo.off, C:Cs[t].s, Co:Cs[t].off, M,K,N, i0:0, i1:M, cpu:(PIN? t%4 : -1) }              // P independent GEMMs
    : { A:As[0].s, Ao:As[0].off, Q:Qsab, Qo:Qo.off, C:Cs[0].s, Co:Cs[0].off, M,K,N, i0:t*r, i1:Math.min(t*r+r,M), cpu:(PIN? t%4 : -1) }; // one GEMM split over P
  workers.push(new Worker(__dirname+'/worker.js', { workerData: wd }));
}
const round = () => Promise.all(workers.map(w => new Promise(res => {
  w.once('message', res); w.postMessage(0);
})));
(async () => {
  await round();                                    // warmup
  let best = Infinity;
  for (let r=0;r<REPS;r++){
    const t0 = process.hrtime.bigint();
    await round();                                  // <-- Promise.all submit
    const dt = Number(process.hrtime.bigint()-t0)/1e9;
    if (dt < best) best = dt;
  }
  const gemms = MODE ? P : 1;
  console.log((gemms*2*M*N*K/best/1e9).toFixed(1));
  workers.forEach(w=>w.terminate());
})();
