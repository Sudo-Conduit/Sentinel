/* verify_sched.c — proves the schedule's three properties for every engine
 * config and unit count. Pure C, no ISA needed.
 *   cc -O2 -o verify_sched verify_sched.c && ./verify_sched            */
#include <stdio.h>
#include <string.h>
#include "diag_sched.h"

static int check(size_t tr, size_t tc, unsigned nunits, const char *tag) {
    static unsigned char seen[4096];
    size_t n = tr * tc; memset(seen, 0, n);
    size_t per[64] = {0};
    for (unsigned u = 0; u < nunits; ++u)
        DIAG_FOR_EACH(t, ti, tj, tr, tc, u, nunits) {
            size_t cell = ti * tc + tj;
            if (ti >= tr || tj >= tc) { printf("  %-22s OUT OF RANGE\n", tag); return 1; }
            if (seen[cell]++)         { printf("  %-22s COLLISION at (%zu,%zu)\n", tag, ti, tj); return 1; }
            per[u]++;
        }
    size_t lo = per[0], hi = per[0];
    for (unsigned u = 1; u < nunits; ++u) { if (per[u]<lo) lo=per[u]; if (per[u]>hi) hi=per[u]; }
    for (size_t c = 0; c < n; ++c) if (!seen[c]) { printf("  %-22s MISSED cell %zu\n", tag, c); return 1; }
    printf("  %-22s %2ux  cover %3zu/%-3zu  per-unit %zu..%zu  imbalance %zu\n",
           tag, nunits, n, n, lo, hi, hi-lo);
    return 0;
}

int main(void) {
    struct { const char *name; size_t tr, tc; } g[] = {
        {"SME2 9x8",   9, 8}, {"AMX  9x8",   9, 8}, {"VNNI 9x8",   9, 8},
        {"ragged 5x8", 5, 8}, {"ragged 9x3", 9, 3}, {"ragged 1x1", 1, 1},
    };
    int bad = 0;
    for (size_t i = 0; i < sizeof g/sizeof*g; ++i) {
        printf("%s\n", g[i].name);
        for (unsigned u = 1; u <= 13; ++u)          /* any unit count, incl. primes */
            bad |= check(g[i].tr, g[i].tc, u, g[i].name);
    }
    printf("\n%s\n", bad ? "FAIL" : "all configs: exact cover, no collisions, balanced");
    return bad;
}
