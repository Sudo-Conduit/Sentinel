// ─── RegX.js — Complete JS → WASM Compiler (FIXED) ──────────
// Full IIFE with ExtendX integration and debug support
// Version: 2.2.0

(function(root, factory) {
  'use strict';
  
  if (typeof define === 'function' && define.amd) {
    define(['ExtendX', 'RulesEngine'], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./ExtendX'), require('./RulesEngine'));
  } else {
    root.RegX = factory(
      root.ExtendX || (typeof window !== 'undefined' && window.ExtendX),
      root.RulesEngine || (typeof window !== 'undefined' && window.RulesEngine)
    );
  }
}(typeof self !== 'undefined' ? self : this, function(ExtendX, RulesEngine) {

  'use strict';

  // ─── Guard: ExtendX Required ─────────────────────────────────

  if (!ExtendX && typeof window !== 'undefined' && window.ExtendX) {
    ExtendX = window.ExtendX;
  }

  if (!ExtendX) {
    throw new Error('RegX requires ExtendX to be loaded first.');
  }

  if (!RulesEngine && typeof window !== 'undefined' && window.RulesEngine) {
    RulesEngine = window.RulesEngine;
  }

  if (!RulesEngine) {
    throw new Error('RegX requires RulesEngine to be loaded first.');
  }

  // ─── Debug Flag ──────────────────────────────────────────────
  
  var DEBUG = false;
  var debugLog = [];

  function enableDebug() { DEBUG = true; }
  function disableDebug() { DEBUG = false; }
  function clearDebugLog() { debugLog = []; }
  function getDebugLog() { return debugLog.join('\n'); }

  function logDebug(msg, data) {
    if (!DEBUG) return;
    var entry = msg;
    if (data !== undefined) {
      if (typeof data === 'object') {
        entry += '\n' + JSON.stringify(data, null, 2);
      } else {
        entry += ': ' + data;
      }
    }
    debugLog.push(entry);
    console.log('[DEBUG]', entry);
  }

  function hexDump(bytes, label) {
    if (!DEBUG) return '';
    var result = [];
    if (label) result.push(label + ':');
    var hex = '';
    var ascii = '';
    for (var i = 0; i < bytes.length; i++) {
      var b = bytes[i];
      hex += ('0' + b.toString(16)).slice(-2) + ' ';
      ascii += (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.';
      if ((i + 1) % 16 === 0 || i === bytes.length - 1) {
        var padding = '';
        var remaining = 16 - ((i + 1) % 16);
        if (remaining !== 16) {
          for (var j = 0; j < remaining; j++) {
            padding += '   ';
          }
        }
        result.push('  ' + hex + padding + '  ' + ascii);
        hex = '';
        ascii = '';
      }
    }
    var output = result.join('\n');
    logDebug(label || 'Hex Dump', '\n' + output);
    return output;
  }

  // ─── Host Imports Table ─────────────────────────────────────
  //
  // A call statement (console.log(this.x);) has no WASM encoding without a
  // real Import Section -- WASM has no object model, so the only way
  // compiled code reaches the host at all is a declared (module,field)
  // import bound to a real JS function at instantiate(). console.log is
  // proven end-to-end here; more rows slot in the same way once a
  // host-side implementation exists for the argument types involved.
  // params: WASM types for the arguments the USER actually writes
  // (excludes an implicit leading $this, added automatically when
  // needsThis is set). resultType: null for a void import (console.log),
  // or the real WASM type the import returns (setTimeout/setInterval
  // hand back a real timer id the compiled code can store and later
  // pass to clearTimeout/clearInterval).
  var KNOWN_IMPORTS = {
    'console.log': { module: 'env', field: 'log', params: ['i64'], resultType: null },
    // setTimeout/setInterval(closureProperty, delayMs) -- the closure
    // property's own bare read already IS its real table index (i64,
    // see the HANDLE_TYPES normalization), so no special extraction is
    // needed for that argument; $this is threaded through automatically
    // so the host callback knows which instance to invoke the closure
    // against. Real timers (real setTimeout/setInterval on the host
    // side, see RegXCore.instantiate), not a fake no-op.
    'setTimeout': { module: 'env', field: 'setTimeout', params: ['i64', 'i64'], resultType: 'i64', needsThis: true },
    'setInterval': { module: 'env', field: 'setInterval', params: ['i64', 'i64'], resultType: 'i64', needsThis: true },
    'clearTimeout': { module: 'env', field: 'clearTimeout', params: ['i64'], resultType: null },
    'clearInterval': { module: 'env', field: 'clearInterval', params: ['i64'], resultType: null }
  };

  // ─── Math Intrinsics Table ────────────────────────────────────
  //
  // Unlike KNOWN_IMPORTS, these need no Import Section and no host
  // function at all — Math.floor/ceil/abs/sqrt/trunc/max/min map
  // directly onto real WASM f64 opcodes that already exist in every
  // engine. Real math, not a call: no crossing the JS boundary, no
  // function-index bookkeeping, just picking the right instruction.
  // Every one of these is only defined for floating-point in WASM
  // (there's no i32/i64.floor etc.), so arguments always convert to
  // f64 first and the result is always f64.
  var KNOWN_INTRINSICS = {
    'Math.floor': { arity: 1, opcode: 0x9C }, // f64.floor
    'Math.ceil':  { arity: 1, opcode: 0x9B }, // f64.ceil
    'Math.trunc': { arity: 1, opcode: 0x9D }, // f64.trunc
    'Math.abs':   { arity: 1, opcode: 0x99 }, // f64.abs
    'Math.sqrt':  { arity: 1, opcode: 0x9F }, // f64.sqrt
    'Math.max':   { arity: 2, opcode: 0xA5 }, // f64.max
    'Math.min':   { arity: 2, opcode: 0xA4 }  // f64.min
  };

  // ─── Array Heap ─────────────────────────────────────────────
  //
  // WASM memory is byte-addressed and starts at page 0. Existing
  // per-object property storage already lives in page 0 (each instance's
  // $this pointer is always 0 in every observed test, so property slots
  // never approach the 64KB page boundary). Page 1 (byte offset 65536)
  // is reserved untouched as the array heap, addressed by a simple bump
  // allocator (global 0) that only ever grows.
  var HEAP_START = 65536;

  // Every function body reserves this many extra i32 locals, right
  // after the array/object/string-construction scratch local, for
  // string concatenation/comparison's own runtime byte-copy/byte-
  // compare loops (they need a few temporaries -- source/dest pointers,
  // a length, a running index -- that have to survive across loop
  // iterations, unlike ordinary expression compilation which only ever
  // needs the WASM value stack). Declared unconditionally, same
  // reasoning as the single scratch local: harmless to declare even
  // when a given body never uses string operators.
  var STR_SCRATCH_COUNT = 7;

  // Array/object/string/function "types" are all real WASM i64 under
  // the hood (a heap pointer or table index, see compileAtomToWasm's
  // own bare-read comment) -- normalized wherever downstream code only
  // knows real WASM value types (widening, the type section's own
  // result byte, numeric conversion), without every call site needing
  // its own copy of this list. Module-level rather than `this.
  // HANDLE_TYPES`: ExtendX's mixin proxy only reliably forwards method
  // dispatch through `this`, not plain data properties.
  var HANDLE_TYPES = { 'array': 1, 'object': 1, 'string': 1, 'function': 1 };

  // Splits a call's raw argument text on top-level commas only — a comma
  // inside a nested call's own parens (Math.max(a, Math.min(b, c))) must
  // not be treated as an argument separator for the OUTER call.
  function splitTopLevelArgs(text) {
    var args = [];
    var depth = 0, start = 0;
    for (var i = 0; i < text.length; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')') depth--;
      else if (text[i] === ',' && depth === 0) {
        args.push(text.slice(start, i).trim());
        start = i + 1;
      }
    }
    var last = text.slice(start).trim();
    if (last) args.push(last);
    return args;
  }

  // Recursively collects every KNOWN_IMPORTS callee reachable in a
  // statement tree, including inside if/while bodies -- a call several
  // levels of control flow deep still needs the same Import Section
  // entry. Scans both the legacy structural 'call' node (a bare
  // console.log(x); statement) AND any expression-text field a
  // statement can carry (value/cond) -- an import used inside an
  // assignment or return (this.id = setTimeout(...);) has no dedicated
  // node type of its own, just text compileExpressionToWasm resolves
  // later, so it has to be found the same way here.
  var KNOWN_IMPORT_NAMES = Object.keys(KNOWN_IMPORTS);
  function scanTextForImports(text, seen, out) {
    if (!text) return;
    KNOWN_IMPORT_NAMES.forEach(function(name) {
      if (seen[name]) return;
      var re = new RegExp('(?:^|[^\\w.])' + name.replace(/\./g, '\\.') + '\\(');
      if (re.test(text)) { seen[name] = true; out.push(name); }
    });
  }
  function collectCallees(stmts, seen, out) {
    (stmts || []).forEach(function(s) {
      if (s.type === 'call' && KNOWN_IMPORTS[s.callee] && !seen[s.callee]) {
        seen[s.callee] = true;
        out.push(s.callee);
      }
      if (typeof s.value === 'string') scanTextForImports(s.value, seen, out);
      if (typeof s.cond === 'string') scanTextForImports(s.cond, seen, out);
      if (s.type === 'if') {
        collectCallees(s.then, seen, out);
        if (s.else) collectCallees(s.else, seen, out);
      } else if (s.type === 'while') {
        collectCallees(s.body, seen, out);
      }
    });
  }

  // ─── Base RegX Class ─────────────────────────────────────────
  
  var RegXCore = function() {
    this._source = '';
    this._ast = null;
    this._wasmBinary = null;
    this._instance = null;
    this._exports = null;
    this._debug = false;
  };

  RegXCore.prototype = {
    constructor: RegXCore,

    enableDebug: function() {
      this._debug = true;
      enableDebug();
      return this;
    },

    disableDebug: function() {
      this._debug = false;
      return this;
    },

    getLineNumber: function(source, index) {
      if (!source) return 0;
      var lines = source.split('\n');
      var charCount = 0;
      for (var i = 0; i < lines.length; i++) {
        charCount += lines[i].length + 1;
        if (charCount > index) return i + 1;
      }
      return lines.length;
    },

    getColumn: function(source, index) {
      if (!source) return 0;
      var lines = source.split('\n');
      var charCount = 0;
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (charCount + line.length >= index) {
          return index - charCount;
        }
        charCount += line.length + 1;
      }
      return 0;
    },

    // The name of the one class this compiler actually compiles. RegX
    // generates ONE constructor + ONE shared export namespace per module
    // -- there's no per-class module boundary in the generated WASM at
    // all, so a source with more than one class can't honestly compile
    // both; buildWasmBinary rejects that case loudly instead of silently
    // merging their methods/properties into one collided mess. Property/
    // method maps still need to know which class is "the one being
    // compiled" even before that check runs (e.g. buildPropertyMap is
    // called directly, without going through buildWasmBinary at all), so
    // this lives on the shared base rather than either generator mixin.
    primaryClassName: function(ast) {
      var blocks = ast.blocks || [];
      for (var i = 0; i < blocks.length; i++) {
        if (blocks[i].type === 'class') return blocks[i].name;
      }
      return null;
    },

    collectMatches: function(regex, source) {
      var matches = [];
      var match;
      regex.lastIndex = 0;
      while ((match = regex.exec(source)) !== null) {
        matches.push({
          index: match.index,
          match: match[0],
          groups: match.slice(1),
          line: this.getLineNumber(source, match.index),
          column: this.getColumn(source, match.index)
        });
        if (match[0].length === 0) regex.lastIndex++;
      }
      return matches;
    },

    parse: function(source) {
      throw new Error('parse() must be implemented by a language mixin');
    },
    
    generateWAT: function() {
      throw new Error('generateWAT() must be implemented by a generator mixin');
    },
    
    generateWasm: function() {
      throw new Error('generateWasm() must be implemented by a WASM generator');
    },
    
    instantiate: function(imports) {
      if (!this._wasmBinary) {
        this.generateWasm();
      }
      var self = this;
      // Real timers: setTimeout/setInterval hand back a real id (the
      // SAME convention real JS uses) that clearTimeout/clearInterval
      // can later cancel. The callback itself is a real closure -- its
      // table index crosses the import boundary as a plain i64, and the
      // host looks it up in the exported __closureTable LAZILY, at fire
      // time (self._instance doesn't exist yet when `merged` here is
      // built, only once WebAssembly.instantiate below resolves).
      // v1 scope: the callback closure must take no arguments beyond
      // the implicit $this -- setTimeout/setInterval never pass any.
      var timerHandles = {};
      var nextTimerId = 1;
      function invokeClosure(thisPtr, tableIdx) {
        var table = self._instance.exports.__closureTable;
        var fn = table.get(Number(tableIdx));
        fn(thisPtr);
      }
      var merged = {
        env: {
          log: function (v) { console.log('[wasm]', v); },
          setTimeout: function (thisPtr, tableIdx, delayMs) {
            var id = nextTimerId++;
            timerHandles[id] = setTimeout(function () { invokeClosure(thisPtr, tableIdx); }, Number(delayMs));
            return BigInt(id);
          },
          setInterval: function (thisPtr, tableIdx, delayMs) {
            var id = nextTimerId++;
            timerHandles[id] = setInterval(function () { invokeClosure(thisPtr, tableIdx); }, Number(delayMs));
            return BigInt(id);
          },
          clearTimeout: function (id) {
            var handle = timerHandles[Number(id)];
            if (handle !== undefined) { clearTimeout(handle); delete timerHandles[Number(id)]; }
          },
          clearInterval: function (id) {
            var handle = timerHandles[Number(id)];
            if (handle !== undefined) { clearInterval(handle); delete timerHandles[Number(id)]; }
          }
        }
      };
      if (imports) {
        for (var mod in imports) {
          if (!Object.prototype.hasOwnProperty.call(imports, mod)) continue;
          merged[mod] = merged[mod] || {};
          for (var field in imports[mod]) {
            if (Object.prototype.hasOwnProperty.call(imports[mod], field)) merged[mod][field] = imports[mod][field];
          }
        }
      }
      return WebAssembly.instantiate(this._wasmBinary, merged)
        .then(function(result) {
          self._instance = result.instance;
          self._exports = result.instance.exports;
          return result.instance;
        })
        .catch(function(err) {
          if (self._debug || DEBUG) {
            console.error('❌ Instantiation failed!');
            console.error('Error:', err.message);
            console.error('WASM size:', self._wasmBinary.length, 'bytes');
            hexDump(self._wasmBinary, 'WASM Binary');
          }
          throw err;
        });
    },
    
    compileAndRun: function(source, imports) {
      this.parse(source);
      this.generateWasm();
      return this.instantiate(imports);
    }
  };

  // ─── JavaScript Parsing Mixin ──────────────────────────────
  
  var JavaScriptMixin = {
    mixinId: 'javascript-parser',
    overrides: true,
    version: '2.0.0',
    
    parse: function(source) {
      this._source = source;
      logDebug('Parsing source', source.length + ' bytes');
      
      var ast = {
        type: 'Program',
        blocks: [],
        methods: [],
        properties: [],
        staticProperties: [],
        statements: [],
        expressions: [],
        calls: [],
        comments: [],
        literals: [],
        lines: [],
        raw: source
      };

      var blockRegex = /(class|function|const|let|var)\s+(\w+)\s*(?:extends\s+(\w+)\s*)?([\{\(])/g;
      var blockMatches = this.collectMatches(blockRegex, source);

      for (var i = 0; i < blockMatches.length; i++) {
        var match = blockMatches[i];
        var type = match.groups[0];
        var name = match.groups[1];
        var extendsName = match.groups[2] || null;
        var block = this.extractBlock(source, match.index);
        ast.blocks.push({
          type: type,
          name: name,
          extendsName: extendsName,
          body: block.content,
          start: match.index,
          end: block.end,
          line: block.line,
          column: block.column
        });
        logDebug('Found block', type + ' ' + name + (extendsName ? ' extends ' + extendsName : ''));
      }

      // #? -- a private method (`#helper() {}`) is parsed by the exact
      // same regex as a plain one; WASM has no runtime privacy of its
      // own to enforce (see validatePrivateRefs), so the only thing that
      // differs downstream is the compile-time declared-in-class check.
      var methodRegex = /(\*)?\s*(#?\w+)\s*\(([^)]*)\)\s*\{/g;
      var accessorRegex = /\b(get|set)\s+(\w+)\s*\(([^)]*)\)\s*\{/g;
      var CONTROL_FLOW_KEYWORDS = { 'if': true, 'else': true, 'while': true, 'for': true, 'switch': true, 'catch': true, 'do': true, 'function': true };

      for (var b = 0; b < ast.blocks.length; b++) {
        var block = ast.blocks[b];
        if (block.type === 'class' || block.type === 'function') {
          var methodSpans = [];

          // "get NAME() {" / "set NAME(v) {" are the exact same shape as a
          // plain method to methodRegex below — without matching them first,
          // a getter and setter of the same property would both be parsed
          // as ONE method literally named "NAME", colliding, with no
          // accessor semantics at all. Matched on their own regex, tagged
          // with kind+prop, and exported under a distinct name (get_NAME /
          // set_NAME) so both compile as independent, callable functions.
          var accessorMatches = this.collectMatches(accessorRegex, block.body);
          for (var am = 0; am < accessorMatches.length; am++) {
            var amatch = accessorMatches[am];
            var kind = amatch.groups[0];
            var propName = amatch.groups[1];
            var aparams = amatch.groups[2].split(',').map(function(p) { return p.trim(); }).filter(function(p) { return p; });
            var accBlock = this.extractBlock(block.body, amatch.index);
            methodSpans.push({ start: amatch.index, end: accBlock.end });
            ast.methods.push({
              name: kind + '_' + propName,
              accessorKind: kind,
              accessorProp: propName,
              params: aparams,
              body: accBlock.content,
              start: amatch.index,
              end: accBlock.end,
              line: block.line + this.getLineNumber(block.body.substring(0, amatch.index)) - 1,
              column: this.getColumn(block.body, amatch.index),
              className: block.name
            });
            logDebug('Found accessor', kind + ' ' + propName);
          }

          var methodMatches = this.collectMatches(methodRegex, block.body);
          for (var m = 0; m < methodMatches.length; m++) {
            var match = methodMatches[m];
            var isGenerator = !!match.groups[0];
            var name = match.groups[1];
            // A control-flow keyword (if/while/switch/catch/...) followed by
            // "(...) {" has the exact same shape as a method definition to
            // this regex — without this guard, `if (cond) {` inside a real
            // method body gets parsed as a second, bogus top-level method
            // named "if", corrupting exports and silently dropping the real
            // method's control-flow statements (they get scanned out of the
            // wrong extracted block).
            if (Object.prototype.hasOwnProperty.call(CONTROL_FLOW_KEYWORDS, name)) continue;
            // Already captured above as an accessor — methodRegex matches the
            // SAME "NAME(...) {" text a second time, at an index inside the
            // accessor's own span. Skip it rather than register a second,
            // plain-method copy alongside the tagged accessor.
            var insideAccessor = methodSpans.some(function(sp) { return match.index >= sp.start && match.index < sp.end; });
            if (insideAccessor) continue;
            var params = match.groups[2].split(',').map(function(p) { return p.trim(); }).filter(function(p) { return p; });
            var methodBlock = this.extractBlock(block.body, match.index);
            methodSpans.push({ start: match.index, end: methodBlock.end });
            ast.methods.push({
              name: name,
              isGenerator: isGenerator,
              params: params,
              body: methodBlock.content,
              start: match.index,
              end: methodBlock.end,
              line: block.line + this.getLineNumber(block.body.substring(0, match.index)) - 1,
              column: this.getColumn(block.body, match.index),
              className: block.name
            });
            logDebug('Found method', name + '(' + params.join(', ') + ')');
          }

          // Static and private field declarations ("static NAME = VALUE;",
          // "#NAME = VALUE;") sitting directly in the class body. Scanned
          // line-by-line, skipping any line whose start index falls inside a
          // method/accessor span, so the same token appearing deep inside a
          // method body is never mistaken for a field declaration.
          var fieldLines = block.body.split('\n');
          var lineStart = 0;
          for (var fl = 0; fl < fieldLines.length; fl++) {
            var lineText = fieldLines[fl];
            var lineTrim = lineText.trim();
            var thisLineStart = lineStart;
            var insideMethod = methodSpans.some(function(sp) { return thisLineStart >= sp.start && thisLineStart < sp.end; });
            if (!insideMethod && lineTrim) {
              var staticMatch = lineTrim.match(/^static\s+(\w+)\s*=\s*([^,;]+);?$/);
              var privateMatch = !staticMatch && lineTrim.match(/^#(\w+)\s*=\s*([^,;]+);?$/);
              // `#name;` with NO initializer -- a real, common private-field
              // shape (declared bare, assigned later in the constructor).
              // Matched separately from privateMatch above (which requires
              // `=`) rather than folding into one regex, so a bare
              // declaration's ast.properties entry can carry value:
              // undefined and be told apart from "initializer is the empty
              // string" by buildClassUnit's field-init splice below.
              var bareMatch = !staticMatch && !privateMatch && lineTrim.match(/^#(\w+)\s*;?$/);
              if (staticMatch) {
                ast.staticProperties.push({ key: staticMatch[1], value: staticMatch[2].trim(), className: block.name });
                logDebug('Found static field', staticMatch[1] + ' = ' + staticMatch[2].trim());
              } else if (privateMatch) {
                ast.properties.push({ key: '#' + privateMatch[1], value: privateMatch[2].trim(), prefix: 'field', isField: true, line: block.line + fl, column: 0, raw: lineTrim, className: block.name });
                logDebug('Found private field', '#' + privateMatch[1] + ' = ' + privateMatch[2].trim());
              } else if (bareMatch) {
                ast.properties.push({ key: '#' + bareMatch[1], value: undefined, prefix: 'field', isField: true, line: block.line + fl, column: 0, raw: lineTrim, className: block.name });
                logDebug('Found private field (no initializer)', '#' + bareMatch[1]);
              }
            }
            lineStart += lineText.length + 1;
          }
        }
      }

      var propRegex = /(this\.|self\.|@)(#?\w+)\s*=\s*([^,;\n]+)([,\n;]?)/g;
      var propMatches = this.collectMatches(propRegex, source);
      for (var p = 0; p < propMatches.length; p++) {
        var match = propMatches[p];
        // propRegex scans the WHOLE source once, not per class -- without
        // tagging which class block a match actually falls inside,
        // buildWasmPropertyMap has no way to tell two different classes'
        // same-named-or-not properties apart, and previously merged them
        // into one shared, colliding offset table.
        var owningClass = null;
        for (var ob = 0; ob < ast.blocks.length; ob++) {
          var obk = ast.blocks[ob];
          if (obk.type === 'class' && match.index >= obk.start && match.index < obk.end) {
            owningClass = obk.name;
            break;
          }
        }
        ast.properties.push({
          key: match.groups[1],
          value: match.groups[2].trim(),
          prefix: match.groups[0],
          line: match.line,
          column: match.column,
          raw: match.match,
          className: owningClass
        });
        logDebug('Found property', match.groups[1] + ' = ' + match.groups[2].trim());
      }

      var lines = source.split('\n');
      for (var l = 0; l < lines.length; l++) {
        var rawLine = lines[l];
        var trimmed = rawLine.trim();
        var indent = rawLine.length - rawLine.trimStart().length;
        ast.lines.push({
          number: l + 1,
          text: trimmed,
          indent: indent,
          raw: rawLine,
          column: indent,
          type: trimmed === '' ? 'empty' :
                trimmed.startsWith('//') ? 'comment' :
                trimmed.startsWith('/*') ? 'comment' :
                trimmed.endsWith('{') ? 'blockStart' :
                trimmed.endsWith('}') ? 'blockEnd' :
                'code'
        });
      }

      logDebug('AST built', 'blocks: ' + ast.blocks.length + ', methods: ' + ast.methods.length + ', properties: ' + ast.properties.length);
      this._ast = ast;
      return ast;
    },

    extractBlock: function(source, start) {
      var depth = 0;
      var i = start;
      var inString = false;
      var stringChar = '';
      var inComment = false;

      while (i < source.length && source[i] !== '{') i++;
      if (i >= source.length) {
        return { 
          content: '', 
          end: i, 
          line: this.getLineNumber(source, i), 
          column: this.getColumn(source, i) 
        };
      }

      depth = 1;
      i++;

      while (i < source.length && depth > 0) {
        var char = source[i];

        if (!inString && !inComment && char === '/' && source[i + 1] === '*') {
          inComment = true;
          i += 2;
          continue;
        }
        if (inComment && char === '*' && source[i + 1] === '/') {
          inComment = false;
          i += 2;
          continue;
        }
        if (inComment) { i++; continue; }

        if (!inString && (char === '"' || char === "'" || char === '`')) {
          inString = true;
          stringChar = char;
          i++;
          continue;
        }
        if (inString && char === stringChar && source[i - 1] !== '\\') {
          inString = false;
          i++;
          continue;
        }
        if (inString) { i++; continue; }

        if (char === '{') depth++;
        if (char === '}') depth--;
        i++;
      }

      return {
        content: source.substring(start, i),
        end: i,
        line: this.getLineNumber(source, start),
        column: this.getColumn(source, start)
      };
    }
  };

  // ─── WAT Generator Mixin ────────────────────────────────────
  
  var WATGeneratorMixin = {
    mixinId: 'wat-generator',
    overrides: true,
    version: '2.1.0',

    generateWAT: function() {
      if (!this._ast) {
        throw new Error('No AST to generate from');
      }
      var wat = this.generateWATFromAST(this._ast);
      logDebug('WAT generated', wat.length + ' characters');
      if (this._debug || DEBUG) {
        console.log('📄 Generated WAT:');
        console.log(wat);
      }
      return wat;
    },

    generateWATFromAST: function(ast) {
      var wat = '(module\n';

      var methods = ast.methods || [];
      var usedKeys = [];
      var seenKeys = {};
      for (var mi0 = 0; mi0 < methods.length; mi0++) {
        collectCallees(this.parseStatements(this.stripBraceInterior(methods[mi0].body)), seenKeys, usedKeys);
      }
      for (var u = 0; u < usedKeys.length; u++) {
        var known = KNOWN_IMPORTS[usedKeys[u]];
        wat += '  (import "' + known.module + '" "' + known.field + '" (func $imp_' + known.field + ' (param i64)))\n';
      }
      if (usedKeys.length) wat += '\n';

      wat += '  (memory 1)\n\n';
      wat += this.generateHelpers();
      
      var propertyMap = this.buildPropertyMap(ast);
      var methods = ast.methods || [];
      var exports = [];
      var constructor = null;
      
      for (var i = 0; i < methods.length; i++) {
        if (methods[i].name === 'constructor') {
          constructor = methods[i];
        } else {
          exports.push(methods[i]);
        }
      }
      
      if (constructor) {
        wat += this.generateConstructor(constructor, propertyMap);
      }
      
      wat += this.generateMethods(exports, propertyMap);
      wat += this.generateExports(exports);
      wat += ')\n';
      return wat;
    },

    generateHelpers: function() {
      return '  ;; ─── Memory Helpers ──────────────────────────────────────\n' +
      '  (func $store (param $ptr i32) (param $offset i32) (param $value i32)\n' +
      '    (i32.store (i32.add (get_local $ptr) (get_local $offset)) (get_local $value))\n' +
      '  )\n\n' +
      '  (func $load (param $ptr i32) (param $offset i32) (result i32)\n' +
      '    (i32.load (i32.add (get_local $ptr) (get_local $offset)))\n' +
      '  )\n\n';
    },

    buildPropertyMap: function(ast) {
      var map = {};
      var primaryClass = this.primaryClassName(ast);
      var properties = ast.properties || [];
      var nextIndex = 0;
      for (var i = 0; i < properties.length; i++) {
        // Only this class's own properties -- a property tagged with a
        // DIFFERENT class name belongs to some other class entirely and
        // must never share this one's offset table.
        if (properties[i].className && properties[i].className !== primaryClass) continue;
        var key = properties[i].key;
        if (Object.prototype.hasOwnProperty.call(map, key)) continue;
        map[key] = nextIndex * 4;
        nextIndex++;
      }
      return map;
    },

    generateConstructor: function(constructor, propertyMap) {
      var wat = '  ;; ─── Constructor ──────────────────────────────────────\n';
      var params = constructor.params || [];
      
      wat += '  (func $init (param $this i32)';
      // Add constructor parameters (skip 'this' which is already a param)
      for (var i = 0; i < params.length; i++) {
        if (params[i] !== 'this' && params[i] !== 'self') {
          wat += ' (param $' + params[i] + ' i32)';
        }
      }
      wat += '\n';
      
      var statements = this.parseStatements(constructor.body);
      for (var s = 0; s < statements.length; s++) {
        if (statements[s].type === 'assign') {
          var compiled = this.compileStatementToWAT(statements[s], propertyMap);
          if (compiled) {
            wat += '    ' + compiled + '\n';
          }
        }
      }
      wat += '  )\n\n';
      return wat;
    },

    generateMethods: function(exports, propertyMap) {
      var wat = '  ;; ─── Methods ─────────────────────────────────────────\n';
      for (var i = 0; i < exports.length; i++) {
        var method = exports[i];
        wat += this.generateMethodToWAT(method, propertyMap);
      }
      return wat;
    },

    generateMethodToWAT: function(method, propertyMap) {
      var name = method.name;
      var params = method.params || [];
      
      var wat = '  (func $' + name + ' (param $this i32)';
      for (var i = 0; i < params.length; i++) {
        if (params[i] !== 'this' && params[i] !== 'self') {
          wat += ' (param $' + params[i] + ' i32)';
        }
      }
      wat += ' (result i32)\n';
      
      var statements = this.parseStatements(method.body);
      for (var s = 0; s < statements.length; s++) {
        var compiled = this.compileStatementToWAT(statements[s], propertyMap);
        if (compiled) {
          wat += '    ' + compiled + '\n';
        }
      }
      wat += '  )\n\n';
      return wat;
    },

    // ExtendX chain-dispatches `parseStatements` to whichever mixin declared
    // it FIRST (this one) and stops unless it forwards — so this can't stay
    // its own old line-only scanner once WasmBinaryGeneratorMixin grew a
    // real multi-line one, or every `this.parseStatements(...)` call in the
    // actually-executed compile path (buildFunctionBody/buildConstructorBody)
    // would silently run the stale version instead. Delegate to the one
    // real implementation so there is a single source of truth.
    parseStatements: function(body) {
      return this.parseStatementList(body);
    },

    compileStatementToWAT: function(stmt, propertyMap) {
      switch (stmt.type) {
        case 'return': {
          var value = this.compileExpressionToWAT(stmt.value, propertyMap);
          return '(return ' + value + ')';
        }
        case 'assign': {
          var offset = propertyMap[stmt.key] || 0;
          var value = this.compileExpressionToWAT(stmt.value, propertyMap);
          return '(call $store (get_local $this) (i32.const ' + offset + ') ' + value + ')';
        }
        case 'call': {
          var known = KNOWN_IMPORTS[stmt.callee];
          if (!known) return null;
          var argsWat = [];
          for (var a = 0; a < stmt.args.length; a++) argsWat.push(this.compileExpressionToWAT(stmt.args[a], propertyMap));
          return '(call $imp_' + known.field + ' ' + argsWat.join(' ') + ')';
        }
        default:
          return null;
      }
    },

    compileExpressionToWAT: function(expr, propertyMap) {
      expr = expr.trim();
      
      var thisMatch = expr.match(/^this\.(#?\w+)$/);
      if (thisMatch) {
        var offset = propertyMap[thisMatch[1]] || 0;
        return '(call $load (get_local $this) (i32.const ' + offset + '))';
      }
      
      if (expr.includes('+')) {
        var parts = expr.split('+');
        var compiled = [];
        for (var i = 0; i < parts.length; i++) {
          compiled.push(this.compileExpressionToWAT(parts[i].trim(), propertyMap));
        }
        var result = compiled[0];
        for (var i = 1; i < compiled.length; i++) {
          result = '(i32.add ' + result + ' ' + compiled[i] + ')';
        }
        return result;
      }
      
      if (expr.includes('*')) {
        var parts = expr.split('*');
        var compiled = [];
        for (var i = 0; i < parts.length; i++) {
          compiled.push(this.compileExpressionToWAT(parts[i].trim(), propertyMap));
        }
        var result = compiled[0];
        for (var i = 1; i < compiled.length; i++) {
          result = '(i32.mul ' + result + ' ' + compiled[i] + ')';
        }
        return result;
      }
      
      if (/^\d+$/.test(expr)) {
        return '(i32.const ' + parseInt(expr, 10) + ')';
      }
      
      if (/^[a-zA-Z_]\w*$/.test(expr)) {
        return '(get_local $' + expr + ')';
      }
      
      return '(i32.const 0)';
    },

    generateExports: function(exports) {
      var wat = '  ;; ─── Exports ─────────────────────────────────────────\n';
      for (var i = 0; i < exports.length; i++) {
        wat += '  (export "' + exports[i].name + '" (func $' + exports[i].name + '))\n';
      }
      wat += '  (export "memory" (memory 0))\n';
      return wat;
    }
  };

  // ─── WASM Binary Generator Mixin ────────────────────────────
  
  var WasmBinaryGeneratorMixin = {
    mixinId: 'wasm-binary-generator',
    overrides: true,
    version: '2.1.0',

    generateWasm: function() {
      if (!this._ast) {
        throw new Error('No AST to generate WASM from');
      }
      var wasm = this.buildWasmBinary(this._ast);
      this._wasmBinary = wasm;
      logDebug('WASM generated', wasm.length + ' bytes');
      if (this._debug || DEBUG) {
        console.log('🔨 WASM binary size:', wasm.length, 'bytes');
        hexDump(wasm, 'WASM Binary');
      }
      return wasm;
    },

    // One compilation unit per class: its own constructor (if any),
    // exports, and a property map scoped to just its own properties. A
    // single-class source gets exactly one unit with an empty export
    // prefix -- byte-for-byte the same output this always produced.
    // Multiple classes each get their own unit, prefixed "ClassName_" in
    // the shared export namespace so two classes' same-named methods (or
    // statics) can't collide -- real per-class compilation, not a
    // rejection: there's no case where this compiler has the latitude to
    // just refuse a second class.
    // The next free byte offset in a property map -- the max of every
    // existing slot's own (offset + size), where a nullable property's
    // slot is 16 bytes and everything else is 8. Used to append hidden
    // capture slots after a class's ordinary properties without needing
    // to recompute the whole map from scratch.
    nextPropertyOffset: function(propertyMap) {
      var max = 0;
      Object.keys(propertyMap.offsets).forEach(function(k) {
        var size = (propertyMap.nullable && propertyMap.nullable[k]) ? 16 : 8;
        var end = propertyMap.offsets[k] + size;
        if (end > max) max = end;
      });
      return max;
    },

    // Records which locals compileExpressionToWasm's various recursive
    // call sites can use for array/object/string LITERAL CONSTRUCTION
    // (_exprScratchLocal, one i32) and for string CONCATENATION/
    // COMPARISON's own runtime byte-copy/byte-compare loops
    // (_exprStrLocals, STR_SCRATCH_COUNT more i32s, right after it).
    // compileExpressionToWasm's signature doesn't thread these through
    // its many recursive call sites, so this is transient per-
    // compilation instance state instead -- safe since compilation is
    // synchronous and single-threaded, and every buildXBody function
    // re-sets it before compiling its own statement list.
    setExprScratch: function(scratchLocal) {
      this._exprScratchLocal = scratchLocal;
      this._exprStrLocals = [];
      for (var i = 1; i <= STR_SCRATCH_COUNT; i++) this._exprStrLocals.push(scratchLocal + i);
    },

    // Rewrites every bare occurrence of `oldName` in a single expression-
    // text string into `this.<newKey>` -- skips one already `this.`-
    // prefixed (a property read, not this local) via a negative
    // lookbehind, same technique discoverClosures uses for captures.
    rewriteIdentifierInText: function(text, oldName, newKey) {
      return text.replace(new RegExp('(?<!this\\.)\\b' + oldName + '\\b', 'g'), 'this.' + newKey);
    },

    // Applies rewriteIdentifierInText to every expression-text field a
    // statement (or its nested if/while bodies) can carry, recursively.
    // Used by buildGeneratorInfo to promote every param and local
    // variable in a generator's body to a hidden per-instance property,
    // since a WASM local can't survive between two separate .next()
    // calls the way a generator's own suspended state has to.
    rewriteIdentifierInStatements: function(stmts, oldName, newKey) {
      var self = this;
      (stmts || []).forEach(function(stmt) {
        switch (stmt.type) {
          case 'return':
          case 'yield':
          case 'exprStatement':
            stmt.value = self.rewriteIdentifierInText(stmt.value, oldName, newKey);
            break;
          case 'assign':
          case 'localDecl':
          case 'localAssign':
            stmt.value = self.rewriteIdentifierInText(stmt.value, oldName, newKey);
            break;
          case 'arrayIndexSet':
            stmt.indexExpr = self.rewriteIdentifierInText(stmt.indexExpr, oldName, newKey);
            stmt.value = self.rewriteIdentifierInText(stmt.value, oldName, newKey);
            break;
          case 'arrayInit':
            stmt.elements = stmt.elements.map(function(e) { return self.rewriteIdentifierInText(e, oldName, newKey); });
            break;
          case 'objectInit':
            stmt.fields.forEach(function(f) { f.valueText = self.rewriteIdentifierInText(f.valueText, oldName, newKey); });
            break;
          case 'if':
            stmt.cond = self.rewriteIdentifierInText(stmt.cond, oldName, newKey);
            self.rewriteIdentifierInStatements(stmt.then, oldName, newKey);
            if (stmt.else) self.rewriteIdentifierInStatements(stmt.else, oldName, newKey);
            break;
          case 'while':
            stmt.cond = self.rewriteIdentifierInText(stmt.cond, oldName, newKey);
            self.rewriteIdentifierInStatements(stmt.body, oldName, newKey);
            break;
          case 'call':
            stmt.args = stmt.args.map(function(a) { return self.rewriteIdentifierInText(a, oldName, newKey); });
            break;
          default:
            break; // arrowInit/destructure/arrayIndexSet-less shapes: not reachable inside a generator body in v1 scope
        }
      });
    },

    // Real closures: `this.f = (a, b) => a + b;` in a constructor. Scans
    // constructorInfo's already-parsed statements for 'arrowInit' nodes
    // and, for each:
    //   - finds its free (captured) identifiers -- any bare name in the
    //     arrow body that isn't one of the arrow's own params and isn't
    //     `this.`-prefixed. Each MUST be a parameter of the enclosing
    //     constructor (real JS itself would throw a ReferenceError for a
    //     truly undefined capture -- this mirrors that, not a "RegX
    //     doesn't support X" rejection).
    //   - gives the closure its own hidden, per-instance property slot
    //     for each captured value (so the value survives past the
    //     constructor returning, exactly like a real JS closure's
    //     captured environment does), and rewrites the arrow's own body
    //     to read captures from there instead of as bare identifiers.
    //   - registers propertyMap.closures[key] (arity + return type, used
    //     by every OTHER method in this class to compile a `this.f(...)`
    //     call against) and replaces the statement with a simplified
    //     'arrowInit' that just needs its final table index at codegen
    //     time (assigned later, once every class's closures are known
    //     module-wide -- see buildWasmBinary).
    // Lowers an (already identifier-rewritten) generator statement list
    // into a flat array of basic blocks {id, ops, terminator}. `ops`
    // holds only straight-line statements (assign/exprStatement/call/
    // arrayInit/arrayIndexSet/objectInit); every 'if'/'while'/'return'/
    // 'yield' is extracted into a terminator instead:
    //   {kind:'yield', exprText, next}       -- store pc=next, return the value
    //   {kind:'branch', condText, thenBlock, elseBlock}
    //   {kind:'jump', next}
    //   {kind:'end', exprText|null}          -- store pc=-1 (done), return the value
    // General on purpose: any nesting of if/while (with back-edges for
    // loops) lowers to this same flat block list -- the generator driver
    // (buildGeneratorFunctionBody) dispatches it with a single shared
    // WASM `loop` + a $state local, re-entering at $state's block on
    // every 'jump'/'branch' and only ever leaving the function through
    // an explicit `return` at a 'yield' or 'end' -- the same "loop +
    // dispatch on a state variable" technique real bytecode interpreters
    // use to run an arbitrary control-flow graph on top of structured
    // control flow, without needing a full Relooper-style CFG
    // reconstruction into nested WASM blocks.
    lowerGeneratorBody: function(statements) {
      var blocks = [];
      function freshBlock() {
        var id = blocks.length;
        blocks.push({ id: id, ops: [], terminator: null });
        return id;
      }

      // Returns the id of the block still open (no terminator) after
      // lowering this list, or null once every path through it has
      // already terminated (only a 'return' truly ends a path; 'yield'
      // always continues into a fresh block).
      function lower(stmts, blockId) {
        var cur = blockId;
        for (var i = 0; i < stmts.length; i++) {
          if (cur === null) break; // unreachable code after a return
          var stmt = stmts[i];
          if (stmt.type === 'yield') {
            var nextId = freshBlock();
            blocks[cur].terminator = { kind: 'yield', exprText: stmt.value, next: nextId };
            cur = nextId;
          } else if (stmt.type === 'return') {
            blocks[cur].terminator = { kind: 'end', exprText: stmt.value };
            cur = null;
          } else if (stmt.type === 'if') {
            var thenId = freshBlock();
            var elseId = stmt.else ? freshBlock() : null;
            var afterId = freshBlock();
            blocks[cur].terminator = { kind: 'branch', condText: stmt.cond, thenBlock: thenId, elseBlock: stmt.else ? elseId : afterId };
            var thenEnd = lower(stmt.then, thenId);
            var reachesAfter = false;
            if (thenEnd !== null) { blocks[thenEnd].terminator = { kind: 'jump', next: afterId }; reachesAfter = true; }
            if (stmt.else) {
              var elseEnd = lower(stmt.else, elseId);
              if (elseEnd !== null) { blocks[elseEnd].terminator = { kind: 'jump', next: afterId }; reachesAfter = true; }
            } else {
              reachesAfter = true; // falling through the condition itself already targets afterId
            }
            cur = reachesAfter ? afterId : null;
          } else if (stmt.type === 'while') {
            var condId = freshBlock();
            var bodyId = freshBlock();
            var afterW = freshBlock();
            blocks[cur].terminator = { kind: 'jump', next: condId };
            blocks[condId].terminator = { kind: 'branch', condText: stmt.cond, thenBlock: bodyId, elseBlock: afterW };
            var bodyEnd = lower(stmt.body, bodyId);
            if (bodyEnd !== null) blocks[bodyEnd].terminator = { kind: 'jump', next: condId };
            cur = afterW;
          } else {
            blocks[cur].ops.push(stmt);
          }
        }
        return cur;
      }

      var entry = freshBlock();
      var finalOpen = lower(statements, entry);
      if (finalOpen !== null) {
        blocks[finalOpen].terminator = { kind: 'end', exprText: null };
      }
      // Defensive: any block lower() never actually reached (e.g. one
      // arm of an if that always returns, leaving an unused merge point)
      // still needs SOME terminator for buildGeneratorFunctionBody to
      // emit valid code for it, even though nothing ever dispatches there.
      blocks.forEach(function(b) { if (!b.terminator) b.terminator = { kind: 'end', exprText: null }; });
      return blocks;
    },

    // Widens across every yield/return value reachable in the lowered
    // block list -- mirrors inferReturnType, but a generator's _next
    // ALWAYS returns some value (0 once exhausted), never void.
    inferGeneratorReturnType: function(blocks, propertyMap, localMap) {
      var self = this;
      var resultType = null;
      function widenOrSet(t) { resultType = (resultType === null) ? t : self.widenType(resultType, t); }
      blocks.forEach(function(b) {
        var t = b.terminator;
        if (t.kind === 'yield' || (t.kind === 'end' && t.exprText)) {
          widenOrSet(self.compileExpressionToWasm(t.exprText, propertyMap, localMap).type);
        }
      });
      return resultType || 'i64';
    },

    // Builds a generator method's compiled description: every param and
    // every let/const/var-declared local promoted to its own hidden,
    // per-instance property slot (a WASM local can't survive between two
    // separate .next() calls the way a generator's suspended state has
    // to), plus a dedicated pc slot recording which block to resume at.
    // Params are captured once, on the very first call (block 0 always
    // runs exactly once, before pc ever moves past it).
    buildGeneratorInfo: function(method, propertyMap) {
      var self = this;
      var rawStatements = this.parseStatements(this.stripBraceInterior(method.body));
      var params = (method.params || []).filter(function(p) { return p !== 'this' && p !== 'self'; });
      var genPrefix = '__gen_' + method.name + '_';

      var localNames = params.slice();
      (function walk(stmts) {
        (stmts || []).forEach(function(stmt) {
          if (stmt.type === 'localDecl' && localNames.indexOf(stmt.name) === -1) localNames.push(stmt.name);
          if (stmt.type === 'if') { walk(stmt.then); if (stmt.else) walk(stmt.else); }
          if (stmt.type === 'while') walk(stmt.body);
        });
      })(rawStatements);

      var hiddenKeys = {};
      localNames.forEach(function(name) {
        var key = genPrefix + name;
        hiddenKeys[name] = key;
        if (!Object.prototype.hasOwnProperty.call(propertyMap.offsets, key)) {
          propertyMap.offsets[key] = self.nextPropertyOffset(propertyMap);
          propertyMap.types[key] = 'i64'; // v1 scope: generator locals are always i64
        }
        self.rewriteIdentifierInStatements(rawStatements, name, key);
      });

      // localDecl/localAssign kept their bare `name` through the rewrite
      // above (only the VALUE text was rewritten) -- now retarget the
      // statement itself at the hidden property, reusing ordinary
      // property-assign codegen for both.
      (function convert(stmts) {
        (stmts || []).forEach(function(stmt) {
          if (stmt.type === 'localDecl' || stmt.type === 'localAssign') {
            stmt.type = 'assign';
            stmt.key = hiddenKeys[stmt.name];
          }
          if (stmt.type === 'if') { convert(stmt.then); if (stmt.else) convert(stmt.else); }
          if (stmt.type === 'while') convert(stmt.body);
        });
      })(rawStatements);

      // On the first call only (block 0 never runs again once pc moves
      // past it), store each incoming param into its hidden slot --
      // reading the param by its ORIGINAL bare name (still a real WASM
      // param local here; every OTHER reference to that name in the body
      // was already rewritten to the hidden property above).
      var paramInits = params.map(function(p) { return { type: 'assign', key: hiddenKeys[p], value: p }; });
      var statements = paramInits.concat(rawStatements);

      var localMap = this.buildLocalMap(params);
      var blocks = this.lowerGeneratorBody(statements);
      var returnType = this.inferGeneratorReturnType(blocks, propertyMap, localMap);
      var pcKey = genPrefix + 'pc';
      if (!Object.prototype.hasOwnProperty.call(propertyMap.offsets, pcKey)) {
        propertyMap.offsets[pcKey] = this.nextPropertyOffset(propertyMap);
        propertyMap.types[pcKey] = 'i64';
      }

      return { method: method, pcKey: pcKey, blocks: blocks, localMap: localMap, returnType: returnType };
    },

    // The _next driver: loads pc, and -- unless already exhausted --
    // dispatches (a nested if/else-if chain comparing $state to each
    // block's id) into that block's code, which runs until it hits a
    // 'yield' or 'end' terminator (an explicit `return`, persisting the
    // new pc first) or a 'jump'/'branch' terminator (sets $state and
    // `br`s back to the top of the shared loop to re-dispatch, still
    // within this SAME call -- no function boundary crossed for those).
    buildGeneratorFunctionBody: function(genInfo, propertyMap) {
      var self = this;
      var blocks = genInfo.blocks;
      var localMap = genInfo.localMap;
      var returnType = genInfo.returnType;
      var pcOffset = propertyMap.offsets[genInfo.pcKey];
      var paramCount = Object.keys(localMap).length;
      var scratchLocal = paramCount + 1;
      var stateLocal = paramCount + 2;

      function pcStoreBytes(value) {
        return [0x20].concat(leb128Encode(0), [0x41], leb128EncodeSigned(pcOffset), [0x6A, 0x42],
          leb128EncodeSignedBig(BigInt(value)), [0x37, 0x03, 0x00]);
      }
      function stateSetBytes(blockId) {
        return [0x41].concat(leb128EncodeSigned(blockId), [0x21], leb128Encode(stateLocal));
      }
      function zeroConstOf(type) {
        if (type === 'f64') return self.f64ConstBytes(0);
        if (type === 'i32') return [0x41, 0x00];
        return [0x42, 0x00];
      }
      function terminatorBytes(t, depth) {
        if (t.kind === 'yield') {
          var v = self.compileExpressionToWasm(t.exprText, propertyMap, localMap);
          return pcStoreBytes(t.next).concat(self.convertType(v.bytes, v.type, returnType), [0x0F]);
        }
        if (t.kind === 'end') {
          var ev = t.exprText ? self.compileExpressionToWasm(t.exprText, propertyMap, localMap) : null;
          var valBytes = ev ? self.convertType(ev.bytes, ev.type, returnType) : zeroConstOf(returnType);
          return pcStoreBytes(-1).concat(valBytes, [0x0F]);
        }
        if (t.kind === 'jump') {
          return stateSetBytes(t.next).concat([0x0C], leb128Encode(depth));
        }
        // 'branch'
        var c = self.compileExpressionToWasm(t.condText, propertyMap, localMap);
        var cb = self.toBoolean(c);
        return cb.concat([0x04, 0x40])
          .concat(stateSetBytes(t.thenBlock))
          .concat([0x05])
          .concat(stateSetBytes(t.elseBlock))
          .concat([0x0B])
          .concat([0x0C], leb128Encode(depth));
      }
      function chainBytes(blockIndex, ifDepth) {
        if (blockIndex >= blocks.length) return [0x00]; // unreachable -- a valid pc always matches one arm
        var b = blocks[blockIndex];
        var bodyBytes = [];
        b.ops.forEach(function(op) {
          var compiled = self.compileStatementToWasm(op, propertyMap, localMap, false, null, scratchLocal);
          if (compiled) bodyBytes = bodyBytes.concat(compiled);
        });
        bodyBytes = bodyBytes.concat(terminatorBytes(b.terminator, ifDepth + 1));
        return [0x20].concat(leb128Encode(stateLocal), [0x41], leb128EncodeSigned(blockIndex), [0x46, 0x04, 0x40])
          .concat(bodyBytes)
          .concat([0x05])
          .concat(chainBytes(blockIndex + 1, ifDepth + 1))
          .concat([0x0B]);
      }

      var bytes = [];
      bytes = bytes.concat(leb128Encode(2));
      bytes = bytes.concat(leb128Encode(1)); bytes.push(0x7F); // $scratch
      bytes = bytes.concat(leb128Encode(1)); bytes.push(0x7F); // $state

      // $state = i32.wrap_i64(this.pc)
      bytes = bytes.concat([0x20], leb128Encode(0), [0x41], leb128EncodeSigned(pcOffset),
        [0x6A, 0x29, 0x03, 0x00, 0xA7, 0x21], leb128Encode(stateLocal));

      // if ($state == -1) return 0 (already exhausted); else run the dispatch loop.
      bytes = bytes.concat([0x20], leb128Encode(stateLocal), [0x41], leb128EncodeSigned(-1), [0x46]);
      bytes.push(0x04, this.valueTypeByte(returnType));
      bytes = bytes.concat(zeroConstOf(returnType), [0x0F]);
      bytes.push(0x05); // else
      bytes.push(0x03, 0x40); // loop (void)
      bytes = bytes.concat(chainBytes(0, 0));
      bytes.push(0x0B); // end loop (unreachable in practice -- every path returns or brs)
      bytes.push(0x00); // unreachable safety net
      bytes.push(0x0B); // end if
      bytes.push(0x0B); // end func
      return bytes;
    },

    // The _done export: a genuinely separate, trivial query -- pc == -1
    // (the sentinel buildGeneratorFunctionBody's 'end' terminator writes)
    // means every value has already been yielded and .next() would only
    // ever return the same "exhausted" 0 from here on.
    buildGeneratorDoneBody: function(genInfo, propertyMap) {
      var pcOffset = propertyMap.offsets[genInfo.pcKey];
      var bytes = [];
      bytes = bytes.concat(leb128Encode(0));
      bytes = bytes.concat([0x20], leb128Encode(0), [0x41], leb128EncodeSigned(pcOffset), [0x6A, 0x29, 0x03, 0x00, 0xA7]);
      bytes = bytes.concat([0x41], leb128EncodeSigned(-1), [0x46, 0x0F, 0x0B]);
      return bytes;
    },

    discoverClosures: function(constructorInfo, propertyMap) {
      var self = this;
      var constructorParams = (constructorInfo.method.params || []).filter(function(p) { return p !== 'this' && p !== 'self'; });
      var KEYWORDS = { 'true': 1, 'false': 1, 'NaN': 1, 'this': 1 };
      var newStatements = [];

      constructorInfo.statements.forEach(function(stmt) {
        if (stmt.type !== 'arrowInit') { newStatements.push(stmt); return; }

        var key = stmt.key;
        var ownParams = stmt.params;
        var exprText = stmt.exprText;

        var identRe = /(this\.)?([a-zA-Z_]\w*)/g;
        var captureNames = [];
        var seenCapture = {};
        var m;
        identRe.lastIndex = 0;
        while ((m = identRe.exec(exprText)) !== null) {
          if (m[1]) continue; // "this."-prefixed -- a property read, not a capture
          var name = m[2];
          if (ownParams.indexOf(name) !== -1) continue;
          if (Object.prototype.hasOwnProperty.call(KEYWORDS, name)) continue;
          if (constructorParams.indexOf(name) === -1) {
            throw new Error('RegX: arrow function assigned to this.' + key + ' captures unknown identifier \'' + name + '\' (not a parameter of the enclosing constructor): ' + exprText);
          }
          if (!seenCapture[name]) { seenCapture[name] = true; captureNames.push(name); }
        }

        var rewrittenExpr = exprText;
        captureNames.forEach(function(name) {
          var capKey = '__cap_' + key + '_' + name;
          rewrittenExpr = rewrittenExpr.replace(new RegExp('(?<!this\\.)\\b' + name + '\\b', 'g'), 'this.' + capKey);
          newStatements.push({ type: 'assign', key: capKey, value: name });
          if (!Object.prototype.hasOwnProperty.call(propertyMap.offsets, capKey)) {
            propertyMap.offsets[capKey] = self.nextPropertyOffset(propertyMap);
            propertyMap.types[capKey] = 'i64'; // captured params are always i64, matching real params
          }
        });

        if (!Object.prototype.hasOwnProperty.call(propertyMap.offsets, key)) {
          propertyMap.offsets[key] = self.nextPropertyOffset(propertyMap);
        }
        propertyMap.types[key] = 'function';
        if (!propertyMap.closures) propertyMap.closures = {};

        var closureLocalMap = self.buildLocalMap(ownParams);
        var typedResult;
        try {
          typedResult = self.compileExpressionToWasm(rewrittenExpr, propertyMap, closureLocalMap);
        } catch (e) {
          throw new Error('RegX: could not compile arrow function assigned to this.' + key + ': ' + e.message);
        }

        propertyMap.closures[key] = {
          key: key,
          ownParams: ownParams,
          exprText: rewrittenExpr,
          returnType: typedResult.type,
          arity: ownParams.length,
          tableIndex: null,
          funcIndex: null
        };

        newStatements.push({ type: 'arrowInit', key: key });
      });

      constructorInfo.statements = newStatements;
    },

    // this.f(args) where this.f holds a real closure -- compiles to a
    // genuine call_indirect through the module's function table.
    // tableIndex/funcIndex are null until buildWasmBinary has laid out
    // every class's closures module-wide (see discoverClosures' own
    // comment); called with them still null during return-type
    // inference (inferReturnType discards the bytes and only reads
    // .type, so an empty placeholder is safe there), and with them set
    // during the real, final codegen pass.
    compileClosureCallToWasm: function(key, argTexts, propertyMap, localMap) {
      var closure = propertyMap.closures && propertyMap.closures[key];
      if (!closure) {
        throw new Error('RegX: this.' + key + ' is not a callable (function-valued) property');
      }
      if (argTexts.length !== closure.arity) {
        throw new Error('RegX: this.' + key + ' expects ' + closure.arity + ' argument(s), got ' + argTexts.length);
      }
      if (closure.tableIndex === null) {
        return { bytes: [], type: closure.returnType };
      }

      var offset = propertyMap.offsets[key] || 0;
      var bytes = [];
      bytes.push(0x20);
      bytes = bytes.concat(leb128Encode(0)); // local.get 0 ($this, passed through to the callee)
      for (var i = 0; i < argTexts.length; i++) {
        var argResult = this.compileExpressionToWasm(argTexts[i], propertyMap, localMap);
        bytes = bytes.concat(this.convertType(argResult.bytes, argResult.type, 'i64'));
      }
      // Load the stored table index (this.KEY, an i64) and narrow to i32.
      bytes.push(0x20);
      bytes = bytes.concat(leb128Encode(0));
      bytes.push(0x41);
      bytes = bytes.concat(leb128EncodeSigned(offset));
      bytes.push(0x6A, 0x29, 0x03, 0x00, 0xA7);
      bytes.push(0x11); // call_indirect
      bytes = bytes.concat(leb128Encode(closure.funcIndex)); // type index -- closures' own type == their own func index, see buildWasmBinary
      bytes.push(0x00); // table index 0
      return { bytes: bytes, type: closure.returnType };
    },

    // this.method(args) calling ANOTHER method of the SAME class -- a
    // real, direct `call`, not call_indirect: unlike a closure (whose
    // stored function value can change at runtime), which method this
    // is is fixed at compile time, so no table/dispatch is needed at
    // all. funcIndex is null until buildWasmBinary has assigned every
    // method its real function index (same two-phase pattern closures
    // use); called with it still null during return-type inference
    // (which only reads .type and discards the bytes).
    compileMethodCallToWasm: function(name, argTexts, propertyMap, localMap) {
      var m = propertyMap.methods && propertyMap.methods[name];
      if (!m) {
        throw new Error('RegX: this.' + name + ' is not a callable method on this class');
      }
      if (argTexts.length !== m.arity) {
        throw new Error('RegX: this.' + name + ' expects ' + m.arity + ' argument(s), got ' + argTexts.length);
      }
      if (m.funcIndex === null) {
        // m.returnType is `undefined` only while it's genuinely not yet
        // known (still mid-fixed-point-inference) -- 'i64' is this
        // compiler's own default for anything untyped in that case. A
        // real `null` means already resolved AND genuinely void; that
        // must pass through unchanged; falling back to 'i64' for it
        // (undefined and null both being falsy) would wrongly claim a
        // void method call to always have a value.
        return { bytes: [], type: m.returnType === undefined ? 'i64' : m.returnType };
      }
      var bytes = [];
      bytes.push(0x20);
      bytes = bytes.concat(leb128Encode(0)); // local.get 0 ($this, passed through to the callee)
      for (var i = 0; i < argTexts.length; i++) {
        var argResult = this.compileExpressionToWasm(argTexts[i], propertyMap, localMap);
        bytes = bytes.concat(this.convertType(argResult.bytes, argResult.type, 'i64'));
      }
      bytes.push(0x10); // call
      bytes = bytes.concat(leb128Encode(m.funcIndex));
      return { bytes: bytes, type: m.returnType };
    },

    // A real host import call (console.log, setTimeout, ...) used as a
    // general expression -- unlike a sibling-method/closure call, the
    // target function index is already fully known at compile time (K
    // imports occupy the FIRST function indices, fixed once
    // this._importIndexMap is built), so there's no two-phase "index
    // unknown yet" concern the way sibling calls/closures have.
    compileImportCallToWasm: function(name, argTexts, propertyMap, localMap) {
      var def = KNOWN_IMPORTS[name];
      if (!def) {
        throw new Error('RegX: ' + name + ' is not a known host import');
      }
      if (argTexts.length !== def.params.length) {
        throw new Error('RegX: ' + name + ' expects ' + def.params.length + ' argument(s), got ' + argTexts.length);
      }
      var importIdx = (this._importIndexMap && this._importIndexMap[name]) || 0;
      var bytes = [];
      if (def.needsThis) {
        bytes.push(0x20);
        bytes = bytes.concat(leb128Encode(0)); // local.get 0 ($this)
      }
      for (var i = 0; i < argTexts.length; i++) {
        var argResult = this.compileExpressionToWasm(argTexts[i], propertyMap, localMap);
        bytes = bytes.concat(this.convertType(argResult.bytes, argResult.type, def.params[i]));
      }
      bytes.push(0x10); // call
      bytes = bytes.concat(leb128Encode(importIdx));
      return { bytes: bytes, type: def.resultType };
    },

    buildClassUnit: function(ast, className, prefix) {
      var self = this;

      // A class with no `extends` gets a one-element chain [className] --
      // identical to the plain className filtering this always did, so a
      // non-inheriting class (including every single-class source that
      // exists today) compiles byte-for-byte the same as before.
      var chain = className ? this.classAncestryChain(ast, className) : null;
      var inChain = function(cn) { return !className || (chain && chain.indexOf(cn) !== -1); };

      var propertyMap = (chain && chain.length > 1)
        ? this.buildWasmPropertyMapForChain(ast, chain)
        : this.buildWasmPropertyMap(ast, className);

      // Method resolution across the whole ancestry chain, root to leaf:
      // a more-derived class's method with the SAME name overrides its
      // ancestor's; anything the leaf class doesn't redeclare is
      // inherited as-is (recompiled fresh here, against THIS class's own
      // merged property map, not reused unchanged -- inherited field
      // offsets agree across the chain by construction, see
      // buildWasmPropertyMapForChain, so the inherited body compiles
      // correctly without any translation).
      var methods;
      if (chain && chain.length > 1) {
        var byName = {};
        var order = [];
        chain.forEach(function(cn) {
          (ast.methods || []).filter(function(m) { return m.className === cn; }).forEach(function(m) {
            if (!Object.prototype.hasOwnProperty.call(byName, m.name)) order.push(m.name);
            byName[m.name] = m; // a later (more derived) class wins
          });
        });
        methods = order.map(function(n) { return byName[n]; });
      } else {
        methods = (ast.methods || []).filter(function(m) { return !className || m.className === className; });
      }

      // Private-field/method compile-time privacy: every method's body
      // (including an inherited one recompiled fresh for this chain, see
      // the `methods` build above) is checked against ITS OWN
      // className, never the leaf class being compiled -- so a Derived
      // method genuinely cannot reach a #name Base alone declared, the
      // same way real JS scopes it. Field-initializer values (`#b = this.
      // #a + 1;`) are checked the same way, keyed by their own
      // declaring class.
      var privateOwners = this.collectPrivateOwners(ast);
      for (var pv = 0; pv < methods.length; pv++) {
        this.validatePrivateRefs(methods[pv].body, methods[pv].className, privateOwners, 'method ' + methods[pv].name);
      }
      (ast.properties || []).forEach(function(p) {
        if (p.isField && inChain(p.className)) {
          self.validatePrivateRefs(p.value, p.className, privateOwners, 'field initializer ' + p.key);
        }
      });

      var exportsArr = [];
      var generatorMethods = [];
      var constructor = null;
      for (var i = 0; i < methods.length; i++) {
        if (methods[i].name === 'constructor') {
          constructor = methods[i];
        } else if (methods[i].isGenerator) {
          generatorMethods.push(methods[i]);
        } else {
          exportsArr.push(methods[i]);
        }
      }
      if (exportsArr.length === 0 && generatorMethods.length === 0) {
        throw new Error('RegX: no exports found' + (className ? ' in class ' + className : ''));
      }

      // Real sibling-method calls (this.helper(...) calling ANOTHER
      // method of the same class): register every export's arity up
      // front, in a real `call` (not call_indirect -- unlike a closure,
      // which method is stored is fixed at compile time, so no table is
      // needed at all). Registered BEFORE the constructor is processed
      // below (discoverClosures needs to compile a closure's own body,
      // which can itself call a sibling method, e.g. `() => this.incr()`
      // for a setTimeout/setInterval callback) -- funcIndex is filled in
      // later, once buildWasmBinary knows the full module layout (same
      // two-phase pattern closures already use).
      propertyMap.methods = propertyMap.methods || {};
      exportsArr.forEach(function(m) {
        var arity = (m.params || []).filter(function(p) { return p !== 'this' && p !== 'self'; }).length;
        propertyMap.methods[m.name] = { arity: arity, returnType: undefined, funcIndex: null };
      });

      var constructorInfo = null;
      if (constructor) {
        constructorInfo = {
          method: constructor,
          localMap: this.buildLocalMap(constructor.params),
          statements: this.parseStatements(this.stripBraceInterior(constructor.body))
        };
        // Class-field declarations ("#x = 5;") initialize before the
        // constructor's own statements run, same as real JS field-init
        // order -- spliced onto the front, not appended, so an explicit
        // constructor assignment to the same key still overrides it.
        // Across a chain, an ancestor's own field declarations init
        // first (source order already puts Base before Derived).
        // A bare `#x;` (no initializer) only reserves the property's
        // offset -- there's no RHS expression to emit an assign
        // statement for, and real JS itself leaves it `undefined` until
        // something else actually assigns it.
        var fieldInits = (ast.properties || []).filter(function(p) {
          return p.isField && p.value !== undefined && inChain(p.className);
        }).map(function(p) { return { type: 'assign', key: p.key, value: p.value }; });
        if (fieldInits.length) constructorInfo.statements = fieldInits.concat(constructorInfo.statements);

        // Real, callable closures: `this.f = (a,b) => a+b;` in the
        // constructor. Discovered (and the constructor's statement list
        // rewritten) BEFORE exportInfos below, since another method in
        // this same class may call `this.f(...)` and needs propertyMap.
        // closures[key] populated to compile that call.
        this.discoverClosures(constructorInfo, propertyMap);

        // Destructured bindings (`const { a, b } = this.obj;`) need their
        // local indices assigned here too, BEFORE anything else in this
        // constructor references them by name -- constructors don't have
        // a return type to infer, but a later statement reading the
        // binding still needs localMap populated already.
        constructorInfo.scratchLocal = Object.keys(constructorInfo.localMap).length + 1;
        this.setExprScratch(constructorInfo.scratchLocal); // see compileArrayLiteralExprToWasm / compileStringConcatToWasm
        constructorInfo.destructuredEntries = this.allocateDestructuredLocals(
          constructorInfo.statements, constructorInfo.localMap, constructorInfo.scratchLocal, propertyMap);
        constructorInfo.localDeclEntries = this.allocateLocalDeclLocals(
          constructorInfo.statements, constructorInfo.localMap,
          constructorInfo.scratchLocal + 1 + STR_SCRATCH_COUNT + constructorInfo.destructuredEntries.length, propertyMap);
      }

      var exportInfos = exportsArr.map(function(m) {
        var localMap = self.buildLocalMap(m.params);
        var statements = self.parseStatements(self.stripBraceInterior(m.body));
        // Destructured bindings and `let`/`const` locals need their local
        // indices assigned BEFORE inferReturnType compiles `return a;`-
        // style statements that reference them -- see the matching
        // constructor comment above. localDecl locals are allocated
        // AFTER destructured ones, contiguous with them.
        var scratchLocal = Object.keys(localMap).length + 1;
        self.setExprScratch(scratchLocal); // see compileArrayLiteralExprToWasm / compileStringConcatToWasm
        var destructuredEntries = self.allocateDestructuredLocals(statements, localMap, scratchLocal, propertyMap);
        var localDeclEntries = self.allocateLocalDeclLocals(statements, localMap, scratchLocal + 1 + STR_SCRATCH_COUNT + destructuredEntries.length, propertyMap);
        return {
          method: m,
          localMap: localMap,
          statements: statements,
          scratchLocal: scratchLocal,
          destructuredEntries: destructuredEntries,
          localDeclEntries: localDeclEntries
        };
      });

      // Fixed-point return-type inference, 2 rounds: a sibling call's
      // OWN return type has to be known to widen the CALLER's return
      // type correctly, but methods can call each other regardless of
      // declaration order (or even mutually) -- round 1 resolves every
      // method treating an as-yet-unknown sibling call as i64 (this
      // compiler's own default for anything untyped), round 2 re-infers
      // using round 1's real results. Sufficient for realistic (non-
      // adversarial) mutual references; a return type that only
      // stabilizes after round 2 is out of v1 scope.
      for (var round = 0; round < 2; round++) {
        exportInfos.forEach(function(info) {
          self.setExprScratch(info.scratchLocal); // see compileArrayLiteralExprToWasm / compileStringConcatToWasm
          propertyMap.methods[info.method.name].returnType = self.inferReturnType(info.statements, propertyMap, info.localMap);
        });
      }
      exportInfos.forEach(function(info) {
        info.returnType = propertyMap.methods[info.method.name].returnType;
      });

      // A closure discovered during the constructor (above) may have
      // called a sibling method whose own return type wasn't final yet
      // at that point (a method starts with a provisional null/i64
      // placeholder, only settled by the fixed-point loop just above,
      // e.g. `this.tick = () => this.incr();` where incr() is void) --
      // re-probe every closure's body now that every method's REAL
      // return type is known, correcting any closure whose own inferred
      // type was locked in too early.
      if (propertyMap.closures) {
        Object.keys(propertyMap.closures).forEach(function(key) {
          var c = propertyMap.closures[key];
          var cLocalMap = self.buildLocalMap(c.ownParams);
          c.returnType = self.compileExpressionToWasm(c.exprText, propertyMap, cLocalMap).type;
        });
      }

      // Generator methods (*name() { ... yield ...; }) get a completely
      // different compiled shape -- two exports each (NAME_next, NAME_
      // done) instead of one, built by buildGeneratorInfo/
      // buildGeneratorFunctionBody rather than the ordinary statement-
      // list pipeline above. buildGeneratorInfo extends propertyMap
      // in-place with each generator's own hidden locals/pc slot, same
      // pattern discoverClosures already uses for captures.
      var genInfos = generatorMethods.map(function(m) { return self.buildGeneratorInfo(m, propertyMap); });

      var staticFields = (ast.staticProperties || []).filter(function(s) {
        return inChain(s.className);
      });

      return {
        className: className,
        prefix: prefix || '',
        propertyMap: propertyMap,
        constructorInfo: constructorInfo,
        exportInfos: exportInfos,
        genInfos: genInfos,
        staticFields: staticFields
      };
    },

    buildWasmBinary: function(ast) {
      var self = this;
      var bytes = [];

      bytes.push(0x00, 0x61, 0x73, 0x6D);
      bytes.push(0x01, 0x00, 0x00, 0x00);

      var classBlocks = (ast.blocks || []).filter(function(b) { return b.type === 'class'; });
      var multiClass = classBlocks.length > 1;

      var units = multiClass
        ? classBlocks.map(function(b) { return self.buildClassUnit(ast, b.name, b.name + '_'); })
        : [ this.buildClassUnit(ast, this.primaryClassName(ast), '') ];

      logDebug('Building WASM', units.length + ' class unit(s): ' + units.map(function(u) { return u.className || '(none)'; }).join(', '));

      // $this is always an i32 memory address (WASM's memory32 model).
      // Every other param/property/literal defaults to i64 (exact, native
      // speed, and — unlike f64 — no representability gap for RegX's
      // purposes) and only promotes to f64 when a literal's own text is
      // unmistakably fractional (has a decimal point) or is NaN, or when it
      // combines with something that already is f64.

      // ─── Callees (imports actually used) across every unit ────────
      // K imports occupy function indices 0..K-1; every local function
      // (every unit's constructor + methods, in unit order) is pushed
      // back by K in both the function index space and the type table.
      var usedKeys = [];
      var seenKeys = {};
      units.forEach(function(u) {
        if (u.constructorInfo) collectCallees(u.constructorInfo.statements, seenKeys, usedKeys);
        u.exportInfos.forEach(function(info) { collectCallees(info.statements, seenKeys, usedKeys); });
      });
      var K = usedKeys.length;
      this._importIndexMap = {};
      for (var iki = 0; iki < usedKeys.length; iki++) this._importIndexMap[usedKeys[iki]] = iki;

      var totalLocalTypes = 0;
      units.forEach(function(u) {
        if (u.constructorInfo) totalLocalTypes++;
        totalLocalTypes += u.exportInfos.length;
      });

      // ─── Closures: real, callable arrow-function properties ───────
      // Every unit's propertyMap.closures (populated by discoverClosures)
      // is keyed by property name -- flatten into one ordered, module-
      // wide list so each gets a stable table index (its position here)
      // and a func index right after every unit's own local functions.
      // Closures' own type/function/code entries are appended in this
      // SAME order below, so "closure i's type index == its func index"
      // holds by construction (compileClosureCallToWasm depends on it).
      var closures = [];
      units.forEach(function(u) {
        if (!u.propertyMap.closures) return;
        Object.keys(u.propertyMap.closures).forEach(function(k) {
          closures.push(u.propertyMap.closures[k]);
        });
      });
      closures.forEach(function(c, idx) {
        c.tableIndex = idx;
        c.funcIndex = K + totalLocalTypes + idx;
      });

      // A function-typed array element (a real event listener, see
      // arrayElementIsFunction/compileArrayPushToWasm) is dispatched
      // through call_indirect against ONE shared type index -- every
      // closure ever pushed into such an array is compile-time-checked
      // to share the exact same (i32 $this) -> void shape, so any one of
      // their own type-section entries (closures' own type index ==
      // their own func index, see the loop just above) is structurally
      // interchangeable for that immediate. Left null when no such
      // closure exists at all -- only reached by compileDynamicArrayCall
      // ToWasm, which throws its own clear error if it's ever null there.
      var listenerTypeIndex = null;
      closures.forEach(function(c) {
        if (listenerTypeIndex === null && c.arity === 0 && c.returnType === null) {
          listenerTypeIndex = c.funcIndex;
        }
      });
      this._listenerTypeIndex = listenerTypeIndex;

      // ─── Generators: real, resumable *name() methods ──────────────
      // Each contributes TWO functions (NAME_next, NAME_done), laid out
      // right after every unit's own functions and every closure, in the
      // same flattened, ordered list codegen below reuses.
      var allGenInfos = [];
      units.forEach(function(u) {
        (u.genInfos || []).forEach(function(g) { allGenInfos.push({ unit: u, gen: g }); });
      });
      allGenInfos.forEach(function(entry, idx) {
        entry.gen.nextFuncIndex = K + totalLocalTypes + closures.length + idx * 2;
        entry.gen.doneFuncIndex = entry.gen.nextFuncIndex + 1;
      });

      var totalFunctions = totalLocalTypes + closures.length + allGenInfos.length * 2;
      var totalTypes = K + totalFunctions;

      // ─── Type Section ──────────────────────────────────────────
      var typePayload = [];
      typePayload = typePayload.concat(leb128Encode(totalTypes));

      // Import types first -- (param [i32 $this,] ...params) -> [result].
      // Their type indices (0..K-1) are exactly their Import Section order.
      for (var iti = 0; iti < usedKeys.length; iti++) {
        var impDef = KNOWN_IMPORTS[usedKeys[iti]];
        var impParamTypes = (impDef.needsThis ? ['i32'] : []).concat(impDef.params);
        typePayload.push(0x60);
        typePayload = typePayload.concat(leb128Encode(impParamTypes.length));
        impParamTypes.forEach(function(t) { typePayload.push(self.valueTypeByte(t)); });
        if (impDef.resultType) {
          typePayload.push(0x01, self.valueTypeByte(impDef.resultType));
        } else {
          typePayload.push(0x00);
        }
      }

      units.forEach(function(u) {
        // Constructor type: (param i32 $this, param i64 ...) -> void
        if (u.constructorInfo) {
          var cParams = u.constructorInfo.method.params || [];
          var cParamCount = cParams.filter(function(p) { return p !== 'this' && p !== 'self'; });
          typePayload.push(0x60);
          typePayload = typePayload.concat(leb128Encode(cParamCount.length + 1)); // +1 for $this
          typePayload.push(0x7F); // $this — address, always i32
          for (var p = 0; p < cParamCount.length; p++) typePayload.push(0x7E);
          typePayload.push(0x00); // 0 results
        }

        // Method types: (param i32 $this, param i64 x) -> <inferred i32|i64|f64|void>
        u.exportInfos.forEach(function(info) {
          var mParams = info.method.params || [];
          var mParamCount = mParams.filter(function(p) { return p !== 'this' && p !== 'self'; });
          typePayload.push(0x60);
          typePayload = typePayload.concat(leb128Encode(mParamCount.length + 1));
          typePayload.push(0x7F);
          for (var p2 = 0; p2 < mParamCount.length; p2++) typePayload.push(0x7E);
          // A method with no `return` anywhere (make(), set(i,v), ...) is
          // genuinely void -- declare 0 results, not a fake 1-result type
          // its body never actually produces.
          if (info.returnType === null) {
            typePayload.push(0x00);
          } else {
            typePayload.push(0x01);
            typePayload.push(self.valueTypeByte(info.returnType));
          }
        });
      });

      // Closure types: (param i32 $this, param i64 x N own params) ->
      // <inferred i32|i64|f64>, OR void when the closure's own single-
      // expression body is itself a call to a void sibling method
      // (`() => this.incr()`, a real pattern for a setTimeout/
      // setInterval callback that exists purely for its side effect).
      closures.forEach(function(c) {
        typePayload.push(0x60);
        typePayload = typePayload.concat(leb128Encode(c.arity + 1));
        typePayload.push(0x7F);
        for (var cp = 0; cp < c.arity; cp++) typePayload.push(0x7E);
        if (c.returnType === null) {
          typePayload.push(0x00);
          return;
        }
        typePayload.push(0x01);
        typePayload.push(self.valueTypeByte(c.returnType));
      });

      // Generator types: NAME_next (param i32 $this) -> <inferred
      // i32|i64|f64>, NAME_done (param i32 $this) -> i32 (boolean).
      allGenInfos.forEach(function(entry) {
        typePayload.push(0x60, 0x01, 0x7F, 0x01);
        typePayload.push(self.valueTypeByte(entry.gen.returnType));
        typePayload.push(0x60, 0x01, 0x7F, 0x01, 0x7F);
      });

      bytes.push(0x01);
      bytes = bytes.concat(leb128Encode(typePayload.length));
      bytes = bytes.concat(typePayload);

      // ─── Import Section ──────────────────────────────────────────
      // Must sit between Type(0x01) and Function(0x03) -- section order is
      // significant, not just id-tagged.
      var importPayload = [];
      importPayload = importPayload.concat(leb128Encode(K));
      for (var ici = 0; ici < usedKeys.length; ici++) {
        var impInfo = KNOWN_IMPORTS[usedKeys[ici]];
        var modBytes = stringToBytes(impInfo.module);
        importPayload = importPayload.concat(leb128Encode(modBytes.length)).concat(modBytes);
        var fieldBytes = stringToBytes(impInfo.field);
        importPayload = importPayload.concat(leb128Encode(fieldBytes.length)).concat(fieldBytes);
        importPayload.push(0x00); // import kind: function
        importPayload = importPayload.concat(leb128Encode(ici)); // type index == import order
      }
      bytes.push(0x02);
      bytes = bytes.concat(leb128Encode(importPayload.length));
      bytes = bytes.concat(importPayload);

      // ─── Function Section ──────────────────────────────────────
      // Local function i gets type index K+i -- import types occupy 0..K-1.
      // Closures are local functions too, laid out right after every
      // unit's own (totalLocalTypes..totalFunctions-1).
      var funcPayload = [];
      funcPayload = funcPayload.concat(leb128Encode(totalFunctions));
      for (var fi = 0; fi < totalFunctions; fi++) {
        funcPayload = funcPayload.concat(leb128Encode(K + fi));
      }

      bytes.push(0x03);
      bytes = bytes.concat(leb128Encode(funcPayload.length));
      bytes = bytes.concat(funcPayload);

      // ─── Table Section ──────────────────────────────────────────
      // One funcref table, sized to exactly the closures that exist --
      // omitted entirely when there are none, so a source with no arrow-
      // function properties emits exactly the same sections it always
      // did. This is what makes `this.f(...)` a genuine call_indirect
      // dispatch rather than a fixed, unconditional jump: the SAME table
      // slot can hold a different closure depending on which one was
      // actually assigned to that property at construction time.
      if (closures.length > 0) {
        var tablePayload = [];
        tablePayload = tablePayload.concat(leb128Encode(1)); // 1 table
        tablePayload.push(0x70); // funcref
        tablePayload.push(0x00); // limits: min only
        tablePayload = tablePayload.concat(leb128Encode(closures.length));
        bytes.push(0x04);
        bytes = bytes.concat(leb128Encode(tablePayload.length));
        bytes = bytes.concat(tablePayload);
      }

      // ─── Memory Section ────────────────────────────────────────
      // 2 pages (128KB): page 0 holds per-object property storage
      // (offsets 0.. — every test in this compiler always passes $this=0,
      // so a page is far more than any realistic property list needs);
      // page 1 (byte 65536 on) is reserved as the array heap, so a bump
      // allocation there can never collide with property storage. The
      // heap and every class's property layout are shared module-wide --
      // distinct classes (or distinct instances of the same class) stay
      // independent by using distinct $this addresses, exactly like two
      // instances of one class already had to.
      var memPayload = [];
      memPayload = memPayload.concat(leb128Encode(1));
      memPayload.push(0x00);
      memPayload = memPayload.concat(leb128Encode(2));

      bytes.push(0x05);
      bytes = bytes.concat(leb128Encode(memPayload.length));
      bytes = bytes.concat(memPayload);

      // ─── Global Section ──────────────────────────────────────────
      // Global 0 is ALWAYS the array-heap bump pointer (HEAP_START,
      // mutable i32) -- declared unconditionally rather than only when
      // the source actually uses an array literal, trading a few bytes
      // for not needing to thread "does this module need a heap" through
      // every call site that might reference global index 0.
      // A `static NAME = VALUE;` has no per-object home -- every JS instance
      // of the class is one pointer into ONE wasm module instance's linear
      // memory here, so a WASM global (owned by the module instance, not by
      // any one $this pointer) is the exact right shape for "shared by every
      // instance, not part of any one object's storage." Static globals
      // occupy indices 1..N (in unit order), after the heap pointer at 0.
      var allStaticFields = [];
      units.forEach(function(u) { allStaticFields = allStaticFields.concat(u.staticFields); });

      var globalPayload = [];
      globalPayload = globalPayload.concat(leb128Encode(1 + allStaticFields.length));
      globalPayload.push(0x7F, 0x01); // i32, mutable
      globalPayload.push(0x41);
      globalPayload = globalPayload.concat(leb128EncodeSigned(HEAP_START));
      globalPayload.push(0x0B); // end
      for (var gi = 0; gi < allStaticFields.length; gi++) {
        var rawVal = allStaticFields[gi].value;
        var isFloatGlobal = /\d+\.\d+/.test(rawVal) || /\bNaN\b/.test(rawVal);
        if (isFloatGlobal) {
          globalPayload.push(0x7C, 0x01); // f64, mutable
          globalPayload = globalPayload.concat(this.f64ConstBytes(parseFloat(rawVal)));
        } else {
          globalPayload.push(0x7E, 0x01); // i64, mutable
          globalPayload.push(0x42);
          globalPayload = globalPayload.concat(leb128EncodeSignedBig(BigInt(parseInt(rawVal, 10) || 0)));
        }
        globalPayload.push(0x0B); // end
      }
      bytes.push(0x06);
      bytes = bytes.concat(leb128Encode(globalPayload.length));
      bytes = bytes.concat(globalPayload);

      // ─── Export Section ────────────────────────────────────────
      var exportPayload = [];
      var exportCount = totalLocalTypes + (allGenInfos.length * 2) + 1 + allStaticFields.length + (closures.length > 0 ? 1 : 0); // +1 for memory, +1 for the closure table if one exists
      exportPayload = exportPayload.concat(leb128Encode(exportCount));

      var funcIndex = K;
      units.forEach(function(u) {
        if (u.constructorInfo) {
          var initNameBytes = stringToBytes(u.prefix + 'init');
          exportPayload = exportPayload.concat(leb128Encode(initNameBytes.length)).concat(initNameBytes);
          exportPayload.push(0x00);
          exportPayload = exportPayload.concat(leb128Encode(funcIndex));
          funcIndex++;
        }
        u.exportInfos.forEach(function(info) {
          var nameBytes = stringToBytes(u.prefix + info.method.name);
          exportPayload = exportPayload.concat(leb128Encode(nameBytes.length)).concat(nameBytes);
          exportPayload.push(0x00);
          exportPayload = exportPayload.concat(leb128Encode(funcIndex));
          // Real sibling-method calls (compileMethodCallToWasm) need this
          // method's real function index, only knowable once the whole
          // module's layout is settled -- fills in the placeholder
          // registered back in buildClassUnit.
          if (u.propertyMap.methods && u.propertyMap.methods[info.method.name]) {
            u.propertyMap.methods[info.method.name].funcIndex = funcIndex;
          }
          funcIndex++;
        });
      });

      // Generator exports: NAME_next / NAME_done, using the func indices
      // already assigned above (K + totalLocalTypes + closures.length +
      // idx*2 / +1).
      allGenInfos.forEach(function(entry) {
        var nextNameBytes = stringToBytes(entry.unit.prefix + entry.gen.method.name + '_next');
        exportPayload = exportPayload.concat(leb128Encode(nextNameBytes.length)).concat(nextNameBytes);
        exportPayload.push(0x00);
        exportPayload = exportPayload.concat(leb128Encode(entry.gen.nextFuncIndex));

        var doneNameBytes = stringToBytes(entry.unit.prefix + entry.gen.method.name + '_done');
        exportPayload = exportPayload.concat(leb128Encode(doneNameBytes.length)).concat(doneNameBytes);
        exportPayload.push(0x00);
        exportPayload = exportPayload.concat(leb128Encode(entry.gen.doneFuncIndex));
      });

      var globalIndex = 1; // 0 is the heap pointer
      units.forEach(function(u) {
        u.staticFields.forEach(function(sf) {
          var sgNameBytes = stringToBytes(u.prefix + sf.key);
          exportPayload = exportPayload.concat(leb128Encode(sgNameBytes.length)).concat(sgNameBytes);
          exportPayload.push(0x03); // export kind: global
          exportPayload = exportPayload.concat(leb128Encode(globalIndex));
          globalIndex++;
        });
      });

      var memNameBytes = stringToBytes('memory');
      exportPayload = exportPayload.concat(leb128Encode(memNameBytes.length));
      exportPayload = exportPayload.concat(memNameBytes);
      exportPayload.push(0x02);
      exportPayload = exportPayload.concat(leb128Encode(0));

      // The closure table, exported so a host import (setTimeout,
      // setInterval) can invoke a closure LATER, outside of any WASM
      // call -- real JS timer callbacks aren't WASM code, so the only
      // way one can call back into a closure is through its real,
      // exported funcref. See RegXCore.instantiate's host setTimeout/
      // setInterval implementations.
      if (closures.length > 0) {
        var tableNameBytes = stringToBytes('__closureTable');
        exportPayload = exportPayload.concat(leb128Encode(tableNameBytes.length));
        exportPayload = exportPayload.concat(tableNameBytes);
        exportPayload.push(0x01); // export kind: table
        exportPayload = exportPayload.concat(leb128Encode(0));
      }

      bytes.push(0x07);
      bytes = bytes.concat(leb128Encode(exportPayload.length));
      bytes = bytes.concat(exportPayload);

      // ─── Element Section ────────────────────────────────────────
      // Populates the funcref table declared above with every closure's
      // real function index, in table-index order -- table[c.tableIndex]
      // = c.funcIndex. Must come after Export(7), before Code(10).
      if (closures.length > 0) {
        var elemPayload = [];
        elemPayload = elemPayload.concat(leb128Encode(1)); // 1 active segment
        elemPayload = elemPayload.concat(leb128Encode(0)); // table index 0
        elemPayload.push(0x41); // i32.const
        elemPayload = elemPayload.concat(leb128EncodeSigned(0)); // offset 0
        elemPayload.push(0x0B); // end
        elemPayload = elemPayload.concat(leb128Encode(closures.length));
        closures.forEach(function(c) { elemPayload = elemPayload.concat(leb128Encode(c.funcIndex)); });
        bytes.push(0x09);
        bytes = bytes.concat(leb128Encode(elemPayload.length));
        bytes = bytes.concat(elemPayload);
      }

      // ─── Code Section ──────────────────────────────────────────
      // Bodies must be emitted in EXACTLY the same order the Type/Function
      // sections above declared them in (per unit: constructor, then each
      // export; closures last) -- that parallel ordering is what ties a
      // code entry back to its own type/function index.
      var allBodies = [];
      units.forEach(function(u) {
        if (u.constructorInfo) {
          var constructorBody = self.buildConstructorBody(u.constructorInfo, u.propertyMap);
          allBodies.push(constructorBody);
          logDebug('Constructor body (' + (u.className || 'default') + ')', constructorBody.length + ' bytes');
        }
        u.exportInfos.forEach(function(info) {
          var bodyBytes = self.buildFunctionBody(info, u.propertyMap);
          allBodies.push(bodyBytes);
          logDebug('Method body: ' + u.prefix + info.method.name, bodyBytes.length + ' bytes');
        });
      });
      closures.forEach(function(c) {
        var owningUnit = units.filter(function(u) { return u.propertyMap.closures && u.propertyMap.closures[c.key] === c; })[0];
        var closureBody = self.buildClosureBody(c, owningUnit.propertyMap);
        allBodies.push(closureBody);
        logDebug('Closure body: this.' + c.key, closureBody.length + ' bytes');
      });
      allGenInfos.forEach(function(entry) {
        var nextBody = self.buildGeneratorFunctionBody(entry.gen, entry.unit.propertyMap);
        var doneBody = self.buildGeneratorDoneBody(entry.gen, entry.unit.propertyMap);
        allBodies.push(nextBody);
        allBodies.push(doneBody);
        logDebug('Generator: ' + entry.unit.prefix + entry.gen.method.name, nextBody.length + '+' + doneBody.length + ' bytes');
      });

      var codePayload = [];
      codePayload = codePayload.concat(leb128Encode(totalFunctions));

      for (var ci = 0; ci < allBodies.length; ci++) {
        var body = allBodies[ci];
        codePayload = codePayload.concat(leb128Encode(body.length));
        codePayload = codePayload.concat(body);
      }

      bytes.push(0x0A);
      bytes = bytes.concat(leb128Encode(codePayload.length));
      bytes = bytes.concat(codePayload);

      logDebug('WASM complete', bytes.length + ' bytes total');
      return new Uint8Array(bytes);
    },

    buildLocalMap: function(params) {
      var map = {};
      var filtered = (params || []).filter(function(p) {
        return p !== 'this' && p !== 'self';
      });
      for (var i = 0; i < filtered.length; i++) {
        map[filtered[i]] = i + 1; // local 0 is $this
      }
      return map;
    },

    // constructor.body/method.body (from JavaScriptMixin's block extraction)
    // include the "name(params) {" header and outer braces, not just the
    // interior statements. The old line-based parser tolerated that (the
    // header just failed to match any pattern and was silently skipped);
    // the brace/paren-aware parser needs the real interior, because a
    // single-line body (no newline separating the header from the first
    // statement — common with ASI, or several statements on one line)
    // otherwise gets globbed together with the header into one
    // unrecognizable blob and silently dropped.
    stripBraceInterior: function(text) {
      var open = text.indexOf('{');
      var close = text.lastIndexOf('}');
      if (open === -1 || close === -1 || close <= open) return text;
      return text.slice(open + 1, close);
    },

    // Real destructuring (`const { a, b } = this.obj;`) needs each named
    // binding to be a genuine new local -- allocated here, once, before
    // the locals section is emitted, so every reference to that name
    // later in the SAME statement list resolves through the ordinary
    // bare-identifier lookup every param already uses. v1 scope: only
    // top-level statements are scanned (not inside if/while bodies),
    // same bound as the single shared scratchLocal.
    // Returns [{name, type}] in allocation order, and mutates localMap in
    // place (name -> its new local index) plus localMap.__types (name ->
    // 'f64' for any binding whose field is f64 -- ordinary params are
    // always i64 by this compiler's own convention, but a destructured
    // binding's real type comes from its field's own inferred type,
    // which compileAtomToWasm's bare-identifier read needs to know
    // instead of always assuming i64).
    allocateDestructuredLocals: function(statements, localMap, scratchLocal, propertyMap) {
      var nextLocal = scratchLocal + 1 + STR_SCRATCH_COUNT;
      var entries = [];
      (statements || []).forEach(function(stmt) {
        if (stmt.type !== 'destructure') return;
        var shape = propertyMap.objectShapes && propertyMap.objectShapes[stmt.sourceKey];
        stmt.names.forEach(function(name) {
          if (Object.prototype.hasOwnProperty.call(localMap, name)) return;
          var type = (shape && shape.fieldTypes[name] === 'f64') ? 'f64' : 'i64';
          localMap[name] = nextLocal;
          nextLocal++;
          if (type === 'f64') {
            localMap.__types = localMap.__types || {};
            localMap.__types[name] = 'f64';
          }
          entries.push({ name: name, type: type });
        });
      });
      return entries;
    },

    // Real local variable declarations (`let x = 5;`) for an ORDINARY
    // (non-generator) method -- each gets its own genuine WASM local,
    // type inferred from a one-time probe compile of its own declared
    // value (mirrors how a closure's return type is inferred). Unlike
    // destructuring, this recurses into if/while bodies too (a loop
    // counter declared with `let` inside a while loop is exactly the
    // common case), since nothing here needs a single shared scratch
    // slot the way array/object construction does.
    allocateLocalDeclLocals: function(statements, localMap, startLocal, propertyMap) {
      var self = this;
      var nextLocal = startLocal;
      var entries = [];
      function walk(stmts) {
        (stmts || []).forEach(function(stmt) {
          if (stmt.type === 'localDecl') {
            if (Object.prototype.hasOwnProperty.call(localMap, stmt.name)) return;
            var probe = self.compileExpressionToWasm(stmt.value, propertyMap, localMap);
            localMap[stmt.name] = nextLocal;
            nextLocal++;
            if (probe.type === 'f64') {
              localMap.__types = localMap.__types || {};
              localMap.__types[stmt.name] = 'f64';
            }
            entries.push({ name: stmt.name, type: probe.type });
          } else if (stmt.type === 'if') {
            walk(stmt.then);
            if (stmt.else) walk(stmt.else);
          } else if (stmt.type === 'while') {
            walk(stmt.body);
          }
        });
      }
      walk(statements);
      return entries;
    },

    // Locals section: the shared i32 scratch local, then one (count=1)
    // group per destructured binding -- each in its OWN declared type,
    // since WASM's local.set validates against the local's DECLARED
    // type, and a blanket i64 declaration would reject an f64 field's
    // real value the moment it tried to store there.
    buildLocalsPayload: function(destructuredEntries) {
      var bytes = [];
      // 1 (construction scratch) + STR_SCRATCH_COUNT (string op
      // temporaries) i32 locals, then one (count=1) group per
      // destructured/localDecl binding in its own declared type.
      bytes = bytes.concat(leb128Encode(1 + STR_SCRATCH_COUNT + destructuredEntries.length));
      for (var si = 0; si <= STR_SCRATCH_COUNT; si++) {
        bytes = bytes.concat(leb128Encode(1));
        bytes.push(0x7F);
      }
      destructuredEntries.forEach(function(e) {
        bytes = bytes.concat(leb128Encode(1));
        bytes.push(e.type === 'f64' ? 0x7C : 0x7E);
      });
      return bytes;
    },

    buildConstructorBody: function(info, propertyMap) {
      var bytes = [];
      // One scratch i32 local (index = last param index + 1), used by
      // compileArrayInitToWasm/compileObjectInitToWasm to hold a newly-
      // allocated array/object's base pointer across its multiple per-
      // field stores. Harmless to declare even when unused. Any
      // destructured bindings get their own locals right after it --
      // both already assigned in buildClassUnit, before this same
      // constructor's own statements were compiled for the first time
      // (e.g. discoverClosures' own compileExpressionToWasm probe).
      var scratchLocal = info.scratchLocal;
      this.setExprScratch(scratchLocal); // see compileArrayLiteralExprToWasm / compileStringConcatToWasm
      var destructuredEntries = (info.destructuredEntries || []).concat(info.localDeclEntries || []);
      bytes = bytes.concat(this.buildLocalsPayload(destructuredEntries));

      // Previously only handled top-level 'assign'/'arrayInit' statements
      // directly, silently dropping anything else (if/while, ...) with no
      // warning at all -- a constructor with a branch (needed for a
      // nullable property's initializer, e.g.) would just compile as if
      // the branch were never there. compileStatementListToWasm already
      // handles every statement type correctly (and recurses into if/while
      // bodies), so reuse it here instead of this file's own ad hoc loop.
      bytes = bytes.concat(this.compileStatementListToWasm(
        info.statements, propertyMap, info.localMap, null, scratchLocal));

      bytes.push(0x0B);
      return bytes;
    },

    buildFunctionBody: function(info, propertyMap) {
      var bytes = [];
      var scratchLocal = info.scratchLocal;
      this.setExprScratch(scratchLocal); // see compileArrayLiteralExprToWasm / compileStringConcatToWasm
      var destructuredEntries = (info.destructuredEntries || []).concat(info.localDeclEntries || []);
      bytes = bytes.concat(this.buildLocalsPayload(destructuredEntries));

      bytes = bytes.concat(this.compileStatementListToWasm(
        info.statements, propertyMap, info.localMap, info.returnType, scratchLocal));

      bytes.push(0x0B);
      return bytes;
    },

    // A closure's body is always exactly ONE expression (arrow functions
    // have no statement list) -- compile it, convert to the closure's own
    // inferred return type, and return it. No scratch local: v1 closures
    // don't construct arrays of their own.
    buildClosureBody: function(closure, propertyMap) {
      var bytes = [];
      bytes = bytes.concat(leb128Encode(0)); // no extra locals
      var localMap = this.buildLocalMap(closure.ownParams);
      var result = this.compileExpressionToWasm(closure.exprText, propertyMap, localMap);
      // A void closure body (its one expression is itself a call to a
      // void sibling method) leaves nothing on the stack -- converting
      // "nothing" to a type would be meaningless, and the function's own
      // declared 0-result type (see the Type Section closure loop above)
      // needs exactly that: nothing pending when `return` runs.
      if (closure.returnType !== null) {
        bytes = bytes.concat(this.convertType(result.bytes, result.type, closure.returnType));
      } else {
        bytes = bytes.concat(result.bytes);
      }
      bytes.push(0x0F); // return
      bytes.push(0x0B); // end
      return bytes;
    },

    compileAssignmentToWasm: function(stmt, propertyMap, localMap) {
      if (propertyMap.nullable && propertyMap.nullable[stmt.key]) {
        return this.compileNullableAssignmentToWasm(stmt, propertyMap, localMap);
      }

      var bytes = [];
      var offset = propertyMap.offsets[stmt.key] || 0;
      var propType = propertyMap.types[stmt.key] || 'i64';
      var value = this.compileExpressionToWasm(stmt.value, propertyMap, localMap);
      var converted = this.convertType(value.bytes, value.type, propType);

      bytes.push(0x20);
      bytes = bytes.concat(leb128Encode(0));
      bytes.push(0x41);
      bytes = bytes.concat(leb128EncodeSigned(offset));
      bytes.push(0x6A);
      bytes = bytes.concat(converted);
      bytes.push(propType === 'f64' ? 0x39 : 0x37); // f64.store / i64.store
      bytes.push(0x03); // align: 8 bytes (both i64 and f64 are 8-byte slots)
      bytes.push(0x00);

      return bytes;
    },

    // A nullable property's 16-byte slot is [presence tag: i64 (0=null,
    // 1=present)][payload: i64|f64]. `this.x = null;` stores tag 0 and
    // leaves the payload untouched (never read back except through ??,
    // which checks the tag first); any other value stores tag 1 and the
    // real converted payload.
    compileNullableAssignmentToWasm: function(stmt, propertyMap, localMap) {
      var offset = propertyMap.offsets[stmt.key] || 0;
      var payloadType = propertyMap.types[stmt.key] || 'i64';
      var isNullLiteral = /^(null|undefined)$/.test(stmt.value.trim());
      var bytes = [];

      bytes.push(0x20);
      bytes = bytes.concat(leb128Encode(0));
      bytes.push(0x41);
      bytes = bytes.concat(leb128EncodeSigned(offset));
      bytes.push(0x6A);
      bytes.push(0x42);
      bytes = bytes.concat(leb128EncodeSignedBig(isNullLiteral ? 0n : 1n));
      bytes.push(0x37, 0x03, 0x00); // i64.store (tag)

      if (!isNullLiteral) {
        var value = this.compileExpressionToWasm(stmt.value, propertyMap, localMap);
        var converted = this.convertType(value.bytes, value.type, payloadType);
        bytes.push(0x20);
        bytes = bytes.concat(leb128Encode(0));
        bytes.push(0x41);
        bytes = bytes.concat(leb128EncodeSigned(offset + 8));
        bytes.push(0x6A);
        bytes = bytes.concat(converted);
        bytes.push(payloadType === 'f64' ? 0x39 : 0x37, 0x03, 0x00);
      }

      return bytes;
    },

    // True if this statement list, once it finishes executing, has always
    // left the enclosing function via `return` (directly, or through every
    // branch of a trailing if/else that itself always returns).
    alwaysReturns: function(stmts) {
      if (!stmts || stmts.length === 0) return false;
      var last = stmts[stmts.length - 1];
      if (last.type === 'return') return true;
      if (last.type === 'if' && last.else) {
        return this.alwaysReturns(last.then) && this.alwaysReturns(last.else);
      }
      return false;
    },

    compileStatementToWasm: function(stmt, propertyMap, localMap, isTail, targetReturnType, scratchLocal) {
      var bytes = [];

      switch (stmt.type) {
        case 'return': {
          var value = this.compileExpressionToWasm(stmt.value, propertyMap, localMap);
          bytes = bytes.concat(this.convertType(value.bytes, value.type, targetReturnType || value.type));
          bytes.push(0x0F);
          break;
        }
        case 'assign': {
          bytes = bytes.concat(this.compileAssignmentToWasm(stmt, propertyMap, localMap));
          break;
        }
        case 'if': {
          // A void-typed if/else, at the tail of a value-returning function,
          // still needs to satisfy that function's own trailing type check
          // once control falls out of the if/else block. Both branches
          // ending in `return` makes them individually unreachable-safe
          // (any stack shape validates after an unconditional return), but
          // the if/else's OWN `end` still resets to "reachable" with
          // whatever the block's declared type promises — void promises
          // nothing, so the enclosing function's fallthrough check then
          // sees 0 values where its result type expects 1. Giving the
          // block the function's own result type instead (only safe when
          // it's in tail position with nothing to conflict with afterward,
          // and both branches are guaranteed to return) fixes that without
          // touching non-terminal ifs, which must stay void.
          var terminal = !!isTail && !!stmt.else &&
            this.alwaysReturns(stmt.then) && this.alwaysReturns(stmt.else);
          var condResult = this.compileExpressionToWasm(stmt.cond, propertyMap, localMap);
          bytes = bytes.concat(this.toBoolean(condResult));
          bytes.push(0x04, terminal ? this.valueTypeByte(targetReturnType || 'i64') : 0x40); // if (<result> | void)
          bytes = bytes.concat(this.compileStatementListToWasm(stmt.then, propertyMap, localMap, targetReturnType, scratchLocal));
          if (stmt.else) {
            bytes.push(0x05); // else
            bytes = bytes.concat(this.compileStatementListToWasm(stmt.else, propertyMap, localMap, targetReturnType, scratchLocal));
          }
          bytes.push(0x0B); // end
          break;
        }
        case 'while': {
          var condResult2 = this.compileExpressionToWasm(stmt.cond, propertyMap, localMap);
          var condBytes = this.toBoolean(condResult2);
          bytes.push(0x02, 0x40); // block (void)
          bytes.push(0x03, 0x40); //   loop (void)
          bytes = bytes.concat(condBytes);
          bytes.push(0x45);       //   i32.eqz
          bytes.push(0x0D, 0x01); //   br_if 1  (condition false -> exit block)
          bytes = bytes.concat(this.compileStatementListToWasm(stmt.body, propertyMap, localMap, targetReturnType, scratchLocal));
          bytes.push(0x0C, 0x00); //   br 0     (loop again)
          bytes.push(0x0B);       //   end loop
          bytes.push(0x0B);       // end block
          break;
        }
        case 'call': {
          if (!KNOWN_IMPORTS[stmt.callee]) return null;
          var callResult = this.compileImportCallToWasm(stmt.callee, stmt.args, propertyMap, localMap);
          bytes = bytes.concat(callResult.bytes);
          // A bare statement call to an import that DOES return something
          // (setTimeout/setInterval's real timer id) still has to balance
          // the stack -- same drop exprStatement already needs for a
          // discarded closure/sibling-method call result.
          if (callResult.type !== null) bytes.push(0x1A); // drop
          break;
        }
        case 'exprStatement': {
          // A Math intrinsic (or any expression) evaluated purely for a
          // side effect and its result discarded — WASM requires the
          // stack be balanced at every statement boundary, so the value
          // has to be explicitly dropped, not just left uncomsumed.
          // Exception: a call to a genuinely VOID method/closure (no
          // `return` anywhere in its body) leaves nothing on the stack
          // at all -- dropping would then fail validation ("not enough
          // arguments on the stack for drop"), same as any other 0-value
          // call.
          var exprResult = this.compileExpressionToWasm(stmt.value, propertyMap, localMap);
          bytes = bytes.concat(exprResult.bytes);
          if (exprResult.type !== null) bytes.push(0x1A); // drop
          break;
        }
        case 'arrayInit': {
          bytes = bytes.concat(this.compileArrayInitToWasm(stmt, propertyMap, localMap, scratchLocal));
          break;
        }
        case 'arrayIndexSet': {
          bytes = bytes.concat(this.compileArrayIndexSetToWasm(stmt, propertyMap, localMap));
          break;
        }
        case 'arrayPush': {
          bytes = bytes.concat(this.compileArrayPushToWasm(stmt, propertyMap, localMap));
          break;
        }
        case 'dynamicCall': {
          bytes = bytes.concat(this.compileDynamicArrayCallToWasm(stmt, propertyMap, localMap));
          break;
        }
        case 'objectInit': {
          bytes = bytes.concat(this.compileObjectInitToWasm(stmt, propertyMap, localMap, scratchLocal));
          break;
        }
        case 'stringInit': {
          bytes = bytes.concat(this.compileStringInitToWasm(stmt, propertyMap, localMap, scratchLocal));
          break;
        }
        case 'destructure': {
          bytes = bytes.concat(this.compileDestructureToWasm(stmt, propertyMap, localMap));
          break;
        }
        case 'localDecl':
        case 'localAssign': {
          bytes = bytes.concat(this.compileLocalAssignToWasm(stmt, propertyMap, localMap));
          break;
        }
        case 'yield': {
          throw new Error('RegX: yield is only valid inside a generator method (*name() { ... }): ' + stmt.value);
        }
        case 'arrowInit': {
          // Stores the closure's final table index (assigned module-wide
          // in buildWasmBinary, before this real codegen pass runs) into
          // the property's own slot -- the captured values themselves
          // were already stored by the ordinary 'assign' statements
          // discoverClosures spliced in right before this one.
          var closureInfo = propertyMap.closures && propertyMap.closures[stmt.key];
          if (!closureInfo || closureInfo.tableIndex === null) {
            throw new Error('RegX: internal error -- closure for this.' + stmt.key + ' has no table index at codegen time');
          }
          var arrowOffset = propertyMap.offsets[stmt.key] || 0;
          bytes.push(0x20);
          bytes = bytes.concat(leb128Encode(0));
          bytes.push(0x41);
          bytes = bytes.concat(leb128EncodeSigned(arrowOffset));
          bytes.push(0x6A);
          bytes.push(0x42);
          bytes = bytes.concat(leb128EncodeSignedBig(BigInt(closureInfo.tableIndex)));
          bytes.push(0x37, 0x03, 0x00); // i64.store
          break;
        }
        default:
          return null;
      }

      return bytes;
    },

    compileStatementListToWasm: function(stmts, propertyMap, localMap, targetReturnType, scratchLocal) {
      var bytes = [];
      var list = stmts || [];
      for (var i = 0; i < list.length; i++) {
        var isTail = (i === list.length - 1);
        var compiled = this.compileStatementToWasm(list[i], propertyMap, localMap, isTail, targetReturnType, scratchLocal);
        if (compiled) {
          bytes = bytes.concat(compiled);
        }
      }
      return bytes;
    },

    // Every emission site below returns {bytes, type}, type one of
    // 'i32' (addresses and booleans — WASM has no other boolean, and every
    // comparison produces one regardless of its operands' type), 'i64'
    // (RegX's default numeric type — exact, native CPU/WASM speed, no
    // representability gap for anything this compiler produces), or 'f64'
    // (only when a literal's own text is unmistakably fractional, is NaN,
    // or the expression combines with something that already is f64).
    // Array/object/string/function "types" are all real WASM i64 under
    // the hood (a heap pointer or table index, see compileAtomToWasm's
    // own bare-read comment) -- normalized here so anything downstream
    // that only knows real WASM value types (widening, the type
    // section's own result byte, numeric conversion) treats a handle
    // exactly like the i64 it physically is, without every call site
    // needing its own copy of this list.
    widenType: function(a, b) {
      if (HANDLE_TYPES[a]) a = 'i64';
      if (HANDLE_TYPES[b]) b = 'i64';
      if (a === 'f64' || b === 'f64') return 'f64';
      if (a === 'i64' || b === 'i64') return 'i64';
      return 'i32';
    },

    valueTypeByte: function(type) {
      if (HANDLE_TYPES[type]) type = 'i64';
      return { i32: 0x7F, i64: 0x7E, f64: 0x7C }[type];
    },

    // Inserts the WASM numeric conversion opcode needed to turn a value
    // already on the stack from `fromType` into `toType`. No-op if they
    // already match. i64->i32/f64->i32/f64->i64 narrow (and can lose
    // precision or truncate) but are only ever reached here when a
    // function's own inferred result type is narrower than one of its
    // return branches, or a mixed-type expression needs one common type.
    convertType: function(bytes, fromType, toType) {
      if (HANDLE_TYPES[fromType]) fromType = 'i64';
      if (HANDLE_TYPES[toType]) toType = 'i64';
      if (fromType === toType) return bytes;
      var CONVERT = {
        'i32->i64': 0xAC, // i64.extend_i32_s
        'i32->f64': 0xB7, // f64.convert_i32_s
        'i64->f64': 0xB9, // f64.convert_i64_s
        'i64->i32': 0xA7, // i32.wrap_i64
        'f64->i64': 0xB0, // i64.trunc_f64_s
        'f64->i32': 0xAA  // i32.trunc_f64_s (0xA8 is i32.trunc_f32_s -- wrong source type)
      };
      var op = CONVERT[fromType + '->' + toType];
      if (op === undefined) {
        throw new Error('RegX: no conversion from ' + fromType + ' to ' + toType);
      }
      return bytes.concat([op]);
    },

    // if/br_if/while's condition always needs a real i32 boolean. A
    // comparison already produces one; a bare i64/f64 value used directly
    // as a condition (e.g. `if (this.flag) {...}`) is compared against 0.
    toBoolean: function(result) {
      if (result.type === 'i32') return result.bytes;
      if (result.type === 'f64') {
        return result.bytes.concat(this.f64ConstBytes(0), [0x62]); // f64.ne
      }
      return result.bytes.concat([0x42, 0x00], [0x52]); // i64.const 0; i64.ne
    },

    // f64.const's operand is 8 raw little-endian IEEE-754 bytes, not
    // LEB128 — this is what makes NaN (and any true fractional value)
    // representable at all, unlike the old i32-only encoder.
    f64ConstBytes: function(num) {
      var buf = new ArrayBuffer(8);
      new DataView(buf).setFloat64(0, num, true);
      return [0x44].concat(Array.from(new Uint8Array(buf)));
    },

    // A function's declared WASM result type has to be decided before its
    // body bytes are emitted (the type section comes first). Walk every
    // `return` reachable through the statement tree (recursing into
    // if/else and while bodies) and widen across all of them — mirrors
    // exactly what compileExpressionToWasm will decide for each return
    // expression during real codegen, so the two can't drift apart.
    inferReturnType: function(stmts, propertyMap, localMap) {
      var resultType = null;
      var self = this;
      function widenOrSet(t) {
        resultType = (resultType === null) ? t : self.widenType(resultType, t);
      }
      function walk(list) {
        (list || []).forEach(function(s) {
          if (s.type === 'return') {
            widenOrSet(self.compileExpressionToWasm(s.value, propertyMap, localMap).type);
          } else if (s.type === 'if') {
            walk(s.then);
            if (s.else) walk(s.else);
          } else if (s.type === 'while') {
            walk(s.body);
          }
        });
      }
      walk(stmts);
      // null (not a default of 'i64') when no `return` exists anywhere in
      // the body — a genuinely void method (make(), set(), ...) has no
      // value to leave on the stack at all, and WASM validates that
      // exactly: declaring a fake result type it never produces fails
      // validation ("expected 1 elements for fallthru, found 0").
      return resultType;
    },

    compileExpressionToWasm: function(expr, propertyMap, localMap) {
      expr = expr.trim();

      // typeof is real now that RegX has real string values to answer
      // with -- and, unlike real JS's fully dynamic typeof, this
      // compiler can answer it EXACTLY at compile time: every property
      // and expression here has ONE fixed, statically-inferred type for
      // its entire lifetime (that's the whole premise this compiler is
      // built on), so "what would typeof report" is already fully known
      // before any code runs, not a runtime tag lookup. Compiles the
      // inner expression purely to learn its .type (bytes discarded,
      // same probe-and-discard pattern inferReturnType already uses),
      // then emits the matching JS-real answer as a genuine string
      // literal, resolved once at compile time -- not folded from
      // nothing, and not a rejection either.
      var typeofMatch = /^typeof\s+(.+)$/.exec(expr);
      if (typeofMatch) {
        var typeofOperandText = typeofMatch[1].trim();
        var TYPEOF_NAMES = { i32: 'boolean', i64: 'number', f64: 'number', string: 'string', array: 'object', object: 'object', 'function': 'function' };
        // A bare `this.KEY` needs its DECLARED type looked up directly --
        // compiling it would flatten array/object/string/function to
        // plain i64 (their real physical representation, the same
        // normalization every OTHER bare-read call site relies on), which
        // would make typeof lose exactly the distinction it exists to
        // report.
        var typeofPropMatch = /^this\.(\w+)$/.exec(typeofOperandText);
        var typeofRealType;
        if (typeofPropMatch && propertyMap.types && propertyMap.types[typeofPropMatch[1]]) {
          typeofRealType = propertyMap.types[typeofPropMatch[1]];
        } else {
          typeofRealType = this.compileExpressionToWasm(typeofOperandText, propertyMap, localMap).type;
        }
        var typeofName = TYPEOF_NAMES[typeofRealType] || 'object';
        return this.compileStringLiteralExprToWasm(typeofName, propertyMap, localMap);
      }

      // Optional chaining (?.) and nullish coalescing (??) both contain a
      // literal '?', which the ternary check below would otherwise catch
      // first and misreport as "malformed ternary expression" — checked
      // here, ahead of it, either way.
      //
      // ?. still has no representation, but for a DIFFERENT reason than
      // "no null value exists" now that nullable properties are real:
      // `this.x?.y` needs `this.x` itself to be an object reference whose
      // OWN property `y` can then be read — and this compiler has no
      // object-reference model at all (a class compiles to one fixed set
      // of property offsets into one instance's memory, not a pointer you
      // can dot into a second level), independent of whether `this.x`
      // could be null. So ?. stays a loud rejection either way.
      if (/\?\./.test(expr)) {
        throw new Error('RegX: optional chaining (?.) is not supported (no object-reference model exists in this compiler -- this.x itself can be nullable, but there is no way to dot a further property off of it): ' + expr);
      }

      // Nullish coalescing: real, when the left side is a nullable
      // property (`this.x ?? default`) -- checks the property's own
      // presence tag at runtime and picks the payload or the default
      // accordingly. When the left side ISN'T a nullable property (a
      // plain property, a param, a literal), it can never be null in this
      // compiler's model at all, so ?? is a genuine no-op: real JS
      // semantics say to just return the left value untouched.
      var nullishIdx = expr.indexOf('??');
      if (nullishIdx !== -1) {
        var nLeft = expr.slice(0, nullishIdx).trim();
        var nRight = expr.slice(nullishIdx + 2).trim();
        var nMatch = nLeft.match(/^this\.(\w+)$/);
        if (nMatch && propertyMap.nullable && propertyMap.nullable[nMatch[1]]) {
          var nKey = nMatch[1];
          var nOffset = propertyMap.offsets[nKey];
          var payloadType = propertyMap.types[nKey];
          var rightResult = this.compileExpressionToWasm(nRight, propertyMap, localMap);
          var resultType = this.widenType(payloadType, rightResult.type);

          var tagLoad = [0x20].concat(leb128Encode(0), [0x41], leb128EncodeSigned(nOffset), [0x6A, 0x29, 0x03, 0x00]);
          var nBytes = tagLoad.concat([0x50]); // i64.eqz -> i32 (true when tag==0, i.e. null)
          nBytes.push(0x04, this.valueTypeByte(resultType)); // if (result <resultType>)
          nBytes = nBytes.concat(this.convertType(rightResult.bytes, rightResult.type, resultType)); // tag==0 (null): use the default
          nBytes.push(0x05); // else
          var payloadLoad = [0x20].concat(leb128Encode(0), [0x41], leb128EncodeSigned(nOffset + 8), [0x6A], [payloadType === 'f64' ? 0x2B : 0x29, 0x03, 0x00]);
          nBytes = nBytes.concat(this.convertType(payloadLoad, payloadType, resultType)); // present: use the payload
          nBytes.push(0x0B); // end
          return { bytes: nBytes, type: resultType };
        }
        return this.compileExpressionToWasm(nLeft, propertyMap, localMap);
      }

      // Arrays and calls have no representation anywhere they might
      // appear in an expression, not just when they ARE the whole
      // expression — checked here, before the arithmetic pipeline's
      // paren-reduction can misinterpret a call's argument parens as
      // ordinary grouping. Left unchecked, `Math.floor(this.x) + 1`
      // would have ParenRule eat "(this.x)" as a grouped sub-expression
      // first, leaving "Math.floor✦0✦" behind as inert leftover text
      // that silently falls through to the zero fallback with no error.
      // A bare array literal as a general expression (`return [1,2,3];`,
      // a function argument, a ternary branch) -- real, not just as a
      // direct property assignment RHS: allocates on the same shared
      // heap and produces its pointer as an ordinary i64 value, exactly
      // what an array-typed property already surfaces as when read bare
      // (this.arr, not indexed) -- consistent with the rest of this
      // compiler's "arrays are pointers" model, not a new kind of value.
      // Needs a scratch i32 local to build into, same as a property
      // array literal -- every method body already reserves one
      // (this._exprScratchLocal, set once at the top of whichever
      // buildXBody function is compiling THIS statement list).
      // `this.arr[i]` reads — whether they're the WHOLE expression or
      // embedded in a larger one (`this.arr[i] + 1`) — are resolved by
      // ArrayReadRule inside the arithmetic pipeline below; any OTHER
      // bracket usage (a bare `arr[i]`, or indexing something that isn't
      // a `this.` property) has no representation and is caught by a
      // safety check at the end of compileArithmeticToWasm, once
      // ArrayReadRule has resolved every legitimate use — never silently
      // falls through to the zero fallback.
      if (/^\[[\s\S]*\]$/.test(expr.trim())) {
        return this.compileArrayLiteralExprToWasm(expr.trim(), propertyMap, localMap);
      }

      // Object.keys(this.OBJ) — real, compile-time-resolvable property
      // enumeration (see compileObjectKeysToWasm), checked here for the
      // same reason the array-literal check just above is: it's call-
      // shaped, so it must resolve before the generic call-rejection
      // logic below ever sees it. Two forms: indexed directly
      // (Object.keys(this.obj)[0], usable without ever naming an array
      // property at all) and bare (the whole array value itself, for
      // assignment/return/argument use) — checked indexed-first since
      // the bare pattern's own trailing `$` would never match the
      // indexed form's extra `[...]` suffix anyway, but ordering them
      // this way keeps the more specific pattern from ever being masked.
      var objectKeysIndexMatch = /^Object\.keys\(([\s\S]+)\)\s*\[([\s\S]+)\]$/.exec(expr.trim());
      if (objectKeysIndexMatch) {
        var okArrResult = this.compileObjectKeysToWasm(objectKeysIndexMatch[1], propertyMap, localMap);
        var okIdxLocal = this._exprStrLocals && this._exprStrLocals[1];
        if (okIdxLocal === undefined) {
          throw new Error('RegX: internal error -- no scratch local available to index an Object.keys() result here');
        }
        // okIdxLocal = wrap_i64(the freshly built array's own pointer)
        var okBytes = okArrResult.bytes.concat([0xA7, 0x21], leb128Encode(okIdxLocal));
        var okIndexResult = this.compileExpressionToWasm(objectKeysIndexMatch[2].trim(), propertyMap, localMap);
        var okIndexI32 = this.convertType(okIndexResult.bytes, okIndexResult.type, 'i32');
        // address = okIdxLocal + (index*8 + 8), same layout compileArrayIndexAddress uses
        var okAddrBytes = [0x20].concat(leb128Encode(okIdxLocal)).concat(okIndexI32)
          .concat([0x41, 0x08, 0x6C, 0x41, 0x08, 0x6A, 0x6A]);
        var okLoadBytes = okAddrBytes.concat([0x29, 0x03, 0x00]); // i64.load the stored string pointer
        return { bytes: okBytes.concat(okLoadBytes), type: 'string' };
      }
      var objectKeysMatch = /^Object\.keys\(([\s\S]*)\)$/.exec(expr.trim());
      if (objectKeysMatch) {
        return this.compileObjectKeysToWasm(objectKeysMatch[1], propertyMap, localMap);
      }

      // this.KEY(args) where KEY holds a real closure (an arrow function
      // assigned to that property, see discoverClosures) -- a genuine
      // call_indirect dispatch through the module's function table, not
      // a rejection. v1 scope: the closure call must be the WHOLE
      // expression (`return this.f(2);`), not embedded inside a larger
      // one (`1 + this.f(2)`) -- checked before the generic call-
      // rejection below either way, so a whole-expression closure call
      // never falls into that throw.
      var closureCallMatch = /^this\.(#?\w+)\(([\s\S]*)\)$/.exec(expr.trim());
      if (closureCallMatch && propertyMap.types && propertyMap.types[closureCallMatch[1]] === 'function') {
        var closureArgTexts = closureCallMatch[2].trim() ? splitTopLevelArgs(closureCallMatch[2]) : [];
        return this.compileClosureCallToWasm(closureCallMatch[1], closureArgTexts, propertyMap, localMap);
      }

      // this.method(args) calling ANOTHER method of the same class -- a
      // real, direct call (see compileMethodCallToWasm), not a
      // rejection. Same v1 scope as a closure call: must be the WHOLE
      // expression, not embedded in a larger one.
      if (closureCallMatch && propertyMap.methods && propertyMap.methods[closureCallMatch[1]]) {
        var methodArgTexts = closureCallMatch[2].trim() ? splitTopLevelArgs(closureCallMatch[2]) : [];
        return this.compileMethodCallToWasm(closureCallMatch[1], methodArgTexts, propertyMap, localMap);
      }

      // A known host import (setTimeout, console.log, ...) used as a
      // general expression -- real, not just as a bare statement (this.
      // id = setTimeout(this.f, 1000); needs the returned timer id to be
      // usable). Same whole-expression v1 scope as closure/method calls.
      var importCallMatch = /^([a-zA-Z_][\w.]*)\(([\s\S]*)\)$/.exec(expr.trim());
      if (importCallMatch && KNOWN_IMPORTS[importCallMatch[1]]) {
        var importArgTexts = importCallMatch[2].trim() ? splitTopLevelArgs(importCallMatch[2]) : [];
        return this.compileImportCallToWasm(importCallMatch[1], importArgTexts, propertyMap, localMap);
      }

      var callCheck = /([a-zA-Z_][\w.]*)\(/.exec(expr);
      if (callCheck && !KNOWN_INTRINSICS[callCheck[1]] && !KNOWN_IMPORTS[callCheck[1]]) {
        // this.NAME( -- could still be a real closure or sibling-method
        // call embedded in a larger expression (`this.double() * 2`),
        // which ThisCallRule resolves once the arithmetic pipeline below
        // actually runs; only a genuinely unrecognized call is rejected.
        var thisCallCheck = /^this\.(#?\w+)\(/.exec(expr.trim());
        var isKnownThisCall = thisCallCheck && (
          (propertyMap.types && propertyMap.types[thisCallCheck[1]] === 'function') ||
          (propertyMap.methods && propertyMap.methods[thisCallCheck[1]])
        );
        if (!isKnownThisCall) {
          throw new Error('RegX: function/method calls are not supported (no call machinery exists in this compiler): ' + expr);
        }
      }

      // Ternary: lowest precedence, so split on the top-level ?/: first.
      var qIdx = expr.indexOf('?');
      if (qIdx !== -1) {
        var condPart = expr.slice(0, qIdx).trim();
        var restPart = expr.slice(qIdx + 1);
        var cIdx = restPart.indexOf(':');
        if (cIdx === -1) {
          throw new Error('RegX: malformed ternary expression: ' + expr);
        }
        var thenPart = restPart.slice(0, cIdx).trim();
        var elsePart = restPart.slice(cIdx + 1).trim();
        var condResult = this.compileExpressionToWasm(condPart, propertyMap, localMap);
        var thenResult = this.compileExpressionToWasm(thenPart, propertyMap, localMap);
        var elseResult = this.compileExpressionToWasm(elsePart, propertyMap, localMap);
        var ternaryType = this.widenType(thenResult.type, elseResult.type);
        var tBytes = [];
        tBytes = tBytes.concat(this.toBoolean(condResult));
        tBytes.push(0x04, this.valueTypeByte(ternaryType)); // if (result <ternaryType>)
        tBytes = tBytes.concat(this.convertType(thenResult.bytes, thenResult.type, ternaryType));
        tBytes.push(0x05); // else
        tBytes = tBytes.concat(this.convertType(elseResult.bytes, elseResult.type, ternaryType));
        tBytes.push(0x0B); // end
        return { bytes: tBytes, type: ternaryType };
      }

      // Bitwise XOR: real JS operator precedence puts ^ BELOW comparisons
      // (== binds tighter than ^, so `a ^ b == c` is `a ^ (b == c)`) —
      // and RegX is a JS compiler, so ^ has to mean what it means in JS
      // (bitwise XOR), not exponentiation borrowed from math notation.
      // Redefining a real JS operator to mean something else would be
      // exactly the silent-wrong-answer trap this compiler otherwise
      // rejects loudly elsewhere: `5 ^ 3` is 6 in JS, not 125. XOR is
      // both associative and commutative, so — unlike ** — a simple
      // first-match split with a recursive right-hand side (letting
      // chained a^b^c re-split on the next ^) gives the correct answer
      // regardless of grouping, no RulesEngine needed here. Only defined
      // for integer operands, matching WASM's xor opcodes; an f64
      // operand has no bitwise representation to XOR against, so that's
      // a compile-time error rather than a silent truncation.
      var xorIdx = expr.indexOf('^');
      if (xorIdx !== -1) {
        var xLeft = expr.slice(0, xorIdx).trim();
        var xRight = expr.slice(xorIdx + 1).trim();
        var xLeftResult = this.compileExpressionToWasm(xLeft, propertyMap, localMap);
        var xRightResult = this.compileExpressionToWasm(xRight, propertyMap, localMap);
        if (xLeftResult.type === 'f64' || xRightResult.type === 'f64') {
          throw new Error('RegX: ^ (bitwise XOR) requires integer operands, got f64: ' + expr);
        }
        var xorType = this.widenType(xLeftResult.type, xRightResult.type);
        var xorBytes = [];
        xorBytes = xorBytes.concat(this.convertType(xLeftResult.bytes, xLeftResult.type, xorType));
        xorBytes = xorBytes.concat(this.convertType(xRightResult.bytes, xRightResult.type, xorType));
        xorBytes.push(xorType === 'i64' ? 0x85 : 0x73); // i64.xor / i32.xor
        return { bytes: xorBytes, type: xorType };
      }

      // Comparisons: next-lowest precedence, above ternary, below +/*.
      // Every comparison produces i32 regardless of operand type (WASM has
      // no float/i64 boolean) — but the OPCODE picked, and any conversion
      // needed to bring mismatched operands to one common type first, does
      // depend on the operands' type.
      // '===' / '!==' checked BEFORE '==' / '!=' -- longest token first,
      // otherwise `expr.indexOf('==')` matches the first two '=' of a
      // three-character '===' and only consumes 2 of them (opTok.length),
      // leaving a stray leading '=' in the sliced-off right-hand text
      // that silently miscompiled into a wrong (but not obviously
      // invalid) expression instead of ever comparing anything -- a real
      // bug this session's own string-comparison work surfaced (`a ===
      // a` was silently always false). No dynamic-type distinction
      // between === and == exists here (every operand's type is already
      // static and consistent by construction), so both map to the same
      // opcode table.
      var cmpOps = [
        ['===', { i32: 0x46, i64: 0x51, f64: 0x61 }],
        ['!==', { i32: 0x47, i64: 0x52, f64: 0x62 }],
        ['==', { i32: 0x46, i64: 0x51, f64: 0x61 }],
        ['!=', { i32: 0x47, i64: 0x52, f64: 0x62 }],
        ['<=', { i32: 0x4C, i64: 0x57, f64: 0x65 }],
        ['>=', { i32: 0x4E, i64: 0x59, f64: 0x66 }],
        ['<',  { i32: 0x48, i64: 0x53, f64: 0x63 }],
        ['>',  { i32: 0x4A, i64: 0x55, f64: 0x64 }]
      ];
      for (var c = 0; c < cmpOps.length; c++) {
        var opTok = cmpOps[c][0];
        var opIdx = expr.indexOf(opTok);
        if (opIdx !== -1) {
          var left = expr.slice(0, opIdx).trim();
          var right = expr.slice(opIdx + opTok.length).trim();
          // A DIRECT string operand (a literal, or a bare this.KEY string
          // property) needs resolving before the generic recursive
          // compile, which would otherwise flatten a bare property read
          // to plain i64 (its real physical representation) and lose the
          // 'string' tag entirely -- a composite expression (this.a +
          // this.b) doesn't have this problem, since compileArithmeticTo
          // Wasm's own string handling already carries the tag through.
          var leftResult = this.resolveStringOperand(left, propertyMap, localMap) ||
            this.compileExpressionToWasm(left, propertyMap, localMap);
          var rightResult = this.resolveStringOperand(right, propertyMap, localMap) ||
            this.compileExpressionToWasm(right, propertyMap, localMap);
          if (leftResult.type === 'string' || rightResult.type === 'string') {
            if (opTok !== '==' && opTok !== '===' && opTok !== '!=' && opTok !== '!==') {
              throw new Error('RegX: ' + opTok + ' is not defined for strings (only equality/inequality is supported): ' + expr);
            }
            if (leftResult.type !== 'string' || rightResult.type !== 'string') {
              throw new Error('RegX: cannot compare a string to a non-string (this compiler has no automatic coercion): ' + expr);
            }
            return this.compileStringCompareToWasm(leftResult, rightResult, opTok === '==' || opTok === '===');
          }
          var opType = this.widenType(leftResult.type, rightResult.type);
          var cmpBytes = [];
          cmpBytes = cmpBytes.concat(this.convertType(leftResult.bytes, leftResult.type, opType));
          cmpBytes = cmpBytes.concat(this.convertType(rightResult.bytes, rightResult.type, opType));
          cmpBytes.push(cmpOps[c][1][opType]);
          return { bytes: cmpBytes, type: 'i32' };
        }
      }

      // Everything else (parens, ^, *, +, and the atoms underneath them)
      // goes through the RulesEngine-driven arithmetic pipeline below —
      // real precedence and associativity, not flat string-splitting.
      return this.compileArithmeticToWasm(expr, propertyMap, localMap);
    },

    // Atom-level (leaf) compiler: a single non-operator token — a property
    // read, a boolean/NaN literal, a numeric literal, a bare identifier
    // (param), or a RulesEngine placeholder referencing bytecode already
    // produced by a prior reduction step in compileArithmeticToWasm.
    compileAtomToWasm: function(expr, propertyMap, localMap, placeholders) {
      expr = expr.trim();

      if (placeholders && placeholders.isPlaceholder(expr)) {
        return placeholders.resolve(expr);
      }

      // Boolean literals — real i32 values, WASM's only boolean type.
      if (/^true$/.test(expr)) {
        return { bytes: [0x41, 0x01], type: 'i32' };
      }
      if (/^false$/.test(expr)) {
        return { bytes: [0x41, 0x00], type: 'i32' };
      }

      // NaN is a real, representable f64 value now that f64 exists in
      // this compiler — no longer a rejection.
      if (/^NaN$/.test(expr)) {
        return { bytes: this.f64ConstBytes(NaN), type: 'f64' };
      }

      // A real string literal -- heap-allocated same as an array, see
      // compileStringLiteralExprToWasm. v1 scope: a single-line literal
      // with no embedded quote of the same kind and no `${...}`
      // interpolation (a template literal WITHOUT interpolation is just
      // a string, so backticks are accepted too; WITH interpolation
      // would need real number/value-to-string conversion, which is
      // still genuinely unsupported and stays a specific rejection).
      if (/^["'`].*["'`]$/.test(expr)) {
        var strLitMatch = expr.match(/^["'`]([^"'`]*)["'`]$/);
        if (strLitMatch && expr.indexOf('${') === -1) {
          return this.compileStringLiteralExprToWasm(strLitMatch[1], propertyMap, localMap);
        }
        throw new Error('RegX: this string literal is not supported (template interpolation, or a quote character inside the literal, needs real string-conversion machinery this compiler does not have yet): ' + expr);
      }

      // Arrays have no representation at all — no array type, no dynamic
      // memory allocation model, nothing an array literal or an index
      // read could compile to. Both previously fell through to the
      // generic zero fallback with no warning.
      if (/^\[[\s\S]*\]$/.test(expr)) {
        throw new Error('RegX: array literals are not supported (no array type in this compiler): ' + expr);
      }
      if (/^[\w.]+\[[\s\S]*\]$/.test(expr)) {
        throw new Error('RegX: array indexing is not supported (no array type in this compiler): ' + expr);
      }

      // A call-shaped expression (Math.floor(x), this.arr.push(1)) — no
      // call/host-import machinery exists in this compiler, so this
      // previously fell through to the generic zero fallback silently.
      if (/^[\w.]+\([\s\S]*\)$/.test(expr)) {
        throw new Error('RegX: function/method calls are not supported (no call machinery exists in this compiler): ' + expr);
      }
      if (/^typeof\s+/.test(expr)) {
        throw new Error('RegX: typeof is not supported (no runtime type information exists in compiled output): ' + expr);
      }
      if (/\binstanceof\b/.test(expr)) {
        throw new Error('RegX: instanceof is not supported (no runtime type/class information exists in compiled output): ' + expr);
      }

      // null/undefined have a real representation now (a nullable
      // property's own presence tag), but only there -- as a general
      // expression value on its own (an argument, a comparison operand, a
      // return value) there's nowhere for either to be materialized into.
      // Without this check, "null" would just fall through to the bare-
      // identifier branch below and throw a correct-but-misleadingly-
      // generic "unknown identifier" instead of naming the real reason.
      if (/^(null|undefined)$/.test(expr)) {
        throw new Error('RegX: null/undefined has no representation as a general expression value (only supported as a property assignment, this.x = null;, or on the left of ??, this.x ?? default): ' + expr);
      }

      var thisMatch = expr.match(/^this\.(#?\w+)$/);
      if (thisMatch) {
        var propKey = thisMatch[1];
        if (propertyMap.nullable && propertyMap.nullable[propKey]) {
          throw new Error('RegX: reading nullable property \'' + propKey + '\' directly is not supported (use ?? to provide a default): this.' + propKey);
        }
        var offset = propertyMap.offsets[propKey] || 0;
        var propType = propertyMap.types[propKey] || 'i64';
        var loadBytes = [];
        loadBytes.push(0x20);
        loadBytes = loadBytes.concat(leb128Encode(0));
        loadBytes.push(0x41);
        loadBytes = loadBytes.concat(leb128EncodeSigned(offset));
        loadBytes.push(0x6A);
        loadBytes.push(propType === 'f64' ? 0x2B : 0x29); // f64.load / i64.load
        loadBytes.push(0x03); // align: 8 bytes
        loadBytes.push(0x00);
        // Array, object, string, and function properties all physically
        // store an i64 handle (a heap pointer, a table index) in their
        // slot -- none of those is a real WASM value type, so a bare
        // read (this.arr, this.obj, this.name, this.f -- not indexed,
        // not destructured, not called) surfaces as plain i64, the
        // handle's actual representation.
        var readType = HANDLE_TYPES[propType] ? 'i64' : propType;
        return { bytes: loadBytes, type: readType };
      }

      if (/^\d+\.\d+$/.test(expr)) {
        return { bytes: this.f64ConstBytes(parseFloat(expr)), type: 'f64' };
      }

      if (/^\d+$/.test(expr)) {
        var big = BigInt(expr);
        var I64_MIN = -(2n ** 63n), I64_MAX = (2n ** 63n) - 1n;
        if (big < I64_MIN || big > I64_MAX) {
          // Beyond even i64's range — the only remaining representable
          // form is f64 (lossy above 2^53, but still the honest choice:
          // an i64.const literally cannot hold this value at all).
          return { bytes: this.f64ConstBytes(Number(expr)), type: 'f64' };
        }
        return { bytes: [0x42].concat(leb128EncodeSignedBig(big)), type: 'i64' };
      }

      if (/^[a-zA-Z_]\w*$/.test(expr)) {
        if (!localMap || !Object.prototype.hasOwnProperty.call(localMap, expr)) {
          // Guessing local index 1 here (the old behavior) silently read
          // whatever value happened to sit in the wrong slot instead of
          // failing — exactly the class of bug this compiler otherwise
          // rejects loudly. An identifier that isn't a parameter of the
          // enclosing function has no value to read at all.
          throw new Error('RegX: unknown identifier (not a parameter of this function): ' + expr);
        }
        // Params default to i64; a destructured binding can be f64
        // instead (localMap.__types, set by allocateDestructuredLocals),
        // matching whatever type its own local was actually declared as.
        var identType = (localMap.__types && localMap.__types[expr]) || 'i64';
        return { bytes: [0x20].concat(leb128Encode(localMap[expr])), type: identType };
      }

      return { bytes: [0x42, 0x00], type: 'i64' }; // i64.const 0
    },

    // Parens, ^ (right-associative), *, + (left-associative), driven by
    // RulesEngine instead of flat split-and-fold. RulesEngine runs rules
    // in array order, each to its own fixed point before the next starts
    // — so the rule array below is ordered highest-precedence-first
    // (paren, then ^, then *, then +), matching what needs to resolve
    // first. A pure-literal sub-expression is constant-folded directly in JS
    // (exact, no bytecode needed); anything touching a property, param,
    // or nested paren result compiles real bytecode and is interned as an
    // opaque placeholder token so later passes can't re-match into it.
    compileArithmeticToWasm: function(expr, propertyMap, localMap) {
      var self = this;
      var placeholders = RulesEngine.definePlaceholderTable();
      var ATOM = '(?:this\\.\\w+|[a-zA-Z_]\\w*|\\d+\\.\\d+|\\d+|✦\\d+✦|"[^"]*"|\'[^\']*\')';

      // Resolves TEXT to a real string-typed operand if it names one --
      // a `this.KEY` string-typed property, an already-resolved
      // placeholder whose OWN stored type is 'string', or a raw quoted
      // literal -- else null. Property reads and placeholders already
      // compile to the correct pointer VALUE regardless of which type
      // tag they carry (bare reads normalize array/object/string/
      // function slots to plain i64 for anything ELSE that reads them);
      // this just restores the 'string' tag so AddSubRule/comparisons
      // can tell a real string operand apart from an ordinary number.
      function resolveStringAtom(text) {
        if (placeholders.isPlaceholder(text)) {
          var r = placeholders.resolve(text);
          return r.type === 'string' ? r : null;
        }
        var litMatch = /^["']([^"']*)["']$/.exec(text);
        if (litMatch) {
          var lit = self.compileStringLiteralExprToWasm(litMatch[1], propertyMap, localMap);
          return { bytes: lit.bytes, type: 'string' };
        }
        var propMatch = /^this\.(\w+)$/.exec(text);
        if (propMatch && propertyMap.types && propertyMap.types[propMatch[1]] === 'string') {
          var res = compileOperand(text);
          return { bytes: res.bytes, type: 'string' };
        }
        return null;
      }

      function compileOperand(text) {
        return self.compileAtomToWasm(text, propertyMap, localMap, placeholders);
      }

      function combine(leftText, rightText, opcodeTable) {
        var left = compileOperand(leftText);
        var right = compileOperand(rightText);
        var opType = self.widenType(left.type, right.type);
        var bytes = [];
        bytes = bytes.concat(self.convertType(left.bytes, left.type, opType));
        bytes = bytes.concat(self.convertType(right.bytes, right.type, opType));
        bytes.push(opcodeTable[opType]);
        return { bytes: bytes, type: opType };
      }

      var ADD_OPS = { i32: 0x6A, i64: 0x7C, f64: 0xA0 };
      var SUB_OPS = { i32: 0x6B, i64: 0x7D, f64: 0xA1 };
      var MUL_OPS = { i32: 0x6C, i64: 0x7E, f64: 0xA2 };

      // Math intrinsics resolve BEFORE parens — a call's own argument
      // parens (Math.floor(x)) aren't grouping, and if ParenRule ran
      // first it would eat "(x)" as an ordinary sub-expression, leaving
      // "Math.floor✦0✦" behind as inert leftover text (exactly the bug
      // the top-level compileExpressionToWasm check exists to prevent,
      // but that check only fires when the call is the WHOLE expression
      // — this handles one embedded anywhere, e.g. "1 + Math.floor(x)").
      var IntrinsicRule = {
        ruleId: 'intrinsic',
        match: function(text) {
          var re = /([a-zA-Z_][\w.]*)\(/g;
          var m;
          while ((m = re.exec(text)) !== null) {
            if (KNOWN_INTRINSICS[m[1]]) {
              var openParen = m.index + m[0].length - 1;
              var close;
              try { close = self.findMatchingParen(text, m.index); } catch (e) { continue; }
              return { index: m.index, length: close + 1 - m.index, callee: m[1], argsText: text.slice(openParen + 1, close) };
            }
          }
          return null;
        },
        reduce: function(text, m) {
          var intrinsic = KNOWN_INTRINSICS[m.callee];
          var argTexts = splitTopLevelArgs(m.argsText);
          if (argTexts.length !== intrinsic.arity) {
            throw new Error('RegX: ' + m.callee + ' expects ' + intrinsic.arity + ' argument(s), got ' + argTexts.length + ': ' + m.argsText);
          }
          var bytes = [];
          for (var ai = 0; ai < argTexts.length; ai++) {
            var argResult = self.compileExpressionToWasm(argTexts[ai], propertyMap, localMap);
            bytes = bytes.concat(self.convertType(argResult.bytes, argResult.type, 'f64'));
          }
          bytes.push(intrinsic.opcode);
          var token = placeholders.intern({ bytes: bytes, type: 'f64' });
          return text.slice(0, m.index) + token + text.slice(m.index + m.length);
        }
      };

      // this.NAME(args) embedded inside a larger expression (`1 +
      // this.double()`, `this.helper() * 2`) -- a real closure call or
      // sibling-method call, resolved the same way IntrinsicRule
      // resolves Math.floor(x) embedded in a larger expression: before
      // ParenRule, so the call's own argument parens aren't mistaken for
      // ordinary grouping.
      var ThisCallRule = {
        ruleId: 'this-call',
        match: function(text) {
          var re = /this\.(#?\w+)\(/g;
          var m;
          while ((m = re.exec(text)) !== null) {
            var isClosure = propertyMap.types && propertyMap.types[m[1]] === 'function';
            var isMethod = propertyMap.methods && propertyMap.methods[m[1]];
            if (!isClosure && !isMethod) continue;
            var openParen = m.index + m[0].length - 1;
            var close;
            try { close = self.findMatchingParen(text, m.index); } catch (e) { continue; }
            return { index: m.index, length: close + 1 - m.index, name: m[1], isClosure: isClosure, argsText: text.slice(openParen + 1, close) };
          }
          return null;
        },
        reduce: function(text, m) {
          var argTexts = m.argsText.trim() ? splitTopLevelArgs(m.argsText) : [];
          var result = m.isClosure
            ? self.compileClosureCallToWasm(m.name, argTexts, propertyMap, localMap)
            : self.compileMethodCallToWasm(m.name, argTexts, propertyMap, localMap);
          var token = placeholders.intern(result);
          return text.slice(0, m.index) + token + text.slice(m.index + m.length);
        }
      };

      // Array index reads resolve BEFORE parens too, for the same reason
      // IntrinsicRule does: `this.arr[i]` has its own bracket pair, not a
      // paren, so it doesn't collide with ParenRule directly, but running
      // it first keeps every non-arithmetic leaf resolved into an opaque
      // placeholder up front, consistently.
      var ArrayReadRule = {
        ruleId: 'array-read',
        match: function(text) {
          var re = /this\.(\w+)\[/g;
          var m;
          while ((m = re.exec(text)) !== null) {
            var openBracket = m.index + m[0].length - 1;
            var close;
            try { close = self.findMatchingBracket(text, openBracket); } catch (e) { continue; }
            return { index: m.index, length: close + 1 - m.index, key: m[1], indexText: text.slice(openBracket + 1, close) };
          }
          return null;
        },
        reduce: function(text, m) {
          var result = self.compileArrayIndexRead(m.key, m.indexText, propertyMap, localMap);
          var token = placeholders.intern(result);
          return text.slice(0, m.index) + token + text.slice(m.index + m.length);
        }
      };

      // this.KEY.length -- a real read of the array's own 8-byte length
      // prefix (see compileArrayIndexAddress's own layout comment: array
      // heap storage is [length: i64][elem0]...), not a compile-time
      // guess: two instances of the same class can hold arrays of
      // different real lengths (one grown further via push than another),
      // so this has to be a genuine runtime memory load, same as any
      // other array-typed read. Resolved before ArrayReadRule (whose own
      // `this.(\w+)\[` regex would never match ".length" anyway, but
      // keeping every non-arithmetic leaf resolved up front, in one
      // consistent place, matches how IntrinsicRule/ArrayReadRule are
      // already ordered here).
      var ArrayLengthRule = {
        ruleId: 'array-length',
        match: function(text) {
          var re = /this\.(\w+)\.length\b/;
          var m = re.exec(text);
          if (!m) return null;
          return { index: m.index, length: m[0].length, key: m[1] };
        },
        reduce: function(text, m) {
          if (propertyMap.types[m.key] !== 'array') {
            throw new Error('RegX: this.' + m.key + '.length used on a non-array property: this.' + m.key);
          }
          var offset = propertyMap.offsets[m.key] || 0;
          var bytes = [0x20].concat(leb128Encode(0), [0x41], leb128EncodeSigned(offset),
            [0x6A, 0x29, 0x03, 0x00, 0xA7, 0x29, 0x03, 0x00]); // this.KEY (i64 ptr) -> wrap i32 -> i64.load length
          var token = placeholders.intern({ bytes: bytes, type: 'i64' });
          return text.slice(0, m.index) + token + text.slice(m.index + m.length);
        }
      };

      var ParenRule = {
        ruleId: 'paren',
        match: function(text) { return /\(([^()]+)\)/.exec(text); },
        reduce: function(text, m) {
          var innerResult = self.compileArithmeticToWasm(m[1], propertyMap, localMap);
          var token = placeholders.intern(innerResult);
          return text.slice(0, m.index) + token + text.slice(m.index + m[0].length);
        }
      };

      // Right-associative: resolve the LAST ** first, so 2**3**2 groups as
      // 2**(3**2), not (2**3)**2 — matching real JS's ** exactly (JS
      // reserves ^ for bitwise XOR; ** is JS's actual exponentiation
      // operator, handled at the top level of compileExpressionToWasm
      // instead). The exponent must be a compile-time-known non-negative
      // integer literal — RegX has no way to emit a runtime power loop
      // yet, so a variable/property exponent is a clear compile-time
      // error rather than a silently wrong result.
      var PowRule = {
        ruleId: 'pow',
        match: function(text) {
          return new RegExp('(' + ATOM + ')\\s*\\*\\*\\s*(' + ATOM + ')(?!.*\\*\\*)').exec(text);
        },
        reduce: function(text, m) {
          var baseText = m[1];
          if (!/^\d+$/.test(m[2])) {
            throw new Error('RegX: ** requires a compile-time-constant, non-negative integer exponent, got: ' + m[2]);
          }
          var n = parseInt(m[2], 10);
          var resultText;

          if (/^\d+$/.test(baseText)) {
            resultText = (BigInt(baseText) ** BigInt(n)).toString();
          } else {
            var base = compileOperand(baseText);
            var acc = (n === 0) ? { bytes: [0x42, 0x01], type: 'i64' } : base;
            for (var i = 1; i < n; i++) {
              var opType = self.widenType(acc.type, base.type);
              var bytes = [];
              bytes = bytes.concat(self.convertType(acc.bytes, acc.type, opType));
              bytes = bytes.concat(self.convertType(base.bytes, base.type, opType));
              bytes.push(MUL_OPS[opType]);
              acc = { bytes: bytes, type: opType };
            }
            resultText = placeholders.intern(acc);
          }
          return text.slice(0, m.index) + resultText + text.slice(m.index + m[0].length);
        }
      };

      // Unary minus: real JS negation, applied to any atom (a literal, a
      // property, an identifier, or an already-resolved paren/pow
      // placeholder) — not just a text hack on digit literals, which
      // breaks the moment a negative result needs to combine with
      // anything else downstream (`5 - -3` needs the second `-` read as
      // negation of 3, not as a second binary operator with nothing on
      // its right). Distinguished from binary minus by what's NOT
      // immediately before it (skipping whitespace): a binary `-` always
      // has an atom or closing placeholder right before it; a unary `-`
      // never does. WASM has no i32.neg/i64.neg opcode — integer
      // negation is done as 0 - x; floats use the real f64.neg opcode.
      var UnaryMinusRule = {
        ruleId: 'unary-minus',
        match: function(text) {
          return new RegExp('(?<![\\w✦]\\s*)-\\s*(' + ATOM + ')').exec(text);
        },
        reduce: function(text, m) {
          var operand = compileOperand(m[1]);
          var bytes;
          if (operand.type === 'f64') {
            bytes = operand.bytes.concat([0x9A]); // f64.neg
          } else {
            var zeroBytes = (operand.type === 'i64') ? [0x42, 0x00] : [0x41, 0x00];
            bytes = zeroBytes.concat(operand.bytes).concat([operand.type === 'i64' ? 0x7D : 0x6B]);
          }
          var token = placeholders.intern({ bytes: bytes, type: operand.type });
          return text.slice(0, m.index) + token + text.slice(m.index + m[0].length);
        }
      };

      // * and / share a precedence level and must resolve left-to-right
      // TOGETHER, not as two separate fixed-point passes — 10/2*3 is
      // (10/2)*3=15 in real JS, not 10/(2*3). A single rule matching
      // whichever comes first (regex scans left to right by default)
      // gives the correct interleaved grouping; two separate rules,
      // each run to ITS OWN fixed point before the other starts, would
      // silently group every * before every / (or vice versa) regardless
      // of source order. Division always produces f64, matching real JS
      // (7/2 is 3.5, not 3) — never constant-folded to an integer-looking
      // literal even when both operands are literals, so the result
      // stays reliably f64-typed rather than depending on whether the
      // division happened to come out even.
      var MulDivRule = {
        ruleId: 'muldiv',
        match: function(text) {
          return new RegExp('(' + ATOM + ')\\s*([*/])\\s*(' + ATOM + ')').exec(text);
        },
        reduce: function(text, m) {
          var op = m[2];
          var resultText;
          if (op === '*') {
            resultText = (/^\d+$/.test(m[1]) && /^\d+$/.test(m[3]))
              ? (BigInt(m[1]) * BigInt(m[3])).toString()
              : placeholders.intern(combine(m[1], m[3], MUL_OPS));
          } else {
            var left = compileOperand(m[1]);
            var right = compileOperand(m[3]);
            var bytes = [];
            bytes = bytes.concat(self.convertType(left.bytes, left.type, 'f64'));
            bytes = bytes.concat(self.convertType(right.bytes, right.type, 'f64'));
            bytes.push(0xA3); // f64.div
            resultText = placeholders.intern({ bytes: bytes, type: 'f64' });
          }
          return text.slice(0, m.index) + resultText + text.slice(m.index + m[0].length);
        }
      };

      // + and - share a precedence level, same left-to-right reasoning
      // as * and / above: 10-3+2 is (10-3)+2=9 in real JS, not
      // 10-(3+2)=5. One rule, whichever operator comes first wins.
      var AddSubRule = {
        ruleId: 'addsub',
        match: function(text) {
          return new RegExp('(' + ATOM + ')\\s*([+\\-])\\s*(' + ATOM + ')').exec(text);
        },
        reduce: function(text, m) {
          var op = m[2];
          var resultText;
          var leftStr = resolveStringAtom(m[1]);
          var rightStr = resolveStringAtom(m[3]);
          if (leftStr || rightStr) {
            if (op !== '+') {
              throw new Error('RegX: - is not defined for strings: ' + m[0]);
            }
            if (!leftStr || !rightStr) {
              throw new Error('RegX: + between a string and a non-string has no automatic coercion in this compiler: ' + m[0]);
            }
            resultText = placeholders.intern(self.compileStringConcatToWasm(leftStr, rightStr));
          } else if (/^\d+$/.test(m[1]) && /^\d+$/.test(m[3])) {
            var folded = (op === '+') ? (BigInt(m[1]) + BigInt(m[3])) : (BigInt(m[1]) - BigInt(m[3]));
            resultText = placeholders.intern({ bytes: [0x42].concat(leb128EncodeSignedBig(folded)), type: 'i64' });
          } else {
            resultText = placeholders.intern(combine(m[1], m[3], op === '+' ? ADD_OPS : SUB_OPS));
          }
          return text.slice(0, m.index) + resultText + text.slice(m.index + m[0].length);
        }
      };

      var engine = new RulesEngine([ThisCallRule, ArrayLengthRule, ArrayReadRule, IntrinsicRule, ParenRule, PowRule, UnaryMinusRule, MulDivRule, AddSubRule]);
      var finalText = engine.run(expr.trim(), {}).text.trim();

      // Any bracket still standing after ArrayReadRule has resolved every
      // `this.KEY[...]` occurrence has no representation (a bare `arr[i]`,
      // or indexing something that isn't a `this.` property) — reject it
      // loudly here rather than letting compileAtomToWasm's fallback
      // silently compute i64.const 0 for text it doesn't recognize.
      if (finalText.indexOf('[') !== -1) {
        throw new Error('RegX: array indexing is only supported directly on a `this.` property (this.arr[i]): ' + finalText);
      }

      return this.compileAtomToWasm(finalText, propertyMap, localMap, placeholders);
    },

    // Computes the i32 byte address of element [indexExpr] of array
    // property KEY, leaving that address on the stack. Shared by both
    // compileArrayIndexRead and compileArrayIndexSetToWasm — reading and
    // writing an element differ only in the load/store opcode that
    // follows this address.
    //
    // Layout on the heap: [length: i64 (8 bytes)][elem0][elem1]...,
    // each element slot 8 bytes regardless of i64/f64 — so element i
    // sits at basePtr + 8 + i*8. The property's own slot holds that
    // basePtr widened to i64 (see compileArrayInitToWasm), so reading it
    // back needs i32.wrap_i64 to get a usable memory address.
    compileArrayIndexAddress: function(key, indexExpr, propertyMap, localMap) {
      var offset = propertyMap.offsets[key] || 0;
      var basePtrBytes = [];
      basePtrBytes.push(0x20);
      basePtrBytes = basePtrBytes.concat(leb128Encode(0));
      basePtrBytes.push(0x41);
      basePtrBytes = basePtrBytes.concat(leb128EncodeSigned(offset));
      basePtrBytes.push(0x6A); // i32.add ($this + offset)
      basePtrBytes.push(0x29); // i64.load (the stored, widened heap pointer)
      basePtrBytes.push(0x03, 0x00);
      basePtrBytes.push(0xA7); // i32.wrap_i64 -> real i32 heap pointer

      var indexResult = this.compileExpressionToWasm(indexExpr, propertyMap, localMap);
      var indexI32Bytes = this.convertType(indexResult.bytes, indexResult.type, 'i32');

      var byteOffsetBytes = indexI32Bytes.concat([0x41, 0x08, 0x6C, 0x41, 0x08, 0x6A]); // index*8 + 8

      return basePtrBytes.concat(byteOffsetBytes).concat([0x6A]); // basePtr + (index*8 + 8)
    },

    compileArrayIndexRead: function(key, indexExpr, propertyMap, localMap) {
      if (propertyMap.types[key] !== 'array') {
        throw new Error('RegX: this.' + key + ' is not an array-typed property');
      }
      var elemType = propertyMap.elementTypes[key] || 'i64';
      var addrBytes = this.compileArrayIndexAddress(key, indexExpr, propertyMap, localMap);
      var bytes = addrBytes.concat([elemType === 'f64' ? 0x2B : 0x29, 0x03, 0x00]);
      return { bytes: bytes, type: elemType };
    },

    compileArrayIndexSetToWasm: function(stmt, propertyMap, localMap) {
      if (propertyMap.types[stmt.key] !== 'array') {
        throw new Error('RegX: this.' + stmt.key + ' is not an array-typed property');
      }
      var elemType = propertyMap.elementTypes[stmt.key] || 'i64';
      var addrBytes = this.compileArrayIndexAddress(stmt.key, stmt.indexExpr, propertyMap, localMap);
      var valueResult = this.compileExpressionToWasm(stmt.value, propertyMap, localMap);
      var valueBytes = this.convertType(valueResult.bytes, valueResult.type, elemType);
      var storeOp = elemType === 'f64' ? 0x39 : 0x37; // f64.store / i64.store
      return addrBytes.concat(valueBytes).concat([storeOp, 0x03, 0x00]);
    },

    // Real array growth: `this.arr.push(EXPR);`. The heap is a simple
    // bump allocator with no free/realloc, so growth means allocating a
    // NEW, one-element-larger block at the current heap top, copying
    // every existing element across with a real runtime byte-copy loop
    // (emitByteCopyLoop, the same one string concatenation already uses,
    // just at the array's 8-byte-per-slot stride instead of 1), writing
    // the new element at the end, then repointing the property at the
    // new block and bumping the heap pointer past it. Reuses
    // this._exprStrLocals (STR_SCRATCH_COUNT i32 scratch locals every
    // method body already reserves) purely as int locals here -- a push
    // statement never runs concurrently with a string op within the same
    // statement, so there's no risk of collision.
    compileArrayPushToWasm: function(stmt, propertyMap, localMap) {
      if (propertyMap.types[stmt.key] !== 'array') {
        throw new Error('RegX: this.' + stmt.key + '.push() called on a non-array property (only a real array, initialized with this.' + stmt.key + ' = [...], supports push): this.' + stmt.key);
      }
      var elemType = propertyMap.elementTypes[stmt.key] || 'i64';
      var offset = propertyMap.offsets[stmt.key] || 0;
      var locals = this._exprStrLocals;
      if (!locals) {
        throw new Error('RegX: internal error -- no scratch locals available for array push here');
      }
      var destPtr = locals[0], oldPtr = locals[1], lenBytes = locals[3], idx = locals[5], destWrite = locals[6];
      function getL(i) { return [0x20].concat(leb128Encode(i)); }
      function setL(i) { return [0x21].concat(leb128Encode(i)); }

      // Function-typed elements are real listener closures dispatched
      // later through a SHARED call_indirect type index (see
      // compileDynamicArrayCallToWasm/buildWasmBinary's _listenerTypeIndex)
      // -- that only works if every closure ever stored here truly shares
      // the exact same WASM signature. This compiler's closures only ever
      // take their own declared params (never JS's implicit event
      // payload), so the one signature real event listeners in this
      // model need is 0 params, void return; anything else is a genuine
      // compile-time error, not a silently wrong dispatch later.
      if (elemType === 'function') {
        var pushedMatch = /^this\.(\w+)$/.exec(stmt.value.trim());
        var closureRef = pushedMatch && propertyMap.closures && propertyMap.closures[pushedMatch[1]];
        if (!closureRef) {
          throw new Error('RegX: this.' + stmt.key + '.push(...) expects a real closure property (a listener) as its argument, got: ' + stmt.value);
        }
        if (closureRef.arity !== 0) {
          throw new Error('RegX: this.' + stmt.key + ' holds listener closures, which must take no arguments (this.' + pushedMatch[1] + ' takes ' + closureRef.arity + '): ' + stmt.value);
        }
        if (closureRef.returnType !== null) {
          throw new Error('RegX: this.' + stmt.key + ' holds listener closures, which must be void (this.' + pushedMatch[1] + ' returns a value): ' + stmt.value);
        }
      }

      var bytes = [];
      // oldPtr = i32.wrap_i64(this.KEY)
      bytes = bytes.concat([0x20], leb128Encode(0), [0x41], leb128EncodeSigned(offset), [0x6A, 0x29, 0x03, 0x00, 0xA7], setL(oldPtr));
      // lenBytes = i32.wrap_i64(i64.load(oldPtr)) * 8 -- existing element count, in bytes
      bytes = bytes.concat(getL(oldPtr), [0x29, 0x03, 0x00, 0xA7], [0x41, 0x08, 0x6C], setL(lenBytes));
      // destPtr = heap pointer (global 0) -- the new, larger block's base
      bytes = bytes.concat([0x23], leb128Encode(0), setL(destPtr));
      // [destPtr] = oldLength + 1 (i64)
      bytes = bytes.concat(getL(destPtr), getL(oldPtr), [0x29, 0x03, 0x00], [0x42, 0x01, 0x7C], [0x37, 0x03, 0x00]);
      // copy every existing element across: destPtr+8 <- oldPtr+8, lenBytes bytes
      bytes = bytes.concat(getL(destPtr), [0x41, 0x08, 0x6A], setL(destWrite));
      bytes = bytes.concat(this.emitByteCopyLoop(destWrite, oldPtr, 8, lenBytes, idx));
      // [destPtr + 8 + lenBytes] = the new element
      var newElemResult = this.compileExpressionToWasm(stmt.value, propertyMap, localMap);
      var newElemBytes = this.convertType(newElemResult.bytes, newElemResult.type, elemType);
      bytes = bytes.concat(getL(destPtr), [0x41, 0x08, 0x6A], getL(lenBytes), [0x6A]);
      bytes = bytes.concat(newElemBytes);
      bytes.push(elemType === 'f64' ? 0x39 : 0x37, 0x03, 0x00);
      // bump the heap pointer past the new block: global0 = destPtr + 8 + lenBytes + 8
      bytes = bytes.concat(getL(destPtr), [0x41, 0x08, 0x6A], getL(lenBytes), [0x6A], [0x41, 0x08, 0x6A]);
      bytes.push(0x24);
      bytes = bytes.concat(leb128Encode(0));
      // this.KEY = destPtr, widened to i64 -- old block is simply abandoned (never freed, same as every other allocation on this bump heap)
      bytes = bytes.concat([0x20], leb128Encode(0), [0x41], leb128EncodeSigned(offset), [0x6A], getL(destPtr), [0xAC], [0x37, 0x03, 0x00]);
      return bytes;
    },

    // `this.KEY[INDEX]();` -- a genuine call_indirect dispatch where the
    // TARGET itself (not just the arguments) is only known at runtime:
    // the table index sits in the array element, read fresh on every
    // call, unlike compileClosureCallToWasm's `this.f(...)` whose
    // property key (and therefore which closure) is fixed at compile
    // time. Every function-typed array element shares one canonical
    // (i32 $this) -> void WASM type (see buildWasmBinary's
    // _listenerTypeIndex and compileArrayPushToWasm's own arity/void
    // check) -- so any table entry stored there is safe to invoke through
    // that ONE shared type immediate, regardless of which specific
    // closure it happens to hold at runtime.
    compileDynamicArrayCallToWasm: function(stmt, propertyMap, localMap) {
      if (propertyMap.types[stmt.key] !== 'array' || propertyMap.elementTypes[stmt.key] !== 'function') {
        throw new Error('RegX: this.' + stmt.key + '[...]() is only supported when this.' + stmt.key + ' is an array of real closure (listener) elements: this.' + stmt.key);
      }
      if (this._listenerTypeIndex === null || this._listenerTypeIndex === undefined) {
        throw new Error('RegX: internal error -- no listener (0-arg void closure) type registered for dynamic call_indirect dispatch on this.' + stmt.key);
      }
      var addrBytes = this.compileArrayIndexAddress(stmt.key, stmt.indexExpr, propertyMap, localMap);
      var tableIdxBytes = addrBytes.concat([0x29, 0x03, 0x00, 0xA7]); // i64.load the stored table index, wrap to i32

      var bytes = [];
      bytes.push(0x20);
      bytes = bytes.concat(leb128Encode(0)); // local.get 0 ($this, passed through to whichever closure this turns out to be)
      bytes = bytes.concat(tableIdxBytes);
      bytes.push(0x11); // call_indirect
      bytes = bytes.concat(leb128Encode(this._listenerTypeIndex));
      bytes.push(0x00); // table 0
      return bytes;
    },

    // Allocates a new fixed-size array on the heap (bump allocator,
    // global 0) and stores its pointer into property KEY. scratchLocal is
    // an i32 local index reserved by buildConstructorBody/buildFunctionBody
    // to hold the new array's base pointer across the multiple per-element
    // stores below.
    // A bare array literal used as a general expression value (`return
    // [1,2,3];`, an argument, a ternary branch) -- same heap layout and
    // bump-allocator as a property array literal (compileArrayInitToWasm
    // below), but leaves the constructed pointer as the expression's
    // VALUE on the stack instead of storing it into a property slot.
    // Uses this._exprScratchLocal (set by whichever buildXBody function
    // is compiling the statement list this expression lives in) since
    // compileExpressionToWasm's signature doesn't thread a scratch local
    // through its many recursive call sites.
    compileArrayLiteralExprToWasm: function(expr, propertyMap, localMap) {
      var scratchLocal = this._exprScratchLocal;
      if (scratchLocal === undefined || scratchLocal === null) {
        throw new Error('RegX: internal error -- no scratch local available to construct an array literal here: ' + expr);
      }
      var elemTexts = splitTopLevelArgs(expr.slice(1, -1));
      var elemType = elemTexts.some(function(t) { return /\d+\.\d+/.test(t); }) ? 'f64' : 'i64';
      var count = elemTexts.length;
      var storeOp = elemType === 'f64' ? 0x39 : 0x37;
      var bytes = [];

      bytes.push(0x23);
      bytes = bytes.concat(leb128Encode(0)); // global.get 0 (heap pointer)
      bytes.push(0x21);
      bytes = bytes.concat(leb128Encode(scratchLocal));

      bytes.push(0x20);
      bytes = bytes.concat(leb128Encode(scratchLocal));
      bytes.push(0x42);
      bytes = bytes.concat(leb128EncodeSignedBig(BigInt(count)));
      bytes.push(0x37, 0x03, 0x00); // i64.store (length)

      for (var e = 0; e < count; e++) {
        var elemResult = this.compileExpressionToWasm(elemTexts[e], propertyMap, localMap);
        var elemBytes = this.convertType(elemResult.bytes, elemResult.type, elemType);
        bytes.push(0x20);
        bytes = bytes.concat(leb128Encode(scratchLocal));
        bytes.push(0x41);
        bytes = bytes.concat(leb128EncodeSigned(8 + e * 8));
        bytes.push(0x6A);
        bytes = bytes.concat(elemBytes);
        bytes.push(storeOp, 0x03, 0x00);
      }

      bytes.push(0x20);
      bytes = bytes.concat(leb128Encode(scratchLocal));
      bytes.push(0x41);
      bytes = bytes.concat(leb128EncodeSigned(8 + count * 8));
      bytes.push(0x6A);
      bytes.push(0x24);
      bytes = bytes.concat(leb128Encode(0)); // global.set 0 (bump the heap pointer)

      bytes.push(0x20);
      bytes = bytes.concat(leb128Encode(scratchLocal));
      bytes.push(0xAC); // i64.extend_i32_s -- the resulting VALUE: the array's pointer, widened

      return { bytes: bytes, type: 'i64' };
    },

    compileArrayInitToWasm: function(stmt, propertyMap, localMap, scratchLocal) {
      var elemType = propertyMap.elementTypes[stmt.key] || 'i64';
      var offset = propertyMap.offsets[stmt.key] || 0;
      var count = stmt.elements.length;
      var storeOp = elemType === 'f64' ? 0x39 : 0x37;
      var bytes = [];

      // scratch = current heap pointer (the new array's base address).
      bytes.push(0x23);
      bytes = bytes.concat(leb128Encode(0)); // global.get 0
      bytes.push(0x21);
      bytes = bytes.concat(leb128Encode(scratchLocal)); // local.set scratch

      // [scratch] = length (always stored as i64, regardless of elemType).
      bytes.push(0x20);
      bytes = bytes.concat(leb128Encode(scratchLocal));
      bytes.push(0x42);
      bytes = bytes.concat(leb128EncodeSignedBig(BigInt(count)));
      bytes.push(0x37, 0x03, 0x00); // i64.store

      // [scratch + 8 + i*8] = element i, for each element.
      for (var e = 0; e < count; e++) {
        var elemResult = this.compileExpressionToWasm(stmt.elements[e], propertyMap, localMap);
        var elemBytes = this.convertType(elemResult.bytes, elemResult.type, elemType);
        bytes.push(0x20);
        bytes = bytes.concat(leb128Encode(scratchLocal));
        bytes.push(0x41);
        bytes = bytes.concat(leb128EncodeSigned(8 + e * 8));
        bytes.push(0x6A); // i32.add
        bytes = bytes.concat(elemBytes);
        bytes.push(storeOp, 0x03, 0x00);
      }

      // Bump the heap pointer past this array: global0 = scratch + 8 + count*8.
      bytes.push(0x20);
      bytes = bytes.concat(leb128Encode(scratchLocal));
      bytes.push(0x41);
      bytes = bytes.concat(leb128EncodeSigned(8 + count * 8));
      bytes.push(0x6A);
      bytes.push(0x24);
      bytes = bytes.concat(leb128Encode(0)); // global.set 0

      // this.KEY = scratch, widened to i64 (property slots are always 8 bytes).
      bytes.push(0x20);
      bytes = bytes.concat(leb128Encode(0)); // local.get 0 ($this)
      bytes.push(0x41);
      bytes = bytes.concat(leb128EncodeSigned(offset));
      bytes.push(0x6A); // i32.add
      bytes.push(0x20);
      bytes = bytes.concat(leb128Encode(scratchLocal));
      bytes.push(0xAC); // i64.extend_i32_s
      bytes.push(0x37, 0x03, 0x00); // i64.store

      return bytes;
    },

    // Allocates a new fixed-shape object on the heap (same bump
    // allocator as arrays -- one shared arena) and stores its pointer
    // into property KEY. Unlike an array, no length prefix: every field
    // sits at a compile-time-known offset (propertyMap.objectShapes
    // [key].fieldOffsets), so nothing at runtime ever needs to know how
    // many fields there are.
    // Shared by compileStringInitToWasm and compileStringLiteralExprToWasm:
    // bump-allocates a length-prefixed byte buffer on the same shared
    // heap arrays/objects use ([length: i64][byte0]...[byteN-1], no
    // padding) and writes every character byte -- all at COMPILE TIME
    // since a literal's own text is fully known then, so this is N
    // single-byte stores, never a runtime loop. Leaves the scratch
    // local holding the buffer's base i32 address; the caller decides
    // whether that becomes a property write or a bare expression value.
    allocateStringLiteralBytes: function(scratchLocal, charBytes) {
      var bytes = [];
      bytes.push(0x23);
      bytes = bytes.concat(leb128Encode(0)); // global.get 0 (heap pointer)
      bytes.push(0x21);
      bytes = bytes.concat(leb128Encode(scratchLocal));

      bytes.push(0x20);
      bytes = bytes.concat(leb128Encode(scratchLocal));
      bytes.push(0x42);
      bytes = bytes.concat(leb128EncodeSignedBig(BigInt(charBytes.length)));
      bytes.push(0x37, 0x03, 0x00); // i64.store (length)

      for (var i = 0; i < charBytes.length; i++) {
        bytes.push(0x20);
        bytes = bytes.concat(leb128Encode(scratchLocal));
        bytes.push(0x41);
        bytes = bytes.concat(leb128EncodeSigned(8 + i));
        bytes.push(0x6A);
        bytes.push(0x41);
        bytes = bytes.concat(leb128EncodeSigned(charBytes[i]));
        bytes.push(0x3A, 0x00, 0x00); // i32.store8
      }

      bytes.push(0x20);
      bytes = bytes.concat(leb128Encode(scratchLocal));
      bytes.push(0x41);
      bytes = bytes.concat(leb128EncodeSigned(8 + charBytes.length));
      bytes.push(0x6A);
      bytes.push(0x24);
      bytes = bytes.concat(leb128Encode(0)); // global.set 0 (bump the heap pointer)
      return bytes;
    },

    compileStringInitToWasm: function(stmt, propertyMap, localMap, scratchLocal) {
      var offset = propertyMap.offsets[stmt.key] || 0;
      var charBytes = stringToBytes(stmt.text);
      var bytes = this.allocateStringLiteralBytes(scratchLocal, charBytes);

      bytes.push(0x20);
      bytes = bytes.concat(leb128Encode(0));
      bytes.push(0x41);
      bytes = bytes.concat(leb128EncodeSigned(offset));
      bytes.push(0x6A);
      bytes.push(0x20);
      bytes = bytes.concat(leb128Encode(scratchLocal));
      bytes.push(0xAC); // i64.extend_i32_s
      bytes.push(0x37, 0x03, 0x00);
      return bytes;
    },

    // A bare string literal used as a general expression value -- same
    // this._exprScratchLocal convention as compileArrayLiteralExprToWasm.
    compileStringLiteralExprToWasm: function(text, propertyMap, localMap) {
      var scratchLocal = this._exprScratchLocal;
      if (scratchLocal === undefined || scratchLocal === null) {
        throw new Error('RegX: internal error -- no scratch local available to construct a string literal here: ' + text);
      }
      var charBytes = stringToBytes(text);
      var bytes = this.allocateStringLiteralBytes(scratchLocal, charBytes);
      bytes.push(0x20);
      bytes = bytes.concat(leb128Encode(scratchLocal));
      bytes.push(0xAC); // i64.extend_i32_s
      return { bytes: bytes, type: 'string' };
    },

    // Object.keys(this.OBJ) -- real, compile-time-resolvable property
    // enumeration. This compiler's objects are entirely static-shaped
    // (objectShapeFor parses the ONE literal an object property is ever
    // assigned from, so its field set never varies at runtime), which
    // means every field name Object.keys() would need to report is
    // already fully known here, at compile time -- no runtime
    // reflection required at all. Materializes a genuine heap array
    // (same [length: i64][elem0]...] layout every other array uses)
    // whose elements are genuine heap strings, one per field, in
    // `shape.order` (the literal's own declaration order -- exactly
    // real JS's Object.keys() ordering for string keys).
    //
    // Two DISTINCT scratch locals are needed, not one: _exprScratchLocal
    // holds the array's own base address for the whole construction,
    // while _exprStrLocals[0] is reused (transiently, per element) to
    // hold each key STRING's own base address while
    // allocateStringLiteralBytes builds it -- sharing one local for both
    // would have the array's base address clobbered by the last key
    // string's address the moment more than one field exists. The
    // array's header+slots are bump-allocated and the heap pointer
    // advanced PAST them before any key string is built, precisely so
    // each string (itself bump-allocated afterward, at the new heap
    // top) lands strictly after the array's own fixed region instead of
    // overwriting it.
    compileObjectKeysToWasm: function(argsText, propertyMap, localMap) {
      var argTexts = argsText.trim() ? splitTopLevelArgs(argsText) : [];
      if (argTexts.length !== 1) {
        throw new Error('RegX: Object.keys() expects exactly 1 argument, got ' + argTexts.length + ': ' + argsText);
      }
      var argMatch = /^this\.(\w+)$/.exec(argTexts[0].trim());
      if (!argMatch) {
        throw new Error('RegX: Object.keys() argument must be a direct object-shaped property reference (this.NAME): ' + argTexts[0]);
      }
      var objKey = argMatch[1];
      if (propertyMap.types[objKey] !== 'object' || !propertyMap.objectShapes || !propertyMap.objectShapes[objKey]) {
        throw new Error('RegX: Object.keys(this.' + objKey + ') requires this.' + objKey + ' to be a known, static object-shaped property (it is not one): this.' + objKey);
      }
      var order = propertyMap.objectShapes[objKey].order;
      var count = order.length;

      var arrayScratch = this._exprScratchLocal;
      var stringScratch = this._exprStrLocals && this._exprStrLocals[0];
      if (arrayScratch === undefined || arrayScratch === null || stringScratch === undefined) {
        throw new Error('RegX: internal error -- no scratch locals available to construct Object.keys() result here');
      }

      var bytes = [];
      // arrayScratch = current heap pointer (the new array's base address).
      bytes.push(0x23);
      bytes = bytes.concat(leb128Encode(0));
      bytes.push(0x21);
      bytes = bytes.concat(leb128Encode(arrayScratch));

      // Reserve the array's own header+slots (bump the heap pointer past
      // them) BEFORE writing anything into them -- see this function's
      // own comment above for why key strings must allocate after this
      // point, not before it.
      bytes = bytes.concat([0x20], leb128Encode(arrayScratch), [0x41], leb128EncodeSigned(8 + count * 8), [0x6A]);
      bytes.push(0x24);
      bytes = bytes.concat(leb128Encode(0));

      // [arrayScratch] = count (i64) -- the array's own length prefix.
      bytes = bytes.concat([0x20], leb128Encode(arrayScratch));
      bytes.push(0x42);
      bytes = bytes.concat(leb128EncodeSignedBig(BigInt(count)));
      bytes.push(0x37, 0x03, 0x00);

      for (var i = 0; i < count; i++) {
        var charBytes = stringToBytes(order[i]);
        bytes = bytes.concat(this.allocateStringLiteralBytes(stringScratch, charBytes));
        // [arrayScratch + 8 + i*8] = i64.extend_i32_s(stringScratch)
        bytes = bytes.concat([0x20], leb128Encode(arrayScratch), [0x41], leb128EncodeSigned(8 + i * 8), [0x6A]);
        bytes = bytes.concat([0x20], leb128Encode(stringScratch), [0xAC]);
        bytes.push(0x37, 0x03, 0x00);
      }

      bytes = bytes.concat([0x20], leb128Encode(arrayScratch), [0xAC]); // result: array pointer, widened
      return { bytes: bytes, type: 'i64' };
    },

    // A single byte-copy loop iteration: copies srcLocal[srcByteOffset+i]
    // to destBaseLocal[i] for i in [0, lenLocal), i driven by idxLocal.
    // Real runtime control flow (block+loop+br_if), not unrolled --
    // string lengths aren't compile-time-known in general (a property's
    // actual content varies per instance), unlike literal CONSTRUCTION
    // where the byte count is static.
    emitByteCopyLoop: function(destBaseLocal, srcLocal, srcByteOffset, lenLocal, idxLocal) {
      var bytes = [];
      bytes.push(0x41, 0x00, 0x21);
      bytes = bytes.concat(leb128Encode(idxLocal)); // idx = 0

      bytes.push(0x02, 0x40); // block (void)
      bytes.push(0x03, 0x40); //   loop (void)
      bytes = bytes.concat([0x20], leb128Encode(idxLocal), [0x20], leb128Encode(lenLocal), [0x4E]); // idx >= len
      bytes.push(0x0D, 0x01); //   br_if 1 (exit block)

      // dest[idx] = src[srcByteOffset + idx]
      bytes = bytes.concat([0x20], leb128Encode(destBaseLocal), [0x20], leb128Encode(idxLocal), [0x6A]);
      bytes = bytes.concat([0x20], leb128Encode(srcLocal), [0x20], leb128Encode(idxLocal),
        [0x41], leb128EncodeSigned(srcByteOffset), [0x6A, 0x6A]);
      bytes.push(0x2D, 0x00, 0x00); // i32.load8_u
      bytes.push(0x3A, 0x00, 0x00); // i32.store8

      bytes = bytes.concat([0x20], leb128Encode(idxLocal), [0x41, 0x01, 0x6A, 0x21], leb128Encode(idxLocal)); // idx++
      bytes.push(0x0C, 0x00); //   br 0 (loop again)
      bytes.push(0x0B);       //   end loop
      bytes.push(0x0B);       // end block
      return bytes;
    },

    // Real string concatenation: allocates a new buffer on the shared
    // heap sized to both operands' ACTUAL runtime lengths (read from
    // their own length prefixes, not assumed), copies both byte ranges
    // in with emitByteCopyLoop, and leaves the new buffer's pointer as
    // the result -- a real runtime operation, not something foldable at
    // compile time in general (either operand can be a property whose
    // real content varies per instance).
    compileStringConcatToWasm: function(leftResult, rightResult) {
      var locals = this._exprStrLocals;
      if (!locals) {
        throw new Error('RegX: internal error -- no scratch locals available for string concatenation here');
      }
      var destPtr = locals[0], leftPtr = locals[1], rightPtr = locals[2],
        leftLen = locals[3], rightLen = locals[4], idx = locals[5], destWrite = locals[6];
      var bytes = [];
      function getL(i) { return [0x20].concat(leb128Encode(i)); }
      function setL(i) { return [0x21].concat(leb128Encode(i)); }

      bytes = bytes.concat(leftResult.bytes, [0xA7], setL(leftPtr));   // leftPtr = wrap_i64(leftResult)
      bytes = bytes.concat(rightResult.bytes, [0xA7], setL(rightPtr)); // rightPtr = wrap_i64(rightResult)

      bytes = bytes.concat(getL(leftPtr), [0x29, 0x03, 0x00, 0xA7], setL(leftLen));   // leftLen
      bytes = bytes.concat(getL(rightPtr), [0x29, 0x03, 0x00, 0xA7], setL(rightLen)); // rightLen

      bytes = bytes.concat([0x23], leb128Encode(0), setL(destPtr)); // destPtr = heap pointer

      // [destPtr] = i64.extend_i32_s(leftLen + rightLen)
      bytes = bytes.concat(getL(destPtr), getL(leftLen), getL(rightLen), [0x6A, 0xAC]);
      bytes.push(0x37, 0x03, 0x00);

      // copy left bytes into destPtr+8
      bytes = bytes.concat(getL(destPtr), [0x41, 0x08, 0x6A], setL(destWrite));
      bytes = bytes.concat(this.emitByteCopyLoop(destWrite, leftPtr, 8, leftLen, idx));

      // copy right bytes into destPtr+8+leftLen
      bytes = bytes.concat(getL(destPtr), [0x41, 0x08, 0x6A], getL(leftLen), [0x6A], setL(destWrite));
      bytes = bytes.concat(this.emitByteCopyLoop(destWrite, rightPtr, 8, rightLen, idx));

      // bump the heap pointer past the new buffer
      bytes = bytes.concat(getL(destPtr), [0x41, 0x08, 0x6A], getL(leftLen), [0x6A], getL(rightLen), [0x6A]);
      bytes.push(0x24);
      bytes = bytes.concat(leb128Encode(0));

      bytes = bytes.concat(getL(destPtr), [0xAC]); // result = i64.extend_i32_s(destPtr)
      return { bytes: bytes, type: 'string' };
    },


    // Real string equality: same length AND every byte equal, checked
    // by an actual runtime loop over both operands' real content (their
    // lengths aren't compile-time-known in general) -- produces a real
    // i32 boolean, not folded from anything static.
    // Resolves TEXT to a real string-typed operand if it's DIRECTLY a
    // string literal or a bare `this.KEY` string-typed property -- else
    // null (a composite expression like `this.a + this.b` doesn't need
    // this: it already carries the 'string' tag through correctly via
    // compileArithmeticToWasm's own string handling). Used by the
    // comparison operators, which run BEFORE the arithmetic pipeline on
    // raw, unreduced text.
    resolveStringOperand: function(text, propertyMap, localMap) {
      text = text.trim();
      var litMatch = /^["']([^"']*)["']$/.exec(text);
      if (litMatch) {
        return this.compileStringLiteralExprToWasm(litMatch[1], propertyMap, localMap);
      }
      var propMatch = /^this\.(\w+)$/.exec(text);
      if (propMatch && propertyMap.types && propertyMap.types[propMatch[1]] === 'string') {
        var offset = propertyMap.offsets[propMatch[1]] || 0;
        var loadBytes = [0x20, 0, 0x41].concat(leb128EncodeSigned(offset), [0x6A, 0x29, 0x03, 0x00]);
        return { bytes: loadBytes, type: 'string' };
      }
      return null;
    },

    compileStringCompareToWasm: function(leftResult, rightResult, wantEqual) {
      var locals = this._exprStrLocals;
      if (!locals) {
        throw new Error('RegX: internal error -- no scratch locals available for string comparison here');
      }
      var leftPtr = locals[1], rightPtr = locals[2], leftLen = locals[3], rightLen = locals[4], idx = locals[5];
      var bytes = [];

      bytes = bytes.concat(leftResult.bytes, [0xA7, 0x21], leb128Encode(leftPtr));
      bytes = bytes.concat(rightResult.bytes, [0xA7, 0x21], leb128Encode(rightPtr));
      bytes = bytes.concat([0x20], leb128Encode(leftPtr), [0x29, 0x03, 0x00, 0xA7, 0x21], leb128Encode(leftLen));
      bytes = bytes.concat([0x20], leb128Encode(rightPtr), [0x29, 0x03, 0x00, 0xA7, 0x21], leb128Encode(rightLen));

      // result (i32) = (leftLen == rightLen) ? byteCompareLoop() : 0
      bytes = bytes.concat([0x20], leb128Encode(leftLen), [0x20], leb128Encode(rightLen), [0x46]); // i32.eq
      bytes.push(0x04, 0x7F); // if (result i32)

      // idx = 0; loop: if idx>=leftLen -> equal (fell through all bytes);
      // if left[idx] != right[idx] -> not equal; idx++; repeat.
      bytes = bytes.concat([0x41, 0x00, 0x21], leb128Encode(idx));
      bytes.push(0x02, 0x7F); // block (result i32)
      bytes.push(0x03, 0x40); //   loop (void)
      bytes = bytes.concat([0x20], leb128Encode(idx), [0x20], leb128Encode(leftLen), [0x4E]); // idx >= leftLen
      bytes.push(0x04, 0x40); //   if (void)
      bytes.push(0x41, 0x01); //     push 1 (equal -- exhausted with no mismatch)
      bytes.push(0x0C, 0x02); //     br 2 (out of the loop AND the result block, with 1 on the stack)
      bytes.push(0x0B);       //   end if

      bytes = bytes.concat([0x20], leb128Encode(leftPtr), [0x20], leb128Encode(idx), [0x41, 0x08, 0x6A, 0x6A, 0x2D, 0x00, 0x00]);
      bytes = bytes.concat([0x20], leb128Encode(rightPtr), [0x20], leb128Encode(idx), [0x41, 0x08, 0x6A, 0x6A, 0x2D, 0x00, 0x00]);
      bytes.push(0x47); // i32.ne
      bytes.push(0x04, 0x40); //   if (void)
      bytes.push(0x41, 0x00); //     push 0 (mismatch -- not equal)
      bytes.push(0x0C, 0x02); //     br 2 (out of the loop AND the result block, with 0 on the stack)
      bytes.push(0x0B);       //   end if

      bytes = bytes.concat([0x20], leb128Encode(idx), [0x41, 0x01, 0x6A, 0x21], leb128Encode(idx)); // idx++
      bytes.push(0x0C, 0x00); //   br 0 (loop again)
      bytes.push(0x0B);       //   end loop
      // Unreachable in practice (every path above br's out with a value
      // already on the stack) -- satisfies validation for the
      // (result i32) block's own natural end.
      bytes.push(0x00);       //   unreachable
      bytes.push(0x0B);       // end block (result i32)

      bytes.push(0x05); // else (lengths differed)
      bytes.push(0x41, 0x00); //   push 0 (not equal)
      bytes.push(0x0B); // end if

      if (!wantEqual) bytes.push(0x45); // i32.eqz -- invert for !==/!=

      return { bytes: bytes, type: 'i32' };
    },

    compileObjectInitToWasm: function(stmt, propertyMap, localMap, scratchLocal) {
      var shape = propertyMap.objectShapes[stmt.key];
      if (!shape) {
        throw new Error('RegX: this.' + stmt.key + ' has no known object shape');
      }
      var offset = propertyMap.offsets[stmt.key] || 0;
      var bytes = [];

      // scratch = current heap pointer (the new object's base address).
      bytes.push(0x23);
      bytes = bytes.concat(leb128Encode(0)); // global.get 0
      bytes.push(0x21);
      bytes = bytes.concat(leb128Encode(scratchLocal));

      // [scratch + fieldOffset(name)] = value, for each field. The
      // property's shape is fixed once (from the FIRST such literal
      // found anywhere in the class, see objectShapeFor) -- a later
      // construction using a DIFFERENT field name would silently leave
      // that field's write unaccounted for if simply skipped, so a
      // mismatch is a loud, specific error instead.
      stmt.fields.forEach(function(f) {
        if (!Object.prototype.hasOwnProperty.call(shape.fieldOffsets, f.name)) {
          throw new Error('RegX: this.' + stmt.key + ' = {...} includes field \'' + f.name + '\', which is not part of this property\'s inferred shape (' + shape.order.join(', ') + ')');
        }
        var fieldType = shape.fieldTypes[f.name];
        var fieldResult = this.compileExpressionToWasm(f.valueText, propertyMap, localMap);
        var fieldBytes = this.convertType(fieldResult.bytes, fieldResult.type, fieldType);
        var storeOp = fieldType === 'f64' ? 0x39 : 0x37;
        bytes.push(0x20);
        bytes = bytes.concat(leb128Encode(scratchLocal));
        bytes.push(0x41);
        bytes = bytes.concat(leb128EncodeSigned(shape.fieldOffsets[f.name]));
        bytes.push(0x6A);
        bytes = bytes.concat(fieldBytes);
        bytes.push(storeOp, 0x03, 0x00);
      }, this);

      // Bump the heap pointer past this object.
      bytes.push(0x20);
      bytes = bytes.concat(leb128Encode(scratchLocal));
      bytes.push(0x41);
      bytes = bytes.concat(leb128EncodeSigned(shape.byteSize));
      bytes.push(0x6A);
      bytes.push(0x24);
      bytes = bytes.concat(leb128Encode(0)); // global.set 0

      // this.KEY = scratch, widened to i64.
      bytes.push(0x20);
      bytes = bytes.concat(leb128Encode(0));
      bytes.push(0x41);
      bytes = bytes.concat(leb128EncodeSigned(offset));
      bytes.push(0x6A);
      bytes.push(0x20);
      bytes = bytes.concat(leb128Encode(scratchLocal));
      bytes.push(0xAC); // i64.extend_i32_s
      bytes.push(0x37, 0x03, 0x00);

      return bytes;
    },

    // Real destructuring: `const { a, b } = this.obj;`. Each named
    // binding was already given its own fresh local index by
    // buildFunctionBody/buildConstructorBody (scanning for 'destructure'
    // statements before the locals section is emitted) -- this just
    // loads this.obj's heap pointer once and reads each field at its
    // known offset directly into its local.
    compileDestructureToWasm: function(stmt, propertyMap, localMap) {
      var shape = propertyMap.objectShapes[stmt.sourceKey];
      if (!shape) {
        throw new Error('RegX: this.' + stmt.sourceKey + ' is not a known object-shaped property, cannot destructure it');
      }
      var offset = propertyMap.offsets[stmt.sourceKey] || 0;
      var bytes = [];

      // basePtr = i32.wrap_i64(this.obj) -- load once, reused per field.
      var basePtrBytes = [0x20].concat(leb128Encode(0), [0x41], leb128EncodeSigned(offset), [0x6A, 0x29, 0x03, 0x00, 0xA7]);

      stmt.names.forEach(function(name) {
        if (!Object.prototype.hasOwnProperty.call(shape.fieldOffsets, name)) {
          throw new Error('RegX: this.' + stmt.sourceKey + ' has no field \'' + name + '\' to destructure');
        }
        if (!Object.prototype.hasOwnProperty.call(localMap, name)) {
          throw new Error('RegX: internal error -- destructured binding \'' + name + '\' has no local slot');
        }
        var fieldType = shape.fieldTypes[name];
        var loadOp = fieldType === 'f64' ? 0x2B : 0x29;
        var addr = basePtrBytes.concat([0x41], leb128EncodeSigned(shape.fieldOffsets[name]), [0x6A]);
        bytes = bytes.concat(addr, [loadOp, 0x03, 0x00]);
        bytes.push(0x21); // local.set
        bytes = bytes.concat(leb128Encode(localMap[name]));
      });

      return bytes;
    },

    // A real local variable write -- 'localDecl' (its first assignment,
    // already given a local index+type by allocateLocalDeclLocals) and
    // 'localAssign' (every later mutation) compile identically once the
    // local exists: compile the RHS, convert to the local's own declared
    // type, local.set.
    compileLocalAssignToWasm: function(stmt, propertyMap, localMap) {
      if (!localMap || !Object.prototype.hasOwnProperty.call(localMap, stmt.name)) {
        throw new Error('RegX: unknown local \'' + stmt.name + '\' (not declared with let/const/var, and not a parameter of this function): ' + stmt.name);
      }
      var localType = (localMap.__types && localMap.__types[stmt.name]) || 'i64';
      var value = this.compileExpressionToWasm(stmt.value, propertyMap, localMap);
      var converted = this.convertType(value.bytes, value.type, localType);
      return converted.concat([0x21]).concat(leb128Encode(localMap[stmt.name]));
    },

    // A property's type is decided once, from the TEXT of its assignment
    // expressions — not full recursive type inference, but RegX's grammar
    // is simple enough that this is sufficient and avoids any circularity
    // between "what type is this property" and "what type does its own
    // initializer expression evaluate to" (which could itself reference
    // other properties). f64 if ANY assignment anywhere in the source is
    // unmistakably fractional or NaN; i64 (the default) otherwise.
    propertyIsFloat: function(ast, key, className) {
      var targetClass = className !== undefined ? className : this.primaryClassName(ast);
      var properties = ast.properties || [];
      for (var i = 0; i < properties.length; i++) {
        if (properties[i].key !== key) continue;
        if (properties[i].className && properties[i].className !== targetClass) continue;
        if (properties[i].value === undefined) continue; // a bare `#x;`/`x;` declaration has no RHS to read a type from
        if (/\d+\.\d+/.test(properties[i].value) || /\bNaN\b/.test(properties[i].value)) {
          return true;
        }
      }
      return false;
    },

    // A property is array-typed if any of its assignments begins with '['.
    // propRegex's own value capture ([^,;\n]+) truncates at the first
    // comma, so for `this.arr = [1, 2, 3];` properties[i].value is only
    // "[1" — but leading-bracket detection survives that truncation fine,
    // since the truncation can only ever happen AFTER the '[' is already
    // captured.
    propertyIsArray: function(ast, key, className) {
      var targetClass = className !== undefined ? className : this.primaryClassName(ast);
      var properties = ast.properties || [];
      for (var i = 0; i < properties.length; i++) {
        if (properties[i].key !== key) continue;
        if (properties[i].className && properties[i].className !== targetClass) continue;
        if (properties[i].value === undefined) continue; // bare declaration, no RHS
        if (/^\[/.test(properties[i].value.trim())) return true;
      }
      return false;
    },

    // Array element type: i64 by default, f64 if any element in ANY
    // literal assigned to this property (within the target class, when a
    // source has more than one) contains a decimal point. properties[i]
    // .value can't be trusted here (comma-truncated), so this scans
    // ast.raw (the untruncated original source) directly for the full
    // bracketed literal instead -- scoped to the owning class block's own
    // [start,end) span in ast.raw, so two classes with a same-named array
    // property can't leak into each other's element-type inference.
    arrayElementIsFloat: function(ast, key, className) {
      var searchText = ast.raw || '';
      if (className) {
        var block = (ast.blocks || []).filter(function(b) { return b.type === 'class' && b.name === className; })[0];
        if (block) searchText = searchText.slice(block.start, block.end);
      }
      var re = new RegExp('this\\.' + key + '\\s*=\\s*\\[([^\\]]*)\\]', 'g');
      var m;
      while ((m = re.exec(searchText)) !== null) {
        if (/\d+\.\d+/.test(m[1])) return true;
      }
      return false;
    },

    // An array's elements are real callable closures (function-typed,
    // physically the same i64 table index HANDLE_TYPES already gives a
    // bare `this.f` closure read) when the source visibly stores a real
    // closure property INTO this array -- either grown at runtime
    // (`this.listeners.push(this.cb);`, the real event-emitter pattern
    // this exists for) or pre-populated in the literal itself
    // (`this.listeners = [this.cb];`). Pure text inference over ast.raw,
    // same truncation-tolerant style as arrayElementIsFloat/objectShapeFor
    // -- deliberately NOT dependent on propertyMap.closures already being
    // populated (discoverClosures runs AFTER buildWasmPropertyMap, using
    // ITS offsets, so relying on the closures map here would be a real
    // ordering cycle); "this.NAME = ... => ..." appearing anywhere in the
    // same class is enough to know NAME is a real closure property.
    arrayElementIsFunction: function(ast, key, className) {
      var searchText = ast.raw || '';
      if (className) {
        var block = (ast.blocks || []).filter(function(b) { return b.type === 'class' && b.name === className; })[0];
        if (block) searchText = searchText.slice(block.start, block.end);
      }
      function isArrowProperty(name) {
        var arrowRe = new RegExp('this\\.' + name + '\\s*=\\s*(?:\\([^)]*\\)|[a-zA-Z_]\\w*)\\s*=>');
        return arrowRe.test(searchText);
      }
      var pushRe = new RegExp('this\\.' + key + '\\.push\\(\\s*this\\.(\\w+)\\s*\\)', 'g');
      var pm;
      while ((pm = pushRe.exec(searchText)) !== null) {
        if (isArrowProperty(pm[1])) return true;
      }
      var litRe = new RegExp('this\\.' + key + '\\s*=\\s*\\[\\s*this\\.(\\w+)');
      var lm = litRe.exec(searchText);
      if (lm && isArrowProperty(lm[1])) return true;
      return false;
    },

    // A property is object-typed if any of its assignments begins with
    // '{' -- same truncation-tolerant leading-character check as arrays.
    propertyIsObject: function(ast, key, className) {
      var targetClass = className !== undefined ? className : this.primaryClassName(ast);
      var properties = ast.properties || [];
      for (var i = 0; i < properties.length; i++) {
        if (properties[i].key !== key) continue;
        if (properties[i].className && properties[i].className !== targetClass) continue;
        if (properties[i].value === undefined) continue; // bare declaration, no RHS
        if (/^\{/.test(properties[i].value.trim())) return true;
      }
      return false;
    },

    // A property is string-typed if any of its assignments begins with a
    // quote -- same truncation-tolerant leading-character check.
    propertyIsString: function(ast, key, className) {
      var targetClass = className !== undefined ? className : this.primaryClassName(ast);
      var properties = ast.properties || [];
      for (var i = 0; i < properties.length; i++) {
        if (properties[i].key !== key) continue;
        if (properties[i].className && properties[i].className !== targetClass) continue;
        if (properties[i].value === undefined) continue; // bare declaration, no RHS
        if (/^["'`]/.test(properties[i].value.trim())) return true;
      }
      return false;
    },

    // A property is Object.keys()-derived-array-typed if any of its
    // assignments is exactly `Object.keys(this.OTHER)` -- checked BEFORE
    // propertyIsArray (which only recognizes a leading '[') since this
    // RHS has no brackets of its own at all; the array it produces is
    // still a genuine array of genuine heap strings (see
    // compileObjectKeysToWasm), just constructed from field names
    // instead of a literal element list. propRegex's own value capture
    // ([^,;\n]+) never truncates this -- `this.NAME` (the only
    // supported argument shape) contains no comma.
    propertyIsObjectKeysAssignment: function(ast, key, className) {
      var searchText = ast.raw || '';
      if (className) {
        var block = (ast.blocks || []).filter(function(b) { return b.type === 'class' && b.name === className; })[0];
        if (block) searchText = searchText.slice(block.start, block.end);
      }
      var re = new RegExp('this\\.' + key + '\\s*=\\s*Object\\.keys\\(');
      return re.test(searchText);
    },

    // An object property's field layout: fixed, compile-time-known named
    // slots (unlike an array, no runtime index -- destructuring and
    // property access both resolve a field NAME to a constant offset at
    // compile time). Decided once from the first `{ a: ..., b: ... }`
    // literal assigned to this property anywhere in the owning class,
    // read from ast.raw directly (propRegex's own value capture
    // truncates at the first comma, same reason arrays need this).
    // Fields are 8 bytes each, in the literal's own declared order; each
    // field independently promotes to f64 if ITS OWN value text is
    // unmistakably fractional (a genuinely per-field decision, unlike an
    // array's one uniform element type, since two fields can mean very
    // different things).
    objectShapeFor: function(ast, key, className) {
      var searchText = ast.raw || '';
      if (className) {
        var block = (ast.blocks || []).filter(function(b) { return b.type === 'class' && b.name === className; })[0];
        if (block) searchText = searchText.slice(block.start, block.end);
      }
      var re = new RegExp('this\\.' + key + '\\s*=\\s*\\{([^}]*)\\}', '');
      var m = re.exec(searchText);
      if (!m) {
        throw new Error('RegX: could not locate the object literal assigned to this.' + key);
      }
      var fieldTexts = splitTopLevelArgs(m[1]);
      var fieldOffsets = {};
      var fieldTypes = {};
      var order = [];
      var nextOffset = 0;
      for (var i = 0; i < fieldTexts.length; i++) {
        var colonIdx = fieldTexts[i].indexOf(':');
        if (colonIdx === -1) {
          throw new Error('RegX: malformed object literal field (expected name: value): ' + fieldTexts[i]);
        }
        var fieldName = fieldTexts[i].slice(0, colonIdx).trim();
        var fieldValueText = fieldTexts[i].slice(colonIdx + 1).trim();
        if (Object.prototype.hasOwnProperty.call(fieldOffsets, fieldName)) continue;
        fieldOffsets[fieldName] = nextOffset;
        fieldTypes[fieldName] = /\d+\.\d+/.test(fieldValueText) ? 'f64' : 'i64';
        order.push(fieldName);
        nextOffset += 8;
      }
      return { fieldOffsets: fieldOffsets, fieldTypes: fieldTypes, order: order, byteSize: nextOffset };
    },

    // A property is nullable if any of its assignments is exactly the
    // literal `null` or `undefined` — not comma-truncation-prone like the
    // array check, since neither literal can contain a comma.
    propertyIsNullable: function(ast, key, className) {
      var targetClass = className !== undefined ? className : this.primaryClassName(ast);
      var properties = ast.properties || [];
      for (var i = 0; i < properties.length; i++) {
        if (properties[i].key !== key) continue;
        if (properties[i].className && properties[i].className !== targetClass) continue;
        if (properties[i].value === undefined) continue; // bare declaration, not an explicit null/undefined RHS
        if (/^(null|undefined)$/.test(properties[i].value.trim())) return true;
      }
      return false;
    },

    // Named distinctly from WATGeneratorMixin's own buildPropertyMap
    // (dead code for the executed compileAndRun/javascriptToWasm path, but
    // still a same-named method on another composed mixin) — ExtendX
    // chain-dispatches `this.buildPropertyMap(...)` to whichever mixin
    // declared it FIRST and stops there unless it forwards, exactly the
    // parseStatements bug from earlier in this file. Renaming instead of
    // touching the WAT mixin, which is still internally self-consistent
    // with the old flat {key: offset} shape this new {offsets, types}
    // shape would have broken it against.
    //
    // Slot width per property: 8 bytes normally (i64/f64/array pointer
    // are all one 8-byte value), 16 bytes for a nullable property (an
    // 8-byte presence tag followed by an 8-byte payload) — so offsets are
    // now a running byte total, not index*8.
    buildWasmPropertyMap: function(ast, className) {
      var offsets = {};
      var types = {};
      var elementTypes = {};
      var nullable = {};
      var objectShapes = {};
      var targetClass = className !== undefined ? className : this.primaryClassName(ast);
      var properties = ast.properties || [];
      var nextOffset = 0;
      for (var i = 0; i < properties.length; i++) {
        // Only THIS class's own properties -- see buildPropertyMap's
        // matching comment and primaryClassName's own comment for why.
        if (properties[i].className && properties[i].className !== targetClass) continue;
        var key = properties[i].key;
        if (Object.prototype.hasOwnProperty.call(offsets, key)) continue;
        offsets[key] = nextOffset;
        if (this.propertyIsObjectKeysAssignment(ast, key, targetClass)) {
          types[key] = 'array';
          elementTypes[key] = 'string';
          nextOffset += 8;
        } else if (this.propertyIsArray(ast, key, targetClass)) {
          types[key] = 'array';
          elementTypes[key] = this.arrayElementIsFunction(ast, key, targetClass) ? 'function' :
            (this.arrayElementIsFloat(ast, key, targetClass) ? 'f64' : 'i64');
          nextOffset += 8;
        } else if (this.propertyIsObject(ast, key, targetClass)) {
          types[key] = 'object';
          objectShapes[key] = this.objectShapeFor(ast, key, targetClass);
          nextOffset += 8; // the slot holds a heap pointer, same as an array
        } else if (this.propertyIsString(ast, key, targetClass)) {
          types[key] = 'string';
          nextOffset += 8; // the slot holds a heap pointer, same as an array
        } else if (this.propertyIsNullable(ast, key, targetClass)) {
          types[key] = this.propertyIsFloat(ast, key, targetClass) ? 'f64' : 'i64';
          nullable[key] = true;
          nextOffset += 16;
        } else {
          types[key] = this.propertyIsFloat(ast, key, targetClass) ? 'f64' : 'i64';
          nextOffset += 8;
        }
      }
      return { offsets: offsets, types: types, elementTypes: elementTypes, nullable: nullable, objectShapes: objectShapes };
    },

    // #name is a COMPILE-TIME-only privacy concept in real JS -- WASM
    // itself has no notion of it at all (a private field's offset load/
    // store is byte-for-byte identical to a public one, see
    // compileMethodCallToWasm/the this.#x read/write paths reusing the
    // exact same offset machinery as this.x). The only thing that has to
    // be genuinely enforced is the SyntaxError real JS throws at parse
    // time for a #name that was never declared in the referencing text's
    // OWN class body: this map is "which class(es) declare #name",
    // built from every place a name is legitimately introduced --
    // a `#name;`/`#name = v;` field declaration, a `this.#name = v;`
    // assignment (mirrors how an ordinary this.x property needs no
    // separate declaration either), and a `#name() {}` private method.
    collectPrivateOwners: function(ast) {
      var owners = {};
      // Deliberately isField-only (the `#name;` / `#name = v;` class-body
      // declaration), NOT every `this.#name = v` assignment site the way
      // an ordinary property's ownership is inferred (buildWasmPropertyMap
      // needs no separate declaration for this.x). Real JS DOES require an
      // explicit private-field declaration before any use, including its
      // own class's first assignment -- using assignment sites here too
      // would let `this.#secret = v;` written from a subclass (which
      // parses as its own, syntactically well-formed assignment) silently
      // count as a legitimate declaration and defeat the whole check.
      (ast.properties || []).forEach(function(p) {
        if (p.isField && p.key && p.key.charAt(0) === '#' && p.className) {
          owners[p.key] = owners[p.key] || {};
          owners[p.key][p.className] = true;
        }
      });
      (ast.methods || []).forEach(function(m) {
        if (m.name && m.name.charAt(0) === '#' && m.className) {
          owners[m.name] = owners[m.name] || {};
          owners[m.name][m.className] = true;
        }
      });
      return owners;
    },

    // Real JS scopes a private name to the LEXICAL class body that
    // declares it -- NOT inherited down an `extends` chain the way an
    // ordinary property is (a subclass method referencing an ancestor's
    // #name is a genuine SyntaxError, "must be declared in an enclosing
    // class"). buildWasmPropertyMapForChain still merges private
    // OFFSETS across the whole chain (an inherited, non-overridden
    // method compiled fresh for Derived still needs to agree with Base
    // on #name's slot) -- this pass is what stops a DERIVED class's OWN
    // method text from reaching an ancestor's private slot it never
    // declared itself, since the offset map alone can't tell the two
    // cases apart. ownerClass is the exact class whose body the checked
    // text belongs to (a method/constructor/field-initializer's own
    // className) -- never the leaf class being compiled.
    validatePrivateRefs: function(text, ownerClass, owners, label) {
      if (!text) return;
      var re = /this\.(#\w+)/g;
      var m;
      while ((m = re.exec(text)) !== null) {
        var name = m[1];
        var declaredIn = owners[name];
        if (!declaredIn || !declaredIn[ownerClass]) {
          throw new Error('RegX: Private field \'' + name + '\' must be declared in an enclosing class (' +
            label + (ownerClass ? ' of class ' + ownerClass : '') + ' references ' + name +
            (declaredIn ? ', but it is only declared in ' + Object.keys(declaredIn).join(', ') : ', which is never declared') + ')');
        }
      }
    },

    // [rootAncestor, ..., immediateParent, className] -- the chain of
    // classes className is built from, root first. A class with no
    // `extends` clause is its own one-element chain, exactly matching
    // buildWasmPropertyMap's existing single-class behavior.
    classAncestryChain: function(ast, className) {
      var blocks = ast.blocks || [];
      var chain = [];
      var seen = {};
      var current = className;
      while (current && !seen[current]) {
        seen[current] = true;
        chain.unshift(current);
        var block = blocks.filter(function(b) { return b.type === 'class' && b.name === current; })[0];
        current = block ? block.extendsName : null;
      }
      return chain;
    },

    // Same slot layout as buildWasmPropertyMap, but merging an entire
    // ancestry chain: the root class's own properties get the lowest
    // offsets, each more-derived class's NEW properties are appended
    // after -- so a Base method compiled against Base's own property map
    // and a Derived method compiled against this merged map agree on
    // every inherited field's offset exactly, letting inherited methods
    // (compiled fresh here, not reused unchanged) work correctly on a
    // Derived instance without any per-field translation.
    buildWasmPropertyMapForChain: function(ast, classNames) {
      var offsets = {};
      var types = {};
      var elementTypes = {};
      var nullable = {};
      var objectShapes = {};
      var properties = ast.properties || [];
      var nextOffset = 0;
      for (var ci = 0; ci < classNames.length; ci++) {
        var cn = classNames[ci];
        for (var i = 0; i < properties.length; i++) {
          if (properties[i].className !== cn) continue;
          var key = properties[i].key;
          // A more-derived class re-assigning the SAME key (real JS
          // shadowing) keeps the ancestor's original slot -- one field,
          // not a second one appended after.
          if (Object.prototype.hasOwnProperty.call(offsets, key)) continue;
          offsets[key] = nextOffset;
          if (this.propertyIsObjectKeysAssignment(ast, key, cn)) {
            types[key] = 'array';
            elementTypes[key] = 'string';
            nextOffset += 8;
          } else if (this.propertyIsArray(ast, key, cn)) {
            types[key] = 'array';
            elementTypes[key] = this.arrayElementIsFunction(ast, key, cn) ? 'function' :
              (this.arrayElementIsFloat(ast, key, cn) ? 'f64' : 'i64');
            nextOffset += 8;
          } else if (this.propertyIsObject(ast, key, cn)) {
            types[key] = 'object';
            objectShapes[key] = this.objectShapeFor(ast, key, cn);
            nextOffset += 8;
          } else if (this.propertyIsString(ast, key, cn)) {
            types[key] = 'string';
            nextOffset += 8;
          } else if (this.propertyIsNullable(ast, key, cn)) {
            types[key] = this.propertyIsFloat(ast, key, cn) ? 'f64' : 'i64';
            nullable[key] = true;
            nextOffset += 16;
          } else {
            types[key] = this.propertyIsFloat(ast, key, cn) ? 'f64' : 'i64';
            nextOffset += 8;
          }
        }
      }
      return { offsets: offsets, types: types, elementTypes: elementTypes, nullable: nullable, objectShapes: objectShapes };
    },

    parseStatements: function(body) {
      return this.parseStatementList(body);
    },

    // Multi-line, brace-aware statement parser. Replaces the old one-regex-
    // per-line scanner so if/while/switch/try bodies (which span lines and
    // nest braces) are parsed as real blocks, not silently skipped by the
    // per-line matcher. ASI (no trailing ';') falls out of findStatementEnd
    // treating an unescaped newline as a statement terminator too.
    parseStatementList: function(body) {
      var statements = [];
      var i = 0;
      var n = body.length;

      while (i < n) {
        while (i < n && /\s/.test(body[i])) i++;
        if (i >= n) break;

        if (body[i] === '/' && body[i + 1] === '/') {
          while (i < n && body[i] !== '\n') i++;
          continue;
        }
        if (body[i] === '/' && body[i + 1] === '*') {
          i += 2;
          while (i < n && !(body[i] === '*' && body[i + 1] === '/')) i++;
          i += 2;
          continue;
        }

        var rest = body.slice(i);
        var kwMatch = rest.match(/^(if|while|for|try|switch)\b/);

        if (kwMatch && kwMatch[1] === 'if') {
          var parsedIf = this.parseIfStatement(body, i);
          statements.push(parsedIf.stmt);
          i = parsedIf.end;
          continue;
        }

        if (kwMatch && kwMatch[1] === 'while') {
          var parsedWhile = this.parseWhileStatement(body, i);
          statements.push(parsedWhile.stmt);
          i = parsedWhile.end;
          continue;
        }

        if (kwMatch && kwMatch[1] === 'for') {
          var parsedFor = this.parseForStatement(body, i);
          statements = statements.concat(parsedFor.stmts);
          i = parsedFor.end;
          continue;
        }

        if (kwMatch && kwMatch[1] === 'try') {
          // Nothing in RegX's supported grammar can throw, so the try body
          // always runs to completion; splice it in directly and drop the
          // (unreachable) catch block rather than leaving try/catch unparsed.
          var parsedTry = this.parseTryStatement(body, i);
          statements = statements.concat(parsedTry.stmts);
          i = parsedTry.end;
          continue;
        }

        if (kwMatch && kwMatch[1] === 'switch') {
          var parsedSwitch = this.parseSwitchStatement(body, i);
          statements = statements.concat(parsedSwitch.stmts);
          i = parsedSwitch.end;
          continue;
        }

        var end = this.findStatementEnd(body, i);
        var stmtText = body.slice(i, end).trim();
        i = end;
        if (body[i] === ';') i++;

        if (!stmtText) continue;

        var returnMatch = stmtText.match(/^return\s+(.+)$/);
        if (returnMatch) {
          statements.push({ type: 'return', value: returnMatch[1].trim() });
          continue;
        }

        // yield EXPR; -- only meaningful inside a generator method (see
        // buildGeneratorUnit); compileStatementToWasm throws a specific
        // error if one is ever reached OUTSIDE that context, rather than
        // silently dropping it the way an unrecognized statement always
        // used to.
        var yieldMatch = stmtText.match(/^yield\s+(.+)$/);
        if (yieldMatch) {
          statements.push({ type: 'yield', value: yieldMatch[1].trim() });
          continue;
        }

        // let/const/var NAME = EXPR; -- a real local variable, not a
        // rejection: in an ordinary method it gets its own WASM local
        // (allocateLocalDecls, mirroring how destructured bindings get
        // theirs); inside a generator body every local instead becomes a
        // hidden per-instance property, since a WASM local can't survive
        // between separate .next() calls the way a generator's own
        // local state has to (see buildGeneratorUnit's rewrite pass).
        var localDeclMatch = stmtText.match(/^(?:let|const|var)\s+(\w+)\s*=\s*(.+)$/);
        if (localDeclMatch) {
          statements.push({ type: 'localDecl', name: localDeclMatch[1], value: localDeclMatch[2].trim() });
          continue;
        }

        // NAME++ / NAME-- / NAME += EXPR / NAME -= EXPR / NAME *= EXPR /
        // NAME /= EXPR -- compound mutation of an existing local (this.x
        // += ... is handled separately above/below, for PROPERTIES).
        var localIncDecMatch = stmtText.match(/^(\w+)\s*(\+\+|--)$/);
        if (localIncDecMatch) {
          var lidOp = localIncDecMatch[2] === '++' ? '+' : '-';
          statements.push({ type: 'localAssign', name: localIncDecMatch[1], value: localIncDecMatch[1] + ' ' + lidOp + ' 1' });
          continue;
        }
        var localCompoundMatch = stmtText.match(/^(\w+)\s*(\+|-|\*|\/)=\s*(.+)$/);
        if (localCompoundMatch) {
          statements.push({ type: 'localAssign', name: localCompoundMatch[1], value: localCompoundMatch[1] + ' ' + localCompoundMatch[2] + ' (' + localCompoundMatch[3].trim() + ')' });
          continue;
        }

        // NAME = EXPR; -- plain mutation of an existing local (bare,
        // no this. prefix -- that case is handled below for properties).
        var localAssignMatch = stmtText.match(/^(\w+)\s*=\s*(.+)$/);
        if (localAssignMatch) {
          statements.push({ type: 'localAssign', name: localAssignMatch[1], value: localAssignMatch[2].trim() });
          continue;
        }

        // this.x[i] = ...; — real array index assignment. Only a single
        // bracketed index is supported (no multi-dimensional arrays); the
        // index expression and the RHS value are both compiled as
        // ordinary expressions later, by compileArrayIndexSetToWasm.
        var arraySetMatch = stmtText.match(/^this\.(\w+)\s*\[([\s\S]+)\]\s*=\s*(.+)$/);
        if (arraySetMatch) {
          statements.push({ type: 'arrayIndexSet', key: arraySetMatch[1], indexExpr: arraySetMatch[2].trim(), value: arraySetMatch[3].trim() });
          continue;
        }

        // this.arr.push(EXPR); — real array growth (see
        // compileArrayPushToWasm): a genuine runtime allocate-copy-append,
        // not a rejection or a fixed-size-only restriction.
        var pushMatch = stmtText.match(/^this\.(\w+)\.push\(([\s\S]*)\)$/);
        if (pushMatch) {
          statements.push({ type: 'arrayPush', key: pushMatch[1], value: pushMatch[2].trim() });
          continue;
        }

        // this.listeners[i](); — a real, dynamic call_indirect dispatch
        // through a function-typed array element (see
        // compileDynamicArrayCallToWasm): the callee itself, not just its
        // arguments, is only known at runtime. v1 scope matches this
        // compiler's existing closure convention: no user arguments.
        var dynCallMatch = stmtText.match(/^this\.(\w+)\[([\s\S]+)\]\(\)$/);
        if (dynCallMatch) {
          statements.push({ type: 'dynamicCall', key: dynCallMatch[1], indexExpr: dynCallMatch[2].trim() });
          continue;
        }

        // Compound assignment (this.x += 1;) desugars to a plain
        // assignment (this.x = this.x + 1;) and reuses all existing
        // assignment codegen — it previously matched no statement
        // pattern and was silently dropped, never applied even wrongly.
        var compoundMatch = stmtText.match(/^this\.(\w+)\s*(\+|-|\*|\/)=\s*(.+)$/);
        if (compoundMatch) {
          var cKey = compoundMatch[1], cOp = compoundMatch[2], cRhs = compoundMatch[3].trim();
          statements.push({ type: 'assign', key: cKey, value: 'this.' + cKey + ' ' + cOp + ' (' + cRhs + ')' });
          continue;
        }

        var assignMatch = stmtText.match(/^this\.(#?\w+)\s*=\s*(.+)$/);
        if (assignMatch) {
          var assignRhs = assignMatch[2].trim();
          // this.arr = [1, 2, 3]; — array literal construction: the
          // INITIAL element count and every element expression are known
          // entirely at compile time (no bounds checking on indexed
          // reads/writes); this.arr.push(EXPR) afterward (see
          // compileArrayPushToWasm) genuinely grows it further at
          // runtime.
          if (/^\[[\s\S]*\]$/.test(assignRhs)) {
            var elemTexts = splitTopLevelArgs(assignRhs.slice(1, -1));
            statements.push({ type: 'arrayInit', key: assignMatch[1], elements: elemTexts });
            continue;
          }
          // this.f = (a, b) => a + b;  /  this.f = x => x * 2;  /  this.f = () => 9;
          // A real, callable closure -- see buildClassUnit's closure
          // collection and the arrowInit codegen for how captured
          // variables and the call_indirect dispatch are compiled.
          var arrowMatch = assignRhs.match(/^\(([^)]*)\)\s*=>\s*([\s\S]+)$/) ||
            assignRhs.match(/^([a-zA-Z_]\w*)\s*=>\s*([\s\S]+)$/);
          if (arrowMatch) {
            var arrowParams = arrowMatch[1].split(',').map(function(p) { return p.trim(); }).filter(function(p) { return p; });
            statements.push({ type: 'arrowInit', key: assignMatch[1], params: arrowParams, exprText: arrowMatch[2].trim() });
            continue;
          }
          // this.obj = { a: 1, b: 2 };  — a real object literal, fixed
          // named fields known entirely at compile time (see
          // objectShapeFor, which independently infers each field's
          // TYPE for the property map). Field value TEXT is captured
          // here, from the real per-statement text (not comma-truncated,
          // unlike propRegex's own value capture).
          if (/^\{[\s\S]*\}$/.test(assignRhs)) {
            var fieldTexts = splitTopLevelArgs(assignRhs.slice(1, -1));
            var fields = fieldTexts.map(function(ft) {
              var colonIdx = ft.indexOf(':');
              if (colonIdx === -1) {
                throw new Error('RegX: malformed object literal field (expected name: value): ' + ft);
              }
              return { name: ft.slice(0, colonIdx).trim(), valueText: ft.slice(colonIdx + 1).trim() };
            });
            statements.push({ type: 'objectInit', key: assignMatch[1], fields: fields });
            continue;
          }
          // this.name = "hello";  — a real string literal, heap-
          // allocated same as an array (length-prefixed byte buffer).
          // v1 scope: the literal text itself can't contain a comma or
          // semicolon -- this compiler's own statement/property scanners
          // aren't quote-aware (findStatementEnd and propRegex both scan
          // for those characters at face value, a pre-existing gap this
          // doesn't attempt to fix), so a literal containing either would
          // already have been mis-split before reaching here.
          var stringLitMatch = assignRhs.match(/^["'`]([^"'`]*)["'`]$/);
          if (stringLitMatch) {
            statements.push({ type: 'stringInit', key: assignMatch[1], text: stringLitMatch[1] });
            continue;
          }
          statements.push({ type: 'assign', key: assignMatch[1], value: assignRhs });
          continue;
        }

        // const { a, b } = this.obj;  /  let { a } = this.obj;
        // Real destructuring: each named binding becomes a genuine new
        // local, read from this.obj's own compile-time-known field
        // offset (see objectShapeFor) -- not a rejection, and not a
        // guess: this.obj MUST already be a real, statically-known
        // object-shaped property (built by buildFunctionBody scanning
        // for these before the locals section is emitted).
        var destructureMatch = stmtText.match(/^(?:const|let|var)\s*\{\s*([^}]*)\}\s*=\s*this\.(\w+)\s*$/);
        if (destructureMatch) {
          var destructureNames = destructureMatch[1].split(',').map(function(p) { return p.trim(); }).filter(function(p) { return p; });
          statements.push({ type: 'destructure', names: destructureNames, sourceKey: destructureMatch[2] });
          continue;
        }

        // A call-shaped statement. A recognized host import (console.log)
        // gets a real 'call' node -- the Import Section machinery gives it
        // an actual WASM encoding. Anything else (Math.floor(x);
        // this.arr.push(1);) has no call/host-import machinery to target,
        // so it previously matched no known pattern and silently vanished
        // (the call disappeared without a trace). Reject it loudly and
        // specifically instead of leaving it unparsed.
        // The callee/open-paren is found with a plain regex, but the
        // matching close paren is found with findMatchingParen (like
        // every other paren-pair in this file), not a `[^)]*` char class
        // -- a `[^)]*` class can never match an import call whose OWN
        // argument is itself parenthesized (console.log((x**2));, a real,
        // reachable shape once a print statement's argument is any
        // arithmetic expression instead of a bare identifier), so it
        // would silently fail to match at all and fall through to the
        // "unrecognized statement" rejection below for genuinely valid
        // input.
        var callHeadMatch = stmtText.match(/^([\w.]+)\(/);
        if (callHeadMatch && KNOWN_IMPORTS[callHeadMatch[1]]) {
          var callClose = this.findMatchingParen(stmtText, 0);
          if (callClose === stmtText.length - 1) {
            var callArgsText = stmtText.slice(callHeadMatch[0].length, callClose);
            var callArgs = callArgsText.trim() ? splitTopLevelArgs(callArgsText) : [];
            statements.push({ type: 'call', callee: callHeadMatch[1], args: callArgs });
            continue;
          }
        }
        // A Math intrinsic used for its side-effect-free result, then
        // discarded (Math.floor(x); with no assignment) — real, not
        // rejected: compiles the expression normally and drops the
        // value WASM otherwise requires be consumed before the next
        // statement.
        if (/^[a-zA-Z_][\w.]*\(/.test(stmtText) && KNOWN_INTRINSICS[/^([a-zA-Z_][\w.]*)\(/.exec(stmtText)[1]]) {
          statements.push({ type: 'exprStatement', value: stmtText });
          continue;
        }
        // this.f(args); / this.method(args); as a bare statement -- a
        // real closure call or sibling-method call, used for its side
        // effect and its value discarded. Whether `f`/`method` is
        // actually callable isn't knowable yet at parse time (propertyMap
        // doesn't exist until buildWasmPropertyMap runs) -- compiled as
        // an ordinary expression statement, which naturally throws its
        // own specific, honest error at compile time if it turns out not
        // to name a real closure or method.
        if (/^this\.\w+\([\s\S]*\)$/.test(stmtText)) {
          statements.push({ type: 'exprStatement', value: stmtText });
          continue;
        }
        if (/^[\w.]+\([\s\S]*\)$/.test(stmtText)) {
          throw new Error('RegX: function/method calls are not supported (no call machinery exists in this compiler): ' + stmtText);
        }
      }
      return statements;
    },

    // Index of the ')' matching the '(' at-or-after openIdx.
    findMatchingParen: function(str, openIdx) {
      var start = str.indexOf('(', openIdx);
      var depth = 0;
      for (var i = start; i < str.length; i++) {
        if (str[i] === '(') depth++;
        else if (str[i] === ')') {
          depth--;
          if (depth === 0) return i;
        }
      }
      throw new Error('RegX: unmatched ( in: ' + str.slice(start, start + 40));
    },

    // Index of the ']' matching the '[' at-or-after openIdx. Same
    // algorithm as findMatchingParen, for array-index bracket pairs.
    findMatchingBracket: function(str, openIdx) {
      var start = str.indexOf('[', openIdx);
      var depth = 0;
      for (var i = start; i < str.length; i++) {
        if (str[i] === '[') depth++;
        else if (str[i] === ']') {
          depth--;
          if (depth === 0) return i;
        }
      }
      throw new Error('RegX: unmatched [ in: ' + str.slice(start, start + 40));
    },

    // First unescaped ';' or '\n' at paren-depth 0, starting at `start`.
    findStatementEnd: function(body, start) {
      var i = start;
      var n = body.length;
      var depth = 0;
      while (i < n) {
        var ch = body[i];
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        else if (depth === 0 && (ch === ';' || ch === '\n')) return i;
        i++;
      }
      return n;
    },

    parseIfStatement: function(body, start) {
      var n = body.length;
      var condClose = this.findMatchingParen(body, start);
      var condOpen = body.indexOf('(', start);
      var cond = body.slice(condOpen + 1, condClose).trim();

      var j = condClose + 1;
      while (j < n && /\s/.test(body[j])) j++;
      if (body[j] !== '{') {
        throw new Error('RegX: if statement requires a { } block');
      }
      var thenBlock = this.extractBlock(body, j);
      var thenStmts = this.parseStatementList(thenBlock.content.slice(1, -1));

      var k = thenBlock.end;
      var m = k;
      while (m < n && /\s/.test(body[m])) m++;

      var elseStmts = null;
      if (body.slice(m, m + 4) === 'else') {
        var e = m + 4;
        while (e < n && /\s/.test(body[e])) e++;
        if (body.slice(e, e + 2) === 'if') {
          var nested = this.parseIfStatement(body, e);
          elseStmts = [nested.stmt];
          k = nested.end;
        } else if (body[e] === '{') {
          var elseBlock = this.extractBlock(body, e);
          elseStmts = this.parseStatementList(elseBlock.content.slice(1, -1));
          k = elseBlock.end;
        } else {
          throw new Error('RegX: else must be followed by { } or if');
        }
      }

      return {
        stmt: { type: 'if', cond: cond, then: thenStmts, else: elseStmts },
        end: k
      };
    },

    parseWhileStatement: function(body, start) {
      var n = body.length;
      var condClose = this.findMatchingParen(body, start);
      var condOpen = body.indexOf('(', start);
      var cond = body.slice(condOpen + 1, condClose).trim();

      var j = condClose + 1;
      while (j < n && /\s/.test(body[j])) j++;
      if (body[j] !== '{') {
        throw new Error('RegX: while statement requires a { } block');
      }
      var block = this.extractBlock(body, j);
      var stmts = this.parseStatementList(block.content.slice(1, -1));

      return {
        stmt: { type: 'while', cond: cond, body: stmts },
        end: block.end
      };
    },

    // Splits a for-loop header (the text between its outer parens) into
    // [init, condition, update] on top-level ';' only -- paren-depth
    // aware so a condition/update containing its own parens (a method
    // call's argument list, say) doesn't get mis-split on a ';' that was
    // never actually a header separator. There is no bracket tracking:
    // a real for-header's own ';'s never sit inside a bracket pair.
    splitForHeaderParts: function(text) {
      var parts = [];
      var depth = 0, start = 0;
      for (var i = 0; i < text.length; i++) {
        var ch = text[i];
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        else if (ch === ';' && depth === 0) {
          parts.push(text.slice(start, i));
          start = i + 1;
        }
      }
      parts.push(text.slice(start));
      return parts;
    },

    // `for (let i = 0; i < COND; i = i + 1) { BODY }` -- desugared at
    // PARSE time into [initStmt, whileStmt{cond, body: BODY + updateStmt}]
    // rather than given its own dedicated codegen path: every downstream
    // consumer (inferReturnType, allocateLocalDeclLocals,
    // compileStatementToWasm's own 'while' case) already knows how to
    // walk a 'while' node correctly (including recursing into nested
    // ones), so reusing that shape for real gets a fully working for-loop
    // with no new codegen at all, and no risk of the two forms silently
    // drifting apart later. Real JS's post-condition update-after-body
    // ordering is preserved exactly by appending the update statement to
    // the end of the parsed body, not by any special-casing in the loop
    // driver itself.
    parseForStatement: function(body, start) {
      var n = body.length;
      var parenOpen = body.indexOf('(', start);
      var parenClose = this.findMatchingParen(body, start);
      var headerText = body.slice(parenOpen + 1, parenClose);
      var parts = this.splitForHeaderParts(headerText);
      if (parts.length !== 3) {
        throw new Error('RegX: for loop requires init; condition; update (got: ' + headerText + ')');
      }
      var initText = parts[0].trim();
      var condText = parts[1].trim();
      var updateText = parts[2].trim();

      var j = parenClose + 1;
      while (j < n && /\s/.test(body[j])) j++;
      if (body[j] !== '{') {
        throw new Error('RegX: for statement requires a { } block');
      }
      var block = this.extractBlock(body, j);
      var bodyStmts = this.parseStatementList(block.content.slice(1, -1));

      var initStmts = initText ? this.parseStatementList(initText) : [];
      var updateStmts = updateText ? this.parseStatementList(updateText) : [];
      if (initStmts.length !== 1 || initStmts[0].type !== 'localDecl') {
        throw new Error('RegX: for loop init clause must be a single let/const/var declaration (got: ' + initText + ')');
      }
      if (updateStmts.length !== 1) {
        throw new Error('RegX: for loop update clause must be a single assignment (got: ' + updateText + ')');
      }
      if (!condText) {
        throw new Error('RegX: for loop requires a real condition (an infinite for(;;) loop has no representation here): ' + headerText);
      }

      var whileStmt = { type: 'while', cond: condText, body: bodyStmts.concat(updateStmts) };
      return { stmts: [initStmts[0], whileStmt], end: block.end };
    },

    parseTryStatement: function(body, start) {
      var n = body.length;
      var j = start + 3; // 'try'
      while (j < n && /\s/.test(body[j])) j++;
      if (body[j] !== '{') {
        throw new Error('RegX: try statement requires a { } block');
      }
      var tryBlock = this.extractBlock(body, j);
      var stmts = this.parseStatementList(tryBlock.content.slice(1, -1));

      var k = tryBlock.end;
      var m = k;
      while (m < n && /\s/.test(body[m])) m++;

      if (body.slice(m, m + 5) === 'catch') {
        var c = m + 5;
        while (c < n && /\s/.test(body[c])) c++;
        if (body[c] === '(') {
          c = this.findMatchingParen(body, c) + 1;
          while (c < n && /\s/.test(body[c])) c++;
        }
        if (body[c] !== '{') {
          throw new Error('RegX: catch requires a { } block');
        }
        var catchBlock = this.extractBlock(body, c);
        k = catchBlock.end;
      }

      return { stmts: stmts, end: k };
    },

    parseSwitchStatement: function(body, start) {
      var n = body.length;
      var exprClose = this.findMatchingParen(body, start);
      var exprOpen = body.indexOf('(', start);
      var discriminant = body.slice(exprOpen + 1, exprClose).trim();

      var j = exprClose + 1;
      while (j < n && /\s/.test(body[j])) j++;
      if (body[j] !== '{') {
        throw new Error('RegX: switch statement requires a { } block');
      }
      var block = this.extractBlock(body, j);
      var inner = block.content.slice(1, -1);

      var labelRegex = /(case\s+([^:]+)|default)\s*:/g;
      var groups = [];
      var lastIndex = 0;
      var lastGroup = null;
      var m;
      while ((m = labelRegex.exec(inner)) !== null) {
        if (lastGroup) lastGroup.raw = inner.slice(lastIndex, m.index);
        var isDefault = m[2] === undefined;
        lastGroup = { value: isDefault ? null : m[2].trim(), isDefault: isDefault, raw: '' };
        groups.push(lastGroup);
        lastIndex = labelRegex.lastIndex;
      }
      if (lastGroup) lastGroup.raw = inner.slice(lastIndex);

      for (var g = 0; g < groups.length; g++) {
        var breakMatch = groups[g].raw.match(/^([\s\S]*?)\bbreak\s*;\s*$/);
        groups[g].stmts = this.parseStatementList(breakMatch ? breakMatch[1] : groups[g].raw);
        groups[g].breaks = !!breakMatch;
      }

      function endsInReturn(stmts) {
        return stmts.length > 0 && stmts[stmts.length - 1].type === 'return';
      }

      // Real JS fallthrough: a case without a break (and not ending in
      // return) absorbs every following case's statements up to and
      // including the next one that does break (or ends in return).
      for (var g2 = 0; g2 < groups.length; g2++) {
        if (groups[g2].breaks || endsInReturn(groups[g2].stmts)) continue;
        for (var f = g2 + 1; f < groups.length; f++) {
          groups[g2].stmts = groups[g2].stmts.concat(groups[f].stmts);
          if (groups[f].breaks || endsInReturn(groups[f].stmts)) break;
        }
      }

      var cases = groups.filter(function(g) { return !g.isDefault; });
      var defaultGroup = groups.filter(function(g) { return g.isDefault; })[0];

      var chain = defaultGroup ? defaultGroup.stmts : [];
      for (var c2 = cases.length - 1; c2 >= 0; c2--) {
        chain = [{
          type: 'if',
          cond: discriminant + ' == ' + cases[c2].value,
          then: cases[c2].stmts,
          else: chain.length ? chain : null
        }];
      }

      return { stmts: chain, end: block.end };
    }
  };

  // ─── Helpers ──────────────────────────────────────────────────
  
  function leb128Encode(value) {
    var bytes = [];
    var more = true;
    while (more) {
      var byte = value & 0x7F;
      value >>>= 7;
      if (value === 0) {
        more = false;
      } else {
        byte |= 0x80;
      }
      bytes.push(byte);
    }
    return bytes;
  }

  // WASM's i32.const operand is SIGNED LEB128 (unlike indices/counts/sizes,
  // which are unsigned) — encoding a constant like 99 (0b1100011, sign bit
  // of its low 7 bits set) with the unsigned encoder above produces a
  // single byte the decoder reads back as -29, since a signed LEB128
  // decoder sign-extends whenever the final byte's bit 6 is set. Any i32
  // constant needs this encoder specifically; index/count/size fields
  // elsewhere correctly keep using the unsigned one.
  function leb128EncodeSigned(value) {
    var bytes = [];
    var more = true;
    while (more) {
      var byte = value & 0x7F;
      value >>= 7; // arithmetic shift: preserves sign
      if ((value === 0 && (byte & 0x40) === 0) || (value === -1 && (byte & 0x40) !== 0)) {
        more = false;
      } else {
        byte |= 0x80;
      }
      bytes.push(byte);
    }
    return bytes;
  }

  // Same algorithm as leb128EncodeSigned, but for i64.const operands.
  // JS's `&`/`>>`/`<<` bitwise operators coerce their operands to i32
  // first, silently truncating anything beyond 32 bits — a value in the
  // i64 range needs BigInt arithmetic throughout, not just a wider input.
  function leb128EncodeSignedBig(value) {
    value = BigInt(value);
    var bytes = [];
    var more = true;
    while (more) {
      var byte = Number(value & 0x7Fn);
      value >>= 7n; // BigInt arithmetic shift: preserves sign
      if ((value === 0n && (byte & 0x40) === 0) || (value === -1n && (byte & 0x40) !== 0)) {
        more = false;
      } else {
        byte |= 0x80;
      }
      bytes.push(byte);
    }
    return bytes;
  }

  function stringToBytes(str) {
    var bytes = [];
    for (var i = 0; i < str.length; i++) {
      bytes.push(str.charCodeAt(i));
    }
    return bytes;
  }

  // ─── Compose with ExtendX ──────────────────────────────────
  
  var RegX = ExtendX.extend(
    RegXCore,
    JavaScriptMixin,
    WATGeneratorMixin,
    WasmBinaryGeneratorMixin,
    { order: 'left-right' }
  );

  // ─── Static Helpers ────────────────────────────────────────
  
  RegX.javascriptToWAT = function(source) {
    var instance = new RegX();
    instance.parse(source);
    return instance.generateWAT();
  };

  RegX.javascriptToWasm = function(source) {
    var instance = new RegX();
    instance.parse(source);
    return instance.generateWasm();
  };

  RegX.compileAndRun = function(source, imports) {
    var instance = new RegX();
    return instance.compileAndRun(source, imports);
  };

  RegX.enableDebug = function() {
    enableDebug();
    return RegX;
  };

  RegX.disableDebug = function() {
    disableDebug();
    return RegX;
  };

  RegX.hexDump = hexDump;
  RegX.getDebugLog = getDebugLog;
  RegX.clearDebugLog = clearDebugLog;

  // ─── Expose ──────────────────────────────────────────────────

  if (typeof window !== 'undefined') {
    window.RegX = RegX;
  }

  return RegX;

}));