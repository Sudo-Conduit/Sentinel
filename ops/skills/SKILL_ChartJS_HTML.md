# SKILL_ChartJS_HTML.md

**Mountain Shift OS · Pooled Impact Corporation**
**Load order:** On demand — load whenever generating HTML that includes Chart.js charts
**For:** Every instance generating dashboard HTML with Chart.js
**Author:** Will Fobbs III · verified by Kairos
**Fingerprint:** Kairos
**Version:** 1.1 · 2026-03-29 · Epoch 1774823671

---

## Why This Skill Exists

Two bugs were discovered in `MountainShift-BI.html` after generation and push to `Sudo-Conduit/Sentinel`. Will had to manually fix them and commit the correction (`21dc081`). The fixes were then overwritten by a subsequent instance that regenerated the file without pulling first.

This skill exists so no instance ever generates these bugs again.

---

## Bug 1 — Never Include Recharts When Using Chart.js

### What happened
The generated file included this dead script tag:
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/recharts/2.8.0/Recharts.min.js"></script>
```

Recharts is a React charting library. It has no effect in a plain HTML file using Chart.js. It loads ~300KB for nothing and pollutes the global namespace.

### The rule
**If you are using Chart.js (`chart.umd.min.js`), do not include Recharts. They are different libraries. Pick one.**

| Library | Context | CDN |
|---|---|---|
| Chart.js | Plain HTML / vanilla JS | `https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js` |
| Recharts | React (JSX) artifacts only | `import { ... } from "recharts"` |

Never mix them. Never include both. If you see both in the same file, remove Recharts.

---

## Bug 2 — Always Wrap Canvas Elements in a Positioned Container

### What happened
The generated file had bare canvas elements with a `height` attribute:
```html
<canvas id="financial-chart" height="200"></canvas>
```

Chart.js with `maintainAspectRatio: false` (which is required for fixed-height charts) **ignores the `height` attribute on `<canvas>`**. It sizes the canvas by reading the computed height of the parent container. If the parent has no explicit height, Chart.js collapses the chart or renders it at the wrong size.

### The fix (applied in commit 21dc081)
Wrap every `<canvas>` in a `position:relative` div with an explicit pixel height:
```html
<div style="position:relative;height:200px;"><canvas id="financial-chart"></canvas></div>
```

### The rule
**Every Chart.js canvas in a plain HTML file must be wrapped in a `position:relative` container with an explicit `height` in pixels.**

Pattern to always use:
```html
<div style="position:relative;height:NNNpx;">
  <canvas id="your-chart-id"></canvas>
</div>
```

Where `NNN` matches the intended chart height. Common values used in MountainShift-BI.html:
- Financial area chart: `200px`
- Profit bar chart: `160px`
- Unit economics line chart: `240px`
- Cash flow area chart: `180px`
- Cash flow bar chart: `150px`

Also required in your Chart.js options:
```javascript
options: {
  responsive: true,
  maintainAspectRatio: false,  // REQUIRED — without this the container height is ignored
  ...
}
```

Both the wrapper div AND `maintainAspectRatio: false` are required. Either one alone is not sufficient.

---

## Bug 3 — Always Pull Before Treating Outputs as Canonical

This is not a Chart.js bug but was discovered in the same session.

### What happened
`/mnt/user-data/outputs/mountainshift.html` was the version generated in this session. A subsequent instance copied that file into the repo and pushed it — overwriting Will's fix that had been committed to git after the initial push.

### The rule
**`/mnt/user-data/outputs/` is not git-tracked. It does not auto-sync with the repo.**

Before pushing any file that may have been previously committed:
1. Pull the repo: `git pull --rebase https://${PAT}@github.com/${REPO}.git main`
2. Diff your version against the repo version: `diff /mnt/user-data/outputs/your-file.html /tmp/sentinel-repo/path/to/your-file.html`
3. If the repo version has changes you don't have — **use the repo version**, not your outputs version
4. After pulling, sync outputs from repo if needed: `cp /tmp/sentinel-repo/path/to/file /mnt/user-data/outputs/file`

### The corollary — commit fixes immediately
If you manually fix a file and it is not immediately committed to git, the fix will be lost when any instance pushes a regenerated version. Fix → commit → push is a single atomic action.

---

## Quick Reference — Chart.js HTML Checklist

Before pushing any HTML file that contains Chart.js charts, verify all of the following:

- [ ] `chart.umd.min.js` is the only chart library included — no Recharts, no D3, no duplicates
- [ ] Every `<canvas>` is wrapped in `<div style="position:relative;height:NNNpx;">`
- [ ] Every Chart.js options block includes `maintainAspectRatio: false`
- [ ] You pulled the repo and diffed before pushing to confirm you are not overwriting a fix
- [ ] `responsive: true` is set alongside `maintainAspectRatio: false`

---

## Verified Working Pattern

```html
<!-- Script — Chart.js only, no Recharts -->
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>

<!-- Canvas — always wrapped -->
<div class="chart-wrap">
  <div class="card-label">Chart title</div>
  <div style="position:relative;height:200px;">
    <canvas id="my-chart"></canvas>
  </div>
</div>

<!-- JS — always include both options -->
<script>
const ctx = document.getElementById('my-chart');
new Chart(ctx, {
  type: 'line',
  data: { ... },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    ...
  }
});
</script>
```

---

*Will Fobbs III · Pooled Impact Corporation · Fingerprint: Kairos · v1.1 · 2026-03-29*
