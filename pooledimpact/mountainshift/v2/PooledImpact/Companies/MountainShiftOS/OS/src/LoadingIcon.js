/**
 * @file LoadingIcon.js
 * @author Will Fobbs, Pooled Impact
 * @version 1.0.0
 * @description A 16x16 animated SVG loading icon \u2014 a 3x3 grid of
 *              blocks (9 total) where one block's color cycles through
 *              the grid to indicate activity, matching the reference
 *              frame (olive-green active block on a blue grid, white
 *              gaps). Implemented as a BaseClassX domain class so its
 *              config (colors, speed, run state) is schema-tracked like
 *              every other MESHUI model \u2014 not just a one-off widget.
 *
 *              Runtime-only state (the live <svg> element, its <rect>
 *              refs, the setInterval handle) is kept OUTSIDE the
 *              schema-enforcing Proxy in a WeakMap, following the same
 *              pattern AppClasses.js uses for its `appVersions` store \u2014
 *              BaseClassX's proxy only allows writes to properties
 *              declared in _schema.properties, so DOM/timer handles must
 *              live elsewhere.
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) define(['./BaseClassX.js'], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory(require('./BaseClassX.js'));
  else root.LoadingIcon = factory(root.BaseClassX);
}(typeof self !== 'undefined' ? self : this, function(BaseClassX) {
  'use strict';
  if (!BaseClassX) throw new Error('LoadingIcon requires BaseClassX to be loaded first');

  const runtime = new WeakMap(); // instance -> { svg, rects, timer }
  const GRID = 3, CELL = 4, GAP = 1; // 16x16 viewBox: gap+cell+gap+cell+gap+cell+gap = 16
  // Clockwise path around the 8 OUTER blocks only (center, index 4, never lights up) —
  // a simple brand-color spinner rather than a plain sequential fill.
  const RING = [0, 1, 2, 5, 8, 7, 6, 3];

  class LoadingIcon extends BaseClassX {
    static version = '1.0.0';
    static domain = 'ui.loadingIcon';
    static _schema = {
      type: 'loadingIcon',
      properties: {
        colors: { type: 'object', default: { active: '#b3cc66', base: '#5b7fe0', gap: '#ffffff' } },
        speedMs: { type: 'number', default: 200, min: 100, max: 1000 },   // realistic bounds: never faster than 100ms, never slower than 1s
        playState: { type: 'string', default: 'stopped' },   // 'stopped' | 'running' | 'paused' — named playState, not state (BaseClassX already owns `state` for its own object lifecycle)
        activeIndex: { type: 'number', default: 0 }   // index into the clockwise outer-ring path (RING), not a raw grid index
      }
    };

    constructor(options = {}) {
      super({ type: 'loadingIcon', ...options });
      runtime.set(this, { svg: null, rects: [], timer: null });
    }

    // ─── Rendering ────────────────────────────────────────────────
    _cellPos(i) {
      const row = Math.floor(i / GRID), col = i % GRID;
      return { x: GAP + col * (CELL + GAP), y: GAP + row * (CELL + GAP) };
    }
    _buildSVG() {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 16 16');
      svg.setAttribute('width', '16');
      svg.setAttribute('height', '16');
      svg.style.display = 'block';
      const bg = document.createElementNS(svg.namespaceURI, 'rect');
      bg.setAttribute('x', '0'); bg.setAttribute('y', '0'); bg.setAttribute('width', '16'); bg.setAttribute('height', '16');
      bg.setAttribute('fill', this.colors.gap);
      svg.appendChild(bg);
      const rects = [];
      for (let i = 0; i < GRID * GRID; i++) {
        const { x, y } = this._cellPos(i);
        const r = document.createElementNS(svg.namespaceURI, 'rect');
        r.setAttribute('x', x); r.setAttribute('y', y);
        r.setAttribute('width', CELL); r.setAttribute('height', CELL);
        r.setAttribute('rx', '0.4');
        r.setAttribute('fill', this.playState === 'stopped' ? this.colors.active : (i === RING[this.activeIndex] ? this.colors.active : this.colors.base));
        r.style.transition = 'fill 120ms linear';
        svg.appendChild(r);
        rects.push(r);
      }
      return { svg, rects };
    }
    _paint() {
      const rt = runtime.get(this);
      if (!rt || !rt.rects.length) return;
      // Stopped: the whole grid reads as one solid Active Color (idle look).
      rt.rects.forEach((r, i) => r.setAttribute('fill', this.playState === 'stopped' ? this.colors.active : (i === RING[this.activeIndex] ? this.colors.active : this.colors.base)));
    }

    /** Mounts a fresh <svg> into `container` (any Element) and returns it. */
    mount(container) {
      const rt = runtime.get(this);
      if (rt.svg && rt.svg.parentNode) rt.svg.parentNode.removeChild(rt.svg);
      const built = this._buildSVG();
      runtime.set(this, { ...rt, svg: built.svg, rects: built.rects });
      if (container) container.appendChild(built.svg);
      return built.svg;
    }

    // ─── Playback control ───────────────────────────────────────────
    _tick() {
      this.activeIndex = (this.activeIndex + 1) % RING.length;
      this._paint();
      this.emit('tick', { activeIndex: this.activeIndex });
    }
    _clearTimer() {
      const rt = runtime.get(this);
      if (rt.timer) { clearInterval(rt.timer); rt.timer = null; }
    }
    /** Starts from the beginning (resets activeIndex to 0). */
    start() {
      this._clearTimer();
      this.activeIndex = 0;
      this.playState = 'running';
      this._paint();
      this.emit('start', { activeIndex: this.activeIndex });
      const rt = runtime.get(this);
      rt.timer = setInterval(() => this._tick(), this.speedMs);
    }
    /** Halts and resets to the idle frame (index 0). */
    stop() {
      this._clearTimer();
      this.playState = 'stopped';
      this.activeIndex = 0;
      this._paint();
      this.emit('stop', {});
    }
    /** Halts in place \u2014 activeIndex is preserved for resume(). */
    pause() {
      this._clearTimer();
      this.playState = 'paused';
      this.emit('pause', { activeIndex: this.activeIndex });
    }
    /** Continues cycling from wherever pause() left off. */
    resume() {
      if (this.playState !== 'paused') return this.start();
      this.playState = 'running';
      this.emit('resume', { activeIndex: this.activeIndex });
      const rt = runtime.get(this);
      rt.timer = setInterval(() => this._tick(), this.speedMs);
    }
    setColors(patch) {
      this.colors = { ...this.colors, ...patch };
      this._paint();
      this.emit('colors_changed', { colors: this.colors });
    }
    setSpeed(ms) {
      this.speedMs = Math.min(1000, Math.max(100, ms));
      this.emit('speed_changed', { speedMs: this.speedMs });
      if (this.playState === 'running') { this._clearTimer(); const rt = runtime.get(this); rt.timer = setInterval(() => this._tick(), this.speedMs); }
    }
    /** Serializes the CURRENT colors/speed into a standalone, JS-free
     * animated SVG string (native SMIL <animate>, calcMode="discrete")
     * that reproduces the same clockwise ring cycle when opened anywhere \u2014
     * a browser, an <img>, a design tool \u2014 with no LoadingIcon.js present. */
    exportSVG() {
      const N = RING.length;
      const durMs = this.speedMs * N;
      const keyTimes = Array.from({ length: N + 1 }, (_, i) => (i / N).toFixed(4)).join(';');
      let body = `<rect x="0" y="0" width="16" height="16" fill="${this.colors.gap}"/>`;
      for (let i = 0; i < GRID * GRID; i++) {
        const { x, y } = this._cellPos(i);
        const p = RING.indexOf(i);
        if (p === -1) {
          body += `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="0.4" fill="${this.colors.base}"/>`;
        } else {
          const values = Array.from({ length: N + 1 }, (_, k) => (k === p ? this.colors.active : this.colors.base)).join(';');
          body += `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="0.4" fill="${this.colors.base}">` +
            `<animate attributeName="fill" calcMode="discrete" values="${values}" keyTimes="${keyTimes}" dur="${durMs}ms" repeatCount="indefinite"/></rect>`;
        }
      }
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">${body}</svg>`;
    }
    destroy() {
      this._clearTimer();
      const rt = runtime.get(this);
      if (rt.svg && rt.svg.parentNode) rt.svg.parentNode.removeChild(rt.svg);
    }
  }

  return LoadingIcon;
}));
