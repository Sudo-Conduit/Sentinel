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
const slices = S => Array.from({length:S},(_,s)=>{
  const h=hdrBase+s*64, per=E/S;
  i32.set([B,K,N,E,xOff,wOff,rtOff,yOff,sOff,s*per,(s+1)*per],h/4);
  return () => inst.exports.run(h,44);
});
const gf = t => 2*B*E*K*N/t/1e9;
const med = async fn => { await fn(); const ts=[];
  for(let r=0;r<5;r++){const s=process.hrtime.bigint(); await fn();
    ts.push(Number(process.hrtime.bigint()-s)/1e9);} ts.sort((a,b)=>a-b); return ts[2]; };

console.log('A. all-local: does Promise.all beat a sequential loop over the SAME slices?');
for (const S of [4,8]) {
  const hs = slices(S);
  const seq  = await med(async () => { for (const f of hs) f(); });
  const pall = await med(async () => { await Promise.all(hs.map(f => Promise.resolve().then(f))); });
  console.log(`   S=${S}  sequential ${(seq*1000).toFixed(2)}ms (${gf(seq).toFixed(0)} GF)   `
    + `Promise.all ${(pall*1000).toFixed(2)}ms (${gf(pall).toFixed(0)} GF)   ${(seq/pall).toFixed(3)}x`);
}

console.log('\nB. mixed local + remote: one slice answered by a "peer" (real await)');
const S = 4, hs = slices(S);
const peer = ms => new Promise(r => setTimeout(r, ms));
for (const lat of [10, 25, 50]) {
  // sequential: wait for the peer, THEN compute locally
  const seq = await med(async () => {
    await peer(lat);
    for (let i=1;i<S;i++) hs[i]();
  });
  // concurrent: fire the peer, compute locally while it is in flight
  const conc = await med(async () => {
    await Promise.all([ peer(lat), ...hs.slice(1).map(f => Promise.resolve().then(f)) ]);
  });
  console.log(`   peer ${String(lat).padStart(2)}ms   sequential ${(seq*1000).toFixed(1)}ms   `
    + `Promise.all ${(conc*1000).toFixed(1)}ms   ${(seq/conc).toFixed(2)}x`);
}
