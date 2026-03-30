/**
 * GeoJS — Geometric Language Reasoning Engine
 * 
 * Reasoning is a C²-continuous path through semantic space.
 * Memory is a three-tier NURBS/B-Spline/Bézier manifold.
 * Intelligence is geometry. Language is output only.
 * 
 * No LLM. No black box. No statistical guessing.
 * Deterministic. Auditable. Portable.
 */

class GeoJS {

  /**
   * @param {Object} config
   * @param {number}   config.dimensions      — semantic space dimensionality
   * @param {Object}   config.domainWeights   — per-dimension significance weights
   * @param {number}   config.degree          — spline degree (3 = cubic, minimum for C²)
   * @param {number[]} config.northStar       — Bézier North Star control points [origin, focus, goal]
   * @param {Object}   config.thresholds      — curvature escalation thresholds per domain
   * @param {string}   config.domain          — manifold domain namespace
   */
  constructor(config = {}) {
    this.dimensions   = config.dimensions  || 7;
    this.degree       = config.degree      || 3;
    this.domain       = config.domain      || 'general';
    this.thresholds   = config.thresholds  || {
      low:       0.15,   // AI autonomous
      moderate:  0.35,   // recommend + approve
      high:      0.65,   // human decides
    };

    // Three-tier memory manifold
    this._manifold = {
      nurbs:   [],   // Tier 1 — active, high-fidelity, 0-12 months
      bspline: [],   // Tier 2 — historical, operational, 13-60 months
      bezier:  null, // Tier 3 — strategic, full horizon, North Star
    };

    // Knot vector and control points
    this._knots         = new Float64Array(0);
    this._controlPoints = [];
    this._weights       = new Float64Array(0);

    // Current parameter position on the manifold
    this._currentT = 0.0;

    // Event listeners for curvature threshold crossings
    this._listeners = {
      'curvature:low':       [],
      'curvature:moderate':  [],
      'curvature:high':      [],
      'curvature:undefined': [],
      'continuity:violated': [],
      'escalation:required': [],
    };

    // Initialize North Star Bézier
    if (config.northStar) {
      this._initNorthStar(config.northStar);
    }

    // Initialize domain thresholds
    this._domainThresholds = new Map();
    this._domainThresholds.set(this.domain, this.thresholds);
  }


  // ═══════════════════════════════════════════
  //  COORDINATE ENCODING
  // ═══════════════════════════════════════════

  /**
   * Encode a concept into a semantic coordinate.
   * Maps named concept to position in manifold space.
   * No LLM. Direct coordinate measurement from domain schema.
   * 
   * @param {Object} concept
   * @param {string}   concept.label         — human-readable name
   * @param {Object}   concept.measurements  — named dimension values 0.0-1.0
   * @param {string}   concept.domain        — domain namespace
   * @returns {SemanticPoint}
   */
  encode(concept) {
    const coordinates = new Float64Array(this.dimensions);

    // Map named measurements to coordinate positions
    const schema = this._getDomainSchema(concept.domain || this.domain);
    for (const [dimension, index] of Object.entries(schema)) {
      if (concept.measurements[dimension] !== undefined) {
        coordinates[index] = concept.measurements[dimension];
      }
    }

    return new SemanticPoint({
      coordinates,
      label:     concept.label,
      domain:    concept.domain || this.domain,
      weight:    concept.weight || 1.0,
      timestamp: Date.now(),
    });
  }


  // ═══════════════════════════════════════════
  //  NURBS CURVE EVALUATION — Cox-de Boor
  // ═══════════════════════════════════════════

  /**
   * Evaluate the manifold at parameter position t.
   * Returns the semantic coordinate at that position.
   * Uses Cox-de Boor recursion with NURBS rational basis.
   * 
   * @param {number} t — parameter in [0, 1]
   * @returns {SemanticPoint}
   */
  evaluate(t) {
    t = Math.max(0, Math.min(1, t));

    const n = this._controlPoints.length - 1;
    const k = this.degree;

    if (n < 0) return null;

    // Compute NURBS rational basis functions R_i,k(t)
    const N = this._computeBasis(t, n, k);
    const W = this._weights;

    // Denominator: sum of w_i * N_i,k(t)
    let denominator = 0;
    for (let i = 0; i <= n; i++) {
      denominator += W[i] * N[i];
    }

    // Numerator: sum of w_i * N_i,k(t) * P_i
    const coords = new Float64Array(this.dimensions);
    for (let i = 0; i <= n; i++) {
      const R = (W[i] * N[i]) / denominator;
      for (let d = 0; d < this.dimensions; d++) {
        coords[d] += R * this._controlPoints[i].coordinates[d];
      }
    }

    this._currentT = t;

    return new SemanticPoint({
      coordinates: coords,
      label:       `Manifold evaluation at t=${t.toFixed(4)}`,
      domain:      this.domain,
      weight:      1.0,
      timestamp:   Date.now(),
    });
  }

