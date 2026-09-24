var ExtendX = require('./ExtendX.js');
global.self = global;
self.ExtendX = ExtendX;
var RegX = require('./RegX.js');

var failures = 0;
function check(label, actual, expected) {
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

// The exact case that broke the old flat split-and-fold algorithm:
// ** is right-associative, 2**3**2 must be 2**(3**2)=512, not (2**3)**2=64.
var rightAssocSrc = `
class C {
  chain() {
    return 2 ** 3 ** 2;
  }
}
`;

// Parens overriding the default right-associative grouping.
var parenOverrideSrc = `
class C {
  chain() {
    return (2 ** 3) ** 2;
  }
}
`;

// Precedence across all three levels together: ** before * before +.
var mixedPrecedenceSrc = `
class C {
  calc() {
    return 2 + 3 * 4 ** 2;
  }
}
`;
// 4**2=16, 3*16=48, 2+48=50

// Parens forcing a non-default grouping across + and *.
var parenGroupSrc = `
class C {
  calc() {
    return (2 + 3) * 4;
  }
}
`;

// ** applied to a RUNTIME value (a property), not just literals — proves
// the placeholder/side-table mechanism, not just compile-time folding.
var runtimePowSrc = `
class C {
  constructor(r) { this.r = r; }
  squared() {
    return this.r ** 2;
  }
}
`;

// Nested parens mixed with a runtime property.
var nestedParenRuntimeSrc = `
class C {
  constructor(x) { this.x = x; }
  calc() {
    return (this.x + 1) * (this.x + 2);
  }
}
`;

// ** with a non-constant exponent must fail loudly at compile time, not
// silently compute something wrong (RegX has no runtime power loop yet).
var badExponentSrc = `
class C {
  constructor(a, b) { this.a = a; this.b = b; }
  bad() {
    return this.a ** this.b;
  }
}
`;

// ^ is real JS bitwise XOR, not exponentiation — this is the whole
// reason ** exists as a separate operator: redefining ^ would silently
// betray anyone who already knows what ^ means in real JS.
var xorLiteralSrc = `
class C {
  x() {
    return 5 ^ 3;
  }
}
`;
// 5^3 = 0b101 ^ 0b011 = 0b110 = 6

var xorRuntimeSrc = `
class C {
  constructor(a, b) { this.a = a; this.b = b; }
  x() {
    return this.a ^ this.b;
  }
}
`;

var xorChainedSrc = `
class C {
  x() {
    return 12 ^ 10 ^ 3;
  }
}
`;
// associative regardless of grouping: (12^10)^3 = 6^3 = 5; 12^(10^3)=12^9=5

var xorPrecedenceSrc = `
class C {
  x() {
    return 1 ^ 2 == 2;
  }
}
`;
// == binds tighter than ^ in real JS: 1 ^ (2==2) = 1 ^ 1 = 0

var xorFloatSrc = `
class C {
  x() {
    return 5 ^ 3.5;
  }
}
`;

Promise.resolve()
  .then(function() {
    return run('right-associative **', rightAssocSrc, function(inst) {
      check('2**3**2 = 2**(3**2)', inst.exports.chain(0), 512);
    });
  })
  .then(function() {
    return run('paren-overridden **', parenOverrideSrc, function(inst) {
      check('(2**3)**2', inst.exports.chain(0), 64);
    });
  })
  .then(function() {
    return run('mixed precedence ** > * > +', mixedPrecedenceSrc, function(inst) {
      check('2+3*4**2', inst.exports.calc(0), 50);
    });
  })
  .then(function() {
    return run('parens override + and *', parenGroupSrc, function(inst) {
      check('(2+3)*4', inst.exports.calc(0), 20);
    });
  })
  .then(function() {
    return run('** on a runtime property', runtimePowSrc, function(inst) {
      inst.exports.init(0, 7n);
      check('this.r ** 2, r=7', inst.exports.squared(0), 49);
    });
  })
  .then(function() {
    return run('nested parens with runtime property', nestedParenRuntimeSrc, function(inst) {
      inst.exports.init(0, 3n);
      check('(x+1)*(x+2), x=3', inst.exports.calc(0), 20); // 4*5=20
    });
  })
  .then(function() {
    expectCompileError('non-constant exponent rejected', badExponentSrc, 'compile-time-constant');
  })
  .then(function() {
    return run('real JS XOR on literals', xorLiteralSrc, function(inst) {
      check('5 ^ 3 = 6 (bitwise XOR, not 125)', inst.exports.x(0), 6);
    });
  })
  .then(function() {
    return run('XOR on runtime properties', xorRuntimeSrc, function(inst) {
      inst.exports.init(0, 5n, 3n);
      check('this.a ^ this.b, 5^3', inst.exports.x(0), 6);
    });
  })
  .then(function() {
    return run('chained XOR (associative, order-independent)', xorChainedSrc, function(inst) {
      check('12 ^ 10 ^ 3', inst.exports.x(0), 5);
    });
  })
  .then(function() {
    return run('^ is looser than == (real JS precedence)', xorPrecedenceSrc, function(inst) {
      check('1 ^ 2 == 2  is  1 ^ (2==2)', inst.exports.x(0), 0);
    });
  })
  .then(function() {
    expectCompileError('XOR on a float operand rejected', xorFloatSrc, 'bitwise XOR');
  })
  .then(function() {
    console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
  });
