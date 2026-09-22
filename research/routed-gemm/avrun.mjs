import fs from 'fs';
const [B,K,N,E] = process.argv.slice(3,7).map(Number);
const X=new Float32Array(B*K); for(let i=0;i<X.length;i++)X[i]=((i*37)%1000)/1000-0.5;
const W=[]; for(let e=0;e<E;e++){const w=new Float32Array(K*N);for(let i=0;i<w.length;i++)w[i]=((i+e*7919)%997)/997-0.5;W.push(w);}
const route=new Int32Array(B); for(let b=0;b<B;b++)route[b]=(b*31+7)%E;
const inst=new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(process.argv[2])),{});
const mem=inst.exports.memory, al=o=>(o+63)&~63;
let off=al(inst.exports.__heap_base.value);
const hdr=off; off+=64;
const xOff=off; off=al(off+B*K*4);
const wOff=off; off=al(off+E*K*N*4);
const rtOff=off; off=al(off+B*4);
const yOff=off; off=al(off+B*N*4);
const sOff=off; off=al(off+B*N*4);
const f32=new Float32Array(mem.buffer), i32=new Int32Array(mem.buffer);
f32.set(X,xOff/4); let wc=wOff/4; for(const w of W){f32.set(w,wc);wc+=w.length;}
i32.set(route,rtOff/4); i32.set([B,K,N,E,xOff,wOff,rtOff,yOff,sOff],hdr/4);
const one=()=>{const s=process.hrtime.bigint(); if(inst.exports.run(hdr,36)!==B)throw new Error('rc'); return Number(process.hrtime.bigint()-s)/1e9;};
one(); const ts=[]; for(let r=0;r<5;r++)ts.push(one()); ts.sort((a,b)=>a-b);
const t=ts[2];
// verify row 0
const Y=new Float32Array(mem.buffer,yOff,B*N); let scale=0,maxAbs=0;
for(let j=0;j<N;j++){let a=0;for(let k=0;k<K;k++)a+=X[k]*W[route[0]][k*N+j];
  scale=Math.max(scale,Math.abs(a)); maxAbs=Math.max(maxAbs,Math.abs(Y[j]-a));}
console.log((2*B*E*K*N/t/1e9).toFixed(1).padStart(7)+' GF-equiv   err '+(maxAbs/scale).toExponential(1));