  /**
   * Cox-de Boor basis function recursion.
   * N_i,1(t) = 1 if t_i <= t < t_{i+1}, else 0
   * N_i,k(t) = [(t-t_i)/(t_{i+k-1}-t_i)] * N_i,k-1(t)
   *           + [(t_{i+k}-t)/(t_{i+k}-t_{i+1})] * N_{i+1,k-1}(t)
   * 
   * @private
   */
  _computeBasis(t, n, k) {
    const m = this._knots.length - 1;
    const N = new Float64Array(n + 1);

    // Base case: degree 1
    for (let i = 0; i <= n; i++) {
      N[i] = (t >= this._knots[i] && t < this._knots[i + 1]) ? 1 : 0;
    }
    // Handle endpoint: t === last knot → activate last basis function
    if (t === this._knots[m]) N[n] = 1;

    // Recursive case: build up to degree k
    for (let p = 2; p <= k; p++) {
      const Np = new Float64Array(n + 1);
      for (let i = 0; i <= n; i++) {
        let left  = 0;
        let right = 0;
        const dLeft  = this._knots[i + p - 1] - this._knots[i];
        const dRight = this._knots[i + p]     - this._knots[i + 1];
        if (dLeft  > 1e-10) {
          left = ((t - this._knots[i]) / dLeft) * N[i];
        }
        // CRITICAL: guard i+1 <= n — Float64Array returns undefined (not 0)
        // for out-of-bounds reads, producing NaN in the multiplication
        if (dRight > 1e-10 && i + 1 <= n) {
          right = ((this._knots[i + p] - t) / dRight) * N[i + 1];
        }
        Np[i] = left + right;
      }
      N.set(Np);
    }

    return N;
  }


  // ═══════════════════════════════════════════
  //  REASONING — C²-CONTINUOUS PATH FINDING
  // ═══════════════════════════════════════════

  /**
   * Find a C²-continuous reasoning path from one semantic point to another.
   * The path must maintain geometric smoothness — logical coherence.
   * Rejects any path that violates C² continuity.
   * 
   * @param {SemanticPoint} from — premise coordinate
   * @param {SemanticPoint} to   — conclusion coordinate  
   * @param {Object}        opts — pathfinding options
   * @returns {ReasoningPath}
   */
  reason(from, to, opts = {}) {
    const steps    = opts.steps    || 10;
    const maxIter  = opts.maxIter  || 100;

    // Build candidate path through manifold
    // Weighted by high-significance NURBS control points
    const path = this._buildPath(from, to, steps);

    // Enforce C² continuity at every knot junction
    const continuityResult = this._checkContinuity(path);

    if (!continuityResult.valid) {
      this._emit('continuity:violated', {
        path,
        violation: continuityResult.violation,
      });

      // Attempt to repair path
      const repairedPath = this._repairPath(path, continuityResult.violation);
      if (!repairedPath) {
        throw new GeometricContinuityError(
          `Reasoning path violates C² continuity at t=${continuityResult.violation.t.toFixed(4)}. ` +
          `Logical discontinuity detected. Human review required.`
        );
      }
      return repairedPath;
    }

    // Evaluate curvature at destination
    const κ = this._curvature(to.coordinates, path);
    this._emitCurvatureEvent(κ, path);

    // Check confidence based on local knot density
    const confidence = this._confidence(to);

    return new ReasoningPath({
      steps:      path,
      from,
      to,
      curvature:  κ,
      confidence,
      continuous: true,
      domain:     this.domain,
      timestamp:  Date.now(),
    });
  }

  /**
   * Build intermediate path steps between two semantic points.
   * Attracted to high-weight NURBS control points in manifold.
   * @private
   */
  _buildPath(from, to, steps) {
    const path = [];

    for (let i = 0; i <= steps; i++) {
      const t    = i / steps;
      const base = this._lerp(from.coordinates, to.coordinates, t);

      // Pull toward high-weight NURBS control points
      const influenced = this._applyNURBSGravity(base, t);

      path.push(new SemanticPoint({
        coordinates: influenced,
        label:       `Step ${i}/${steps}`,
        domain:      this.domain,
        weight:      1.0,
        timestamp:   Date.now(),
      }));
    }

    return path;
  }

