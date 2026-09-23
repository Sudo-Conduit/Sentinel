import fs from 'fs';
const [B,K,N,E] = [720,512,512,64];
const bytes = fs.readFileSync('./dmm.wasm');
const mod = new WebAssembly.Module(bytes);
const xAt=(b,k)=>(((b*K+k)*37)%1000)/1000-0.5, wAt=(e,i)=>((i+e*7919)%997)/997-0.5;

function mk(row0, rows) {
  const inst = new WebAssembly.Instance(mod, {});
  const mem = inst.exports.memory, al=o=>(o+63)&~63;
  let off = al(inst.exports.__heap_base.value);
  const hdr=off; off+=64;
  const xOff=off; off=al(off+rows*K*4);
  const wOff=off; off=al(off+E*K*N*4);
  const rtOff=off; off=al(off+rows*4);
  const yOff=off; off=al(off+rows*N*4);
  const sOff=off; off=al(off+rows*N*4);
  const f32=new Float32Array(mem.buffer), i32=new Int32Array(mem.buffer);
  for(let r=0;r<rows;r++) for(let k=0;k<K;k++) f32[xOff/4+r*K+k]=xAt(row0+r,k);
  for(let e=0;e<E;e++) for(let i=0;i<K*N;i++) f32[wOff/4+e*K*N+i]=wAt(e,i);
  for(let r=0;r<rows;r++) i32[rtOff/4+r]=((row0+r)*31+7)%E;
  i32.set([rows,K,N,E,xOff,wOff,rtOff,yOff,sOff],hdr/4);
  return () => { if(inst.exports.run(hdr,36)!==rows) throw new Error('rc'); };
}

const S = Number(process.argv[2]||4), per = B/S;
const slices = Array.from({length:S},(_,i)=>mk(i*per, per));
const gf = t => 2*B*E*K*N/t/1e9;
const time = async (fn) => { await fn(); let best=Infinity;
  for(let r=0;r<3;r++){const s=process.hrtime.bigint(); await fn();
    const d=Number(process.hrtime.bigint()-s)/1e9; if(d<best)best=d;} return best; };

const seq = await time(async () => { for(const f of slices) f(); });
const pall = await time(async () => { await Promise.all(slices.map(f => Promise.resolve().then(f))); });
const pallAsync = await time(async () => { await Promise.all(slices.map(async f => f())); });

console.log(`S=${S} slices, same thread, no workers:`);
console.log(`  sequential loop        ${(seq*1000).toFixed(2)} ms   ${gf(seq).toFixed(1)} GF-equiv`);
console.log(`  Promise.all(.then)     ${(pall*1000).toFixed(2)} ms   ${gf(pall).toFixed(1)} GF-equiv   ${(seq/pall).toFixed(2)}x`);
console.log(`  Promise.all(async fn)  ${(pallAsync*1000).toFixed(2)} ms   ${gf(pallAsync).toFixed(1)} GF-equiv   ${(seq/pallAsync).toFixed(2)}x`);
