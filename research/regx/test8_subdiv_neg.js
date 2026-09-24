var ExtendX = require('./ExtendX.js');
global.self = global;
self.ExtendX = ExtendX;
var RegX = require('./RegX.js');

var failures = 0;
function check(label, actual, expected) {
  var normalized = typeof actual === 'bigint' ? Number(actual) : actual;
  var ok = Math.abs(normalized - expected) < 1e-9;
  if (!ok) failures++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + '  got=' + actual + ' want=' + expected);
}

function run(label, source, calls) {
  return RegX.compileAndRun(source, {})
    .then(function(instance) {
      return calls(instance, label);
    })
    .catch(function(err) {
      console.log('THREW (unexpected)  ' + label + '  ' + err.message);
      failures++;
    });
}

function expectCompileError(label, source, expectedSubstring) {
  try {
    RegX.compileAndRun(source, {});
    console.log('FAIL  ' + label + '  expected a thrown compile error, got none');
    failures++;
  } catch (err) {
    var ok = err.message.indexOf(expectedSubstring) !== -1;
    if (!ok) failures++;
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + '  threw: "' + err.message + '"');
  }
}

// ── Case 08: real subtraction ───────────────────────────────────────────
var subSrc = `
class C {
  constructor(a, b) { this.a = a; this.b = b; }
  diff() {
    return this.a - this.b;
  }
}
`;

// Left-to-right interleaving of + and - at the same precedence.
var mixedAddSubSrc = `
class C {
  calc() {
    return 10 - 3 + 2;
  }
}
`;
// (10-3)+2 = 9, NOT 10-(3+2)=5

var mixedAddSub2Src = `
class C {
  calc() {
    return 10 + 3 - 2;
  }
}
`;
// (10+3)-2 = 11

// ── Case 12: real division (always float, matching real JS) ────────────
var divSrc = `
class C {
  constructor(a, b) { this.a = a; this.b = b; }
  quotient() {
    return this.a / this.b;
  }
}
`;

var mixedMulDivSrc = `
class C {
  calc() {
    return 10 / 2 * 3;
  }
}
`;
// (10/2)*3 = 15, NOT 10/(2*3) = 1.666...

// ── Case 14: unary minus ────────────────────────────────────────────────
var negLiteralSrc = `
class C {
  n() {
    return -5;
  }
}
`;

var negPropertySrc = `
class C {
  constructor(a) { this.a = a; }
  neg() {
    return -this.a;
  }
}
`;

var doubleNegSrc = `
class C {
  calc() {
    return 5 - -3;
  }
}
`;
// 5 - (-3) = 8

var negThenAddSrc = `
class C {
  calc() {
    return 5 + -3;
  }
}
`;
// 5 + (-3) = 2

// ── Case 07: unknown identifier fails loudly, not a wrong-slot guess ───
var unknownIdentSrc = `
class C {
  bad() {
    return q;
  }
}
`;

Promise.resolve()
  .then(function() {
    return run('real subtraction', subSrc, function(inst) {
      inst.exports.init(0, 10n, 4n);
      check('diff() = a-b', inst.exports.diff(0), 6);
    });
  })
  .then(function() {
    return run('left-to-right +/-', mixedAddSubSrc, function(inst) {
      check('10-3+2', inst.exports.calc(0), 9);
    });
  })
  .then(function() {
    return run('left-to-right +/- (2)', mixedAddSub2Src, function(inst) {
      check('10+3-2', inst.exports.calc(0), 11);
    });
  })
  .then(function() {
    return run('real division (always float)', divSrc, function(inst) {
      inst.exports.init(0, 7n, 2n);
      check('quotient() = a/b = 3.5, not 3', inst.exports.quotient(0), 3.5);
    });
  })
  .then(function() {
    return run('left-to-right */÷', mixedMulDivSrc, function(inst) {
      check('10/2*3', inst.exports.calc(0), 15);
    });
  })
  .then(function() {
    return run('unary minus on a literal', negLiteralSrc, function(inst) {
      check('-5', inst.exports.n(0), -5);
    });
  })
  .then(function() {
    return run('unary minus on a property', negPropertySrc, function(inst) {
      inst.exports.init(0, 9n);
      check('-this.a, a=9', inst.exports.neg(0), -9);
    });
  })
  .then(function() {
    return run('double negative', doubleNegSrc, function(inst) {
      check('5 - -3', inst.exports.calc(0), 8);
    });
  })
  .then(function() {
    return run('unary minus after +', negThenAddSrc, function(inst) {
      check('5 + -3', inst.exports.calc(0), 2);
    });
  })
  .then(function() {
    expectCompileError('unknown identifier rejected', unknownIdentSrc, 'unknown identifier');
  })
  .then(function() {
    console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
  });
