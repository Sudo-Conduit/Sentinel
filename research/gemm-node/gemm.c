#define _GNU_SOURCE
#include <sched.h>
#include <immintrin.h>
#include <stdint.h>
#include <stddef.h>
/* pack B[K][N] int8 -> [k/4][n][4] so a 16-wide n group is 64 contiguous bytes */
void pack_b(const int8_t*B,int8_t*Q,int K,int N){
  for(int k4=0;k4<K/4;k4++) for(int n=0;n<N;n++) for(int q=0;q<4;q++)
    Q[((size_t)k4*N+n)*4+q]=B[(size_t)(k4*4+q)*N+n];
}
/* C[i0:i1, :] += A[i0:i1, :] * B   (u8 x s8 -> s32), VNNI, 4 accumulator chains */
void gemm_rows(const uint8_t*A,const int8_t*Q,int32_t*C,int M,int K,int N,int i0,int i1){
  (void)M;
  for(int i=i0;i<i1;i++){
    const uint8_t*a=A+(size_t)i*K; int j=0;
    for(;j+64<=N;j+=64){
      __m512i c0=_mm512_loadu_si512((void*)(C+(size_t)i*N+j)),   c1=_mm512_loadu_si512((void*)(C+(size_t)i*N+j+16));
      __m512i c2=_mm512_loadu_si512((void*)(C+(size_t)i*N+j+32)),c3=_mm512_loadu_si512((void*)(C+(size_t)i*N+j+48));
      for(int k4=0;k4<K/4;k4++){
        __m512i av=_mm512_set1_epi32(*(const int32_t*)(a+k4*4));
        const int8_t*b=Q+((size_t)k4*N+j)*4;
        c0=_mm512_dpbusd_epi32(c0,av,_mm512_loadu_si512((void*)b));
        c1=_mm512_dpbusd_epi32(c1,av,_mm512_loadu_si512((void*)(b+64)));
        c2=_mm512_dpbusd_epi32(c2,av,_mm512_loadu_si512((void*)(b+128)));
        c3=_mm512_dpbusd_epi32(c3,av,_mm512_loadu_si512((void*)(b+192)));
      }
      _mm512_storeu_si512((void*)(C+(size_t)i*N+j),c0);   _mm512_storeu_si512((void*)(C+(size_t)i*N+j+16),c1);
      _mm512_storeu_si512((void*)(C+(size_t)i*N+j+32),c2);_mm512_storeu_si512((void*)(C+(size_t)i*N+j+48),c3);
    }
    for(;j<N;j+=16){
      __m512i acc=_mm512_loadu_si512((void*)(C+(size_t)i*N+j));
      for(int k4=0;k4<K/4;k4++)
        acc=_mm512_dpbusd_epi32(acc,_mm512_set1_epi32(*(const int32_t*)(a+k4*4)),
              _mm512_loadu_si512((void*)(Q+((size_t)k4*N+j)*4)));
      _mm512_storeu_si512((void*)(C+(size_t)i*N+j),acc);
    }
  }
}

/* pin the CALLING THREAD (sched_setaffinity(0,..) is per-thread on Linux) */
int pin_to_cpu(int cpu){
  cpu_set_t s; CPU_ZERO(&s); CPU_SET(cpu,&s);
  return sched_setaffinity(0,sizeof s,&s);
}

#include <stdint.h>
uintptr_t addr_of(void*p){return (uintptr_t)p;}