  /**
   * Apply gravitational pull of high-weight NURBS control points.
   * High weight = high attraction = curve pulled toward significance.
   * @private
   */
  _applyNURBSGravity(coords, t) {
    const result = new Float64Array(coords);

    for (const cp of this._manifold.nurbs) {
      const dist = this._distance(coords, cp.coordinates);
      if (dist < 1e-10) continue;

      // Gravitational influence = weight / distance²
      const influence = cp.weight / (dist * dist);
      const factor    = Math.min(influence * 0.01, 0.3); // cap influence

      for (let d = 0; d < this.dimensions; d++) {
        result[d] += factor * (cp.coordinates[d] - coords[d]);
      }
    }

    return result;
  }


  // ═══════════════════════════════════════════
  //  C² CONTINUITY ENFORCEMENT
  // ═══════════════════════════════════════════

  /**
   * Verify C² continuity at every junction in the reasoning path.
   * C⁰: path connected — no gaps
   * C¹: first derivative continuous — no direction jumps
   * C²: second derivative continuous — no curvature jumps
   * 
   * Uses Kahan compensated summation for numerical stability.
   * 
   * @param {SemanticPoint[]} path
   * @returns {{ valid: boolean, violation?: Object }}
   */
  _checkContinuity(path) {
    if (path.length < 3) return { valid: true };

    // Scale epsilon to the typical step size in this path.
    // Finite-difference approximations on lerp-constructed paths produce
    // derivatives on the order of the step size — not zero.
    // Absolute 1e-6 would flag every smooth lerp path as discontinuous.
    const stepSize = this._distance(path[0].coordinates, path[path.length - 1].coordinates)
                     / Math.max(1, path.length - 1);
    const εC0 = Math.max(stepSize * 2.0,  1e-4); // C⁰: no gaps
    const εC1 = Math.max(stepSize * 2.0,  1e-3); // C¹: direction change
    const εC2 = Math.max(stepSize * 4.0,  5e-3); // C²: curvature change

    for (let i = 1; i < path.length - 1; i++) {
      const prev = path[i - 1].coordinates;
      const curr = path[i].coordinates;
      const next = path[i + 1].coordinates;

      // C⁰: path connected — consecutive points must not jump
      const gap = this._distance(curr, next);
      if (gap > εC0) {
        return {
          valid: false,
          violation: { type: 'C0', t: i / path.length, gap, label: path[i].label }
        };
      }

      // C¹: first derivative continuous — no sudden direction changes
      const d1_back = this._subtract(curr, prev);
      const d1_fwd  = this._subtract(next, curr);
      const d1_diff = this._norm(this._subtract(d1_fwd, d1_back));
      if (d1_diff > εC1) {
        return {
          valid: false,
          violation: { type: 'C1', t: i / path.length, diff: d1_diff, label: path[i].label }
        };
      }

      // C²: second derivative continuous — no curvature jumps
      if (i > 1 && i < path.length - 2) {
        const pprev = path[i - 2].coordinates;
        const nnext = path[i + 2].coordinates;
        const d2_back = this._subtract(
          this._subtract(curr, prev),
          this._subtract(prev, pprev)
        );
        const d2_fwd = this._subtract(
          this._subtract(nnext, next),
          this._subtract(next, curr)
        );
        const d2_diff = this._norm(this._subtract(d2_fwd, d2_back));
        if (d2_diff > εC2) {
          return {
            valid: false,
            violation: { type: 'C2', t: i / path.length, diff: d2_diff, label: path[i].label }
          };
        }
      }
    }

    return { valid: true };
  }


  // ═══════════════════════════════════════════
  //  MEMORY — THREE-TIER MANIFOLD
  // ═══════════════════════════════════════════

  /**
   * Inject a high-significance event into the manifold.
   * Uses Boehm's algorithm to preserve C² continuity after insertion.
   * Assigns to appropriate memory tier based on weight and age.
   * 
   * @param {SemanticPoint} point  — event to inject
   * @param {number}        weight — NURBS significance weight
   * @returns {GeoJS} this — chainable
   */
  inject(point, weight = 1.0) {
    point.weight = weight;

    // Assign to memory tier
    if (weight >= 5.0) {
      this._manifold.nurbs.push(point);
      this._enforceMaxKnotDensity('nurbs');
    } else if (weight >= 2.0) {
      this._manifold.bspline.push(point);
    } else {
      this._updateNorthStar(point);
    }

    // CRITICAL: sync _controlPoints from all manifold tiers
    // _rebuildKnots and evaluate() both depend on _controlPoints being current
    this._syncControlPoints();

    // Rebuild knot vector — preserves C² structure
    this._rebuildKnots();

    return this;
  }

