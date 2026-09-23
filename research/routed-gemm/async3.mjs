// Two shapes of the same walk set:
//   A  Promise.resolve().then(f)      one statement, one microtask, no yield
//   B  async fn, per-expert chunks with a real await between them
// The walks are identical work; only the scheduling shape differs.
import fs from 'fs';
const [B,K,N,E] = [720,512,512,64];
const inst = new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync('./dmm.wasm')), {});
const mem = inst.exports.memory, al = o => (o+63)&~63;
let off = al(inst.exports.__heap_base.value);
const hdrBase = off; off += 64*128;
const xOff = off; off = al(off + B*K*4);
const wOff = off; off = al(off + E*K*N*4);
const rtOff = off; off = al(off + B*4);
const yOff = off; off = al(off + B*N*4);
const sOff = off; off = al(off + B*N*4);
const f32 = new Float32Array(mem.buffer), i32 = new Int32Array(mem.buffer);
for (let b=0;b<B;b++) for (let k=0;k<K;k++) f32[xOff/4+b*K+k] = (((b*K+k)*37)%1000)/1000-0.5;
for (let e=0;e<E;e++) for (let i=0;i<K*N;i++) f32[wOff/4+e*K*N+i] = ((i+e*7919)%997)/997-0.5;
for (let b=0;b<B;b++) i32[rtOff/4+b] = (b*31+7)%E;

let slot = 0;
const mkRange = (e0,e1) => { const h = hdrBase + (slot++ % 120)*64;
  i32.set([B,K,N,E,xOff,wOff,rtOff,yOff,sOff,e0,e1],h/4);
  return () => inst.exports.run(h,44); };

const S = 4, per = E/S;
// A: one slice = one call = one statement
const A = () => Array.from({length:S},(_,s)=>mkRange(s*per,(s+1)*per))
                 .map(f => Promise.resolve().then(f));
// B: one slice = several statements, awaiting between expert chunks so the
//    scheduler actually gets control back mid-walk
const CH = 4;
const B_ = () => Array.from({length:S},(_,s)=>{
  const sub = []; for (let c=0;c<CH;c++) sub.push(mkRange(s*per + c*per/CH, s*per + (c+1)*per/CH));
  return (async () => { for (const f of sub) { f(); await new Promise(r => setImmediate(r)); } })();
});

const now = () => Number(process.hrtime.bigint())/1e6;
const med = async fn => { await fn(); const ts=[];
  for(let r=0;r<5;r++){const t=now(); await fn(); ts.push(now()-t);} ts.sort((a,b)=>a-b); return ts[2]; };

console.log('all-local, total wall:');
const b1 = await med(async()=>{ await Promise.all(B_()); });
const a1 = await med(async()=>{ await Promise.all(A()); });
console.log(`   A one-statement  ${a1.toFixed(2)} ms`);
console.log(`   B chunk+setImm   ${b1.toFixed(2)} ms   ${(a1/b1).toFixed(3)}x`);

console.log('\nresponsiveness: can a 5ms timer land DURING the walk set?');
for (const [label, mk] of [['A one-statement', A], ['B chunked+setImmediate', B_]]) {
  let fired = null; const t0 = now();
  const timer = new Promise(r => setTimeout(() => { fired = now()-t0; r(); }, 5));
  await Promise.all([...mk(), timer]);
  const total = now()-t0;
  console.log(`   ${label}  timer callback ran at ${fired.toFixed(1)} ms of ${total.toFixed(1)} ms total`
    + (fired < total*0.9 ? '   <- interleaved' : '   <- blocked until the end'));
}
