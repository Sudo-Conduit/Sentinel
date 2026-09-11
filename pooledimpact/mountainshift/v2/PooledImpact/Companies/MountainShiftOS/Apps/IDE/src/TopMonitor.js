/**
 * @file TopMonitor.js
 * @description Pure, DOM-free `top`-style process monitor. UMD/IIFE so it can be
 *   required in Node for tests, or dropped in via <script> for a global.
 *   No Alpine/DOM dependency — the app's runTop()/stopTop() call tick() and
 *   push the result into topHeader/topRows; this module just computes it.
 * @example
 *   const TopMonitor = require('./TopMonitor.js');
 *   const mon = new TopMonitor([{ pid: 1, user: 'root', cmd: 'kernel.js' }]);
 *   const { header, rows } = mon.tick();
 */
(function(root, factory) {
  'use strict';
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TopMonitor = factory();
  }
}(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  function TopMonitor(procs, options) {
    options = options || {};
    this.procs = procs || [];
    this.ticks = 0;
    this.rand = typeof options.rand === 'function' ? options.rand : Math.random;
    this.now = typeof options.now === 'function' ? options.now : function() { return new Date(); };
  }

  TopMonitor.prototype.tick = function() {
    var self = this;
    var now = this.now();
    var rows = this.procs.map(function(p) {
      return { pid: p.pid, user: p.user, cmd: p.cmd, cpu: self.rand() * 40, mem: self.rand() * 20 };
    }).sort(function(a, b) { return b.cpu - a.cpu; });

    var totalCpu = rows.reduce(function(s, r) { return s + r.cpu; }, 0);

    var header = {
      time: now.toLocaleTimeString ? now.toLocaleTimeString() : String(now),
      uptime: this.ticks,
      load: (totalCpu / 100).toFixed(2),
      tasks: this.procs.length,
      running: Math.round(this.rand() * 2),
      cpuPct: totalCpu.toFixed(1),
      memFree: (256 - this.rand() * 40).toFixed(0)
    };

    var formattedRows = rows.map(function(r) {
      return { pid: r.pid, user: r.user, cpu: r.cpu.toFixed(1), mem: r.mem.toFixed(1), cmd: r.cmd };
    });

    this.ticks++;
    return { header: header, rows: formattedRows };
  };

  TopMonitor.prototype.reset = function() { this.ticks = 0; };

  // ─── Static demo runner ──────────────────────────────────────────────────
  // TopMonitor.run("demo top --ui")      -> live table overlay panel.
  // TopMonitor.run("demo top --console") -> same data, animated via console.clear()+console.table.
  // "demo chart"/"demo downloads" work the same way. Multiple jobs can run
  // concurrently; TopMonitor.ps()/fg(id)/bg(id)/kill(id) manage them —
  // only one console job is ever foreground (owns the shared console surface)
  // at a time, same as a real shell only lets one job own the TTY.
  var _jobs = [];
  var _jobIdCounter = 0;

  function _demoProcs() {
    return [
      { pid: 1, user: 'root', cmd: 'kernel.js' },
      { pid: 42, user: 'wfobbs', cmd: 'bsh' },
      { pid: 88, user: 'wfobbs', cmd: 'vdebugger' },
      { pid: 103, user: 'root', cmd: 'zenfsrouter' },
      { pid: 117, user: 'wfobbs', cmd: 'analyze' }
    ];
  }

  function _makePanel(title) {
    var panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;bottom:16px;right:16px;width:380px;background:#1e1e1e;' +
      'border:1px solid #333;border-radius:6px;font:12px "Courier New",monospace;color:#d4d4d4;' +
      'box-shadow:0 8px 24px rgba(0,0,0,.4);z-index:99999;overflow:hidden';
    var header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;' +
      'padding:6px 10px;background:#252526;border-bottom:1px solid #333;color:#6b9';
    header.innerHTML = '<span>' + title + '</span>';
    var closeBtn = document.createElement('button');
    closeBtn.textContent = '\u2715';
    closeBtn.style.cssText = 'background:none;border:none;color:#d4d4d4;cursor:pointer;font-size:12px';
    header.appendChild(closeBtn);
    var body = document.createElement('div');
    body.style.cssText = 'padding:10px';
    var footer = document.createElement('div');
    footer.style.cssText = 'display:flex;gap:10px;padding:6px 10px;background:#252526;' +
      'border-top:1px solid #333;font-size:11px';
    function footerLink(label) {
      var a = document.createElement('a');
      a.textContent = label;
      a.href = '#';
      a.style.cssText = 'color:#6b9;text-decoration:none;cursor:pointer';
      a.onmouseenter = function() { a.style.textDecoration = 'underline'; };
      a.onmouseleave = function() { a.style.textDecoration = 'none'; };
      footer.appendChild(a);
      return a;
    }
    var suspendLink = footerLink('suspend');
    var resumeLink = footerLink('resume');
    var killLink = footerLink('kill');
    killLink.style.color = '#e05555';
    panel.appendChild(header);
    panel.appendChild(body);
    panel.appendChild(footer);
    document.body.appendChild(panel);
    return { panel: panel, body: body, closeBtn: closeBtn, suspendLink: suspendLink, resumeLink: resumeLink, killLink: killLink };
  }

  function _wirePanelControls(ui, job) {
    function refresh() {
      ui.suspendLink.style.opacity = job.suspended ? '0.4' : '1';
      ui.resumeLink.style.opacity = job.suspended ? '1' : '0.4';
    }
    ui.suspendLink.onclick = function(e) { e.preventDefault(); job.suspend(); refresh(); };
    ui.resumeLink.onclick = function(e) { e.preventDefault(); job.resume(); refresh(); };
    ui.killLink.onclick = function(e) { e.preventDefault(); job.stop(); };
    refresh();
  }

  // ─── Machine calibration ──────────────────────────────────────────────────
  // Measures the real achievable setInterval floor (varies by browser/OS/tab
  // throttling/system load) so setHz() ratios stay accurate under load instead
  // of assuming an ideal timer. Re-run periodically (default 30s) via
  // startAutoCalibrate(); minimum 1s enforced — sub-second recalibration is
  // itself expensive enough to skew the measurement it's trying to take.
  var _calibration = { floorMs: 4, measuredAt: null };
  var _autoCalibrateTimer = null;

  TopMonitor.calibrate = function(samples) {
    samples = samples || 5;
    return new Promise(function(resolve) {
      var results = [];
      var n = 0;
      function sample() {
        var start = performance.now();
        setTimeout(function() {
          results.push(performance.now() - start);
          n++;
          if (n < samples) sample();
          else {
            var floorMs = results.reduce(function(a, b) { return a + b; }, 0) / results.length;
            _calibration = { floorMs: floorMs, measuredAt: Date.now() };
            resolve(_calibration);
          }
        }, 0);
      }
      sample();
    });
  };

  TopMonitor.getCalibration = function() { return _calibration; };

  TopMonitor.startAutoCalibrate = function(seconds) {
    seconds = seconds || 30;
    if (seconds < 1) throw new Error('TopMonitor.startAutoCalibrate: minimum interval is 1s — recalibrating faster than that skews the measurement it is taking');
    if (_autoCalibrateTimer) clearInterval(_autoCalibrateTimer);
    TopMonitor.calibrate();
    _autoCalibrateTimer = setInterval(function() { TopMonitor.calibrate(); }, seconds * 1000);
    return _autoCalibrateTimer;
  };

  TopMonitor.stopAutoCalibrate = function() {
    if (_autoCalibrateTimer) { clearInterval(_autoCalibrateTimer); _autoCalibrateTimer = null; }
  };

  // ─── Job control ───────────────────────────────────────────────────────
  // Only one job may be foreground (attached to console/UI output) at a time —
  // this is what real shells enforce per-TTY. Backgrounded jobs keep ticking
  // (their tick() fires on schedule) but render() no-ops until fg'd again.
  // Job #0 is the standard console itself \u2014 always addressable, never cleared
  // by a demo job. fg(0) / "fg 0" restores plain typing-and-reading of the
  // real console (no job owns console.clear()).
  var CONSOLE_JOB = { id: 0, name: 'console', type: 'console', fg: true };
  var _currentJobId = null; // "current job" (the '+' job real shells default fg/bg to)

  function _registerJob(name, type, interval, tick, render, cleanup) {
    var job = {
      id: ++_jobIdCounter, name: name, type: type, fg: type === 'ui', suspended: false,
      interval: interval, _tick: tick, render: render, cleanup: cleanup || function() {}
    };
    job._startTimer = function() {
      if (job.timer) clearInterval(job.timer);
      job.timer = setInterval(function() {
        // scheduler edge fires unconditionally, every job, every cycle —
        // suspended just means this cycle's compute() is skipped, same as a
        // halted CPU still receiving its clock signal.
        if (!job.suspended) job._tick();
        if (job.type === 'ui' || job.fg) job.render();
      }, job.interval);
    };
    job._startTimer();
    job.suspend = function() { job.suspended = true; };
    job.resume = function() { job.suspended = false; };
    job.getHz = function() { return 1000 / job.interval; };
    job.setHz = function(hz) {
      job.interval = Math.max(_calibration.floorMs, 1000 / hz); // never request below the measured floor
      job._startTimer(); // re-clock: tear down and recreate at the new period
    };
    job.stop = function() {
      clearInterval(job.timer);
      job.cleanup();
      var idx = _jobs.indexOf(job);
      if (idx !== -1) _jobs.splice(idx, 1);
    };
    _jobs.push(job);
    _currentJobId = job.id;
    if (type === 'console') _setForeground(job); // newest console job takes the shared surface
    return job;
  }

  function _setForeground(job) {
    CONSOLE_JOB.fg = (job === CONSOLE_JOB);
    _jobs.forEach(function(j) { if (j.type === 'console') j.fg = (j === job); });
    if (job && job.render) job.render();
  }

  function _formatJobs(list, output) {
    if (output === 'json') return JSON.stringify(list);
    if (output === 'csv') {
      var header = 'id,name,state';
      var rows = list.map(function(j) { return j.id + ',' + j.name + ',' + j.state; });
      return [header].concat(rows).join('\n');
    }
    // default: ps-style plain columns
    var lines = ['  ID NAME                  STATE'];
    list.forEach(function(j) {
      lines.push(String(j.id).padStart(4) + ' ' + j.name.padEnd(21) + ' ' + j.state);
    });
    return lines.join('\n');
  }

  TopMonitor.ps = function(opts) {
    opts = opts || {};
    var all = [CONSOLE_JOB].concat(_jobs);
    if (opts.target === 'ui') all = all.filter(function(j) { return j.type === 'ui'; });
    if (opts.target === 'console') all = all.filter(function(j) { return j.type === 'console'; });
    return all.map(function(j) {
      var state = j.suspended ? 'suspended' : (j.fg ? 'foreground' : 'background');
      return { id: j.id, name: j.name, state: state };
    });
  };

  TopMonitor.fg = function(id) {
    if (id === 0) { _setForeground(CONSOLE_JOB); return TopMonitor.ps(); }
    var job = _jobs.filter(function(j) { return j.id === id; })[0];
    if (!job) throw new Error('TopMonitor.fg: no job #' + id);
    _setForeground(job);
    return TopMonitor.ps();
  };

  TopMonitor.bg = function(id) {
    if (id === 0) { CONSOLE_JOB.fg = false; return TopMonitor.ps(); }
    var job = _jobs.filter(function(j) { return j.id === id; })[0];
    if (job) job.fg = false;
    return TopMonitor.ps();
  };

  TopMonitor.suspend = function(id) {
    var job = _jobs.filter(function(j) { return j.id === id; })[0];
    if (!job) throw new Error('TopMonitor.suspend: no job #' + id);
    job.suspend();
    return TopMonitor.ps();
  };

  TopMonitor.resume = function(id) {
    var job = _jobs.filter(function(j) { return j.id === id; })[0];
    if (!job) throw new Error('TopMonitor.resume: no job #' + id);
    job.resume();
    return TopMonitor.ps();
  };

  TopMonitor.getHz = function(id) {
    var job = _jobs.filter(function(j) { return j.id === id; })[0];
    if (!job) throw new Error('TopMonitor.getHz: no job #' + id);
    return job.getHz();
  };

  TopMonitor.setHz = function(id, hz) {
    var job = _jobs.filter(function(j) { return j.id === id; })[0];
    if (!job) throw new Error('TopMonitor.setHz: no job #' + id);
    job.setHz(hz);
    return TopMonitor.ps();
  };

  TopMonitor.kill = function(id) {
    if (id === 0) throw new Error('TopMonitor.kill: job #0 is the console itself — cannot be killed (try "fg 0" instead)');
    var job = _jobs.filter(function(j) { return j.id === id; })[0];
    if (job) job.stop();
    return TopMonitor.ps();
  };

  function _runDemoTop() {
    var ui = _makePanel('top — demo (TopMonitor.js)');
    var mon = new TopMonitor(_demoProcs());
    var table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse';
    ui.body.appendChild(table);
    var latest = null;

    function render() {
      if (!latest) return;
      var h = latest.header;
      table.innerHTML =
        '<tr><td colspan="5" style="color:#8b93a0;padding-bottom:2px">top - ' + h.time + ' up, ' + h.uptime + 's, load: ' + h.load + '</td></tr>' +
        '<tr><td colspan="5" style="color:#8b93a0">Tasks: ' + h.tasks + ' total, ' + h.running + ' running \u00b7 CPU: ' + h.cpuPct + '% \u00b7 Mem: ' + h.memFree + 'M free</td></tr>' +
        '<tr><td colspan="5">&nbsp;</td></tr>' +
        '<tr style="color:#6b9;text-align:left;border-bottom:1px solid #333">' +
          '<th style="padding:2px 6px;text-align:right">PID</th><th style="padding:2px 6px">USER</th>' +
          '<th style="padding:2px 6px;text-align:right">CPU%</th><th style="padding:2px 6px;text-align:right">MEM%</th>' +
          '<th style="padding:2px 6px">COMMAND</th></tr>' +
        latest.rows.map(function(r) {
          return '<tr><td style="padding:1px 6px;text-align:right">' + r.pid + '</td><td style="padding:1px 6px">' + r.user +
            '</td><td style="padding:1px 6px;text-align:right">' + r.cpu + '</td><td style="padding:1px 6px;text-align:right">' + r.mem +
            '</td><td style="padding:1px 6px">' + r.cmd + '</td></tr>';
        }).join('');
    }

    var job = _registerJob('top', 'ui', 1000, function() { latest = mon.tick(); }, render, function() { ui.panel.remove(); });
    ui.closeBtn.onclick = job.stop;
    _wirePanelControls(ui, job);
    return job;
  }

  // ─── Lasagna Limit demo: real small-matrix linear algebra ───────────────
  // S_delta = S_0 + delta*P, delta -> 0. S_0 has identical rows (Lasagna
  // Limit: perfect redundancy). P is a fixed random perturbation. Each tick
  // shrinks delta, moving S_delta toward S_0. We compute, on the REAL matrix:
  //   sigma      — 1 - (row diversity / initial row diversity): -> 1 as delta -> 0
  //   deltaSNorm — Frobenius norm of S_delta(t) - S_delta(t-1) (the ΔS_k of §3)
  //   r_eff      — exp(Shannon entropy of normalized singular values), §7,
  //                via a real one-sided Jacobi SVD on the small matrix.
  function _jacobiSingularValues(rows, cols, matrix) {
    // One-sided Jacobi SVD: rotate pairs of columns of `matrix` (n x cols)
    // until orthogonal; column norms at convergence are the singular values.
    var A = matrix.map(function(r) { return r.slice(); });
    var n = rows, d = cols;
    for (var sweep = 0; sweep < 30; sweep++) {
      for (var p = 0; p < d - 1; p++) {
        for (var q = p + 1; q < d; q++) {
          var alpha = 0, beta = 0, gamma = 0;
          for (var i = 0; i < n; i++) {
            alpha += A[i][p] * A[i][p];
            beta += A[i][q] * A[i][q];
            gamma += A[i][p] * A[i][q];
          }
          if (Math.abs(gamma) < 1e-12) continue;
          var zeta = (beta - alpha) / (2 * gamma);
          var t = Math.sign(zeta || 1) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta));
          var c = 1 / Math.sqrt(1 + t * t), s = c * t;
          for (var k = 0; k < n; k++) {
            var Aip = A[k][p], Aiq = A[k][q];
            A[k][p] = c * Aip - s * Aiq;
            A[k][q] = s * Aip + c * Aiq;
          }
        }
      }
    }
    var singulars = [];
    for (var col = 0; col < d; col++) {
      var sumSq = 0;
      for (var row = 0; row < n; row++) sumSq += A[row][col] * A[row][col];
      singulars.push(Math.sqrt(sumSq));
    }
    return singulars.sort(function(a, b) { return b - a; });
  }

  function _effectiveRank(singulars) {
    var total = singulars.reduce(function(a, b) { return a + b; }, 0);
    if (total < 1e-12) return 0;
    var entropy = 0;
    singulars.forEach(function(s) {
      var p = s / total;
      if (p > 1e-12) entropy -= p * Math.log(p);
    });
    return Math.exp(entropy);
  }

  function _rowDiversity(matrix) {
    var n = matrix.length, d = matrix[0].length;
    var mean = new Array(d).fill(0);
    matrix.forEach(function(row) { row.forEach(function(v, j) { mean[j] += v / n; }); });
    var sumSq = 0;
    matrix.forEach(function(row) {
      row.forEach(function(v, j) { sumSq += (v - mean[j]) * (v - mean[j]); });
    });
    return Math.sqrt(sumSq / n);
  }

  function _lasagnaState() {
    var n = 4, d = 3;
    var s = [1.0, -0.5, 0.7]; // shared row (the Lasagna Limit's identical-row value)
    var P = []; // fixed random perturbation matrix, generated once
    for (var i = 0; i < n; i++) {
      var row = [];
      for (var j = 0; j < d; j++) row.push((Math.random() * 2 - 1));
      P.push(row);
    }
    return {
      n: n, d: d, s: s, P: P,
      delta: 1.0,
      decay: 0.92,
      prevMatrix: null,
      initialDiversity: null
    };
  }

  function _lasagnaMatrix(state) {
    var m = [];
    for (var i = 0; i < state.n; i++) {
      var row = [];
      for (var j = 0; j < state.d; j++) row.push(state.s[j] + state.delta * state.P[i][j]);
      m.push(row);
    }
    return m;
  }

  function _lasagnaTick(state) {
    var matrix = _lasagnaMatrix(state);
    var diversity = _rowDiversity(matrix);
    if (state.initialDiversity === null) state.initialDiversity = diversity || 1e-9;
    var sigma = 1 - Math.min(1, diversity / state.initialDiversity);
    var deltaSNorm = 0;
    if (state.prevMatrix) {
      for (var i = 0; i < state.n; i++) {
        for (var j = 0; j < state.d; j++) {
          var diff = matrix[i][j] - state.prevMatrix[i][j];
          deltaSNorm += diff * diff;
        }
      }
      deltaSNorm = Math.sqrt(deltaSNorm);
    }
    var singulars = _jacobiSingularValues(state.n, state.d, matrix);
    var rEff = _effectiveRank(singulars);
    state.prevMatrix = matrix;
    state.delta *= state.decay;
    if (state.delta < 0.0005) state.delta = 1.0; // loop the approach continuously
    return { matrix: matrix, sigma: sigma, deltaSNorm: deltaSNorm, singulars: singulars, rEff: rEff, delta: state.delta };
  }

  function _runDemoLasagna() {
    var ui = _makePanel('Lasagna Limit — demo (TopMonitor.js)');
    var state = _lasagnaState();
    var matrixEl = document.createElement('div');
    matrixEl.style.cssText = 'font-family:monospace;font-size:11px;color:#8b93a0;margin-bottom:8px;white-space:pre';
    var statsEl = document.createElement('div');
    statsEl.style.cssText = 'font-size:12px;line-height:1.8';
    ui.body.appendChild(matrixEl);
    ui.body.appendChild(statsEl);
    var latest = null;

    function render() {
      if (!latest) return;
      matrixEl.textContent = latest.matrix.map(function(row) {
        return '[ ' + row.map(function(v) { return v.toFixed(2).padStart(6); }).join(' ') + ' ]';
      }).join('\n');
      statsEl.innerHTML =
        '<div>&delta; = ' + latest.delta.toFixed(4) + '</div>' +
        '<div>&sigma; (symmetry) = <b style="color:' + (latest.sigma > 0.9 ? '#4ec9b0' : '#e0a458') + '">' + latest.sigma.toFixed(4) + '</b></div>' +
        '<div>||&Delta;S|| = ' + latest.deltaSNorm.toFixed(4) + '</div>' +
        '<div>r_eff = <b>' + latest.rEff.toFixed(3) + '</b> (of max ' + latest.singulars.length + ')</div>' +
        '<div style="color:#8b93a0;font-size:11px">singular values: ' + latest.singulars.map(function(v) { return v.toFixed(3); }).join(', ') + '</div>';
    }

    var job = _registerJob('lasagna', 'ui', 500, function() { latest = _lasagnaTick(state); }, render, function() { ui.panel.remove(); });
    ui.closeBtn.onclick = job.stop;
    _wirePanelControls(ui, job);
    return job;
  }

  function _runConsoleLasagna() {
    var state = _lasagnaState();
    var latest = null;
    function render() {
      if (!latest) return;
      console.clear();
      console.log('Lasagna Limit demo — S_delta = S_0 + delta*P, delta -> 0');
      console.log(latest.matrix.map(function(row) { return '[ ' + row.map(function(v) { return v.toFixed(2).padStart(6); }).join(' ') + ' ]'; }).join('\n'));
      console.log('delta=' + latest.delta.toFixed(4) + '  sigma=' + latest.sigma.toFixed(4) + '  ||dS||=' + latest.deltaSNorm.toFixed(4) + '  r_eff=' + latest.rEff.toFixed(3));
      console.log('singular values: ' + latest.singulars.map(function(v) { return v.toFixed(3); }).join(', '));
    }
    return _registerJob('lasagna --console', 'console', 500, function() { latest = _lasagnaTick(state); }, render);
  }

  // ─── Anomalies_Test017 scanner demo ──────────────────────────────────
  // Sweeps t across [0,1], plotting the real α(t) autonomy ratio against
  // the live τ_q (p99) threshold — same job-control/render pattern as
  // the Lasagna Limit demo, but scanning a loaded Anomalies_TestXXX engine
  // instead of computing its own matrix. Requires engine.getAlphaAt(t)
  // (Anomalies_Test017+).
  function _runDemoAnomalyScan(engineGlobalName) {
    var globalRoot = (typeof window !== 'undefined') ? window : (typeof self !== 'undefined' ? self : this);
    var engine = (engineGlobalName && globalRoot[engineGlobalName]) || globalRoot.Anomalies_Test017 || globalRoot.Anomalies_Test016;
    if (!engine) throw new Error('TopMonitor: no Anomalies_TestXXX engine found on window. Load it first, e.g. <script src="Anomalies_Test017.js">.');
    engine.initializeSystem();
    var tauQ = engine.getTauQ();

    var ui = _makePanel('anomaly scan — ' + (engine.NAME || 'Anomalies_Test') + ' (TopMonitor.js)');
    var trackEl = document.createElement('div');
    trackEl.style.cssText = 'position:relative;height:90px;background:#111;border-radius:3px;overflow:hidden;margin-bottom:8px';
    var barEl = document.createElement('div');
    barEl.style.cssText = 'position:absolute;bottom:0;width:6px;background:#4ec9b0;transition:height .1s linear,left .1s linear,background .1s linear';
    var lineEl = document.createElement('div');
    lineEl.style.cssText = 'position:absolute;left:0;right:0;height:1px;background:#e0a458';
    trackEl.appendChild(lineEl);
    trackEl.appendChild(barEl);
    var statsEl = document.createElement('div');
    statsEl.style.cssText = 'font-size:12px;line-height:1.8';
    ui.body.appendChild(trackEl);
    ui.body.appendChild(statsEl);

    var t = 0, dir = 0.008;
    var maxAlphaSeen = tauQ * 1.5; // scale the track; grows if a bigger spike appears

    function render() {
      var alpha = _sampleAlpha(engine, t);
      if (alpha > maxAlphaSeen) maxAlphaSeen = alpha * 1.1;
      var pct = Math.min(1, alpha / maxAlphaSeen);
      var linePct = Math.min(1, tauQ / maxAlphaSeen);
      barEl.style.left = (t * 94) + '%';
      barEl.style.height = (pct * 100) + '%';
      barEl.style.background = alpha > tauQ ? '#e05555' : '#4ec9b0';
      lineEl.style.bottom = (linePct * 90) + 'px';
      statsEl.innerHTML =
        '<div>t = ' + t.toFixed(4) + '</div>' +
        '<div>&alpha;(t) = <b style="color:' + (alpha > tauQ ? '#e05555' : '#4ec9b0') + '">' + alpha.toFixed(4) + '</b></div>' +
        '<div>&tau;_q (p99) = ' + tauQ.toFixed(4) + '</div>' +
        '<div style="color:' + (alpha > tauQ ? '#e05555' : '#8b93a0') + '">' + (alpha > tauQ ? 'ANOMALOUS' : 'normal') + '</div>';
    }

    var job = _registerJob('anomaly-scan', 'ui', 100, function() {
      t += dir;
      if (t >= 1) { t = 1; dir = -Math.abs(dir); }
      if (t <= 0) { t = 0; dir = Math.abs(dir); }
    }, render, function() { ui.panel.remove(); });
    ui.closeBtn.onclick = job.stop;
    _wirePanelControls(ui, job);
    return job;
  }

  function _runConsoleAnomalyScan(engineGlobalName) {
    var globalRoot = (typeof window !== 'undefined') ? window : (typeof self !== 'undefined' ? self : this);
    var engine = (engineGlobalName && globalRoot[engineGlobalName]) || globalRoot.Anomalies_Test017 || globalRoot.Anomalies_Test016;
    if (!engine) throw new Error('TopMonitor: no Anomalies_TestXXX engine found on window.');
    engine.initializeSystem();
    var tauQ = engine.getTauQ();
    var t = 0, dir = 0.02;

    function render() {
      var alpha = _sampleAlpha(engine, t);
      var width = Math.min(50, Math.round((alpha / (tauQ * 1.5)) * 50));
      console.clear();
      console.log('anomaly scan — ' + (engine.NAME || 'Anomalies_Test') + ' (console mode)');
      console.log('t=' + t.toFixed(4) + '  alpha=' + alpha.toFixed(4) + '  tau_q=' + tauQ.toFixed(4));
      console.log((alpha > tauQ ? 'ANOMALOUS ' : 'normal    ') + '[' + '█'.repeat(width) + ' '.repeat(50 - width) + ']');
    }

    return _registerJob('anomaly-scan --console', 'console', 100, function() {
      t += dir;
      if (t >= 1) { t = 1; dir = -Math.abs(dir); }
      if (t <= 0) { t = 0; dir = Math.abs(dir); }
    }, render);
  }

  // The engine's public API exposes isAnomalous(alpha)/getTauQ()/getDeltas()
  // but not a bare evaluate-alpha-at-t function, so the scanner recomputes
  // alpha the same way the engine's own radical9DMovement() axis-1 sweep
  // does: by re-running the engine's t-axis logic isn't exposed either —
  // simplest robust option is to require the engine to expose it. Fixed
  // harnesses (v17+) add getAlphaAt(t) for exactly this purpose.
  function _sampleAlpha(engine, t) {
    if (typeof engine.getAlphaAt === 'function') return engine.getAlphaAt(t);
    throw new Error('TopMonitor anomaly-scan demo requires engine.getAlphaAt(t) — add it to the Anomalies_TestXXX harness (Anomalies_Test017+).');
  }

  function _runDemoChart() {
    var ui = _makePanel('chart — demo (TopMonitor.js)');
    var labels = ['CPU', 'MEM', 'DISK', 'NET', 'GPU'];
    var rows = labels.map(function(label) {
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px';
      var name = document.createElement('span');
      name.textContent = label;
      name.style.cssText = 'width:36px;color:#8b93a0';
      var track = document.createElement('div');
      track.style.cssText = 'flex:1;height:14px;background:#111;border-radius:2px;overflow:hidden';
      var bar = document.createElement('div');
      bar.style.cssText = 'height:100%;width:0%;background:#4ec9b0;transition:width .35s ease';
      track.appendChild(bar);
      var value = document.createElement('span');
      value.style.cssText = 'width:34px;text-align:right;color:#d4d4d4';
      row.appendChild(name); row.appendChild(track); row.appendChild(value);
      ui.body.appendChild(row);
      return { bar: bar, value: value, v: 0 };
    });

    function render() {
      rows.forEach(function(r) {
        r.bar.style.width = r.v + '%';
        r.bar.style.background = r.v > 80 ? '#e05555' : r.v > 50 ? '#e0a458' : '#4ec9b0';
        r.value.textContent = r.v + '%';
      });
    }

    var job = _registerJob('chart', 'ui', 500, function() { rows.forEach(function(r) { r.v = Math.round(Math.random() * 100); }); }, render, function() { ui.panel.remove(); });
    ui.closeBtn.onclick = job.stop;
    _wirePanelControls(ui, job);
    return job;
  }

  function _runConsoleTop() {
    var mon = new TopMonitor(_demoProcs());
    var latest = null;
    function render() {
      if (!latest) return;
      console.clear();
      var h = latest.header;
      console.log('top - ' + h.time + ' up, ' + h.uptime + 's, load: ' + h.load);
      console.log('Tasks: ' + h.tasks + ' total, ' + h.running + ' running · CPU: ' + h.cpuPct + '% · Mem: ' + h.memFree + 'M free');
      console.table(latest.rows);
    }
    return _registerJob('top --console', 'console', 1000, function() { latest = mon.tick(); }, render);
  }

  function _runConsoleChart() {
    var labels = ['CPU', 'MEM', 'DISK', 'NET', 'GPU'];
    var values = labels.map(function() { return 0; });
    function render() {
      console.clear();
      console.log('chart - demo (TopMonitor.js, console mode)');
      labels.forEach(function(label, i) {
        var v = values[i];
        var width = Math.round(v / 2);
        console.log(label.padEnd(5) + ' [' + '█'.repeat(width) + ' '.repeat(50 - width) + '] ' + String(v).padStart(3) + '%');
      });
    }
    return _registerJob('chart --console', 'console', 500, function() { values = labels.map(function() { return Math.round(Math.random() * 100); }); }, render);
  }

  function _demoDownloads() {
    return [
      { name: 'kernel_8.0.10.js', size: 420, pct: 0, speed: 0, done: false },
      { name: 'Explorer_015.js', size: 180, pct: 0, speed: 0, done: false },
      { name: 'node_modules.zip', size: 2400, pct: 0, speed: 0, done: false },
      { name: 'vfs-snapshot.json', size: 860, pct: 0, speed: 0, done: false },
      { name: 'dataset.csv', size: 1100, pct: 0, speed: 0, done: false }
    ];
  }

  function _tickDownloads(files, rand) {
    files.forEach(function(f) {
      if (f.done) {
        if (rand() < 0.02) { f.pct = 0; f.done = false; } // loop a finished download for a continuous demo
        return;
      }
      var delta = rand() * 9;
      f.pct = Math.min(100, f.pct + delta);
      f.speed = 200 + rand() * 900; // KB/s
      if (f.pct >= 100) { f.pct = 100; f.done = true; f.speed = 0; }
    });
    return files;
  }

  function _runDemoDownloads() {
    var ui = _makePanel('downloads — demo (TopMonitor.js)');
    var files = _demoDownloads();
    var rows = files.map(function(f) {
      var row = document.createElement('div');
      row.style.cssText = 'margin-bottom:8px';
      var top = document.createElement('div');
      top.style.cssText = 'display:flex;justify-content:space-between;color:#d4d4d4;margin-bottom:3px';
      var name = document.createElement('span'); name.textContent = f.name;
      var pctLabel = document.createElement('span'); pctLabel.style.color = '#8b93a0';
      top.appendChild(name); top.appendChild(pctLabel);
      var track = document.createElement('div');
      track.style.cssText = 'height:8px;background:#111;border-radius:2px;overflow:hidden';
      var bar = document.createElement('div');
      bar.style.cssText = 'height:100%;width:0%;background:#4ec9b0;transition:width .3s linear';
      track.appendChild(bar);
      row.appendChild(top); row.appendChild(track);
      ui.body.appendChild(row);
      return { pctLabel: pctLabel, bar: bar };
    });

    function render() {
      files.forEach(function(f, i) {
        rows[i].bar.style.width = f.pct.toFixed(0) + '%';
        rows[i].bar.style.background = f.done ? '#4ec9b0' : '#3b82c9';
        rows[i].pctLabel.textContent = f.done ? 'done' : f.pct.toFixed(0) + '% · ' + f.speed.toFixed(0) + ' KB/s';
      });
    }

    var job = _registerJob('downloads', 'ui', 300, function() { _tickDownloads(files, Math.random); }, render, function() { ui.panel.remove(); });
    ui.closeBtn.onclick = job.stop;
    _wirePanelControls(ui, job);
    return job;
  }

  function _runConsoleDownloads() {
    var files = _demoDownloads();
    function render() {
      console.clear();
      console.log('downloads - demo (TopMonitor.js, console mode)');
      files.forEach(function(f) {
        var width = Math.round(f.pct / 2);
        var status = f.done ? 'done ' : f.speed.toFixed(0).padStart(4) + 'K/s';
        console.log(f.name.padEnd(20) + ' [' + '█'.repeat(width) + ' '.repeat(50 - width) + '] ' + f.pct.toFixed(0).padStart(3) + '%  ' + status);
      });
    }
    return _registerJob('downloads --console', 'console', 300, function() { _tickDownloads(files, Math.random); }, render);
  }

  TopMonitor.help = function() {
    var text = [
      'TopMonitor.js — process/animation demo engine with job control',
      '',
      'Demos (--ui opens a floating DOM panel, --console animates via console.clear()):',
      '  TopMonitor.run("demo top --ui" | "demo top --console")',
      '  TopMonitor.run("demo chart --ui" | "demo chart --console")',
      '  TopMonitor.run("demo downloads --ui" | "demo downloads --console")',
      '  TopMonitor.run("demo lasagna --ui" | "demo lasagna --console")  — Lasagna Limit: sigma/deltaS/r_eff on a real small-matrix SVD',
      '  TopMonitor.run("demo anomaly-scan --ui" | "demo anomaly-scan --console")  — sweeps t, plots live alpha(t) vs tau_q from a loaded Anomalies_TestXXX engine (requires engine.getAlphaAt(t), v17+)',
      '',
      'Job control (only one console job owns console.clear() at a time; job #0 = real console):',
      '  TopMonitor.run("ps")                    ps-style plain columns (default)',
      '  TopMonitor.run("ps -t ui")               filter: -t ui | -t console',
      '  TopMonitor.run("ps --json")              structured JSON',
      '  TopMonitor.run("ps --csv")               CSV (for piping/streaming)',
      '  TopMonitor.run("ps --table")             console.table',
      '  TopMonitor.run("fg <id>") / TopMonitor.fg(id)   — id 0 stops all clearing',
      '  TopMonitor.run("fg 0 --table")                  — prints via console.table',
      '  TopMonitor.run("bg <id>") / TopMonitor.bg(id)',
      '  TopMonitor.run("kill <id>") / TopMonitor.kill(id) — id 0 cannot be killed',
      '  TopMonitor.run("stop")                          — stop and remove ALL jobs',
      '',
      'Clock control (scheduler tick keeps firing even when suspended — like a halted CPU still clocked):',
      '  TopMonitor.suspend(id) / TopMonitor.resume(id)  — freeze/resume compute() only',
      '  TopMonitor.getHz(id) / TopMonitor.setHz(id, hz) — read/re-clock a job tick rate live',
      '',
      'Calibration (measures the real setInterval floor so setHz ratios stay accurate under load):',
      '  TopMonitor.calibrate(samples)           — one-off measurement (returns a Promise)',
      '  TopMonitor.getCalibration()              — last measured {floorMs, measuredAt}',
      '  TopMonitor.startAutoCalibrate(seconds)   — repeat measurement (default 30s, min 1s)',
      '  TopMonitor.stopAutoCalibrate()',
      '',
      'Programmatic: new TopMonitor(procs).tick() -> {header, rows}, DOM/console-free.'
    ].join('\n');
    console.log(text);
    return text;
  };

  TopMonitor.run = function(cmd) {
    cmd = (cmd || '').trim().toLowerCase();
    if (cmd === 'help' || cmd === '--help' || cmd === '-h') return TopMonitor.help();
    var parts = cmd.split(/\s+/);
    var flag = parts.filter(function(p) { return p.indexOf('--') === 0; })[0] || '--ui';
    var base = parts.filter(function(p) { return p.indexOf('--') !== 0; }).join(' ');

    if (base === 'demo top' && flag === '--ui') return _runDemoTop();
    if (base === 'demo chart' && flag === '--ui') return _runDemoChart();
    if (base === 'demo downloads' && flag === '--ui') return _runDemoDownloads();
    if (base === 'demo lasagna' && flag === '--ui') return _runDemoLasagna();
    if (base === 'demo top' && flag === '--console') return _runConsoleTop();
    if (base === 'demo chart' && flag === '--console') return _runConsoleChart();
    if (base === 'demo downloads' && flag === '--console') return _runConsoleDownloads();
    if (base === 'demo lasagna' && flag === '--console') return _runConsoleLasagna();
    if (base === 'demo anomaly-scan' && flag === '--ui') return _runDemoAnomalyScan();
    if (base === 'demo anomaly-scan' && flag === '--console') return _runConsoleAnomalyScan();
    if (cmd === 'stop') { _jobs.slice().forEach(function(j) { j.stop(); }); return null; }
    if (/^ps(\s+.+)?$/.test(cmd)) {
      _setForeground(CONSOLE_JOB); // ps implies fg 0 — running it should return console ownership, like real shells
      var jopts = {};
      (cmd.match(/-t\s*\S+/) || [])[0] && (jopts.target = cmd.match(/-t\s*(\S+)/)[1]);
      if (cmd.indexOf('--json') !== -1) jopts.output = 'json';
      else if (cmd.indexOf('--csv') !== -1) jopts.output = 'csv';
      else if (cmd.indexOf('--table') !== -1) jopts.output = 'table';
      else jopts.output = 'plain'; // ps-style default: plain columns, not JSON
      var list = TopMonitor.ps({ target: jopts.target });
      if (jopts.output === 'table') { console.table(list); return list; }
      var formatted = _formatJobs(list, jopts.output);
      console.log(formatted);
      return formatted;
    }
    if (/^fg \d+( --table)?$/.test(cmd)) {
      var fgId = parseInt(cmd.split(/\s+/)[1], 10);
      var fgResult = TopMonitor.fg(fgId);
      if (flag === '--table') { console.table(fgResult); return fgResult; }
      console.log(fgResult);
      return fgResult;
    }
    if (/^bg \d+$/.test(cmd)) return TopMonitor.bg(parseInt(cmd.split(/\s+/)[1], 10));
    if (/^kill \d+$/.test(cmd)) return TopMonitor.kill(parseInt(cmd.split(/\s+/)[1], 10));
    throw new Error('TopMonitor.run: unknown command "' + cmd + '" \u2014 try TopMonitor.help() or TopMonitor.run("help")');
  };

  return TopMonitor;
}));
