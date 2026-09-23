// Same matrix, same X, no copies. N concurrent walks joined by Promise.all,
// sliced by EXPERT so each walk keeps full rows-per-expert and touches a
// disjoint span of W and a disjoint set of Y rows.
import fs from 'fs';
const [B,K,N,E] = [720,512,512,64];
const inst = new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync('./dmm.wasm')), {});
const mem = inst.exports.memory, al = o => (o+63)&~63;
let off = al(inst.exports.__heap_base.value);
const hdrBase = off; off += 64*80;
const xOff = off; off = al(off + B*K*4);
const wOff = off; off = al(off + E*K*N*4);
const rtOff = off; off = al(off + B*4);
const yOff = off; off = al(off + B*N*4);
const sOff = off; off = al(off + B*N*4);
const f32 = new Float32Array(mem.buffer), i32 = new Int32Array(mem.buffer);
for (let b=0;b<B;b++) for (let k=0;k<K;k++) f32[xOff/4+b*K+k] = (((b*K+k)*37)%1000)/1000-0.5;
for (let e=0;e<E;e++) for (let i=0;i<K*N;i++) f32[wOff/4+e*K*N+i] = ((i+e*7919)%997)/997-0.5;
for (let b=0;b<B;b++) i32[rtOff/4+b] = (b*31+7)%E;

function expertSlices(S) {
  const per = E/S;
  return Array.from({length:S}, (_,s) => {
    const h = hdrBase + s*64;
    i32.set([B,K,N,E, xOff, wOff, rtOff, yOff, sOff, s*per, (s+1)*per], h/4);
    return () => inst.exports.run(h, 44);
  });
}
const gf = t => 2*B*E*K*N/t/1e9;
const time = async fn => { await fn(); let best=Infinity;
  for(let r=0;r<3;r++){const s=process.hrtime.bigint(); await fn();
    const d=Number(process.hrtime.bigint()-s)/1e9; if(d<best)best=d;} return best; };

const hWhole = hdrBase + 79*64;
i32.set([B,K,N,E,xOff,wOff,rtOff,yOff,sOff],hWhole/4);
const t1 = await time(async () => { if (inst.exports.run(hWhole,36)!==B) throw new Error('rc'); });
console.log(`one walk, all experts        ${(t1*1000).toFixed(2)} ms  ${gf(t1).toFixed(1)} GF-equiv`);
new Float32Array(mem.buffer,yOff,B*N).fill(0);
inst.exports.run(hWhole,36);
const ref = new Float32Array(mem.buffer,yOff,B*N).slice();

for (const S of [2,4,8,16]) {
  const hs = expertSlices(S);
  const pall = await time(async () => { await Promise.all(hs.map(f => Promise.resolve().then(f))); });
  new Float32Array(mem.buffer,yOff,B*N).fill(0);
  await Promise.all(hs.map(f => Promise.resolve().then(f)));
  const got = new Float32Array(mem.buffer,yOff,B*N);
  let bad=0; for(let i=0;i<ref.length;i++) if(Math.abs(got[i]-ref[i])>1e-4) bad++;
  console.log(`${String(S).padStart(2)} walks by expert  Promise.all ${(pall*1000).toFixed(2)} ms  `
    + `${gf(pall).toFixed(1).padStart(7)} GF-equiv  (${(t1/pall).toFixed(2)}x)  ${bad?bad+' MISMATCH':'exact'}`);
}
