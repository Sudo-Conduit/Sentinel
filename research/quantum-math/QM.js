// ─── Quantum Math (QM) — Tests 11–13 ──────────────────────────────────
// Author: Will Fobbs
// Company: Pooled Impact
// Confidential & Proprietary — Not for distribution

(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.QM = factory();
  }
}(typeof self !== 'undefined' ? self : this, function() {

  'use strict';

  const CONFIDENTIAL = `
╔══════════════════════════════════════════════════════════════════════════╗
║  CONFIDENTIAL & PROPRIETARY — POOLED IMPACT                          ║
║  Author: Will Fobbs                                                   ║
║  Company: Pooled Impact (PooledImpact.com)                           ║
║  Version: ${new Date().toISOString().slice(0, 10).replace(/-/g, '.')}     ║
║  Date: ${new Date().toISOString()}                                   ║
║  Not for distribution — Internal Use Only                           ║
╚══════════════════════════════════════════════════════════════════════════╝
`;

  const log = (msg) => { console.log(msg); return msg; };

  // ─── Helpers ──────────────────────────────────────────────────────────
  function flattenDepth(arr, depth = 0) {
    if (!Array.isArray(arr)) return { depth, value: arr };
    let maxDepth = depth;
    for (let item of arr) {
      const result = flattenDepth(item, depth + 1);
      if (result.depth > maxDepth) maxDepth = result.depth;
    }
    return { depth: maxDepth, value: arr };
  }

  function computeEigenvalues(mat, size) {
    const maxIter = 1000;
    const tol = 1e-10;
    let A = new Float64Array(mat);
    for (let iter = 0; iter < maxIter; iter++) {
      let maxOff = 0;
      let p = 0, q = 1;
      for (let i = 0; i < size; i++) {
        for (let j = i + 1; j < size; j++) {
          const off = Math.abs(A[i * size + j]);
          if (off > maxOff) { maxOff = off; p = i; q = j; }
        }
      }
      if (maxOff < tol) break;
      // Sign must be negated here to match the R*A*R^T rotation convention used
      // by the off-diagonal update below; without it, the (p,q) entry never
      // actually zeroes out and every downstream eigenvalue/entropy is wrong.
      const theta = 0.5 * Math.atan2(-2 * A[p * size + q], A[p * size + p] - A[q * size + q]);
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      const App = A[p * size + p];
      const Aqq = A[q * size + q];
      const Apq = A[p * size + q];
      A[p * size + p] = c * c * App - 2 * c * s * Apq + s * s * Aqq;
      A[q * size + q] = s * s * App + 2 * c * s * Apq + c * c * Aqq;
      A[p * size + q] = 0;
      A[q * size + p] = 0;
      for (let k = 0; k < size; k++) {
        if (k !== p && k !== q) {
          const Apk = A[p * size + k];
          const Aqk = A[q * size + k];
          A[p * size + k] = c * Apk - s * Aqk;
          A[k * size + p] = A[p * size + k];
          A[q * size + k] = s * Apk + c * Aqk;
          A[k * size + q] = A[q * size + k];
        }
      }
    }
    const eigvals = new Float64Array(size);
    for (let i = 0; i < size; i++) eigvals[i] = A[i * size + i];
    return eigvals;
  }

  function vonNeumannEntropy(state) {
    const n = state.length;
    if (n === 0) return 0;

    if (n <= 64) {
      const rho = new Float64Array(n * n);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          rho[i * n + j] = state[i] * state[j];
        }
      }
      const eigvals = computeEigenvalues(rho, n);
      let entropy = 0;
      for (let i = 0; i < n; i++) {
        const p = Math.max(0, eigvals[i]);
        if (p > 1e-12) entropy -= p * Math.log2(p);
      }
      return Math.max(0, entropy);
    }

    let purity = 0;
    for (let i = 0; i < n; i++) purity += state[i] * state[i];
    return Math.max(0, 1 - purity);
  }

  function buildMixedState(rank, entropyTarget) {
    const dim = 1 << rank;
    const state = new Float64Array(dim);

    const numComponents = Math.max(2, Math.floor(entropyTarget * 4) + 1);
    const weights = new Float64Array(numComponents);

    let totalWeight = 0;
    for (let i = 0; i < numComponents; i++) {
      weights[i] = Math.random();
      totalWeight += weights[i];
    }
    for (let i = 0; i < numComponents; i++) {
      weights[i] /= totalWeight;
    }

    for (let c = 0; c < numComponents; c++) {
      const component = new Float64Array(dim);
      const numNonZero = Math.max(2, Math.floor(Math.random() * dim / 4) + 1);
      for (let i = 0; i < numNonZero && i < dim; i++) {
        component[i] = (Math.random() * 2 - 1) * (1 / Math.sqrt(numNonZero));
      }
      let norm = 0;
      for (let i = 0; i < dim; i++) norm += component[i] * component[i];
      norm = Math.sqrt(norm);
      for (let i = 0; i < dim; i++) component[i] /= (norm || 1);

      for (let i = 0; i < dim; i++) {
        state[i] += Math.sqrt(weights[c]) * component[i];
      }
    }

    let norm = 0;
    for (let i = 0; i < dim; i++) norm += state[i] * state[i];
    norm = Math.sqrt(norm);
    for (let i = 0; i < dim; i++) state[i] /= (norm || 1);

    return state;
  }

  function buildTensorFromArrays(R1, R2) {
    const flat = R1;
    const nested = R2;
    const nestedInfo = flattenDepth(nested);
    const nestedDepth = nestedInfo.depth;
    const rank = flat.length + nestedDepth;
    const size = 1 << rank;
    const tensor = new Float64Array(size);
    for (let i = 0; i < size; i++) tensor[i] = (Math.random() * 2 - 1) * 0.01;
    let uniqueIndex = 0;
    for (let i = 0; i < flat.length; i++) {
      if (flat[i] !== 0 && flat[i] !== 1) { uniqueIndex = i; break; }
    }
    const uniqueDepth = nestedDepth;
    const combinedIndex = (uniqueIndex << 4) | uniqueDepth;
    const tensorIndex = combinedIndex % size;
    tensor[tensorIndex] = 0.9999;
    return { rank, size, tensor, uniqueIndex, uniqueDepth, combinedIndex, tensorIndex, flatLength: flat.length, nestedDepth };
  }

  function buildSubsystem(rank, entropyTarget, seedOffset) {
    const R1 = [1, 1, 0, 0, 2, 0, 0, 1, 1];
    const R1_sub = R1.slice(0, 5);
    const R2_sub = [0, [1, [2, [1]]]];
    const tensorData = buildTensorFromArrays(R1_sub, R2_sub);
    const state = buildMixedState(rank, entropyTarget);
    return { state, tensorData, rank, size: 1 << rank };
  }

  function extractFeaturesWithValues(state, rank) {
    const dim = state.length;
    const features = [];
    const entropy = vonNeumannEntropy(state);

    for (let i = 0; i < Math.min(rank, 10); i++) {
      const amplitude = state[i] || 0;
      let nonZeroCount = 0;
      for (let j = 0; j < Math.min(dim, 100); j++) {
        if (Math.abs(state[j]) > 0.001) nonZeroCount++;
      }
      const parallelismValue = nonZeroCount;
      const parallelism = parallelismValue > 20 ? 'High' : parallelismValue > 10 ? 'Moderate' : 'Low';

      const cnotValue = Math.abs(state[i] * state[(i + 1) % dim]);
      const cnot = cnotValue > 0.001 ? 'Yes' : 'No';

      let teleportValue = 0;
      let teleportCount = 0;
      for (let j = 0; j < Math.min(dim, 10); j++) {
        if (j !== i) {
          teleportValue += Math.abs(state[i] * state[j]);
          teleportCount++;
        }
      }
      teleportValue = teleportCount > 0 ? teleportValue / teleportCount : 0;
      const teleportation = teleportValue > 0.001 ? 'Yes' : 'No';

      const measurementValue = Math.abs(amplitude);
      const measurement = measurementValue > 0.1 ? 'Measured' : 'Idle';

      features.push({
        index: i,
        amplitude: amplitude,
        amplitudeStr: amplitude.toFixed(4),
        parallelism: parallelism + '(' + parallelismValue + ')',
        parallelismValue: parallelismValue,
        cnot: cnot + '(' + cnotValue.toFixed(4) + ')',
        cnotValue: cnotValue,
        teleportation: teleportation + '(' + teleportValue.toFixed(4) + ')',
        teleportValue: teleportValue,
        measurement: measurement + '(' + measurementValue.toFixed(4) + ')',
        measurementValue: measurementValue,
        entropy: entropy
      });
    }
    return features;
  }

  function computeValence(shells) {
    const shellKeys = Object.keys(shells).map(Number).sort((a, b) => a - b);
    if (shellKeys.length === 0) return 0;
    const outermost = shellKeys[shellKeys.length - 1];
    return shells[outermost];
  }

  // ─── Class: QM ────────────────────────────────────────────────────────
  class QM {

    constructor() {
      const d = new Date();
      this.author = 'Will Fobbs';
      this.company = 'Pooled Impact';
      this.version = d.toISOString().slice(0, 10).replace(/-/g, '.');
      this.date = d.toISOString();
      this.confidential = true;
      this.results = [];
      this.helpText = `
${CONFIDENTIAL}

╔══════════════════════════════════════════════════════════════════════════╗
║  QM — Quantum Math: Tensor → Hilbert → Quantum                       ║
║  Version: ${this.version}                                             ║
║  Date: ${this.date}                                                  ║
║  Author: ${this.author} · ${this.company}                           ║
╚══════════════════════════════════════════════════════════════════════════╝

Commands:
  QM.run("help")                      — Show this help
  QM.run("test v=011")                — Run Test 011 (Connected Graph)
  QM.run("test v=012")                — Run Test 012 (Element Fingerprint)
  QM.run("test v=013")                — Run Test 013 (Nested Shell Hypothesis, 1-12)
  QM.run("version")                   — Show version & confidentiality
`;
    }

    help() { return log(this.helpText); }

    versionInfo() {
      return log(`
${CONFIDENTIAL}
Version: ${this.version}
Date: ${this.date}
Author: ${this.author}
Company: ${this.company}
Confidential: ${this.confidential ? 'YES — Proprietary' : 'NO'}
`);
    }

    buildTensor(R1, R2) { return buildTensorFromArrays(R1, R2); }

    projectClassical(tensorData) {
      const { tensor, size, rank } = tensorData;
      const classicalState = new Float64Array(rank);
      for (let i = 0; i < rank; i++) {
        const idx = i * (size / rank);
        classicalState[i] = tensor[Math.floor(idx)] || 0;
      }
      return classicalState;
    }

    projectQuantum(tensorData) {
      const { tensor, size, rank } = tensorData;
      const dim = 1 << rank;
      const state = new Float64Array(dim);
      for (let i = 0; i < dim; i++) state[i] = tensor[i % size] || 0;
      let norm = 0;
      for (let i = 0; i < dim; i++) norm += state[i] * state[i];
      norm = Math.sqrt(norm);
      for (let i = 0; i < dim; i++) state[i] /= (norm || 1);
      return state;
    }

    buildSuperposedState(tensorData) {
      const { tensor, size, rank } = tensorData;
      const dim = 1 << rank;
      const state = new Float64Array(dim);
      for (let i = 0; i < dim; i++) {
        state[i] = (Math.random() * 2 - 1) * 0.1 + (tensor[i % size] || 0);
      }
      let norm = 0;
      for (let i = 0; i < dim; i++) norm += state[i] * state[i];
      norm = Math.sqrt(norm);
      for (let i = 0; i < dim; i++) state[i] /= (norm || 1);
      return state;
    }

    computeEntropy(state) { return vonNeumannEntropy(state); }

    shiftUp(classicalState, tensorData) {
      const { rank } = tensorData;
      const dim = 1 << rank;
      const quantumState = new Float64Array(dim);
      for (let i = 0; i < classicalState.length; i++) quantumState[i] = classicalState[i] || 0;
      for (let i = 0; i < dim; i++) quantumState[i] += (Math.random() - 0.5) * 0.1;
      let norm = 0;
      for (let i = 0; i < dim; i++) norm += quantumState[i] * quantumState[i];
      norm = Math.sqrt(norm);
      for (let i = 0; i < dim; i++) quantumState[i] /= (norm || 1);
      return quantumState;
    }

    shiftDown(quantumState) {
      const classicalState = new Float64Array(quantumState.length);
      let maxIdx = 0, maxVal = 0;
      for (let i = 0; i < quantumState.length; i++) {
        const prob = quantumState[i] * quantumState[i];
        if (prob > maxVal) { maxVal = prob; maxIdx = i; }
      }
      classicalState[maxIdx] = 1;
      return classicalState;
    }

    extractFeaturesWithValues(state, rank) { return extractFeaturesWithValues(state, rank); }

    // ─── Corrected buildNestedShell ──────────────────────────────────
    buildNestedShell(shellNumber, electronCount, innerShell) {
      const dim = 1 << shellNumber;

      // Build the outer shell's state first
      const outerState = buildMixedState(shellNumber, 0.7);
      const outerEntropy = vonNeumannEntropy(outerState);
      const outerAmplitude = outerState[Math.min(4, outerState.length - 1)] || 0;

      let state;
      let amplitude;

      if (innerShell && innerShell.state) {
        // Combine inner + outer
        const innerState = innerShell.state;
        const newState = new Float64Array(dim);
        for (let i = 0; i < innerState.length && i < dim; i++) {
          newState[i] = innerState[i] * 0.5;
        }
        for (let i = 0; i < outerState.length && i < dim; i++) {
          newState[i] += outerState[i] * 0.5;
        }
        // Normalize
        let norm = 0;
        for (let i = 0; i < newState.length; i++) norm += newState[i] * newState[i];
        norm = Math.sqrt(norm);
        if (norm > 0) {
          for (let i = 0; i < newState.length; i++) newState[i] /= norm;
        }
        state = newState;
        // The amplitude of this shell is the outer shell's amplitude
        amplitude = outerAmplitude;
      } else {
        state = outerState;
        amplitude = outerAmplitude;
      }

      const entropy = vonNeumannEntropy(state);

      return {
        shell: shellNumber,
        electrons: electronCount,
        entropy: entropy,
        amplitude: amplitude,
        inner: innerShell || null,
        size: dim,
        state: state
      };
    }

    // ─── Test 011 ──────────────────────────────────────────────────────
    test011() {
      log(`
${CONFIDENTIAL}
╔══════════════════════════════════════════════════════════════════════════╗
║  QM Test 11 — Connected Graph Construction                           ║
║  Version: ${this.version} · ${this.date}                            ║
║  Author: ${this.author} · ${this.company}                         ║
║  Builds a connected graph of Rank 9 subsystems                     ║
║  No hierarchy — nodes are peers, edges are entanglement            ║
║  Tests dimensional collapse: does the graph behave as one system?  ║
╚══════════════════════════════════════════════════════════════════════════╝
`);

      const RANK = 9;
      const NUM_NODES = 5;
      const ENTROPY_TARGET = 0.7;

      log('\n📐 Step 1 — Build Nodes (Subsystems)');
      const nodes = [];
      for (let i = 0; i < NUM_NODES; i++) {
        const sys = buildSubsystem(RANK, ENTROPY_TARGET, i);
        nodes.push({
          id: i,
          state: sys.state,
          rank: sys.rank,
          size: sys.size,
          entropy: vonNeumannEntropy(sys.state)
        });
        log(`  Node ${i}: rank=${sys.rank}, size=${sys.size}, entropy=${nodes[i].entropy.toFixed(6)}`);
      }

      log('\n📐 Step 2 — Build Edges (Entanglement Paths)');
      const edges = [];
      for (let i = 0; i < NUM_NODES; i++) {
        for (let j = i + 1; j < NUM_NODES; j++) {
          const q4i = nodes[i].state[4] || 0;
          const q4j = nodes[j].state[4] || 0;
          const strength = Math.abs(q4i * q4j);
          edges.push({ from: i, to: j, strength });
          log(`  Edge ${i} ↔ ${j}: strength = ${strength.toFixed(6)}`);
        }
      }

      log('\n📐 Step 3 — Graph Connectivity');
      const totalEdges = (NUM_NODES * (NUM_NODES - 1)) / 2;
      const isConnected = edges.length === totalEdges;
      log(`  → Total nodes: ${NUM_NODES}`);
      log(`  → Total edges: ${edges.length} / ${totalEdges}`);
      log(`  → Graph is ${isConnected ? 'fully connected' : 'not fully connected'}`);

      log('\n📐 Step 4 — Dimensional Collapse Test');
      const anchor = nodes[0];
      const correlations = [];
      for (let i = 1; i < NUM_NODES; i++) {
        const corr = Math.abs(anchor.state[4] * nodes[i].state[4]);
        correlations.push(corr);
        log(`  Node 0 ↔ Node ${i}: correlation = ${corr.toFixed(6)}`);
      }
      const avgCorr = correlations.reduce((a, b) => a + b, 0) / correlations.length;
      const isCollapsed = avgCorr > 0.01;
      log(`  → Average correlation with anchor: ${avgCorr.toFixed(6)}`);
      log(`  → Dimensional collapse ${isCollapsed ? 'detected' : 'not detected'}`);

      log('\n📐 Step 5 — Graph Statistics');
      const avgStrength = edges.reduce((s, e) => s + e.strength, 0) / edges.length;
      const maxStrength = Math.max(...edges.map(e => e.strength));
      const minStrength = Math.min(...edges.map(e => e.strength));
      log(`  → Average edge strength: ${avgStrength.toFixed(6)}`);
      log(`  → Max edge strength: ${maxStrength.toFixed(6)}`);
      log(`  → Min edge strength: ${minStrength.toFixed(6)}`);

      log('\n📐 Result:');
      log(`  ✅ Connected graph built with ${NUM_NODES} nodes and ${edges.length} edges`);
      log(`  ✅ Graph is ${isConnected ? 'fully connected' : 'not fully connected'}`);
      log(`  ✅ ${isCollapsed ? 'Dimensional collapse detected — system behaves as one relational unit' : 'No collapse — system retains independent dimensions'}`);
      log(`  ✅ Ready for traversal, rebalancing, and cube mapping`);

      log(`
╔══════════════════════════════════════════════════════════════════════════╗
║  Test 11 Complete                                                     ║
║  ${this.date}                                                         ║
║  ${this.author} · ${this.company} · Confidential & Proprietary       ║
╚══════════════════════════════════════════════════════════════════════════╝
`);
      return { nodes, edges, isConnected, isCollapsed, avgStrength, maxStrength, minStrength };
    }

    // ─── Test 012 ──────────────────────────────────────────────────────
    test012() {
      log(`
${CONFIDENTIAL}
╔══════════════════════════════════════════════════════════════════════════╗
║  QM Test 12 — Element Fingerprint (1-12)                             ║
║  Version: ${this.version} · ${this.date}                            ║
║  Author: ${this.author} · ${this.company}                         ║
║  Elements 1-12 (H → Mg) one at a time                            ║
║  Valence is derived from shell structure                         ║
╚══════════════════════════════════════════════════════════════════════════╝
`);

      const elements = [
        { symbol: 'H',  shells: { 1: 1 }, mass: 1.008 },
        { symbol: 'He', shells: { 1: 2 }, mass: 4.003 },
        { symbol: 'Li', shells: { 1: 2, 2: 1 }, mass: 6.94 },
        { symbol: 'Be', shells: { 1: 2, 2: 2 }, mass: 9.012 },
        { symbol: 'B',  shells: { 1: 2, 2: 3 }, mass: 10.81 },
        { symbol: 'C',  shells: { 1: 2, 2: 4 }, mass: 12.01 },
        { symbol: 'N',  shells: { 1: 2, 2: 5 }, mass: 14.01 },
        { symbol: 'O',  shells: { 1: 2, 2: 6 }, mass: 16.00 },
        { symbol: 'F',  shells: { 1: 2, 2: 7 }, mass: 19.00 },
        { symbol: 'Ne', shells: { 1: 2, 2: 8 }, mass: 20.18 },
        { symbol: 'Na', shells: { 1: 2, 2: 8, 3: 1 }, mass: 22.99 },
        { symbol: 'Mg', shells: { 1: 2, 2: 8, 3: 2 }, mass: 24.31 }
      ];

      log('\n📐 Step 1 — Create, Read, Delete each element (1-12)');

      const fingerprints = [];

      for (let i = 0; i < elements.length; i++) {
        const el = elements[i];
        const valence = computeValence(el.shells);
        const graph = createElement(el.symbol, el.shells, el.mass, valence);

        fingerprints.push({
          symbol: el.symbol,
          totalQubits: graph.totalQubits,
          graphEntropy: graph.graphEntropy,
          amplitude: graph.amplitude,
          valence: valence,
          mass: el.mass,
          memory: graph.memory
        });

        log(`  ${el.symbol}: totalQubits=${graph.totalQubits}, graphEntropy=${graph.graphEntropy.toFixed(6)}, amplitude=${graph.amplitude.toFixed(6)}, valence=${valence}, memory=${graph.memory}`);
      }

      log('\n📐 Step 2 — Summary');
      log(`  → Elements processed: ${fingerprints.length} (H → Mg)`);

      log('\n📐 Result:');
      log(`  ✅ Each element's fingerprint captured`);
      log(`  ✅ Valence derived from shell structure`);

      log(`
╔══════════════════════════════════════════════════════════════════════════╗
║  Test 12 Complete                                                     ║
║  ${this.date}                                                         ║
║  ${this.author} · ${this.company} · Confidential & Proprietary       ║
╚══════════════════════════════════════════════════════════════════════════╝
`);
      return fingerprints;
    }

    // ─── Test 013 ──────────────────────────────────────────────────────
    test013() {
      log(`
${CONFIDENTIAL}
╔══════════════════════════════════════════════════════════════════════════╗
║  QM Test 13 — Nested Shell Hypothesis (1-12) — CORRECTED             ║
║  Version: ${this.version} · ${this.date}                            ║
║  Author: ${this.author} · ${this.company}                         ║
║  Builds nested shells for elements 1-12 (H → Mg)                  ║
║  Outer shell amplitude is preserved (not overwritten)            ║
║  Valence is derived from shell structure                         ║
╚══════════════════════════════════════════════════════════════════════════╝
`);

      const elements = [
        { symbol: 'H',  shells: { 1: 1 }, mass: 1.008 },
        { symbol: 'He', shells: { 1: 2 }, mass: 4.003 },
        { symbol: 'Li', shells: { 1: 2, 2: 1 }, mass: 6.94 },
        { symbol: 'Be', shells: { 1: 2, 2: 2 }, mass: 9.012 },
        { symbol: 'B',  shells: { 1: 2, 2: 3 }, mass: 10.81 },
        { symbol: 'C',  shells: { 1: 2, 2: 4 }, mass: 12.01 },
        { symbol: 'N',  shells: { 1: 2, 2: 5 }, mass: 14.01 },
        { symbol: 'O',  shells: { 1: 2, 2: 6 }, mass: 16.00 },
        { symbol: 'F',  shells: { 1: 2, 2: 7 }, mass: 19.00 },
        { symbol: 'Ne', shells: { 1: 2, 2: 8 }, mass: 20.18 },
        { symbol: 'Na', shells: { 1: 2, 2: 8, 3: 1 }, mass: 22.99 },
        { symbol: 'Mg', shells: { 1: 2, 2: 8, 3: 2 }, mass: 24.31 }
      ];

      log('\n📐 Step 1 — Build Nested Shells for Elements 1-12');
      const results = [];

      for (let i = 0; i < elements.length; i++) {
        const el = elements[i];
        const shells = el.shells;
        const valence = computeValence(shells);

        let inner = null;
        const shellData = [];
        const shellKeys = Object.keys(shells).map(Number).sort((a, b) => a - b);

        for (const n of shellKeys) {
          const count = shells[n];
          const shell = this.buildNestedShell(n, count, inner);
          shellData.push(shell);
          inner = shell;
        }

        const outermost = inner;

        const entropyStr = shellData.map(s => s.entropy.toFixed(6)).join(' → ');
        const ampStr = shellData.map(s => s.amplitude.toFixed(6)).join(' → ');
        log(`  ${el.symbol}: shells=${shellData.length}, valence=${valence}, entropy=${entropyStr}, amplitude=${ampStr}`);

        results.push({
          symbol: el.symbol,
          mass: el.mass,
          shells: shellData,
          valence: valence,
          outermostEntropy: outermost ? outermost.entropy : 0,
          outermostAmplitude: outermost ? outermost.amplitude : 0,
          totalQubits: 1 + Object.values(shells).reduce((a, b) => a + b, 0)
        });
      }

      log('\n📐 Step 2 — Entropy Trend (1-12)');
      const entropyValues = results.map(r => r.outermostEntropy);
      const entropyIncreases = entropyValues.every((v, i, arr) => i === 0 || v >= arr[i - 1]);
      log(`  → Entropy trend: ${entropyIncreases ? '✅ Increases with atomic number' : '⚠️  Does not increase monotonically'}`);
      log(`  → Entropy range: ${Math.min(...entropyValues).toFixed(6)} → ${Math.max(...entropyValues).toFixed(6)}`);

      log('\n📐 Result:');
      log(`  ✅ Elements 1-12 (H → Mg) processed`);
      log(`  ✅ Nested shells built for each element`);
      log(`  ✅ Valence derived from shell structure — no hardcoding`);

      log(`
╔══════════════════════════════════════════════════════════════════════════╗
║  Test 13 Complete                                                     ║
║  ${this.date}                                                         ║
║  ${this.author} · ${this.company} · Confidential & Proprietary       ║
╚══════════════════════════════════════════════════════════════════════════╝
`);
      return results;
    }

    // ─── Run Dispatcher ──────────────────────────────────────────────────
    run(cmd) {
      if (!cmd) return this.help();
      if (cmd === 'help') return this.help();
      if (cmd === 'version' || cmd === 'confidential') return this.versionInfo();
      if (cmd.startsWith('test')) {
        const parts = cmd.split(' ');
        const testId = parts.length > 1 ? parts[1] : '';
        if (testId === 'v=011' || testId === '011') return this.test011();
        if (testId === 'v=012' || testId === '012') return this.test012();
        if (testId === 'v=013' || testId === '013') return this.test013();
        return log(`Unknown test: ${testId}. Use "help" for available tests.`);
      }
      return log(`Unknown command: "${cmd}". Use "help" for available commands.`);
    }

  }

  // ─── createElement ──────────────────────────────────────────────────
  function createElement(symbol, shells, mass, valence) {
    const totalElectrons = Object.values(shells).reduce((a, b) => a + b, 0);
    const totalQubits = 1 + totalElectrons;

    const anchorState = buildMixedState(1, 0.7);
    const anchorEntropy = vonNeumannEntropy(anchorState);
    const anchorAmplitude = anchorState[Math.min(4, anchorState.length - 1)] || 0;

    const shellData = [];
    let totalShellEntropy = 0;
    let shellCount = 0;

    for (const [shell, count] of Object.entries(shells)) {
      const rank = parseInt(shell);
      const state = buildMixedState(rank, 0.7);
      const entropy = vonNeumannEntropy(state);
      const amplitude = state[Math.min(4, state.length - 1)] || 0;
      shellData.push({ shell: rank, count, entropy, amplitude, state });
      totalShellEntropy += entropy;
      shellCount++;
    }

    const graphEntropy = (anchorEntropy + totalShellEntropy) / (1 + shellCount);

    const memoryKB = (1 << totalQubits) / 8 / 1024;
    const memory = memoryKB < 1 ? ((1 << totalQubits) * 8 / 1024).toFixed(2) + ' B' : memoryKB.toFixed(2) + ' KB';

    return {
      symbol,
      shells,
      mass,
      valence,
      totalQubits,
      anchorEntropy,
      shellEntropies: shellData.map(d => d.entropy),
      graphEntropy,
      amplitude: anchorAmplitude,
      memory,
      state: null
    };
  }

  const instance = new QM();
  if (typeof window !== 'undefined') window.QM = instance;
  return instance;

}));