/* blasbench.c -- is OpenBLAS underperforming, and can the WASM ops help it?
 *
 *   blasbench <M> <K> <N> <threads> <reps> [blocks]
 *      blocks = 0   let the library thread it (one call, its own pool)
 *      blocks = n   OUR work queue: n row blocks, each a SINGLE-threaded
 *                   sgemm, exactly the split that works for our own kernels
 *
 * Answer, measured on a 4-core SkylakeX box whose pure-FMA AVX-512 ceiling
 * is 756 GFLOPS (four concurrent peak_native):
 *
 *   library threading, 4096^3   447-497 GF   ~60-66% of ceiling
 *   our queue, 4 blocks         484 GF       matches it
 *   our queue, 8 blocks         463
 *   our queue, 16 blocks        389
 *   our queue, 64 blocks        332
 *
 * Monotonic in the number of blocks, and that is the finding: every block is
 * an independent pack of B. OpenBLAS packs B once and shares it across its
 * threads; splitting rows outside the library multiplies the pack instead.
 * It is the same "re-streaming the weight matrix" cost the engine table
 * already measured from the other direction, where BLAS retained 3% of its
 * rate at one row per block.
 *
 * So the WASM ops do NOT transfer here. The one that matters -- pack once,
 * then walk contiguously -- needs sgemm_pack/sgemm_compute to hoist the pack
 * out of the call, and `nm -D` on this library shows it exports no such pair
 * (it has sgemm_batch and sgemm_direct, neither of which helps). Every op we
 * CAN apply from outside makes it worse. BLAS is a black box that already
 * did the blocking; the lever we used on our own kernels is behind its API. */
#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <pthread.h>
#include <dlfcn.h>
typedef long i64;
typedef void (*sg64)(i64,i64,i64,i64,i64,i64,float,const float*,i64,
                     const float*,i64,float,float*,i64);
static sg64 g;
static double now(void){struct timespec t;clock_gettime(CLOCK_MONOTONIC,&t);
  return t.tv_sec+1e-9*t.tv_nsec;}
static int M,K,N,T,NB; static float *A,*B,*C;
static volatile int next_u; static volatile int gen,done,stop;
static void drain(void){
  for(;;){int u=__atomic_fetch_add(&next_u,1,__ATOMIC_RELAXED);
    if(u>=NB)break;
    int m0=(int)((long)u*M/NB), m1=(int)((long)(u+1)*M/NB);
    if(m1>m0) g(101,111,111,m1-m0,N,K,1.0f,A+(size_t)m0*K,K,B,N,0.0f,
                C+(size_t)m0*N,N);}
}
static void*worker(void*a){(void)a;int seen=0;
  for(;;){while(__atomic_load_n(&gen,__ATOMIC_ACQUIRE)==seen){
      if(__atomic_load_n(&stop,__ATOMIC_RELAXED))return NULL;
      __builtin_ia32_pause();}
    seen=__atomic_load_n(&gen,__ATOMIC_ACQUIRE);drain();
    __atomic_add_fetch(&done,1,__ATOMIC_RELEASE);}}
static void run(void){__atomic_store_n(&next_u,0,__ATOMIC_RELAXED);
  __atomic_store_n(&done,0,__ATOMIC_RELAXED);
  __atomic_add_fetch(&gen,1,__ATOMIC_RELEASE);drain();
  while(__atomic_load_n(&done,__ATOMIC_ACQUIRE)<T-1)__builtin_ia32_pause();}
int main(int argc,char**argv){
  M=atoi(argv[1]);K=atoi(argv[2]);N=atoi(argv[3]);T=atoi(argv[4]);
  int R=atoi(argv[5]); NB=argc>6?atoi(argv[6]):T*4;
  {char nt[8];snprintf(nt,8,"%d",NB?1:T);
   setenv("OPENBLAS_NUM_THREADS",nt,1);setenv("OMP_NUM_THREADS",nt,1);}
  void*h=dlopen("/usr/local/lib/python3.11/dist-packages/numpy.libs/"
                "libscipy_openblas64_-32a4b2a6.so",RTLD_NOW);
  g=(sg64)dlsym(h,"scipy_cblas_sgemm64_");
  void(*setn)(i64)=dlsym(h,"scipy_openblas_set_num_threads64_");
  if(setn)setn(NB?1:T);        /* NB=0 keeps the library's own threading */
  A=aligned_alloc(64,(size_t)M*K*4);B=aligned_alloc(64,(size_t)K*N*4);
  C=aligned_alloc(64,(size_t)M*N*4);
  for(size_t i=0;i<(size_t)M*K;i++)A[i]=((i*37)%1000)/1000.0f-0.5f;
  for(size_t i=0;i<(size_t)K*N;i++)B[i]=((i*53)%997)/997.0f-0.5f;
  pthread_t th[64];
  if(NB)for(long t=1;t<T;t++)pthread_create(&th[t],NULL,worker,NULL);
  #define ONE() do{ if(NB) run(); else \
      g(101,111,111,M,N,K,1.0f,A,K,B,N,0.0f,C,N); }while(0)
  ONE();                                 /* warm the pool */
  double best=1e18,ts[256];
  for(int r=0;r<R;r++){double t0=now();ONE();double d=now()-t0;ts[r]=d;
    if(d<best)best=d;}
  for(int i=1;i<R;i++){double v=ts[i];int j=i-1;
    while(j>=0&&ts[j]>v){ts[j+1]=ts[j];j--;}ts[j+1]=v;}
  __atomic_store_n(&stop,1,__ATOMIC_RELAXED);
  double ops=2.0*M*K*N;printf("%.1f %.1f\n",ops/ts[R/2]/1e9,ops/best/1e9);
  return 0;}
