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
    .then(function(instance) { return calls(instance, label); })
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

// #secret declared bare (no initializer), assigned from a constructor
// parameter, read back through an ordinary method -- the exact shape
// the task's own ground-truth probe used. WASM has no runtime privacy
// concept at all, so this compiles through the SAME offset load/store
// machinery this.x already uses; the # is purely a compile-time marker.
var basicSrc = `
class C {
  #secret;
  constructor(x) { this.#secret = x; }
  reveal() { return this.#secret; }
}
`;

// #secret = 5; -- a private field WITH an initializer, spliced onto the
// front of the constructor's own statements exactly like a real (public)
// class-field initializer already is; a later constructor statement can
// still override it, matching real JS field-init-then-constructor-body
// order.
var initializerSrc = `
class C {
  #secret = 5;
  constructor() {}
  reveal() { return this.#secret; }
}
class D {
  #secret = 5;
  constructor(x) { this.#secret = x; }
  reveal() { return this.#secret; }
}
`;

// A private method (#helper() {...}), called from another method of the
// SAME class via this.#helper() -- real, direct `call`, not
// call_indirect, exactly like an ordinary sibling-method call
// (compileMethodCallToWasm) since which method this is is fixed at
// compile time either way.
var privateMethodSrc = `
class C {
  #helper() { return 9; }
  reveal() { return this.#helper() + 1; }
}
`;

// Base's own method still reads its own private field fine when compiled
// as part of a (legitimate) extends chain -- the negative half of this
// pair (below) proves DERIVED's own text can't reach the same field.
var baseOwnPrivateInChainSrc = `
class Base {
  #secret = 1;
  constructor() {}
  getSecret() { return this.#secret; }
}
class Derived extends Base {
  constructor(y) { this.y = y; }
}
`;

// A subclass's OWN methods must NOT be able to reach an ancestor's
// private field -- real JS scopes #name to the lexical class body that
// declares it, not down the extends chain the way an ordinary property
// is inherited. Derived's constructor here literally writes
// this.#secret, a name only Base ever declared -- a real SyntaxError,
// not a silent shared-slot write into Base's storage.
var subclassCannotSeeParentPrivateSrc = `
class Base {
  #secret = 1;
  getSecret() { return this.#secret; }
}
class Derived extends Base {
  constructor() { this.#secret = 2; }
}
`;

// Referencing a #name that was never declared anywhere in the source at
// all -- the plainest case of real JS's own
// "Private field '#name' must be declared in an enclosing class"
// SyntaxError. A legitimate error (matches how an unknown identifier or
// a nonexistent sibling-method call already reject in test8/test19), not
// compiler laziness -- there is no offset to fall back to that would be
// honest.
var undeclaredSrc = `
class C {
  reveal() { return this.#nope; }
}
`;

// this.#helper() where #helper was never declared as a method OR field
// anywhere -- same undeclared-private-name SyntaxError, reached through
// the call-site path instead of the read path.
var undeclaredMethodSrc = `
class C {
  reveal() { return this.#missing(); }
}
`;

Promise.resolve()
  .then(function() {
    return run('bare private field, set via constructor param, read back', basicSrc, function(inst) {
      inst.exports.init(0, 42n);
      check('reveal() returns the private field', inst.exports.reveal(0), 42);
    });
  })
  .then(function() {
    return run('private field WITH an initializer (two independent classes, same private name)', initializerSrc, function(inst) {
      inst.exports.C_init(0);
      check('C.reveal() uses the field initializer, no constructor override', inst.exports.C_reveal(0), 5);
      inst.exports.D_init(64, 77n);
      check('D.reveal() -- constructor assignment overrides the initializer', inst.exports.D_reveal(64), 77);
      check('C instance unaffected by D', inst.exports.C_reveal(0), 5);
    });
  })
  .then(function() {
    // No explicit constructor here -- a source-level pre-existing
    // limitation shared by every field (private or public) with no
    // constructor at all, not something this feature changes; nothing to
    // init(), the private method needs no per-instance state anyway.
    return run('private method, called from a sibling method of the same class', privateMethodSrc, function(inst) {
      check('reveal() calls this.#helper() and adds 1', inst.exports.reveal(0), 10);
    });
  })
  .then(function() {
    return run('Base\'s own method still reads its own private field inside a real extends chain', baseOwnPrivateInChainSrc, function(inst) {
      inst.exports.Base_init(0);
      check('Base.getSecret() sees its own private field', inst.exports.Base_getSecret(0), 1);
    });
  })
  .then(function() {
    expectCompileError(
      'referencing an undeclared #name is a real SyntaxError, not a silent garbage read',
      undeclaredSrc,
      "Private field '#nope' must be declared in an enclosing class"
    );
  })
  .then(function() {
    expectCompileError(
      'a subclass method literally containing this.#secret (declared only in the parent) is rejected at compile time',
      subclassCannotSeeParentPrivateSrc,
      "Private field '#secret' must be declared in an enclosing class"
    );
  })
  .then(function() {
    expectCompileError(
      'calling an undeclared private method is the same real SyntaxError, reached via the call-site path',
      undeclaredMethodSrc,
      "Private field '#missing' must be declared in an enclosing class"
    );
  })
  .then(function() {
    console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
  });
