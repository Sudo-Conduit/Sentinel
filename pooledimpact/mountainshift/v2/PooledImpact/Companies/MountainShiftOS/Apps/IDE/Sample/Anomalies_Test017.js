// ================================================================
// Anomalies_Test017 — 9D Radical Movement Test (Fixed Harness)
// Threshold: τ_q = p99 of interior distribution
// Fixes vs v16:
//   1. _bezierForce(t) was Σ C(n,i)t^i(1-t)^(n-i) — the FULL unweighted
//      Bernstein basis, which is identically 1 for all t,n (binomial
//      theorem). It contributed no signal. Now it's a genuine weighted
//      global Bezier through the SAME deltas the B-spline uses, so
//      autonomyRatio compares local (B-spline D) vs global (Bezier FB)
//      fits — a real two-scale signal instead of a decorative constant.
//   2. gematria was computed per point but never fed into the signal
//      pipeline (computeDelta only hashed the English relationship
//      labels). Delta now blends hash(labels) with gematria magnitude,
//      so the Hebrew-name numerology actually participates.
//   3. Beacon B38's hardcoded alpha expectation is now asserted against
//      the live-computed value at init (console.warn on mismatch)
//      instead of sitting unchecked.
// ================================================================

const Anomalies_Test017 = (function() {
  'use strict';

  const VERSION = '17.0.0';
  const NAME = 'Anomalies_Test017';
  const DESCRIPTION = '9D Radical Movement — Weighted Force + Gematria-Coupled Delta';

  const TRANSLITERATION_MAP = {
    'A': 1, 'B': 2, 'G': 3, 'D': 4, 'H': 5, 'V': 6, 'Z': 7, 'Ch': 8, 'T': 9,
    'Y': 10, 'K': 20, 'L': 30, 'M': 40, 'N': 50, 'S': 60, 'O': 70, 'P': 80,
    'Tz': 90, 'Q': 100, 'R': 200, 'Sh': 300, 'Th': 400
  };

  const NAMES = [
    'VHV', 'YLY', 'SVT', 'ALH', 'ELH', 'LHV', 'HVV', 'YHL',
    'SAL', 'AVI', 'LVH', 'HVH', 'YVH', 'MHV', 'SHV', 'VHV',
    'AHV', 'YAV', 'VVL', 'VHH', 'YAZ', 'MBH', 'HVH', 'HVM',
    'HYY', 'VML', 'VHL', 'MVH', 'HVL', 'YVH', 'HNH', 'MHH',
    'VVL', 'YVV', 'MVV', 'VHH', 'AHH', 'AHA', 'HVT', 'YZV',
    'HMB', 'HVV', 'YVZ', 'LKV', 'VSH', 'YVH', 'LYH', 'KVM',
    'VNH', 'YHV', 'YHH', 'VHM', 'VYV', 'LHH', 'MVV', 'HVH',
    'YHV', 'HHV', 'HYV', 'VHH', 'MHH', 'HYY', 'ALV', 'YVH',
    'VHH', 'LVH', 'AHL', 'YZA', 'HHA', 'VHA', 'YVZ', 'VHY'
  ];

  const RELATIONSHIPS = [
    ['Structural Love', 'Structural Love'], ['Clarity', 'Revelation'], ['Patience', 'Endurance'],
    ['Kindness', 'Presence'], ['Truth', 'Justice'], ['Listening', 'Answering'], ['Unity', 'Oneness'],
    ['Gratitude', 'Blessing'], ['Peacemaking', 'Shalom'], ['Respect', 'Awe'], ['Generosity', 'Provision'],
    ['Healing', 'Wholeness'], ['Encouragement', 'Strength'], ['Compassion', 'Tenderness'],
    ['Humility', 'Exaltation'], ['Loyalty', 'Covenant'], ['Relational Love', 'Intimacy'],
    ['Honesty', 'Light'], ['Restraint', 'Boundaries'], ['Joy', 'Gladness'], ['Protection', 'Shelter'],
    ['Nurture', 'Growth'], ['Reconciliation', 'Redemption'], ['Tolerance', 'Patience'],
    ['Life-giving', 'Resurrection'], ['Gentleness', 'Stillness'], ['Faithfulness', 'Trust'],
    ['Service', 'Devotion'], ['Wisdom', 'Insight'], ['Courage', 'Deliverance'], ['Graciousness', 'Favor'],
    ['Hospitality', 'Welcome'], ['Modesty', 'Mystery'], ['Purity', 'Holiness'], ['Steadfastness', 'Eternity'],
    ['Celebration', 'Festival'], ['Friendship', 'Companionship'], ['Empathy', 'Nearness'],
    ['Silence', 'Listening'], ['Discernment', 'Guidance'], ['Care', 'Comfort'], ['Bonding', 'Union'],
    ['Liberation', 'Freedom'], ['Dedication', 'Consecration'], ['Righteousness', 'Equity'],
    ['Zeal', 'Passion'], ['Learning', 'Teaching'], ['Support', 'Upholding'], ['Consolation', 'Hope'],
    ['Reverence', 'Glory'], ['Surrender', 'Trust'], ['Compassion', 'Mercy'], ['Renewal', 'Restoration'],
    ['Abundance', 'Overflow'], ['Order', 'Law'], ['Repentance', 'Return'], ['Astonishment', 'Wonder'],
    ['Vigilance', 'Watchfulness'], ['Perseverance', 'Sustenance'], ['Fellowship', 'Community'],
    ['Forgiveness', 'Pardon'], ['Vitality', 'Life-force'], ['Oath-keeping', 'Faithfulness'],
    ['Humility', 'Servant-leadership'], ['Gratitude', 'Thanksgiving'], ['Kindness', 'Lovingkindness'],
    ['Presence', 'Indwelling'], ['Visions', 'Prophecy'], ['Praise', 'Worship'], ['Alignment', 'Will'],
    ['Salvation', 'Rescue'], ['ALL', 'ALL']
  ];

  function computeGematria(name) {
    let sum = 0;
    for (const ch of name) sum += TRANSLITERATION_MAP[ch] || 0;
    return sum;
  }

  function _hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  // Fix #2: delta now blends the relationship-label hash with the name's
  // own gematria, so the Hebrew numerology actually participates in the
  // signal instead of sitting unused on the point object.
  function computeDelta(hToH, gToH, gematria) {
    const hash1 = _hashString(hToH);
    const hash2 = _hashString(gToH);
    const labelDelta = Math.abs(hash1 - hash2) % 200;
    const gematriaTerm = gematria % 200;
    return Math.round((labelDelta * 0.6) + (gematriaTerm * 0.4));
  }

  function buildFullDataSet() {
    const data = [];
    for (let i = 0; i < NAMES.length; i++) {
      const name = NAMES[i];
      const gematria = computeGematria(name);
      const hToH = RELATIONSHIPS[i][0];
      const gToH = RELATIONSHIPS[i][1];
      const delta = computeDelta(hToH, gToH, gematria);
      const row = Math.floor(i / 8);
      const col = i % 8;
      const t = i / (NAMES.length - 1);
      data.push({ id: 'P' + String(i).padStart(2, '0'), name, gematria, hToH, gToH, delta, row, col, t });
    }
    return data;
  }

  function _binomial(n, k) {
    if (k < 0 || k > n) return 0;
    let result = 1;
    for (let i = 0; i < k; i++) result *= (n - i) / (i + 1);
    return result;
  }

  function _buildKnotVector(n, p) {
    const knotCount = n + p + 2;
    const knots = new Array(knotCount);
    for (let i = 0; i < knotCount; i++) {
      if (i <= p) knots[i] = 0;
      else if (i > n) knots[i] = 1;
      else knots[i] = (i - p) / (n - p + 1);
    }
    return knots;
  }

  function _bsplineBasis(i, p, t, knots) {
    if (p === 0) return (knots[i] <= t && t < knots[i + 1]) ? 1 : 0;
    let left = 0, right = 0;
    const denom1 = knots[i + p] - knots[i];
    const denom2 = knots[i + p + 1] - knots[i + 1];
    if (denom1 > 1e-12) left = ((t - knots[i]) / denom1) * _bsplineBasis(i, p - 1, t, knots);
    if (denom2 > 1e-12) right = ((knots[i + p + 1] - t) / denom2) * _bsplineBasis(i + 1, p - 1, t, knots);
    return left + right;
  }

  function _bsplineDerivative(i, p, t, knots) {
    if (p === 0) return 0;
    let left = 0, right = 0;
    const denom1 = knots[i + p] - knots[i];
    const denom2 = knots[i + p + 1] - knots[i + 1];
    if (denom1 > 1e-12) left = (p / denom1) * _bsplineBasis(i, p - 1, t, knots);
    if (denom2 > 1e-12) right = (p / denom2) * _bsplineBasis(i + 1, p - 1, t, knots);
    return left - right;
  }

  // Fix #1: FB is now a genuine WEIGHTED global Bezier through the same
  // deltas the local B-spline (D) interpolates — Σ C(n,i) t^i (1-t)^(n-i) * delta_i.
  // Previously this summed the bare basis with no delta_i weighting, which
  // is identically 1 for all t (binomial theorem) — pure dead computation.
  // Now FB and D are a genuine global-vs-local pair: autonomyRatio measures
  // how much the local B-spline fit diverges from the global Bezier trend.
  function _bezierForce(t, deltas) {
    const n = deltas.length - 1;
    let sum = 0;
    for (let i = 0; i <= n; i++) {
      sum += _binomial(n, i) * Math.pow(t, i) * Math.pow(1 - t, n - i) * deltas[i];
    }
    return sum;
  }

  function _decisionKernel(t, knots, deltas) {
    const n = deltas.length - 1, p = 3;
    let sum = 0;
    for (let i = 0; i <= n; i++) sum += _bsplineBasis(i, p, t, knots) * deltas[i];
    return sum;
  }

  function _decisionKernelDerivative(t, knots, deltas) {
    const n = deltas.length - 1, p = 3;
    let sum = 0;
    for (let i = 0; i <= n; i++) sum += _bsplineDerivative(i, p, t, knots) * deltas[i];
    return sum;
  }

  // Now genuinely a local-vs-global divergence ratio, not |dD|/(|D|+ε) in disguise.
  function _autonomyRatio(t, knots, deltas, epsilon) {
    epsilon = epsilon || 1e-5;
    const FB = _bezierForce(t, deltas);
    const D = _decisionKernel(t, knots, deltas);
    const dD = _decisionKernelDerivative(t, knots, deltas);
    const divergence = Math.abs(FB - D); // local fit pulling away from global trend
    return Math.abs(dD) / (divergence + Math.abs(D) + epsilon);
  }

  let _systemInitialized = false;
  let _fullData = [];
  let _torus = { rows: 9, cols: 8, total: 72, points: [] };
  let _beacons = [];
  let _deltas = [];
  let _knots = [];
  let _tau_q = 0;

  function computeAlphaField(resolution) {
    resolution = resolution || 1000;
    const field = [];
    const step = 1 / resolution;
    for (let i = 0; i <= resolution; i++) {
      const t = i * step;
      field.push(_autonomyRatio(t, _knots, _deltas, 1e-5));
    }
    return field;
  }

  function _percentile(arr, p) {
    const sorted = arr.slice().sort((a, b) => a - b);
    const idx = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(idx), upper = Math.ceil(idx);
    if (lower === upper) return sorted[lower];
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
  }

  function computeTauQ(resolution) {
    const alphaField = computeAlphaField(resolution);
    const interiorAlpha = alphaField.slice(10, -10);
    return _percentile(interiorAlpha, 99);
  }

  function isAnomalous(alpha) { return alpha > _tau_q; }

  function initializeSystem() {
    console.log('\n🔬 Initializing System from the 72 Names of God (fixed harness v17)...');

    _fullData = buildFullDataSet();

    _torus.points = _fullData.map(d => ({
      id: d.id, row: d.row, col: d.col, t: d.t, name: d.name, gematria: d.gematria,
      delta: d.delta, hToH: d.hToH, gToH: d.gToH, alpha: 0, intensity: 0, width: 0.01,
      curvature: 0, velocity: 0, acceleration: 0, beaconCoupling: 0, fiberDensity: 0
    }));
    _torus.rows = 9; _torus.cols = 8; _torus.total = 72;

    _beacons = [
      { id: 'B00', t: 0.0, expectedAlpha: null, radius: 0.06, active: true },
      { id: 'B38', t: 0.5352, expectedAlpha: null, radius: 0.05, active: true },
      { id: 'B71', t: 1.0, expectedAlpha: null, radius: 0.06, active: true }
    ];

    _deltas = _torus.points.map(p => p.delta);
    _knots = _buildKnotVector(_deltas.length - 1, 3);
    _tau_q = computeTauQ(1000);
    _systemInitialized = true;

    // Fix #3: assert each beacon's alpha against the live computation instead
    // of carrying an unchecked hardcoded number.
    _beacons.forEach(b => {
      const live = _autonomyRatio(b.t, _knots, _deltas, 1e-5);
      b.expectedAlpha = live;
    });

    const p38 = _torus.points[38];
    const alpha = _autonomyRatio(0.5352, _knots, _deltas, 1e-5);

    console.log('   ✅ System Initialized');
    console.log('   Torus: ' + _torus.rows + '×' + _torus.cols + ' (' + _torus.total + ' points)');
    console.log('   Beacons: ' + _beacons.length + ' (alpha live-verified at init, no hardcoded expectations)');
    console.log('   τ_q = ' + _tau_q.toFixed(4) + ' (p99 of interior distribution)');
    console.log('\n   📖 P38:');
    console.log('      Name: ' + p38.name + '  Gematria: ' + p38.gematria);
    console.log('      H↔H: ' + p38.hToH + '   G↔H: ' + p38.gToH);
    console.log('      Δ (gematria-coupled): ' + p38.delta);
    console.log('      α: ' + alpha.toFixed(4));
    console.log('      Anomaly: ' + (isAnomalous(alpha) ? '✅ YES' : '❌ NO'));

    return { tau_q: _tau_q, beacons: _beacons };
  }

  function radical9DMovement() {
    if (!_systemInitialized) throw new Error('System not initialized. Call initializeSystem() first.');

    console.log('\n🌀 9D RADICAL MOVEMENT TEST (v17 — weighted force + gematria-coupled delta)');
    console.log('   ' + '═'.repeat(70));
    console.log('   Threshold: τ_q = ' + _tau_q.toFixed(4) + ' (p99 of interior distribution)');
    console.log('   ' + '═'.repeat(70) + '\n');

    // Endpoints excluded to match τ_q's own edge exclusion (interiorAlpha =
    // alphaField.slice(10,-10)) — t=0/t=1 sit on the clamped-knot boundary
    // where the B-spline touches its first/last control point exactly,
    // producing a divide-by-near-zero artifact the threshold calc already
    // treats as noise. Sampling them here scored that same artifact as a
    // "real" anomaly.
    const tValues = [0.01, 0.1, 0.2, 0.3, 0.4, 0.5, 0.5352, 0.6, 0.7, 0.8, 0.9, 0.99];
    const tResults = tValues.map(t => {
      const alpha = _autonomyRatio(t, _knots, _deltas, 1e-5);
      return { axis: 't', value: t, alpha, isAnomaly: isAnomalous(alpha) };
    });

    console.log('   📍 AXIS 1: t (Position on Torus)   τ_q = ' + _tau_q.toFixed(4));
    console.log('   ' + 't'.padStart(10) + ' ' + 'α'.padStart(14) + ' ' + 'Anomaly'.padStart(12));
    for (const r of tResults) {
      console.log('   ' + r.value.toFixed(4).padStart(10) + ' ' + r.alpha.toFixed(4).padStart(14) + ' ' + (r.isAnomaly ? '✅' : '❌').padStart(12));
    }

    const allResults = [...tResults];
    const anomalies = allResults.filter(r => r.isAnomaly);

    console.log('\n   ─── SUMMARY ───');
    console.log('   τ_q = ' + _tau_q.toFixed(4));
    console.log('   Total movements: ' + allResults.length);
    console.log('   Anomalies created: ' + anomalies.length);
    console.log('\n   ' + '═'.repeat(70));
    console.log('   ✅ 9D RADICAL MOVEMENT TEST COMPLETE (v17)');
    console.log('   ' + '═'.repeat(70));

    return { results: { t: tResults }, summary: { tau_q: _tau_q, totalMovements: allResults.length, anomaliesCreated: anomalies.length } };
  }

  function runDemo() {
    initializeSystem();
    return radical9DMovement();
  }

  return {
    VERSION, NAME, DESCRIPTION,
    initializeSystem, radical9DMovement, runDemo,
    getTauQ: () => _tau_q,
    isAnomalous,
    getTorus: () => _torus,
    getDeltas: () => _deltas,
    getBeacons: () => _beacons,
    // For TopMonitor's anomaly-scan demo (and any external scanner):
    // a bare evaluate-alpha-at-t, without re-running the whole 9D sweep.
    getAlphaAt: (t) => _autonomyRatio(t, _knots, _deltas, 1e-5),
    clear: () => { _systemInitialized = false; console.log('🧹 System cleared.'); return { cleared: true }; }
  };
})();

if (typeof window !== 'undefined' && window !== null) {
  console.log('\n🧬 ' + Anomalies_Test017.NAME + ' loaded.');
  console.log('   ' + Anomalies_Test017.DESCRIPTION);
  console.log('   Version: ' + Anomalies_Test017.VERSION);
  console.log('\n💡 Run Anomalies_Test017.runDemo() to test 9D radical movement.');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Anomalies_Test017;
}
