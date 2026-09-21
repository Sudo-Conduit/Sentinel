/* routed_gemm.c — the routed-diagonal op.
 *
 *   Y[b] = X[b] · W[route[b]]          for b = 0..B-1
 *
 * A dense implementation computes X·W[e] for EVERY expert and selects, which
 * is E times the arithmetic and E times the intermediate. This computes only
 * the routed diagonal of the (token x expert) grid: gather rows by expert,
 * one dense matmul per expert, scatter back.
 *
 * int8 x int8 -> int32, AVX-512 VNNI. Threading and gather/scatter are
 * internal so the caller passes row-major X and a route vector and nothing
 * else.
 *
 * Build: gcc -O3 -march=native -mavx512vnni -shared -fPIC -pthread \
 *        -o libroutedgemm.so routed_gemm.c
 */
#define _GNU_SOURCE
#include <immintrin.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <pthread.h>

typedef struct { const uint8_t *Xg; const int8_t *Wp; int32_t *Yg;
                 const int *cnt, *off; int K,N,E,nth; long id; } job_t;

/* one expert's dense block: rows [i0,i1) of the gathered X against W[e] */
static void block(const uint8_t *A,const int8_t *Q,int32_t *C,int K,int N,int i0,int i1){
  for(int i=i0;i<i1;i++){ const uint8_t *a=A+(size_t)i*K;
    for(int j=0;j+64<=N;j+=64){
      __m512i c0=_mm512_setzero_si512(),c1=_mm512_setzero_si512();
      __m512i c2=_mm512_setzero_si512(),c3=_mm512_setzero_si512();
      for(int k4=0;k4<K/4;k4++){
        __m512i av=_mm512_set1_epi32(*(const int32_t*)(a+k4*4));
        const int8_t *b=Q+((size_t)k4*N+j)*4;
        c0=_mm512_dpbusd_epi32(c0,av,_mm512_loadu_si512((void*)b));
        c1=_mm512_dpbusd_epi32(c1,av,_mm512_loadu_si512((void*)(b+64)));
        c2=_mm512_dpbusd_epi32(c2,av,_mm512_loadu_si512((void*)(b+128)));
        c3=_mm512_dpbusd_epi32(c3,av,_mm512_loadu_si512((void*)(b+192)));
      }
      int32_t *o=C+(size_t)i*N+j;
      _mm512_storeu_si512((void*)o,c0);      _mm512_storeu_si512((void*)(o+16),c1);
      _mm512_storeu_si512((void*)(o+32),c2); _mm512_storeu_si512((void*)(o+48),c3);
    }}
}
static void *worker(void *p){
  job_t *j=(job_t*)p;
  for(int e=0;e<j->E;e++){
    int n=j->cnt[e]; if(!n) continue;
    int r=(n+j->nth-1)/j->nth, lo=j->id*r, hi=lo+r>n?n:lo+r;
    if(lo>=hi) continue;
    block(j->Xg+(size_t)j->off[e]*j->K, j->Wp+(size_t)e*j->K*j->N,
          j->Yg+(size_t)j->off[e]*j->N, j->K, j->N, lo, hi);
  }
  return 0;
}

/* Wp must already be in VNNI-packed layout, one block per expert.
   route[b] in [0,E). topk is accepted for API stability; only 1 is
   implemented here — pass 1. Returns 0 on success. */
int routed_gemm(const uint8_t *X, const int8_t *Wp, const int *route,
                int32_t *Y, int B, int K, int N, int E, int topk, int nth) {
  if (topk != 1) return -1;
  if (nth < 1) nth = 1;
  int *cnt=calloc(E,sizeof(int)), *off=malloc(E*sizeof(int)), *pos=calloc(E,sizeof(int));
  int *src=malloc((size_t)B*sizeof(int));
  uint8_t *Xg=aligned_alloc(64,(size_t)B*K);
  int32_t *Yg=aligned_alloc(64,(size_t)B*N*4);
  if(!cnt||!off||!pos||!src||!Xg||!Yg){ free(cnt);free(off);free(pos);free(src);free(Xg);free(Yg); return -2; }
  for(int b=0;b<B;b++) cnt[route[b]]++;
  off[0]=0; for(int e=1;e<E;e++) off[e]=off[e-1]+cnt[e-1];
  for(int b=0;b<B;b++){ int e=route[b], p=off[e]+pos[e]++;
    src[p]=b; memcpy(Xg+(size_t)p*K, X+(size_t)b*K, (size_t)K); }     /* gather */
  pthread_t th[64]; job_t jb[64];
  for(long t=0;t<nth;t++){ jb[t]=(job_t){Xg,Wp,Yg,cnt,off,K,N,E,nth,t};
                           pthread_create(&th[t],0,worker,&jb[t]); }
  for(long t=0;t<nth;t++) pthread_join(th[t],0);
  for(int p=0;p<B;p++) memcpy(Y+(size_t)src[p]*N, Yg+(size_t)p*N, (size_t)N*4);  /* scatter */
  free(cnt);free(off);free(pos);free(src);free(Xg);free(Yg);
  return 0;
}
/* dense reference: every token against every expert, then select */
int dense_gemm(const uint8_t *X, const int8_t *Wp, const int *route,
               int32_t *Y, int B, int K, int N, int E, int topk, int nth) {
  if (topk != 1) return -1;
  int32_t *all=aligned_alloc(64,(size_t)E*B*N*4); if(!all) return -2;
  int *cnt=malloc(E*sizeof(int)), *off=malloc(E*sizeof(int));
  for(int e=0;e<E;e++){ cnt[e]=B; off[e]=0; }
  pthread_t th[64]; job_t jb[64];
  for(int e=0;e<E;e++){
    for(long t=0;t<nth;t++){ jb[t]=(job_t){X,Wp+(size_t)e*K*N,all+(size_t)e*B*N,cnt,off,K,N,1,nth,t};
                             pthread_create(&th[t],0,worker,&jb[t]); }
    for(long t=0;t<nth;t++) pthread_join(th[t],0);
  }
  for(int b=0;b<B;b++) memcpy(Y+(size_t)b*N, all+((size_t)route[b]*B+b)*N, (size_t)N*4);
  free(all);free(cnt);free(off);
  return 0;
}
void pack_w(const int8_t *W,int8_t *Q,int K,int N,int E){
  for(int e=0;e<E;e++){ const int8_t *Wi=W+(size_t)e*K*N; int8_t *Qi=Q+(size_t)e*K*N;
    for(int k4=0;k4<K/4;k4++) for(int n=0;n<N;n++) for(int q=0;q<4;q++)
      Qi[((size_t)k4*N+n)*4+q]=Wi[(size_t)(k4*4+q)*N+n]; }
}
uintptr_t addr_of(void *p){ return (uintptr_t)p; }
