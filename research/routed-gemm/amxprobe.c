/* amxprobe.c -- does this box ACTUALLY execute AMX?
 *
 * `engines amxinfo` reads CPUID and XCR0 and the arch_prctl grant, which is
 * three ways of ASKING. A hypervisor can mask the CPUID leaf while the
 * silicon still executes the instruction, and it can trap the instruction
 * while leaving the leaf visible, so none of the three settles it. This one
 * executes ldtilecfg, tilezero, tileloadd, tdpbssd and tilestored, catches
 * SIGILL, and checks the arithmetic came out right.
 *
 * That distinction is not hypothetical here. These containers are not the
 * same CPU twice: one landed on a 2.10GHz Xeon reporting amx_tile/amx_int8/
 * amx_bf16 with XCR0 0x600e7, and the numbers in
 * results/dense-*-amx-bf16.json were measured on it. The next landed on a
 * 2.80GHz Xeon with max CPUID leaf 13 (AMX needs 0x1d to enumerate its
 * palette), XCR0 0xe7, and arch_prctl returning -1 -- and this probe
 * confirmed the difference is real rather than a reporting artefact:
 * ldtilecfg takes #UD.
 *
 * Run it before trusting any AMX row, and before concluding a missing AMX
 * column is a bug in the detection code.
 *
 *   make amxprobe && ./amxprobe        exit 0 = AMX really runs here */
#define _GNU_SOURCE
#include <stdio.h>
#include <signal.h>
#include <setjmp.h>
#include <string.h>
#include <stdint.h>
#include <unistd.h>
#include <sys/syscall.h>

#define ARCH_REQ_XCOMP_PERM 0x1023
#define ARCH_GET_XCOMP_PERM 0x1022
#define XFEATURE_XTILEDATA  18

static sigjmp_buf jb;
static volatile const char *stage = "?";
static void onill(int s){ (void)s; siglongjmp(jb, 1); }

typedef struct { uint8_t palette, start_row, rsvd[14];
                 uint16_t colsb[16]; uint8_t rows[16]; } tilecfg;

int main(void){
  struct sigaction sa; memset(&sa,0,sizeof sa);
  sa.sa_handler = onill; sigaction(SIGILL,&sa,NULL); sigaction(SIGSEGV,&sa,NULL);

  long rc = syscall(SYS_arch_prctl, ARCH_REQ_XCOMP_PERM, XFEATURE_XTILEDATA);
  unsigned long long perm = 0;
  syscall(SYS_arch_prctl, ARCH_GET_XCOMP_PERM, &perm);
  printf("arch_prctl(REQ_XCOMP_PERM, XTILEDATA) = %ld   perm mask = 0x%llx\n", rc, perm);

  unsigned lo, hi;
  __asm__ __volatile__("xgetbv" : "=a"(lo), "=d"(hi) : "c"(0));
  printf("XCR0 = 0x%llx  (XTILECFG bit17=%llu, XTILEDATA bit18=%llu)\n",
         ((unsigned long long)hi<<32)|lo, (((unsigned long long)hi<<32|lo)>>17)&1,
         (((unsigned long long)hi<<32|lo)>>18)&1);

  tilecfg c; memset(&c,0,sizeof c);
  c.palette=1; c.rows[0]=16; c.colsb[0]=64; c.rows[1]=16; c.colsb[1]=64;
  c.rows[2]=16; c.colsb[2]=64;

  stage = "ldtilecfg";
  if (sigsetjmp(jb,1)==0) {
    __asm__ __volatile__("ldtilecfg %0" :: "m"(c) : "memory");
    printf("ldtilecfg  : EXECUTED\n");
  } else { printf("ldtilecfg  : SIGILL (#UD)\n"); return 1; }

  stage = "tilezero";
  if (sigsetjmp(jb,1)==0) {
    __asm__ __volatile__("tilezero %%tmm0" ::: "memory");
    printf("tilezero   : EXECUTED\n");
  } else { printf("tilezero   : SIGILL (#UD)\n"); return 1; }

  static int8_t A[16*64] __attribute__((aligned(64)));
  static int8_t B[16*64] __attribute__((aligned(64)));
  static int32_t C[16*16] __attribute__((aligned(64)));
  for (int i=0;i<16*64;i++){A[i]=1;B[i]=1;}
  long stride = 64;
  stage = "tileloadd+tdpbssd";
  if (sigsetjmp(jb,1)==0) {
    __asm__ __volatile__("tileloadd (%0,%1,1), %%tmm1" :: "r"(A), "r"(stride));
    __asm__ __volatile__("tileloadd (%0,%1,1), %%tmm2" :: "r"(B), "r"(stride));
    __asm__ __volatile__("tdpbssd %%tmm2, %%tmm1, %%tmm0" ::: );
    __asm__ __volatile__("tilestored %%tmm0, (%0,%1,1)" :: "r"(C), "r"((long)64));
    __asm__ __volatile__("tilerelease" ::: );
    printf("tdpbssd    : EXECUTED, C[0]=%d (expect 64)\n", C[0]);
    return C[0]==64 ? 0 : 2;
  } else { printf("tdpbssd    : SIGILL (#UD)\n"); return 1; }
}
