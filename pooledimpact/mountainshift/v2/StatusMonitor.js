/**
 * @file StatusMonitor.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Menu-bar process/CPU status widget \u2014 second composable
 *   BaseClassX widget in the LoadingIcon.js template shape. Unlike
 *   LoadingIcon it takes a live Kernel instance (runtime handle, WeakMap,
 *   never schema state) and paints from Kernel.ps()/tick() output, so the
 *   menu bar's process dot is reading the SAME process table the Dock
 *   and window manager mutate via fork()/kill() \u2014 not a mock.
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) define(['./BaseClassX.js'], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory(require('./BaseClassX.js'));
  else root.StatusMonitor = factory(root.BaseClassX);
}(typeof self !== 'undefined' ? self : this, function(BaseClassX) {
  'use strict';
  if (!BaseClassX) throw new Error('StatusMonitor requires BaseClassX to be loaded first');

  const runtime = new WeakMap(); // instance -> { el, dot, label, timer, kernel }

  class StatusMonitor extends BaseClassX {
    static version = '1.0.0';
    static domain = 'ui.statusMonitor';
    static _schema = {
      type: 'statusMonitor',
      properties: {
        refreshMs: { type: 'number', default: 1200, min: 250, max: 5000 },
        okColor: { type: 'string', default: '#3fb950' },
        idleColor: { type: 'string', default: '#8b8f98' },
        playState: { type: 'string', default: 'stopped' }
      }
    };

    constructor(options = {}) {
      super({ type: 'statusMonitor', ...options });
      runtime.set(this, { el: null, dot: null, label: null, timer: null, kernel: null });
    }

    /** Mounts into `container` and binds to a live Kernel instance (has .ps()). */
    mount(container, kernel) {
      const rt = runtime.get(this);
      if (rt.el && rt.el.parentNode) rt.el.parentNode.removeChild(rt.el);
      const el = document.createElement('span');
      el.style.cssText = 'display:inline-flex;align-items:center;gap:5px;font:inherit;white-space:nowrap;';
      const dot = document.createElement('span');
      dot.style.cssText = 'width:7px;height:7px;border-radius:50%;background:' + this.idleColor + ';display:inline-block;';
      const label = document.createElement('span');
      el.appendChild(dot); el.appendChild(label);
      runtime.set(this, { ...rt, el, dot, label, kernel: kernel || null });
      this._paint();
      if (container) container.appendChild(el);
      return el;
    }

    _paint() {
      const rt = runtime.get(this);
      if (!rt || !rt.el) return;
      const procs = rt.kernel && typeof rt.kernel.ps === 'function' ? rt.kernel.ps() : [];
      const n = procs.length;
      rt.dot.style.background = n > 0 ? this.okColor : this.idleColor;
      rt.label.textContent = n === 1 ? '1 process' : n + ' processes';
    }

    start() {
      this._clearTimer();
      this.playState = 'running';
      this._paint();
      const rt = runtime.get(this);
      rt.timer = setInterval(() => this._paint(), this.refreshMs);
      this.emit('start', {});
    }
    stop() {
      this._clearTimer();
      this.playState = 'stopped';
      this.emit('stop', {});
    }
    _clearTimer() {
      const rt = runtime.get(this);
      if (rt && rt.timer) { clearInterval(rt.timer); rt.timer = null; }
    }
    /** Re-paint immediately \u2014 call after a fork()/kill() so the dot doesn't wait for the next tick. */
    refresh() { this._paint(); }
    destroy() {
      this._clearTimer();
      const rt = runtime.get(this);
      if (rt && rt.el && rt.el.parentNode) rt.el.parentNode.removeChild(rt.el);
    }
  }

  return StatusMonitor;
}));
