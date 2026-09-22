import fs from 'fs';
const [B,K,N,E] = process.argv.slice(3,7).map(Number);
const SCALE = 1/127;
const X=new Float32Array(B*K); for(let i=0;i<X.length;i++)X[i]=((i*37)%1000)/1000-0.5;
// int8 weights; the fp32 reference uses the SAME dequantised values so the
// comparison is exact arithmetic, not a quantisation-error measurement.
const W8=[]; for(let e=0;e<E;e++){const w=new Int8Array(K*N);
  for(let i=0;i<w.length;i++) w[i]=(((i+e*7919)%199)-99); W8.push(w);}
const route=new Int32Array(B); for(let b=0;b<B;b++)route[b]=(b*31+7)%E;
const inst=new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(process.argv[2])),{});
const mem=inst.exports.memory, al=o=>(o+63)&~63;
let off=al(inst.exports.__heap_base.value);
const hdr=off; off+=64;
const xOff=off; off=al(off+B*K*4);
const wOff=off; off=al(off+E*K*N);        // ONE byte per weight
const rtOff=off; off=al(off+B*4);
const yOff=off; off=al(off+B*N*4);
if(mem.buffer.byteLength<off){console.log('OOM');process.exit(0);}
const f32=new Float32Array(mem.buffer), i32=new Int32Array(mem.buffer), i8=new Int8Array(mem.buffer);
f32.set(X,xOff/4); let wc=wOff; for(const w of W8){i8.set(w,wc); wc+=w.length;}
i32.set(route,rtOff/4);
const sc=new Int32Array(new Float32Array([SCALE]).buffer)[0];
i32.set([B,K,N,E,xOff,wOff,rtOff,yOff,0,sc],hdr/4);
const one=()=>{const s=process.hrtime.bigint(); if(inst.exports.run(hdr,44)!==B)throw new Error('rc'); return Number(process.hrtime.bigint()-s)/1e9;};
one(); const ts=[]; for(let r=0;r<5;r++)ts.push(one()); ts.sort((a,b)=>a-b);
const t=ts[2];
const Y=new Float32Array(mem.buffer,yOff,B*N);
let maxAbs=0,scale=0;
for(let j=0;j<Math.min(N,128);j++){let a=0;for(let k=0;k<K;k++)a+=X[k]*W8[route[0]][k*N+j];
  a*=SCALE; scale=Math.max(scale,Math.abs(a)); maxAbs=Math.max(maxAbs,Math.abs(Y[j]-a));}
console.log((2*B*E*K*N/t/1e9).toFixed(1).padStart(7)+' GF-equiv  real '+(2*B*K*N/t/1e9).toFixed(1).padStart(5)
  +'  err '+(maxAbs/scale).toExponential(1));
