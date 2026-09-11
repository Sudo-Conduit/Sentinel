/**
 * @file StatusClock.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Menu-bar clock as a composable BaseClassX widget \u2014 same
 *   shape as LoadingIcon.js: schema-tracked config (format/showSeconds),
 *   runtime-only DOM/timer handles held outside the schema Proxy in a
 *   WeakMap, mount/start/stop imperative API. Meant to be dropped into
 *   any host surface (menu bar, IDE status bar, a future OS widget rail)
 *   the same way LoadingIcon.js is.
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) define(['./BaseClassX.js'], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory(require('./BaseClassX.js'));
  else root.StatusClock = factory(root.BaseClassX);
}(typeof self !== 'undefined' ? self : this, function(BaseClassX) {
  'use strict';
  if (!BaseClassX) throw new Error('StatusClock requires BaseClassX to be loaded first');

  const runtime = new WeakMap(); // instance -> { el, timer }

  class StatusClock extends BaseClassX {
    static version = '1.0.0';
    static domain = 'ui.statusClock';
    static _schema = {
      type: 'statusClock',
      properties: {
        format: { type: 'string', default: '12h' },      // '12h' | '24h'
        showSeconds: { type: 'boolean', default: false },
        showDate: { type: 'boolean', default: true },
        playState: { type: 'string', default: 'stopped' }
      }
    };

    constructor(options = {}) {
      super({ type: 'statusClock', ...options });
      runtime.set(this, { el: null, timer: null });
    }

    _format(now) {
      const opts = { hour: 'numeric', minute: '2-digit', hour12: this.format === '12h' };
      if (this.showSeconds) opts.second = '2-digit';
      let s = now.toLocaleTimeString(undefined, opts);
      if (this.showDate) s = now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + '  ' + s;
      return s;
    }

    _paint() {
      const rt = runtime.get(this);
      if (rt && rt.el) rt.el.textContent = this._format(new Date());
    }

    /** Mounts a <span> into `container` and returns it. */
    mount(container) {
      const rt = runtime.get(this);
      if (rt.el && rt.el.parentNode) rt.el.parentNode.removeChild(rt.el);
      const el = document.createElement('span');
      el.style.font = 'inherit';
      el.style.whiteSpace = 'nowrap';
      runtime.set(this, { ...rt, el });
      this._paint();
      if (container) container.appendChild(el);
      return el;
    }

    start() {
      this._clearTimer();
      this.playState = 'running';
      this._paint();
      const rt = runtime.get(this);
      rt.timer = setInterval(() => this._paint(), this.showSeconds ? 1000 : 15000);
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
    setFormat(format) { this.format = format; this._paint(); this.emit('format_changed', { format }); }
    destroy() {
      this._clearTimer();
      const rt = runtime.get(this);
      if (rt && rt.el && rt.el.parentNode) rt.el.parentNode.removeChild(rt.el);
    }
  }

  return StatusClock;
}));
