var ExtendX = require('./ExtendX.js');
global.self = global;
self.ExtendX = ExtendX;
var RegX = require('./RegX.js');

var failures = 0;
function check(label, actual, expected) {
  // Data-typed results now come back as BigInt (i64 by default); normalize
  // before comparing so `expected` can stay a plain JS number literal.
  var normalized = typeof actual === 'bigint' ? Number(actual) : actual;
  var ok = normalized === expected;
  if (!ok) failures++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + '  got=' + actual + ' want=' + expected);
}

function run(label, source, calls) {
  return RegX.compileAndRun(source, {})
    .then(function(instance) {
      return calls(instance, label);
    })
    .catch(function(err) {
      console.log('THREW  ' + label + '  ' + err.message);
      failures++;
    });
}

// ── Case 30: if/else — real branching, not both-execute ──────────────
var ifElseSrc = `
class C {
  constructor(a) { this.a = a; }
  check() {
    if (this.a > 5) {
      return 1;
    } else {
      return 0;
    }
  }
}
`;

// ── Case 31: while loop — body actually repeats ───────────────────────
var whileSrc = `
class C {
  constructor(n) { this.n = n; }
  countdown() {
    while (this.n > 0) {
      this.n = this.n - 1;
    }
    return this.n;
  }
}
`;
// note: '-' isn't a supported operator yet (out of this task's scope),
// so drive the loop with a param and a fixed number of decrement-free
// iterations isn't representable either — instead prove looping via a
// counter compared against a target, incremented with '+'.
var whileSrc2 = `
class C {
  constructor() { this.i = 0; }
  loopTo5() {
    while (this.i < 5) {
      this.i = this.i + 1;
    }
    return this.i;
  }
}
`;

// ── Case 44: ternary ──────────────────────────────────────────────────
var ternarySrc = `
class C {
  constructor(a, b) { this.a = a; this.b = b; }
  pick() {
    return this.a > this.b ? this.a : this.b;
  }
}
`;

// ── Case 15: ASI — no trailing semicolons ─────────────────────────────
var asiSrc = `
class C {
  constructor(a) { this.a = a }
  get() {
    return this.a
  }
}
`;

// ── Case 51: switch, with real fallthrough + break ────────────────────
var switchSrc = `
class C {
  constructor(x) { this.x = x; }
  classify() {
    switch (this.x) {
      case 1:
      case 2:
        return 10;
      case 3:
        return 30;
      default:
        return 99;
    }
  }
}
`;

// ── Case 52: try/catch — nothing throws, try body just runs ───────────
var tryCatchSrc = `
class C {
  constructor(a) { this.a = a; }
  safe() {
    try {
      return this.a + 1;
    } catch (e) {
      return 0;
    }
  }
}
`;

// ── else-if chain, nested control flow ─────────────────────────────────
var elseIfSrc = `
class C {
  constructor(x) { this.x = x; }
  grade() {
    if (this.x >= 3) {
      return 3;
    } else if (this.x >= 2) {
      return 2;
    } else {
      return 1;
    }
  }
}
`;

Promise.resolve()
  .then(function() {
    return run('if/else true branch', ifElseSrc, function(inst) {
      inst.exports.init(0, 10n);
      check('if/else (a=10>5)', inst.exports.check(0), 1);
    });
  })
  .then(function() {
    return run('if/else false branch', ifElseSrc, function(inst) {
      inst.exports.init(0, 2n);
      check('if/else (a=2>5)', inst.exports.check(0), 0);
    });
  })
  .then(function() {
    return run('while loop to 5', whileSrc2, function(inst) {
      inst.exports.init(0);
      check('while loopTo5()', inst.exports.loopTo5(0), 5);
    });
  })
  .then(function() {
    return run('ternary a>b', ternarySrc, function(inst) {
      inst.exports.init(0, 7n, 3n);
      check('ternary pick(7,3)', inst.exports.pick(0), 7);
    });
  })
  .then(function() {
    return run('ternary b>a', ternarySrc, function(inst) {
      inst.exports.init(0, 2n, 9n);
      check('ternary pick(2,9)', inst.exports.pick(0), 9);
    });
  })
  .then(function() {
    return run('ASI no semicolons', asiSrc, function(inst) {
      inst.exports.init(0, 42n);
      check('ASI get()', inst.exports.get(0), 42);
    });
  })
  .then(function() {
    return run('switch fallthrough case 1', switchSrc, function(inst) {
      inst.exports.init(0, 1n);
      check('switch classify(1) [fallthrough to case 2 body]', inst.exports.classify(0), 10);
    });
  })
  .then(function() {
    return run('switch matched case 2', switchSrc, function(inst) {
      inst.exports.init(0, 2n);
      check('switch classify(2)', inst.exports.classify(0), 10);
    });
  })
  .then(function() {
    return run('switch matched case 3', switchSrc, function(inst) {
      inst.exports.init(0, 3n);
      check('switch classify(3)', inst.exports.classify(0), 30);
    });
  })
  .then(function() {
    return run('switch default', switchSrc, function(inst) {
      inst.exports.init(0, 7n);
      check('switch classify(7) [default]', inst.exports.classify(0), 99);
    });
  })
  .then(function() {
    return run('try/catch — try body runs, catch unreachable', tryCatchSrc, function(inst) {
      inst.exports.init(0, 8n);
      check('try/catch safe()', inst.exports.safe(0), 9);
    });
  })
  .then(function() {
    return run('else-if chain, x=3', elseIfSrc, function(inst) {
      inst.exports.init(0, 3n);
      check('else-if grade(3)', inst.exports.grade(0), 3);
    });
  })
  .then(function() {
    return run('else-if chain, x=2', elseIfSrc, function(inst) {
      inst.exports.init(0, 2n);
      check('else-if grade(2)', inst.exports.grade(0), 2);
    });
  })
  .then(function() {
    return run('else-if chain, x=0', elseIfSrc, function(inst) {
      inst.exports.init(0, 0n);
      check('else-if grade(0)', inst.exports.grade(0), 1);
    });
  })
  .then(function() {
    console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
  });