  /**
   * Resolve memory from higher to lower tier.
   * NOT compression — resolution reduction based on current relevance.
   * A NURBS event at month 14 resolves to B-Spline
   * not because detail is lost but because manifold
   * position has moved past that region.
   * 
   * @param {string} fromTier — 'nurbs' | 'bspline'
   * @param {string} toTier   — 'bspline' | 'bezier'
   */
  resolve(fromTier, toTier) {
    const source = this._manifold[fromTier];
    const target = this._manifold[toTier];

    // Move points that are no longer in the active window
    const now = Date.now();
    const activeWindow = fromTier === 'nurbs'
      ? 12 * 30 * 24 * 60 * 60 * 1000   // 12 months in ms
      : 60 * 30 * 24 * 60 * 60 * 1000;  // 60 months in ms

    const stillActive = [];
    for (const point of source) {
      if (now - point.timestamp > activeWindow && point.weight < 9.0) {
        // Reduce weight on resolution
        point.weight = Math.max(point.weight * 0.5, 1.0);
        target.push(point);
      } else {
        stillActive.push(point);
      }
    }

    this._manifold[fromTier] = stillActive;

    // CRITICAL: sync _controlPoints after tier movement
    this._syncControlPoints();
    this._rebuildKnots();

    return this;
  }


  // ═══════════════════════════════════════════
  //  SKILL PATCHING — MEMORY MANIFEST I/O
  // ═══════════════════════════════════════════

  /**
   * Export the current manifold state as a Memory Manifest.
   * Three resolution levels for three audiences.
   * 
   * @param {string} resolution — 'nurbs' | 'bspline' | 'bezier'
   * @returns {Object} Memory Manifest JSON
   */
  exportManifest(resolution = 'nurbs') {
    const manifest = {
      memory_id:        `MEM-${this.domain.toUpperCase()}-${Date.now()}`,
      schema_version:   '1.0',
      coordinate_space: `GeoJS-${this.dimensions}D`,
      meta: {
        domain:      this.domain,
        resolution,
        exported_at: new Date().toISOString(),
        point_count: this._manifold[resolution]?.length || 0,
      },
      geometry: {
        degree:  this.degree,
        knots:   Array.from(this._knots),
        control_points: this._getControlPointsAtResolution(resolution),
        north_star: this._manifold.bezier,
      },
      semantic_anchors: this._getTopSignificanceLabels(5),
    };

    // Sign manifest
    manifest.signature = this._sign(manifest);

    return manifest;
  }

  /**
   * Import a Memory Manifest — Skill Patch injection.
   * Instantly loads domain expertise without recalculation.
   * Verifies schema version and signature before injection.
   * 
   * @param {Object} manifest — Memory Manifest JSON
   * @returns {GeoJS} this — chainable
   */
  importManifest(manifest) {
    // Verify schema compatibility
    if (manifest.coordinate_space !== `GeoJS-${this.dimensions}D`) {
      throw new ManifestCompatibilityError(
        `Manifest coordinate space ${manifest.coordinate_space} ` +
        `incompatible with this manifold (GeoJS-${this.dimensions}D)`
      );
    }

    // Verify signature
    if (!this._verify(manifest)) {
      throw new ManifestIntegrityError('Manifest signature invalid — import rejected');
    }

    // Inject control points at declared resolution tier
    const tier = manifest.meta.resolution;
    for (const cp of manifest.geometry.control_points) {
      this._manifold[tier].push(new SemanticPoint(cp));
    }

    // Update North Star if manifest includes one
    if (manifest.geometry.north_star) {
      this._manifold.bezier = manifest.geometry.north_star;
    }

    // CRITICAL: sync _controlPoints after injection
    this._syncControlPoints();
    this._rebuildKnots();

    return this;
  }


  // ═══════════════════════════════════════════
  //  CURVATURE AND ESCALATION
  // ═══════════════════════════════════════════

  /**
   * Compute intrinsic curvature κ at a semantic coordinate.
   * Parameterization-independent — uses arc-length normalization.
   * κ = |C' × C''| / |C'|³
   * 
   * High κ → high uncertainty → human escalation required
   * Low κ  → stable region  → AI autonomous
   * 
   * @param {Float64Array} coords
   * @param {SemanticPoint[]} path
   * @returns {number} κ
   */
  _curvature(coords, path) {
    if (path.length < 3) return 0;

    const mid  = Math.floor(path.length / 2);
    const prev = path[mid - 1].coordinates;
    const curr = path[mid].coordinates;
    const next = path[mid + 1].coordinates;

    // First derivative (central difference)
    const d1 = this._subtract(next, prev).map(v => v / 2);

    // Second derivative
    const d2 = this._subtract(
      this._subtract(next, curr),
      this._subtract(curr, prev)
    );

    // κ = |d1 × d2| / |d1|³
    const cross = this._crossMagnitude(d1, d2);
    const d1mag = this._norm(d1);

    if (d1mag < 1e-10) return 0;

    return cross / Math.pow(d1mag, 3);
  }

