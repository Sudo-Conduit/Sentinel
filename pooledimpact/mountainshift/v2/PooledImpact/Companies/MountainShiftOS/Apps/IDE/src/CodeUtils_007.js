/**
 * CodeUtils_007 — Code Analysis with Fixed Parser
 * 
 * Fixes:
 *   1. Control flow statements no longer parsed as functions
 *   2. Max/Min LOC NaN fixed
 *   3. BaseClassX metrics calculated from source code
 *   4. Call Graph properly built
 *   5. Function detection refined
 *   6. Better visibility detection
 * 
 * Features:
 *   - Auto-detect if class has no function comments
 *   - Auto-inject open/close tags if needed
 *   - String or Class input (auto-detects)
 *   - Line range display
 *   - Public/Private API (functions starting with _ are private)
 *   - All metrics (LOC, Complexity, Call Graph, Smells, Coverage, Performance)
 *   - BaseClassX built-ins (KB, estTokens, hash) calculated from source
 * 
 * Usage:
 *   var utils = new CodeUtils_007(BaseClassX, 'BaseClassX.js');
 *   var report = utils.generateFullReport('BaseClassX Analysis');
 *   utils.printFullReport();
 */

(function(root, factory) {
  'use strict';
  
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CodeUtils_007 = factory();
  }
}(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  var BaseClassX = (typeof globalThis !== 'undefined' && globalThis.BaseClassX) ||
                   (typeof window !== 'undefined' && window.BaseClassX) ||
                   null;

  if (!BaseClassX) {
    console.warn('⚠️ CodeUtils_007: BaseClassX not found. Using fallback mode.');
  }

  // ─── Control Flow Keywords ──────────────────────────────────────────────

  var CONTROL_FLOW = new Set([
    'if', 'for', 'while', 'do', 'switch', 'catch', 'with', 'try',
    'else', 'case', 'default', 'return', 'throw', 'finally'
  ]);

  // ─── Sample Class ──────────────────────────────────────────────────────────

  var SampleClassSource = `
  class SampleClass {
    constructor(name) {
      this.name = name;
      this.data = [];
      this.cache = new Map();
    }
  
    addItem(item) {
      this.data.push(item);
      this.cache.set(item.id, item);
      return this;
    }
  
    removeItem(index) {
      if (index >= 0 && index < this.data.length) {
        var item = this.data[index];
        this.data.splice(index, 1);
        if (item) this.cache.delete(item.id);
        return true;
      }
      return false;
    }
  
    getItem(index) {
      return this.data[index] || null;
    }
  
    getAllItems() {
      return this.data;
    }
  
    clearAll() {
      this.data = [];
      this.cache.clear();
      return this;
    }
  
    count() {
      return this.data.length;
    }
  
    findItem(predicate) {
      for (var i = 0; i < this.data.length; i++) {
        if (predicate(this.data[i])) {
          return this.data[i];
        }
      }
      return null;
    }
  
    mapItems(callback) {
      var result = [];
      for (var i = 0; i < this.data.length; i++) {
        result.push(callback(this.data[i]));
      }
      return result;
    }
  
    filterItems(callback) {
      var result = [];
      for (var i = 0; i < this.data.length; i++) {
        if (callback(this.data[i])) {
          result.push(this.data[i]);
        }
      }
      return result;
    }
  
    reduceItems(callback, initial) {
      var accumulator = initial;
      for (var i = 0; i < this.data.length; i++) {
        accumulator = callback(accumulator, this.data[i]);
      }
      return accumulator;
    }
  
    processItems(options) {
      var results = [];
      var threshold = options.threshold || 0;
      var limit = options.limit || 10;
      
      for (var i = 0; i < this.data.length; i++) {
        var item = this.data[i];
        if (item.value > threshold) {
          if (item.type === 'A') {
            results.push(this._processTypeA(item));
          } else if (item.type === 'B') {
            results.push(this._processTypeB(item));
          } else {
            results.push(this._processTypeC(item));
          }
        }
        if (results.length >= limit) break;
      }
      return results;
    }
  
    _processTypeA(item) {
      return { result: item.value * 2, type: 'A' };
    }
  
    _processTypeB(item) {
      return { result: item.value * 3, type: 'B' };
    }
  
    _processTypeC(item) {
      return { result: item.value * 4, type: 'C' };
    }
  
    _validateItem(item) {
      return item && item.value !== undefined && typeof item.value === 'number';
    }
  
    _logOperation(name, data) {
      if (this._debug) {
        console.log('[DEBUG]', name, data);
      }
    }
  }
  `;

  // ─── CodeUtils_007 Class ────────────────────────────────────────────────

  function CodeUtils_007(source, fileName) {
    var sourceCode = '';
    var sourceType = 'unknown';
    
    if (typeof source === 'string') {
      sourceCode = source;
      sourceType = 'string';
    } else if (typeof source === 'function' || (typeof source === 'object' && source && source.toString)) {
      sourceCode = source.toString();
      sourceType = 'class';
    } else {
      console.warn('⚠️ CodeUtils_007: source must be a string or a class. Got:', typeof source);
      sourceCode = '';
      sourceType = 'empty';
    }
    
    if (BaseClassX) {
      var base = new BaseClassX({ 
        type: 'CodeUtils_007', 
        name: 'Code Utility v7' 
      });
      for (var key in base) {
        if (base.hasOwnProperty(key)) {
          this[key] = base[key];
        }
      }
    }
    
    // ─── BaseClassX metrics from source ──────────────────────────────────
    var charCount = sourceCode ? sourceCode.length : 0;
    
    this.sourceCode = sourceCode;
    this.rawSource = source;
    this.inputType = sourceType;
    this.fileName = fileName || 'unknown.js';
    this.lineCount = sourceCode ? sourceCode.split('\n').length : 0;
    this.charCount = charCount;
    this.estSizeKB = charCount / 1024;
    this.tokenEstimate = charCount / 4.5;
    this.maxIndentDepth = this._calculateMaxIndentDepth(sourceCode);
    this.topLevelCount = this._countTopLevelElements(sourceCode);
    
    this.functions = [];
    this.index = {};
    this.report = null;
    this.callGraph = {};
    this.coverage = {};
    this.smells = {};
    this.performance = {};
    this.visibility = { public: 0, private: 0 };
    this._autoInjected = false;
    this._originalSource = sourceCode;
    
    // ─── Build index ──────────────────────────────────────────────────────
    this._buildIndex();
    
    // ─── Auto-detect: No functions found? ──────────────────────────────
    if (this.functions.length === 0 && this.sourceCode) {
      console.log('🔧 Auto-detect: No functions found. Injecting comments...');
      
      var potentialFunctions = this._countPotentialFunctions(sourceCode);
      if (potentialFunctions > 0) {
        console.log('   Found ' + potentialFunctions + ' potential functions. Adding open/close tags...');
        var withComments = this.injectComments(sourceCode);
        this.sourceCode = withComments;
        this._autoInjected = true;
        this._buildIndex();
        console.log('   ✅ Injected ' + this.functions.length + ' functions.');
      } else {
        console.log('   No functions found in source.');
      }
    }
    
    // ─── Analyze ──────────────────────────────────────────────────────────
    if (this.functions.length > 0) {
      this._analyzeAll();
    }
    
    if (typeof this.recordEvent === 'function') {
      this.recordEvent('codeutils_initialized', { 
        fileName: this.fileName, 
        lineCount: this.lineCount,
        inputType: this.inputType,
        functionCount: this.functions.length,
        autoInjected: this._autoInjected
      });
    }
    
    return this;
  }

  // Note: intentionally NOT inheriting BaseClassX.prototype — BaseClassX defines
  // charCount/estSizeKB/tokenEstimate/maxIndentDepth/topLevelCount as getter-only
  // accessors, which collide (throw in strict mode) with this constructor's own
  // instance properties of the same names. CodeUtils_007 never calls the
  // BaseClassX constructor and doesn't rely on its instance methods, so no
  // inheritance is needed here.

  CodeUtils_007.SampleClass = SampleClassSource;

  // ─── Helper: Calculate Max Indent Depth ─────────────────────────────────

  CodeUtils_007.prototype._calculateMaxIndentDepth = function(code) {
    if (!code || typeof code !== 'string') return 0;
    
    var lines = code.split('\n');
    var maxDepth = 0;
    
    for (var i = 0; i < lines.length; i++) {
      var match = lines[i].match(/^(\s*)/);
      if (match) {
        var depth = match[1].length;
        if (depth > maxDepth) maxDepth = depth;
      }
    }
    
    return Math.floor(maxDepth / 2); // Approximate depth in levels
  };

  // ─── Helper: Count Top Level Elements ──────────────────────────────────

  CodeUtils_007.prototype._countTopLevelElements = function(code) {
    if (!code || typeof code !== 'string') return 0;
    
    var lines = code.split('\n');
    var count = 0;
    
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line && !line.startsWith('//') && !line.startsWith('/*') && !line.startsWith('*')) {
        if (line.match(/^(export|import|class|function|const|let|var|async)/)) {
          count++;
        }
      }
    }
    
    return count;
  };

  // ─── Count Potential Functions ─────────────────────────────────────────

  CodeUtils_007.prototype._countPotentialFunctions = function(code) {
    if (!code || typeof code !== 'string') return 0;
    
    var count = 0;
    var lines = code.split('\n');
    
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      
      // Check for function or method definitions
      var fnMatch = line.match(/^\s*(?:async\s+)?(?:function\s+)?([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/);
      if (fnMatch) {
        var name = fnMatch[1];
        if (name !== 'class' && name !== 'constructor' && 
            !line.includes('class ') && !line.includes('extends') &&
            !CONTROL_FLOW.has(name)) {
          count++;
        }
      }
      
      var methodMatch = line.match(/^\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\([^)]*\)\s*\{/);
      if (methodMatch) {
        var methodName = methodMatch[1];
        if (methodName !== 'constructor' && !CONTROL_FLOW.has(methodName)) {
          count++;
        }
      }
    }
    return count;
  };

  // ─── Visibility Detection ──────────────────────────────────────────────

  CodeUtils_007.prototype._isPrivate = function(name) {
    return name && name.charAt(0) === '_';
  };

  CodeUtils_007.prototype._isConstructor = function(name) {
    return name === 'constructor';
  };

  // ─── Comment Injection ──────────────────────────────────────────────────

  CodeUtils_007.prototype.injectComments = function(code) {
    if (typeof code !== 'string') {
      if (typeof code === 'function' || (code && code.toString)) {
        code = code.toString();
      } else {
        code = String(code);
      }
    }
    
    var lines = code.split('\n');
    var result = [];
    var i = 0;
    
    while (i < lines.length) {
      var line = lines[i];
      
      // Check for function declaration
      var fnMatch = line.match(/^\s*(?:async\s+)?(?:function\s+)?([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/);
      if (fnMatch) {
        var fnName = fnMatch[1];
        if (fnName !== 'class' && fnName !== 'constructor' && 
            !line.includes('class ') && !line.includes('extends') &&
            !CONTROL_FLOW.has(fnName)) {
          
          var braceCount = 0;
          var foundStart = false;
          var startIndex = i;
          
          for (var j = i; j < lines.length; j++) {
            var l = lines[j];
            for (var k = 0; k < l.length; k++) {
              if (l[k] === '{') braceCount++;
              if (l[k] === '}') braceCount--;
            }
            if (braceCount === 0 && foundStart) {
              var startTag = '// ─── start: ' + fnName + ' ──────────────────────────────────────────────';
              var endTag = '// ─── end: ' + fnName + ' ──────────────────────────────────────────────';
              
              result.push(startTag);
              for (var m = startIndex; m <= j; m++) {
                result.push(lines[m]);
              }
              result.push(endTag);
              i = j + 1;
              break;
            }
            if (j === startIndex) foundStart = true;
          }
          continue;
        }
      }
      
      // Check for method definition in class
      var methodMatch = line.match(/^\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\([^)]*\)\s*\{/);
      if (methodMatch) {
        var methodName = methodMatch[1];
        if (methodName !== 'constructor' && !CONTROL_FLOW.has(methodName)) {
          var braceCount = 0;
          var foundStart = false;
          var startIndex = i;
          
          for (var j = i; j < lines.length; j++) {
            var l = lines[j];
            for (var k = 0; k < l.length; k++) {
              if (l[k] === '{') braceCount++;
              if (l[k] === '}') braceCount--;
            }
            if (braceCount === 0 && foundStart) {
              var startTag = '// ─── start: ' + methodName + ' ──────────────────────────────────────────────';
              var endTag = '// ─── end: ' + methodName + ' ──────────────────────────────────────────────';
              
              result.push(startTag);
              for (var m = startIndex; m <= j; m++) {
                result.push(lines[m]);
              }
              result.push(endTag);
              i = j + 1;
              break;
            }
            if (j === startIndex) foundStart = true;
          }
          continue;
        }
      }
      
      result.push(line);
      i++;
    }
    
    return result.join('\n');
  };

  // ─── Rebuild ─────────────────────────────────────────────────────────────

  CodeUtils_007.prototype.rebuild = function() {
    console.log('🔄 Rebuilding index...');
    this.functions = [];
    this.index = {};
    this.callGraph = {};
    this.coverage = {};
    this.smells = {};
    this.performance = {};
    this.visibility = { public: 0, private: 0 };
    
    this._buildIndex();
    
    if (this.functions.length > 0) {
      this._analyzeAll();
    }
    
    if (typeof this.recordEvent === 'function') {
      this.recordEvent('codeutils_rebuilt', { 
        functionCount: this.functions.length 
      });
    }
    
    console.log('✅ Rebuilt with ' + this.functions.length + ' functions.');
    return this;
  };

  // ─── Build Index ──────────────────────────────────────────────────────

  CodeUtils_007.prototype._buildIndex = function() {
    var lines = this.sourceCode.split('\n');
    var functionIndex = {};
    var functionList = [];
    var currentFunction = null;
    
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var lineNum = i + 1;
      
      var startMatch = line.match(/\/\/\s*─+\s*start:\s*([^\s─]+)/);
      if (startMatch) {
        var name = startMatch[1];
        var isPrivate = this._isPrivate(name);
        var isConstructor = this._isConstructor(name);
        var visibility = isConstructor ? 'constructor' : (isPrivate ? 'private' : 'public');
        
        // Skip control flow if they somehow got through
        if (CONTROL_FLOW.has(name)) continue;
        
        currentFunction = {
          name: name,
          visibility: visibility,
          isPrivate: isPrivate,
          isConstructor: isConstructor,
          startLine: lineNum,
          endLine: null,
          code: [],
          raw: '',
          calls: [],
          smells: [],
          complexity: 0,
          coverage: 0,
          performance: {}
        };
        continue;
      }
      
      var endMatch = line.match(/\/\/\s*─+\s*end:\s*([^\s─]+)/);
      if (endMatch) {
        var endName = endMatch[1];
        if (currentFunction && currentFunction.name === endName) {
          currentFunction.endLine = lineNum;
          currentFunction.raw = currentFunction.code.join('\n');
          functionIndex[endName] = currentFunction;
          functionList.push(currentFunction);
          currentFunction = null;
        }
        continue;
      }
      
      if (currentFunction) {
        currentFunction.code.push(line);
      }
    }
    
    this.functions = functionList;
    this.index = functionIndex;
    
    this.visibility.public = functionList.filter(function(f) { return f.visibility === 'public'; }).length;
    this.visibility.private = functionList.filter(function(f) { return f.visibility === 'private'; }).length;
  };

  // ─── Analyze All ────────────────────────────────────────────────────────

  CodeUtils_007.prototype._analyzeAll = function() {
    for (var i = 0; i < this.functions.length; i++) {
      var fn = this.functions[i];
      fn.complexity = this._calculateCyclomaticComplexity(fn.raw);
      fn.calls = this._extractCalls(fn.raw);
      fn.smells = this._detectSmells(fn.raw, fn.name);
      fn.coverage = this._estimateCoverage(fn);
      fn.performance = this._measurePerformance(fn);
    }
    
    this.callGraph = this._buildCallGraph();
    this.smells = this._aggregateSmells();
  };

  // ─── 1. Cyclomatic Complexity ──────────────────────────────────────────

  CodeUtils_007.prototype._calculateCyclomaticComplexity = function(code) {
    var patterns = [
      /\bif\s*\(/g,
      /\belse\s+if\s*\(/g,
      /\bfor\s*\(/g,
      /\bwhile\s*\(/g,
      /\bdo\s*\{/g,
      /\bswitch\s*\(/g,
      /\bcase\s+/g,
      /\bcatch\s*\(/g,
      /\?\s*[^:]+:/g,
      /&&/g,
      /\|\|/g
    ];
    
    var count = 1;
    for (var i = 0; i < patterns.length; i++) {
      var matches = code.match(patterns[i]);
      if (matches) {
        count += matches.length;
      }
    }
    
    return count;
  };

  // ─── 2. Function Call Graph ────────────────────────────────────────────

  CodeUtils_007.prototype._extractCalls = function(code) {
    var calls = [];
    var patterns = [
      /\bthis\.([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g,
      /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g,
      /\b([A-Z][a-zA-Z]*)\s*\.\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g
    ];
    
    var reserved = new Set(['if', 'for', 'while', 'switch', 'return', 'new', 'typeof', 'instanceof', 'delete', 'void', 'throw', 'try', 'catch', 'finally', 'function', 'class', 'extends', 'super', 'this', 'console', 'require', 'module', 'exports', 'global', 'process', 'Buffer', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval']);
    
    for (var i = 0; i < patterns.length; i++) {
      var match;
      while ((match = patterns[i].exec(code)) !== null) {
        var name = match[1] || match[2] || match[0];
        name = name.replace(/^['"]/, '').replace(/['"]$/, '');
        if (!reserved.has(name) && name.length > 0) {
          calls.push(name);
        }
      }
    }
    
    // Remove duplicates
    var uniqueCalls = [];
    var seen = {};
    for (var i = 0; i < calls.length; i++) {
      if (!seen[calls[i]]) {
        seen[calls[i]] = true;
        uniqueCalls.push(calls[i]);
      }
    }
    
    return uniqueCalls;
  };

  CodeUtils_007.prototype._buildCallGraph = function() {
    var graph = {};
    for (var i = 0; i < this.functions.length; i++) {
      var fn = this.functions[i];
      graph[fn.name] = {
        calls: fn.calls || [],
        calledBy: [],
        complexity: fn.complexity || 0,
        visibility: fn.visibility || 'public'
      };
    }
    
    for (var i = 0; i < this.functions.length; i++) {
      var fn = this.functions[i];
      var calls = fn.calls || [];
      for (var j = 0; j < calls.length; j++) {
        var call = calls[j];
        if (graph[call]) {
          if (!graph[call].calledBy) graph[call].calledBy = [];
          if (graph[call].calledBy.indexOf(fn.name) === -1) {
            graph[call].calledBy.push(fn.name);
          }
        }
      }
    }
    
    return graph;
  };

  // ─── 3. Code Smell Detection ───────────────────────────────────────────

  CodeUtils_007.prototype._detectSmells = function(code, name) {
    var smells = [];
    
    var lines = code.split('\n').length;
    if (lines > 20) {
      smells.push({ type: 'long_method', severity: lines > 40 ? 'high' : 'medium', detail: lines + ' lines' });
    }
    
    var paramMatch = code.match(/\(([^)]*)\)/);
    if (paramMatch) {
      var params = paramMatch[1].split(',').filter(function(s) { return s.trim(); });
      if (params.length > 4) {
        smells.push({ type: 'too_many_parameters', severity: params.length > 6 ? 'high' : 'medium', detail: params.length + ' params' });
      }
    }
    
    var nestCount = 0;
    var maxNest = 0;
    for (var i = 0; i < code.length; i++) {
      if (code[i] === '{') nestCount++;
      if (code[i] === '}') nestCount--;
      if (nestCount > maxNest) maxNest = nestCount;
    }
    if (maxNest > 3) {
      smells.push({ type: 'deep_nesting', severity: maxNest > 5 ? 'high' : 'medium', detail: maxNest + ' levels' });
    }
    
    var numbers = code.match(/\b\d{2,}\b/g);
    if (numbers && numbers.length > 3) {
      smells.push({ type: 'magic_numbers', severity: numbers.length > 5 ? 'medium' : 'low', detail: numbers.length + ' numbers' });
    }
    
    var lines2 = code.split('\n');
    var duplicates = {};
    for (var i = 0; i < lines2.length; i++) {
      var trimmed = lines2[i].trim();
      if (trimmed.length > 10 && !trimmed.startsWith('//') && !trimmed.startsWith('/*') && !trimmed.startsWith('*')) {
        if (duplicates[trimmed]) {
          if (!smells.some(function(s) { return s.type === 'duplicate_code'; })) {
            smells.push({ type: 'duplicate_code', severity: 'medium', detail: 'repeated lines' });
          }
        }
        duplicates[trimmed] = true;
      }
    }
    
    var logicalOps = (code.match(/&&/g) || []).length + (code.match(/\|\|/g) || []).length;
    if (logicalOps > 3) {
      smells.push({ type: 'complex_conditional', severity: logicalOps > 5 ? 'high' : 'medium', detail: logicalOps + ' logical ops' });
    }
    
    if (name && name.length > 30) {
      smells.push({ type: 'long_identifier', severity: 'low', detail: name.length + ' chars' });
    }
    
    return smells;
  };

  CodeUtils_007.prototype._aggregateSmells = function() {
    var allSmells = {};
    for (var i = 0; i < this.functions.length; i++) {
      var fn = this.functions[i];
      if (!fn.smells) continue;
      for (var j = 0; j < fn.smells.length; j++) {
        var smell = fn.smells[j];
        if (!allSmells[smell.type]) {
          allSmells[smell.type] = { count: 0, severity: smell.severity };
        }
        allSmells[smell.type].count++;
      }
    }
    return allSmells;
  };

  // ─── 4. Test Coverage Mapping ──────────────────────────────────────────

  CodeUtils_007.prototype._estimateCoverage = function(fn) {
    var code = fn.raw || '';
    var complexity = fn.complexity || 1;
    
    var coverage = Math.max(0, Math.min(100, 80 - (complexity * 2)));
    
    var branchCount = (code.match(/if/g) || []).length + (code.match(/else/g) || []).length;
    coverage = Math.max(0, coverage - (branchCount * 2));
    
    return Math.round(coverage);
  };

  // ─── 5. Performance Metrics ────────────────────────────────────────────

  CodeUtils_007.prototype._measurePerformance = function(fn) {
    var code = fn.raw || '';
    var metrics = {};
    
    metrics.complexity = fn.complexity || 1;
    
    var operations = 0;
    operations += (code.match(/for/g) || []).length * 10;
    operations += (code.match(/while/g) || []).length * 10;
    operations += (code.match(/if/g) || []).length * 2;
    operations += (code.match(/return/g) || []).length * 1;
    operations += (code.match(/\./g) || []).length * 0.5;
    operations += code.length * 0.01;
    metrics.estimatedOps = Math.round(operations);
    
    var allocations = 0;
    allocations += (code.match(/new /g) || []).length * 100;
    allocations += (code.match(/\[/g) || []).length * 10;
    allocations += (code.match(/\{/g) || []).length * 20;
    metrics.estimatedMemory = Math.round(allocations);
    
    if (code.indexOf('for') !== -1 && code.indexOf('for') !== code.lastIndexOf('for')) {
      metrics.timeComplexity = 'O(n²)';
    } else if (code.indexOf('for') !== -1) {
      metrics.timeComplexity = 'O(n)';
    } else if (code.indexOf('while') !== -1) {
      metrics.timeComplexity = 'O(n)';
    } else {
      metrics.timeComplexity = 'O(1)';
    }
    
    return metrics;
  };

  // ─── Generate Full Report ──────────────────────────────────────────────

  CodeUtils_007.prototype.generateFullReport = function(title, visibility) {
    visibility = visibility || 'all';
    
    var filteredFunctions = this.functions.filter(function(fn) {
      if (visibility === 'all') return true;
      if (visibility === 'public') return fn.visibility === 'public';
      if (visibility === 'private') return fn.visibility === 'private';
      return true;
    });
    
    var report = {
      title: title || 'Code Analysis Report',
      fileName: this.fileName,
      generated: new Date().toISOString(),
      totalLines: this.lineCount,
      totalFunctions: this.functions.length,
      filteredFunctions: filteredFunctions.length,
      visibilityFilter: visibility,
      visibilityCounts: this.visibility,
      inputType: this.inputType,
      autoInjected: this._autoInjected,
      baseClassX: {
        charCount: this.charCount || 0,
        estSizeKB: this.estSizeKB || 0,
        tokenEstimate: this.tokenEstimate || 0,
        fingerprint: typeof this.fingerprint !== 'undefined' ? this.fingerprint : null,
        maxIndentDepth: this.maxIndentDepth || 0,
        topLevelCount: this.topLevelCount || 0
      },
      functions: [],
      summary: {
        loc: {},
        complexity: {},
        smells: {},
        coverage: {},
        performance: {},
        visibility: {}
      },
      callGraph: this.callGraph,
      smellsAggregate: this.smells
    };
    
    var totalLoc = 0;
    var maxComplexity = 0;
    var totalSmells = 0;
    var avgCoverage = 0;
    var publicCount = 0;
    var privateCount = 0;
    var locValues = [];
    
    for (var i = 0; i < filteredFunctions.length; i++) {
      var fn = filteredFunctions[i];
      var loc = fn.endLine - fn.startLine + 1;
      totalLoc += loc;
      totalSmells += (fn.smells || []).length;
      avgCoverage += fn.coverage || 0;
      locValues.push(loc);
      
      if (fn.complexity > maxComplexity) maxComplexity = fn.complexity;
      if (fn.visibility === 'public') publicCount++;
      if (fn.visibility === 'private') privateCount++;
      
      var visibilityLabel = fn.visibility === 'constructor' ? '📦' : (fn.isPrivate ? '🔒' : '🔓');
      
      report.functions.push({
        name: fn.name,
        visibility: fn.visibility || 'public',
        visibilityLabel: visibilityLabel,
        startLine: fn.startLine,
        endLine: fn.endLine,
        lineRange: fn.startLine + ' → ' + fn.endLine,
        loc: loc,
        complexity: fn.complexity || 0,
        calls: fn.calls || [],
        smells: fn.smells || [],
        coverage: fn.coverage || 0,
        performance: fn.performance || {}
      });
    }
    
    // ─── LOC Summary with proper handling ──────────────────────────────
    var maxLoc = 0;
    var minLoc = 0;
    var avgLoc = 0;
    
    if (locValues.length > 0) {
      maxLoc = Math.max.apply(null, locValues);
      minLoc = Math.min.apply(null, locValues);
      avgLoc = Math.round(totalLoc / locValues.length);
    }
    
    report.summary.loc = {
      total: totalLoc,
      avg: avgLoc,
      max: maxLoc,
      min: minLoc
    };
    
    report.summary.complexity = {
      max: maxComplexity,
      avg: filteredFunctions.length > 0 ? Math.round(filteredFunctions.reduce(function(sum, f) { return sum + f.complexity; }, 0) / filteredFunctions.length) : 0,
      high: filteredFunctions.filter(function(f) { return f.complexity > 10; }).length
    };
    
    report.summary.smells = {
      total: totalSmells,
      perFunction: filteredFunctions.length > 0 ? Math.round(totalSmells / filteredFunctions.length) : 0,
      types: Object.keys(this.smells).length
    };
    
    report.summary.coverage = {
      avg: filteredFunctions.length > 0 ? Math.round(avgCoverage / filteredFunctions.length) : 0,
      high: filteredFunctions.filter(function(f) { return f.coverage > 70; }).length,
      low: filteredFunctions.filter(function(f) { return f.coverage < 30; }).length
    };
    
    report.summary.performance = {
      avgOps: Math.round(filteredFunctions.reduce(function(sum, f) { return sum + (f.performance.estimatedOps || 0); }, 0) / filteredFunctions.length),
      avgMemory: Math.round(filteredFunctions.reduce(function(sum, f) { return sum + (f.performance.estimatedMemory || 0); }, 0) / filteredFunctions.length),
      commonComplexity: this._mostCommonComplexity(filteredFunctions)
    };
    
    report.summary.visibility = {
      public: publicCount,
      private: privateCount,
      total: filteredFunctions.length
    };
    
    this.report = report;
    
    if (typeof this.recordEvent === 'function') {
      this.recordEvent('codeutils_full_report_generated', { 
        functionCount: filteredFunctions.length,
        totalLoc: totalLoc,
        totalSmells: totalSmells,
        visibilityFilter: visibility,
        autoInjected: this._autoInjected
      });
    }
    
    return report;
  };

  CodeUtils_007.prototype._mostCommonComplexity = function(functions) {
    if (!functions || functions.length === 0) return 0;
    var counts = {};
    for (var i = 0; i < functions.length; i++) {
      var c = functions[i].complexity || 1;
      counts[c] = (counts[c] || 0) + 1;
    }
    var max = 0;
    var result = 0;
    for (var key in counts) {
      if (counts[key] > max) {
        max = counts[key];
        result = key;
      }
    }
    return parseInt(result) || 0;
  };

  // ─── Print Report ──────────────────────────────────────────────────────

  CodeUtils_007.prototype.printFullReport = function() {
    if (!this.report) {
      console.log('⚠️ No report generated. Run generateFullReport() first.');
      return;
    }
    
    var r = this.report;
    
    console.log('\n' + '═'.repeat(90));
    console.log('  ' + r.title);
    console.log('═'.repeat(90));
    console.log('  File: ' + r.fileName);
    console.log('  Input Type: ' + r.inputType);
    console.log('  Auto-Injected Comments: ' + (r.autoInjected ? '✅ Yes' : '❌ No'));
    console.log('  Visibility Filter: ' + r.visibilityFilter);
    console.log('  Generated: ' + r.generated);
    console.log('  Total Lines: ' + r.totalLines);
    console.log('  Total Functions: ' + r.totalFunctions);
    console.log('  Filtered Functions: ' + r.filteredFunctions);
    console.log('─'.repeat(90));
    
    console.log('  Visibility Summary:');
    console.log('    🔓 Public:  ' + r.visibilityCounts.public);
    console.log('    🔒 Private: ' + r.visibilityCounts.private);
    console.log('─'.repeat(90));
    
    console.log('  BaseClassX Metrics (from source):');
    console.log('    Char Count: ' + r.baseClassX.charCount);
    console.log('    Est Size KB: ' + r.baseClassX.estSizeKB.toFixed(2));
    console.log('    Token Estimate: ' + Math.round(r.baseClassX.tokenEstimate));
    console.log('    Fingerprint: ' + (r.baseClassX.fingerprint || 'N/A').substring(0, 16) + '...');
    console.log('    Max Indent Depth: ' + r.baseClassX.maxIndentDepth);
    console.log('    Top Level Count: ' + r.baseClassX.topLevelCount);
    console.log('─'.repeat(90));
    
    console.log('  LOC Summary:');
    console.log('    Total: ' + r.summary.loc.total);
    console.log('    Avg: ' + r.summary.loc.avg);
    console.log('    Max: ' + r.summary.loc.max);
    console.log('    Min: ' + r.summary.loc.min);
    console.log('─'.repeat(90));
    
    console.log('  Cyclomatic Complexity:');
    console.log('    Max: ' + r.summary.complexity.max);
    console.log('    Avg: ' + r.summary.complexity.avg);
    console.log('    High (>10): ' + r.summary.complexity.high);
    console.log('─'.repeat(90));
    
    console.log('  Code Smells:');
    console.log('    Total: ' + r.summary.smells.total);
    console.log('    Per Function: ' + r.summary.smells.perFunction);
    console.log('    Types: ' + r.summary.smells.types);
    for (var type in r.smellsAggregate) {
      console.log('      ' + type + ': ' + r.smellsAggregate[type].count + ' (' + r.smellsAggregate[type].severity + ')');
    }
    console.log('─'.repeat(90));
    
    console.log('  Test Coverage (estimated):');
    console.log('    Avg: ' + r.summary.coverage.avg + '%');
    console.log('    High (>70%): ' + r.summary.coverage.high);
    console.log('    Low (<30%): ' + r.summary.coverage.low);
    console.log('─'.repeat(90));
    
    console.log('  Performance Metrics:');
    console.log('    Avg Estimated Ops: ' + r.summary.performance.avgOps);
    console.log('    Avg Estimated Memory: ' + r.summary.performance.avgMemory + ' units');
    console.log('    Common Time Complexity: O(' + r.summary.performance.commonComplexity + ')');
    console.log('─'.repeat(90));
    
    console.log('  Call Graph:');
    for (var name in r.callGraph) {
      var node = r.callGraph[name];
      var vis = node.visibility === 'private' ? '🔒' : '🔓';
      console.log('    ' + vis + ' ' + name + ':');
      console.log('      Calls: ' + (node.calls && node.calls.length > 0 ? node.calls.join(', ') : 'none'));
      console.log('      Called By: ' + (node.calledBy && node.calledBy.length > 0 ? node.calledBy.join(', ') : 'none'));
      console.log('      Complexity: ' + node.complexity);
    }
    console.log('─'.repeat(90));
    
    console.log('  Function Details (with Line Ranges):');
    for (var i = 0; i < r.functions.length; i++) {
      var fn = r.functions[i];
      var bar = '█'.repeat(Math.min(20, fn.loc));
      var vis = fn.visibilityLabel || (fn.visibility === 'private' ? '🔒' : '🔓');
      console.log('    ' + String(i + 1).padStart(2) + '. ' + 
                  vis + ' ' + fn.name.padEnd(22) + 
                  ' Lines: ' + String(fn.loc).padStart(3) + 
                  '  Range: ' + fn.lineRange.padEnd(12) +
                  '  CC: ' + String(fn.complexity).padStart(2) + 
                  '  Cov: ' + String(fn.coverage).padStart(3) + '%' +
                  '  Smells: ' + fn.smells.length +
                  '  [' + bar + ']');
    }
    console.log('═'.repeat(90) + '\n');
  };

  // ─── Run Demo ───────────────────────────────────────────────────────────

  CodeUtils_007.prototype.runDemo = function() {
    console.log('🚀 CodeUtils_007 Demo Running...\n');
    
    // Test 1: With comments already
    console.log('  [1/2] Testing with comments already present:');
    var utils1 = new CodeUtils_007(CodeUtils_007.SampleClass, 'SampleClass.js');
    var report1 = utils1.generateFullReport('Sample Class (with comments)');
    utils1.printFullReport();
    
    // Test 2: Without comments (auto-inject)
    console.log('  [2/2] Testing auto-inject on raw source:');
    var rawSource = CodeUtils_007.SampleClass;
    var utils2 = new CodeUtils_007(rawSource, 'SampleClass_raw.js');
    var report2 = utils2.generateFullReport('Sample Class (auto-injected)');
    utils2.printFullReport();
    
    console.log('✅ Demo complete.');
    return { withComments: report1, autoInjected: report2 };
  };

  CodeUtils_007.runDemo = function() {
    var utils = new CodeUtils_007();
    return utils.runDemo();
  };

  return CodeUtils_007;

}));