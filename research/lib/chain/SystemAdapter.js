/**
 * @file research/lib/chain/SystemAdapter.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Adapter half of the Geodesic Protocol (see GEODESIC_PROTOCOL.md).
 *              Wraps one System (a Hilbert or Hamiltonian instance) and owns
 *              exactly two things: serializing its state to the NDJSON wire
 *              format on a writable stream, and parsing NDJSON received on a
 *              readable stream back into messages. Nothing else.
 *
 *              Deliberately dumb, per spec: no dtype branching beyond what
 *              Tensor.toFlat() already produces, no compatibility checks, no
 *              orchestration of when a System evolves. emitState() is called
 *              by whoever drives the evolution loop, once per evolve() step
 *              — the adapter never reaches into the System to trigger one.
 *              A malformed incoming line is reported to the (optional) error
 *              stream and dropped; it never throws and never desyncs seq
 *              tracking for subsequent lines.
 * @principle "Assume no dependencies in classes unless authorized."
 * @example const adapter = new SystemAdapter().init(hilbertInstance, { systemId: 'sys-a' });
 * @example adapter.emitMeta(); adapter.emitState(); // after each evolve() step
 * @example adapter.onMessage((msg) => { if (msg.type === 'state') { ... } });
 */
(function (root, factory)
{
  if (typeof module === 'object' && module.exports)
  {
    module.exports = factory();
  }
  else if (typeof define === 'function' && define.amd)
  {
    define([], factory);
  }
  else
  {
    root.Chain = root.Chain || {};
    root.Chain.SystemAdapter = factory();
  }
}(typeof self !== 'undefined' ? self : this, function ()
{
  'use strict';

  const PROTOCOL_VERSION = 1;

  /** @returns {{write:function(string):void}|null} process.stdout if present in this environment, else null */
  function defaultWritable()
  {
    return (typeof process !== 'undefined' && process.stdout) ? process.stdout : null;
  }

  /** @returns {{on:function(string,function):void}|null} process.stdin if present in this environment, else null */
  function defaultReadable()
  {
    return (typeof process !== 'undefined' && process.stdin) ? process.stdin : null;
  }

  /** @returns {{write:function(string):void}|null} process.stderr if present in this environment, else null */
  function defaultErrable()
  {
    return (typeof process !== 'undefined' && process.stderr) ? process.stderr : null;
  }

  class SystemAdapter
  {
    static name = 'SystemAdapter';
    static author = 'Will Fobbs';
    static version = '1.0.0';
    static description = 'Adapter half of the Geodesic Protocol: normalizes a System\'s state to/from the NDJSON stdin/stdout/stderr wire format.';
    static docs = 'research/lib/chain/GEODESIC_PROTOCOL.md';
    static tests = 'research/lib/chain/tests/SystemAdapter.unit.js';
    static config_default = { protocolVersion: PROTOCOL_VERSION };
    static PROTOCOL_VERSION = PROTOCOL_VERSION;

    constructor()
    {
    }

    /**
     * @param {object} system a Hilbert/Hamiltonian instance — must expose .shape, .dtype, .toFlat()
     * @param {object} opts
     * @param {string} opts.systemId stable identifier, unchanged for the stream's lifetime
     * @param {string} [opts.kind] wire "kind"; defaults to system.constructor.name
     * @param {{write:function(string):void}} [opts.writable] defaults to process.stdout
     * @param {{on:function(string,function):void}} [opts.readable] defaults to process.stdin
     * @param {{write:function(string):void}} [opts.errable] defaults to process.stderr
     * @returns {SystemAdapter} this, for chaining
     */
    init(system, opts)
    {
      const options = opts || {};
      if (!system || typeof system.toFlat !== 'function')
      {
        throw new TypeError('SystemAdapter.init: system must expose .shape, .dtype, and .toFlat()');
      }
      if (!options.systemId)
      {
        throw new TypeError('SystemAdapter.init: systemId is required');
      }

      this.system = system;
      this.systemId = options.systemId;
      this.kind = options.kind || system.constructor.name;
      this.writable = options.writable !== undefined ? options.writable : defaultWritable();
      this.readable = options.readable !== undefined ? options.readable : defaultReadable();
      this.errable = options.errable !== undefined ? options.errable : defaultErrable();

      this._outSeq = 0;
      this._step = 0;
      this._lastState = null;
      this._inBuffer = '';
      this._messageHandlers = [];

      if (this.readable && typeof this.readable.on === 'function')
      {
        this.readable.on('data', (chunk) => { this._onChunk(String(chunk)); });
      }

      return this;
    }

    /** @returns {number} epoch milliseconds — isolated for testability */
    _now()
    {
      return Date.now();
    }

    /** @param {object} message envelope fields beyond {v,type,systemId,seq,ts}, merged in */
    _send(message)
    {
      const envelope = Object.assign(
        { v: PROTOCOL_VERSION, systemId: this.systemId, seq: this._outSeq, ts: this._now() },
        message
      );
      this._outSeq += 1;
      if (this.writable && typeof this.writable.write === 'function')
      {
        this.writable.write(JSON.stringify(envelope) + '\n');
      }
      return envelope;
    }

    /** Writes the one required handshake message. Should be called once, before the first emitState(). */
    emitMeta()
    {
      return this._send({ type: 'meta', shape: this.system.shape.slice(), dtype: this.system.dtype, kind: this.kind });
    }

    /** Writes one `state` line for the System's current values. Call once per evolve() step. */
    emitState()
    {
      const message = this._send({ type: 'state', step: this._step, data: this.system.toFlat().data });
      this._step += 1;
      return message;
    }

    /** Writes a graceful `control` eof — distinct from simply closing the stream. */
    emitEof()
    {
      return this._send({ type: 'control', action: 'eof' });
    }

    /** @param {function(object):void} fn called once per received message, in arrival order */
    onMessage(fn)
    {
      if (typeof fn !== 'function')
      {
        throw new TypeError('SystemAdapter.onMessage: fn must be a function');
      }
      this._messageHandlers.push(fn);
    }

    /** @returns {object|null} the most recently received `state` message, or null if none yet */
    lastState()
    {
      return this._lastState;
    }

    /** @param {string} text raw chunk from the readable stream; buffered and split on newlines */
    _onChunk(text)
    {
      this._inBuffer += text;
      let newlineIndex = this._inBuffer.indexOf('\n');
      while (newlineIndex !== -1)
      {
        const line = this._inBuffer.slice(0, newlineIndex);
        this._inBuffer = this._inBuffer.slice(newlineIndex + 1);
        this._handleLine(line);
        newlineIndex = this._inBuffer.indexOf('\n');
      }
    }

    /** @param {string} line one newline-delimited line; blank lines are silently ignored */
    _handleLine(line)
    {
      if (line.trim() === '')
      {
        return;
      }
      let message;
      try
      {
        message = JSON.parse(line);
      }
      catch (err)
      {
        this._reportError('malformed line (invalid JSON): ' + line);
        return;
      }
      if (!message || typeof message.v !== 'number' || typeof message.type !== 'string')
      {
        this._reportError('malformed line (missing v/type): ' + line);
        return;
      }
      if (message.v !== PROTOCOL_VERSION)
      {
        this._reportError('unsupported protocol version ' + message.v + ' (expected ' + PROTOCOL_VERSION + ')');
        return;
      }
      if (message.type === 'state')
      {
        this._lastState = message;
      }
      for (let i = 0; i < this._messageHandlers.length; i++)
      {
        this._messageHandlers[i](message);
      }
    }

    /** @param {string} text diagnostic text; written to the errable stream if one is configured, never to stdout */
    _reportError(text)
    {
      if (this.errable && typeof this.errable.write === 'function')
      {
        this.errable.write(JSON.stringify({ level: 'error', systemId: this.systemId, ts: this._now(), message: text }) + '\n');
      }
    }
  }

  return SystemAdapter;
}));