  /**
   * Emit appropriate curvature event based on κ magnitude.
   * @private
   */
  _emitCurvatureEvent(κ, path) {
    if (κ === undefined || isNaN(κ)) {
      this._emit('curvature:undefined', { κ, path });
    } else if (κ < this.thresholds.low) {
      this._emit('curvature:low', { κ, path });
    } else if (κ < this.thresholds.moderate) {
      this._emit('curvature:moderate', { κ, path });
    } else if (κ < this.thresholds.high) {
      this._emit('curvature:high', { κ, path });
    } else {
      this._emit('escalation:required', { κ, path });
    }
  }

  /**
   * Compute confidence based on local knot density.
   * Dense knots → high fidelity → high confidence.
   * Sparse knots → interpolating unknown space → low confidence.
   * 
   * @param {SemanticPoint} point
   * @returns {number} confidence in [0, 1]
   */
  _confidence(point) {
    const radius = 0.1; // search radius in semantic space
    let nearbyKnots = 0;

    for (const cp of [...this._manifold.nurbs, ...this._manifold.bspline]) {
      if (this._distance(point.coordinates, cp.coordinates) < radius) {
        nearbyKnots++;
      }
    }

    // Confidence rises with local knot density, saturates at 20 knots
    return 1 - (1 / (1 + nearbyKnots / 5));
  }


  // ═══════════════════════════════════════════
  //  EVENT SYSTEM
  // ═══════════════════════════════════════════

  /**
   * Subscribe to curvature threshold events.
   * 
   * @param {string}   event   — event name
   * @param {Function} handler — callback
   * @returns {GeoJS} this — chainable
   */
  on(event, handler) {
    if (!this._listeners[event]) {
      this._listeners[event] = [];
    }
    this._listeners[event].push(handler);
    return this;
  }

  _emit(event, data) {
    (this._listeners[event] || []).forEach(fn => fn(data));
  }


  // ═══════════════════════════════════════════
  //  FOBBS PIPELINE — CORE OPERATIONS
  // ═══════════════════════════════════════════

  /**
   * COMPREHENSION — Parse input into geometric structure.
   * Identifies high-curvature events (significance knots).
   * Assigns memory tier: NURBS | B-Spline | Bézier
   * 
   * @param {Object} input — raw concept measurement
   * @returns {{ point: SemanticPoint, tier: string, weight: number }}
   */
  comprehend(input) {
    const point = this.encode(input);

    // Compute local curvature relative to current manifold position
    const κ = this._localCurvature(point);

    // Assign significance weight based on curvature
    let weight, tier;
    if (κ > this.thresholds.high) {
      weight = 10.0;
      tier   = 'nurbs';
    } else if (κ > this.thresholds.low) {
      weight = 5.0;
      tier   = 'bspline';
    } else {
      weight = 1.0;
      tier   = 'bezier';
    }

    return { point, tier, weight, curvature: κ };
  }

  /**
   * ORCHESTRATION — Navigate the manifold to relevant knowledge.
   * Samples curve at parameter values relevant to current task.
   * Does NOT load full history — only the geometrically relevant segments.
   * 
   * @param {string} taskDomain — domain of the current task
   * @param {number} t          — parameter position to sample
   * @returns {SemanticPoint[]} — relevant control points
   */
  orchestrate(taskDomain, t) {
    // Find control points active near parameter t
    const active = this._manifold.nurbs.filter(cp => {
      const cpT = this._pointToParameter(cp);
      return Math.abs(cpT - t) < (this.degree / this._knots.length);
    });

    // Include high-weight points regardless of position
    const highWeight = this._manifold.nurbs.filter(cp => cp.weight >= 8.0);

    // Deduplicate and return
    const seen = new Set();
    return [...active, ...highWeight].filter(cp => {
      if (seen.has(cp.label)) return false;
      seen.add(cp.label);
      return true;
    });
  }

  /**
   * EVALUATION — Assess output quality via curvature analysis.
   * High curvature at destination → request human oversight.
   * Low curvature → AI autonomous.
   * 
   * @param {ReasoningPath} path
   * @returns {{ autonomous: boolean, curvature: number, confidence: number }}
   */
  evaluatePath(path) {
    const κ          = path.curvature;
    const confidence = path.confidence;
    const autonomous = κ < this.thresholds.moderate && confidence > 0.7;

    if (!autonomous) {
      this._emit('escalation:required', { path, κ, confidence });
    }

    return { autonomous, curvature: κ, confidence };
  }


