/**
 * CPU.js — UMD + IIFE mechanical x86-shaped CPU emulator: registers, segment/
 * control registers, MSRs, PIC, IDT, flat byte-array memory, fetch/decode/
 * execute loop, and a small real instruction set. Not a BaseClassX subclass
 * by design — this is a runtime engine a Kernel-layer BaseClassX instance
 * holds by reference (WeakMap), the same way LoadingIcon keeps DOM refs/
 * timers outside the schema Proxy. See Physical.js for the wrapper.
 *
 * Rewritten from an ES5 constructor + CPU.prototype.x = function(){} style
 * to a real ES6 `class` (v1.0.2): a Function.prototype.toString() on the
 * old constructor never captured the prototype methods added afterward,
 * so anything composing this file's code via reflection (as
 * SharedWorkerDecorator/CodeComposer does for BaseClassX) silently lost
 * every instruction handler. An ES6 class body includes its methods in
 * toString(), so this file is now reflectable the same way BaseClassX is.
 *
 * @author Will Fobbs
 * @version 1.0.2
 */
(function(root, factory) {
  'use strict';
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    if (typeof global !== 'undefined') global.CPU = module.exports;
  } else {
    var CPU = factory();
    root.CPU = CPU;
    if (typeof globalThis !== 'undefined') globalThis.CPU = CPU;
  }
}(typeof self !== 'undefined' ? self :
   typeof window !== 'undefined' ? window :
   typeof global !== 'undefined' ? global :
   this,
   function() {
  'use strict';

  class CPU {
    constructor(options) {
      options = options || {};
      this.EAX = 0x00000000; this.EBX = 0x00000000; this.ECX = 0x00000000; this.EDX = 0x00000000;
      this.ESI = 0x00000000; this.EDI = 0x00000000; this.EBP = 0x00000000;
      this.ESP = 0x00007C00; this.EIP = 0x0000FFF0; this.EFLAGS = 0x00000000;
      this.CS = 0x0000; this.DS = 0x0000; this.SS = 0x0000; this.ES = 0x0000; this.FS = 0x0000; this.GS = 0x0000;
      this.CR0 = 0x00000000; this.CR2 = 0x00000000; this.CR3 = 0x00000000; this.CR4 = 0x00000000;
      this.MSR = {}; this.MSR['0x1A0'] = 0x00000000; this.MSR['0x2FF'] = 0x00000000;

      const memSize = options.memorySize || 0x100000;
      this.memory = new Array(memSize);
      for (let i = 0; i < memSize; i++) this.memory[i] = 0x00;
      this.memorySize = memSize;

      this.MTRR = {}; this.MTRR_DEFAULT = 0x06;
      this.PIC = {
        master: { IMR: 0xFFFF, IRR: 0x0000, ISR: 0x0000, baseVector: 0x20, icw: { icw1: 0x00, icw2: 0x20, icw3: 0x04, icw4: 0x01 } },
        slave: { IMR: 0xFFFF, IRR: 0x0000, ISR: 0x0000, baseVector: 0x28, icw: { icw1: 0x00, icw2: 0x28, icw3: 0x02, icw4: 0x01 } }
      };

      this.IDT = new Array(256);
      for (let j = 0; j < 256; j++) this.IDT[j] = null;
      this.IDTR = { base: 0x00000000, limit: 0x07FF };

      this.interrupts = { enabled: false, pending: [], handlers: {} };
      this.IO = { ports: {}, keyboard: null, timer: null, disk: null, console: null };
      this.devices = {};
      this.substrate = { tokens: {}, capabilities: {}, processes: {}, stack: [], sp: 0x00000000, bp: 0x00000000, run: null };
      this.config = { realMode: true, protectedMode: false, longMode: false, paging: false, caching: false, interrupts: false, halted: false };

      this.instructions = {};
      this.registerInstructions();
      return this;
    }

    registerInstructions() {
      const self = this;
      this.instructions['MOV'] = function(dest, src) {
        if (dest.charAt(0) === 'E') {
          if (typeof src === 'string' && src.charAt(0) === 'E') self[dest] = self[src];
          else if (typeof src === 'string' && src.indexOf('0x') === 0) self[dest] = parseInt(src, 16);
          else self[dest] = src;
        } else if (dest.charAt(0) === '[' && dest.charAt(dest.length - 1) === ']') {
          const addr = self.getAddress(dest);
          if (typeof src === 'string' && src.charAt(0) === 'E') self.memoryWrite(addr, self[src]);
          else self.memoryWrite(addr, src);
        }
        self.EIP += 3;
      };
      this.instructions['ADD'] = function(dest, src) {
        let value = src;
        if (typeof src === 'string' && src.charAt(0) === 'E') value = self[src];
        else if (typeof src === 'string' && src.indexOf('0x') === 0) value = parseInt(src, 16);
        self[dest] += value; self.updateFlags(self[dest]); self.EIP += 3;
      };
      this.instructions['SUB'] = function(dest, src) {
        let value = src;
        if (typeof src === 'string' && src.charAt(0) === 'E') value = self[src];
        else if (typeof src === 'string' && src.indexOf('0x') === 0) value = parseInt(src, 16);
        self[dest] -= value; self.updateFlags(self[dest]); self.EIP += 3;
      };
      this.instructions['PUSH'] = function(src) {
        let value = src;
        if (typeof src === 'string' && src.charAt(0) === 'E') value = self[src];
        else if (typeof src === 'string' && src.indexOf('0x') === 0) value = parseInt(src, 16);
        self.ESP -= 4; self.memoryWrite(self.ESP, value); self.EIP += 2;
      };
      this.instructions['POP'] = function(dest) {
        const value = self.memoryRead(self.ESP);
        self[dest] = value; self.ESP += 4; self.EIP += 2;
      };
      this.instructions['JMP'] = function(addr) {
        if (typeof addr === 'string' && addr.indexOf('0x') === 0) self.EIP = parseInt(addr, 16);
        else if (typeof addr === 'string' && addr.charAt(0) === 'E') self.EIP = self[addr];
        else self.EIP = addr;
      };
      this.instructions['CALL'] = function(addr) {
        self.ESP -= 4; self.memoryWrite(self.ESP, self.EIP + 3);
        if (typeof addr === 'string' && addr.indexOf('0x') === 0) self.EIP = parseInt(addr, 16);
        else if (typeof addr === 'string' && addr.charAt(0) === 'E') self.EIP = self[addr];
        else self.EIP = addr;
      };
      this.instructions['RET'] = function() { self.EIP = self.memoryRead(self.ESP); self.ESP += 4; };
      this.instructions['CMP'] = function(dest, src) {
        let srcValue = src;
        if (typeof src === 'string' && src.charAt(0) === 'E') srcValue = self[src];
        else if (typeof src === 'string' && src.indexOf('0x') === 0) srcValue = parseInt(src, 16);
        const result = self[dest] - srcValue; self.updateFlags(result); self.EIP += 3;
      };
      this.instructions['JE'] = function(addr) {
        if (self.EFLAGS & 0x40) self.EIP = typeof addr === 'string' && addr.indexOf('0x') === 0 ? parseInt(addr, 16) : addr;
        else self.EIP += 3;
      };
      this.instructions['JNE'] = function(addr) {
        if (!(self.EFLAGS & 0x40)) self.EIP = typeof addr === 'string' && addr.indexOf('0x') === 0 ? parseInt(addr, 16) : addr;
        else self.EIP += 3;
      };
      this.instructions['INT'] = function(num) {
        const intNum = typeof num === 'string' && num.indexOf('0x') === 0 ? parseInt(num, 16) : parseInt(num, 10);
        self.triggerInterrupt(intNum); self.EIP += 2;
      };
      this.instructions['STI'] = function() { self.EFLAGS |= 0x200; self.interrupts.enabled = true; self.EIP += 1; };
      this.instructions['CLI'] = function() { self.EFLAGS &= ~0x200; self.interrupts.enabled = false; self.EIP += 1; };
      this.instructions['HLT'] = function() { self.config.halted = true; self.EIP += 1; };
      this.instructions['IN'] = function(dest, port) {
        const portNum = typeof port === 'string' && port.indexOf('0x') === 0 ? parseInt(port, 16) : parseInt(port, 10);
        self[dest] = self.IO.ports[portNum] || 0x00; self.EIP += 3;
      };
      this.instructions['OUT'] = function(port, src) {
        const portNum = typeof port === 'string' && port.indexOf('0x') === 0 ? parseInt(port, 16) : parseInt(port, 10);
        let value = src;
        if (typeof src === 'string' && src.charAt(0) === 'E') value = self[src];
        else if (typeof src === 'string' && src.indexOf('0x') === 0) value = parseInt(src, 16);
        self.IO.ports[portNum] = value; self.EIP += 3;
      };
      this.instructions['RDMSR'] = function(msr) {
        const msrNum = typeof msr === 'string' && msr.indexOf('0x') === 0 ? parseInt(msr, 16) : parseInt(msr, 10);
        const key = '0x' + msrNum.toString(16);
        const value = self.MSR[key] || 0x00000000;
        self.EAX = value & 0xFFFFFFFF; self.EDX = (value >> 32) & 0xFFFFFFFF; self.EIP += 3;
      };
      this.instructions['WRMSR'] = function(msr) {
        const msrNum = typeof msr === 'string' && msr.indexOf('0x') === 0 ? parseInt(msr, 16) : parseInt(msr, 10);
        const key = '0x' + msrNum.toString(16);
        self.MSR[key] = (self.EDX << 32) | self.EAX; self.EIP += 3;
      };
      this.instructions['INVD'] = function() { self.config.caching = false; self.EIP += 1; };
      this.instructions['WBINVD'] = function() { self.config.caching = false; self.EIP += 1; };
      this.instructions['LIDT'] = function(addr) {
        const base = self.memoryRead(addr); const limit = self.memoryRead(addr + 2);
        self.IDTR.base = base; self.IDTR.limit = limit; self.EIP += 3;
      };
      this.instructions['LGDT'] = function(addr) { self.EIP += 3; };
    }

    memoryRead(addr) {
      const b0 = this.memory[addr] || 0, b1 = this.memory[addr + 1] || 0, b2 = this.memory[addr + 2] || 0, b3 = this.memory[addr + 3] || 0;
      return (b0 << 0) | (b1 << 8) | (b2 << 16) | (b3 << 24);
    }

    memoryWrite(addr, value) {
      this.memory[addr] = value & 0xFF;
      this.memory[addr + 1] = (value >> 8) & 0xFF;
      this.memory[addr + 2] = (value >> 16) & 0xFF;
      this.memory[addr + 3] = (value >> 24) & 0xFF;
    }

    getAddress(expr) {
      const clean = expr.replace('[', '').replace(']', '');
      if (clean.charAt(0) === 'E') return this[clean];
      if (clean.indexOf('0x') === 0) return parseInt(clean, 16);
      return parseInt(clean, 10);
    }

    updateFlags(value) {
      this.EFLAGS = 0;
      if (value === 0) this.EFLAGS |= 0x40;
      if (value < 0) this.EFLAGS |= 0x80;
      if (value > 0x7FFFFFFF) this.EFLAGS |= 0x800;
      if (value & 0x1) this.EFLAGS |= 0x1;
    }

    triggerInterrupt(intNum) {
      this.ESP -= 4; this.memoryWrite(this.ESP, this.EFLAGS);
      this.ESP -= 4; this.memoryWrite(this.ESP, this.CS);
      this.ESP -= 4; this.memoryWrite(this.ESP, this.EIP);
      const handler = this.IDT[intNum];
      if (handler) { this.CS = handler.selector; this.EIP = handler.offset; }
      else { this.EIP = 0x0000F000; }
    }

    enableCache() {
      const misc = this.MSR['0x1A0'] || 0;
      this.MSR['0x1A0'] = misc | 0x800000;
      this.CR0 = (this.CR0 & ~0x60000000) | 0x00000000;
      this.MSR['0x2FF'] = 0x00000C00;
      this.config.caching = true;
    }

    disableCache() { this.config.caching = false; }
    enableProtectedMode() { this.CR0 |= 0x1; this.config.protectedMode = true; this.config.realMode = false; }
    enablePaging() { this.CR0 |= 0x80000000; this.config.paging = true; }
    fetch() { return this.memoryRead(this.EIP); }

    decode(opcode) {
      for (const name in this.instructions) {
        if (this.instructions.hasOwnProperty(name) && opcode === this.hashInstruction(name)) {
          return { name: name, fn: this.instructions[name] };
        }
      }
      return null;
    }

    hashInstruction(name) {
      let hash = 0;
      for (let i = 0; i < name.length; i++) { hash = ((hash << 5) - hash) + name.charCodeAt(i); hash |= 0; }
      return Math.abs(hash) & 0xFF;
    }

    execute(instruction, args) {
      if (this.instructions[instruction]) { this.instructions[instruction].apply(this, args); return true; }
      return false;
    }

    run(steps) {
      steps = steps || 0;
      let count = 0;
      while (!this.config.halted && (steps === 0 || count < steps)) {
        const opcode = this.fetch();
        const inst = this.decode(opcode);
        if (!inst) { this.EIP += 1; count++; continue; }
        const args = this.parseArgs(this.EIP + 1);
        this.execute(inst.name, args);
        count++;
      }
      return count;
    }

    parseArgs(eip) {
      return [this.memoryRead(eip), this.memoryRead(eip + 4)];
    }

    setSubstrate(substrate) { this.substrate = substrate; }
    getSubstrate() { return this.substrate; }

    dumpState() {
      return {
        registers: { EAX: this._toHex32(this.EAX), EBX: this._toHex32(this.EBX), ECX: this._toHex32(this.ECX), EDX: this._toHex32(this.EDX), ESI: this._toHex32(this.ESI), EDI: this._toHex32(this.EDI), EBP: this._toHex32(this.EBP), ESP: this._toHex32(this.ESP), EIP: this._toHex32(this.EIP), EFLAGS: this._toHex32(this.EFLAGS) },
        segments: { CS: this._toHex16(this.CS), DS: this._toHex16(this.DS), SS: this._toHex16(this.SS), ES: this._toHex16(this.ES), FS: this._toHex16(this.FS), GS: this._toHex16(this.GS) },
        control: { CR0: this._toHex32(this.CR0), CR2: this._toHex32(this.CR2), CR3: this._toHex32(this.CR3), CR4: this._toHex32(this.CR4) },
        config: this.config, halted: this.config.halted || false, memoryUsed: this.memory.length
      };
    }

    _toHex32(value) { let hex = value.toString(16); while (hex.length < 8) hex = '0' + hex; return hex; }
    _toHex16(value) { let hex = value.toString(16); while (hex.length < 4) hex = '0' + hex; return hex; }

    boot() {
      this.EAX = 0; this.EBX = 0; this.ECX = 0; this.EDX = 0; this.ESI = 0; this.EDI = 0; this.EBP = 0;
      this.ESP = 0x00007C00; this.EIP = 0x0000FFF0; this.EFLAGS = 0;
      this.CS = 0; this.DS = 0; this.SS = 0; this.ES = 0; this.FS = 0; this.GS = 0;
      this.CR0 = 0; this.CR2 = 0; this.CR3 = 0; this.CR4 = 0;
      this.config.realMode = true; this.config.protectedMode = false; this.config.longMode = false;
      this.config.paging = false; this.config.caching = false; this.config.interrupts = false; this.config.halted = false;
      return this.dumpState();
    }

    reset() { return this.boot(); }
  }

  CPU.version = '1.0.2';
  CPU.author = 'Will Fobbs';
  CPU.description = 'Mechanical CPU Emulator';

  return CPU;
}));