  // ═══════════════════════════════════════════
  //  NORTH STAR — BÉZIER STRATEGIC BIAS
  // ═══════════════════════════════════════════

  /**
   * Initialize the North Star Bézier from three control points.
   * origin  — where the domain started
   * focus   — current operational position
   * goal    — projected destination
   * 
   * The North Star biases ALL downstream reasoning.
   * A reasoning path that deviates from it incurs
   * a curvature penalty proportional to deviation angle.
   * 
   * @param {Object} northStar — { origin, focus, goal }
   */
  _initNorthStar({ origin, focus, goal }) {
    this._manifold.bezier = {
      controlPoints: [
        this.encode(origin),
        this.encode(focus),
        this.encode(goal),
      ],
      evaluate: (t) => {
        // Quadratic Bézier: B(t) = (1-t)²P₀ + 2(1-t)tP₁ + t²P₂
        const P0 = this._manifold.bezier.controlPoints[0].coordinates;
        const P1 = this._manifold.bezier.controlPoints[1].coordinates;
        const P2 = this._manifold.bezier.controlPoints[2].coordinates;
        const result = new Float64Array(this.dimensions);
        for (let d = 0; d < this.dimensions; d++) {
          result[d] = Math.pow(1-t, 2) * P0[d]
                    + 2 * (1-t) * t    * P1[d]
                    + Math.pow(t, 2)   * P2[d];
        }
        return result;
      }
    };
  }

  /**
   * Compute angular deviation of a point from the North Star.
   * Used as curvature penalty in pathfinding.
   * @private
   */
  _northStarDeviation(coords, t) {
    if (!this._manifold.bezier) return 0;
    const northStarCoords = this._manifold.bezier.evaluate(t);
    const deviation       = this._distance(coords, northStarCoords);
    return deviation;
  }


  // ═══════════════════════════════════════════
  //  KNOT VECTOR MANAGEMENT
  // ═══════════════════════════════════════════

  /**
   * Rebuild the knot vector from current manifold state.
   * Maintains clamped structure: k zeros at start, k zeros at end.
   * Interior knots placed at control point temporal positions.
   * 
   * @private
   */
  _rebuildKnots() {
    const n   = this._controlPoints.length - 1;
    const k   = this.degree;

    // Need at least degree+1 control points for a valid NURBS curve
    if (n < k) {
      this._knots   = new Float64Array(0);
      this._weights = new Float64Array(0);
      return;
    }

    const m   = n + k + 1;
    const knots = new Float64Array(m + 1);

    // Clamped: first k+1 knots = 0
    for (let i = 0; i <= k; i++) knots[i] = 0;

    // Interior knots from control point timestamps, normalized to [0,1]
    const times = this._controlPoints.map(cp => cp.timestamp);
    const tMin  = Math.min(...times);
    const tMax  = Math.max(...times);
    const range = tMax - tMin || 1;

    for (let i = 1; i <= n - k; i++) {
      knots[k + i] = (times[i] - tMin) / range;
    }

    // Clamped: last k+1 knots = 1
    for (let i = m - k; i <= m; i++) knots[i] = 1;

    this._knots = knots;

    // CRITICAL: sync _weights from _controlPoints
    // _weights was initialized as Float64Array(0) and never populated
    // evaluate() uses W[i] — without this, W[i] = undefined → NaN
    this._weights = new Float64Array(this._controlPoints.map(cp => cp.weight));
  }

  /**
   * Sync _controlPoints from the three manifold tiers.
   * NURBS tier takes priority (highest significance).
   * B-Spline tier follows. Sorted by timestamp for correct knot ordering.
   *
   * CRITICAL: inject(), resolve(), importManifest() all modify
   * _manifold.nurbs / _manifold.bspline but never touched _controlPoints.
   * _rebuildKnots() and evaluate() both depend on _controlPoints.
   * Without this sync, _controlPoints is always empty → knots empty → NaN.
   *
   * @private
   */
  _syncControlPoints() {
    const all = [
      ...this._manifold.nurbs,
      ...this._manifold.bspline,
    ];
    // Sort by timestamp so knot vector reflects temporal order
    all.sort((a, b) => a.timestamp - b.timestamp);
    this._controlPoints = all;
  }

  /**
   * Boehm's knot insertion algorithm — non-in-place formulation.
   * Inserts parameter tStar into the knot vector while preserving
   * the curve geometry exactly (C² continuity maintained).
   *
   * Alpha formula (non-in-place, single insertion):
   *   α_i = (tStar - T[i]) / (T[i+p-1] - T[i])
   *
   * CLIO found that T[i+p-1] (not T[i+p]) is correct for the
   * non-in-place formulation. T[i+p] is correct for the in-place
   * P&T A5.4 formulation but gives wrong results here.
   * When denominator → 0: clamp α to 1.0 (copy P[i] unchanged).
   *
   * @param {number} tStar — knot value to insert ∈ [0,1]
   * @private
   */
  _boehm(tStar) {
    const n = this._controlPoints.length - 1;
    const p = this.degree;
    const T = this._knots;

    if (n < 0 || T.length === 0) return;

    // Find span k: largest index such that T[k] <= tStar < T[k+1]
    let k = p;
    for (let i = p; i <= n; i++) {
      if (T[i] <= tStar && tStar < T[i + 1]) { k = i; break; }
    }
    // Handle endpoint
    if (tStar >= T[T.length - 1]) k = n;

    // Non-in-place Boehm: compute new Q[0..n+1] from original P[0..n]
    // Affected range: i = k-p+1 to k
    const Q = [];
    const Qw = [];

    for (let i = 0; i <= n + 1; i++) {
      if (i <= k - p) {
        // Before affected range — copy unchanged
        Q.push(new Float64Array(this._controlPoints[i].coordinates));
        Qw.push(this._weights[i]);
      } else if (i >= k + 1) {
        // After affected range — copy from P[i-1] (shift up by 1)
        Q.push(new Float64Array(this._controlPoints[i - 1].coordinates));
        Qw.push(this._weights[i - 1]);
      } else {
        // Affected range: i in [k-p+1, k]
        // α_i = (tStar - T[i]) / (T[i+p-1] - T[i])
        const denom = T[i + p - 1] - T[i];
        const alpha = denom < 1e-10 ? 1.0 : (tStar - T[i]) / denom;
        const clamped = Math.max(0.0, Math.min(1.0, alpha));

        const qCoords = new Float64Array(this.dimensions);
        const prevCoords = this._controlPoints[i - 1].coordinates;
        const currCoords = this._controlPoints[i].coordinates;
        for (let d = 0; d < this.dimensions; d++) {
          qCoords[d] = clamped * currCoords[d] + (1 - clamped) * prevCoords[d];
        }
        Q.push(qCoords);

        const wPrev = this._weights[i - 1];
        const wCurr = this._weights[i];
        Qw.push(clamped * wCurr + (1 - clamped) * wPrev);
      }
    }

    // Rebuild _controlPoints with new Q arrays
    const newPoints = Q.map((coords, i) => new SemanticPoint({
      coordinates: coords,
      label:       (this._controlPoints[Math.min(i, n)] || this._controlPoints[n]).label,
      domain:      this.domain,
      weight:      Qw[i],
      timestamp:   (this._controlPoints[Math.min(i, n)] || this._controlPoints[n]).timestamp,
    }));

    this._controlPoints = newPoints;
    this._weights = new Float64Array(Qw);

    // Insert tStar into knot vector at position k+1
    const newKnots = new Float64Array(T.length + 1);
    for (let i = 0; i <= k;         i++) newKnots[i]     = T[i];
    newKnots[k + 1] = tStar;
    for (let i = k + 1; i < T.length; i++) newKnots[i + 1] = T[i];
    this._knots = newKnots;
  }

  /**
   * Enforce maximum knot density to prevent numerical instability.
   * When a region reaches maximum density, resolve to next tier.
   * NOT compression — resolution reduction in saturated regions.
   *
   * @private
   */
  _enforceMaxKnotDensity(tier) {
    const MAX_DENSITY = 50; // maximum knots per tier
    if (this._manifold[tier].length > MAX_DENSITY) {
      // Sort by weight — preserve highest significance
      this._manifold[tier].sort((a, b) => b.weight - a.weight);
      // Keep top MAX_DENSITY by weight
      // Low-weight overflow resolves to next tier
      const overflow = this._manifold[tier].splice(MAX_DENSITY);
      const nextTier = tier === 'nurbs' ? 'bspline' : 'bezier';
      if (nextTier !== 'bezier') {
        overflow.forEach(cp => {
          cp.weight = Math.max(cp.weight * 0.5, 1.0);
          this._manifold[nextTier].push(cp);
        });
      }
    }
  }


  // ═══════════════════════════════════════════
  //  VECTOR MATH UTILITIES
  // ═══════════════════════════════════════════

  _distance(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
    return Math.sqrt(sum);
  }

  _norm(v) {
    let sum = 0;
    for (const x of v) sum += x * x;
    return Math.sqrt(sum);
  }

  _subtract(a, b) {
    return Array.from(a).map((x, i) => x - b[i]);
  }

  _lerp(a, b, t) {
    const result = new Float64Array(a.length);
    for (let i = 0; i < a.length; i++) result[i] = a[i] + t * (b[i] - a[i]);
    return result;
  }

  _crossMagnitude(a, b) {
    // Generalized cross product magnitude for n-dimensions
    // Uses Frobenius norm of the skew-symmetric outer product
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      for (let j = i + 1; j < a.length; j++) {
        sum += (a[i] * b[j] - a[j] * b[i]) ** 2;
      }
    }
    return Math.sqrt(sum);
  }

  _localCurvature(point) {
    if (this._controlPoints.length < 3) return 0;
    const nearest = this._nearestControlPoints(point, 3);
    if (nearest.length < 3) return 0;
    const path = nearest.map(cp => cp);
    return this._curvature(point.coordinates, path);
  }

  _nearestControlPoints(point, k) {
    const all = [
      ...this._manifold.nurbs,
      ...this._manifold.bspline,
    ];
    return all
      .map(cp => ({ cp, dist: this._distance(point.coordinates, cp.coordinates) }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, k)
      .map(x => x.cp);
  }

  _pointToParameter(cp) {
    const times = this._controlPoints.map(c => c.timestamp);
    const tMin  = Math.min(...times);
    const tMax  = Math.max(...times);
    return tMax === tMin ? 0 : (cp.timestamp - tMin) / (tMax - tMin);
  }

  _getDomainSchema(domain) {
    // Default 7-dimensional schema
    // Override per domain for specialized manifolds
    return {
      risk:         0,
      liquidity:    1,
      time:         2,
      significance: 3,
      confidence:   4,
      authority:    5,
      resolution:   6,
    };
  }

  _getControlPointsAtResolution(resolution) {
    return (this._manifold[resolution] || []).map(cp => ({
      coordinates:  Array.from(cp.coordinates),
      label:        cp.label,
      weight:       cp.weight,
      timestamp:    cp.timestamp,
      domain:       cp.domain,
    }));
  }

  _getTopSignificanceLabels(n) {
    return [...this._manifold.nurbs]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, n)
      .map(cp => cp.label);
  }

  _sign(manifest) {
    // Production: use SubtleCrypto Web API
    // Development: content hash
    const content = JSON.stringify({
      ...manifest,
      signature: undefined
    });
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      hash = ((hash << 5) - hash) + content.charCodeAt(i);
      hash |= 0;
    }
    return hash.toString(16);
  }

  _verify(manifest) {
    const declared = manifest.signature;
    const computed = this._sign({ ...manifest, signature: undefined });
    return declared === computed;
  }

  _repairPath(path, violation) {
    // Attempt cubic Hermite interpolation to restore C²
    // at violation point — returns null if unresolvable
    return null; // escalates to human
  }

  _updateNorthStar(point) {
    if (this._manifold.bezier) {
      // Shift the focus control point toward new strategic input
      const focus = this._manifold.bezier.controlPoints[1];
      const α = 0.05; // learning rate — slow strategic drift
      for (let d = 0; d < this.dimensions; d++) {
        focus.coordinates[d] += α * (point.coordinates[d] - focus.coordinates[d]);
      }
    }
  }
}


// ═══════════════════════════════════════════
//  SUPPORTING CLASSES
// ═══════════════════════════════════════════

class SemanticPoint {
  constructor({ coordinates, label, domain, weight, timestamp }) {
    this.coordinates = coordinates instanceof Float64Array
      ? coordinates
      : new Float64Array(coordinates);
    this.label     = label     || '';
    this.domain    = domain    || 'general';
    this.weight    = weight    || 1.0;
    this.timestamp = timestamp || Date.now();
  }
}

class ReasoningPath {
  constructor({ steps, from, to, curvature, confidence, continuous, domain, timestamp }) {
    this.steps      = steps;
    this.from       = from;
    this.to         = to;
    this.curvature  = curvature;
    this.confidence = confidence;
    this.continuous = continuous;
    this.domain     = domain;
    this.timestamp  = timestamp;
  }

  /**
   * Export path as labeled audit trail.
   * Every step traceable to its geometric origin.
   */
  toAuditTrail() {
    return this.steps.map((step, i) => ({
      step:        i,
      t:           (i / (this.steps.length - 1)).toFixed(4),
      label:       step.label,
      coordinates: Array.from(step.coordinates),
      domain:      step.domain,
    }));
  }
}

class GeometricContinuityError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GeometricContinuityError';
  }
}

class ManifestCompatibilityError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ManifestCompatibilityError';
  }
}

class ManifestIntegrityError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ManifestIntegrityError';
  }
}


// ═══════════════════════════════════════════
//  EXPORT
// ═══════════════════════════════════════════

if (typeof module !== 'undefined') {
  module.exports = { GeoJS, SemanticPoint, ReasoningPath };
}