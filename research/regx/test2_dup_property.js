var ExtendX = require('./ExtendX.js');
global.self = global;
self.ExtendX = ExtendX;
var RegX = require('./RegX.js');

RegX.enableDebug();

// 'this.age' is assigned twice (constructor, then reassigned in birthday()).
// propRegex scans the whole source, so ast.properties will contain 'age' twice
// and, pre-fix, buildPropertyMap would give the second occurrence its own
// (wasted/unstable) offset instead of reusing the first.
var personCode = `
class Person {
  constructor(name, age) {
    this.name = name;
    this.age = age;
  }
  birthday() {
    this.age = this.age + 1;
    return this.age;
  }
}
`;

RegX.compileAndRun(personCode, {})
  .then(function(instance) {
    console.log('SUCCESS');
    console.log('Exports:', Object.keys(instance.exports));
    if (instance.exports.init) {
      // Data params are i64 now — WASM i64 requires BigInt from JS.
      instance.exports.init(0, 42n, 25n);
    }
    console.log('birthday() call 1 =', instance.exports.birthday(0));
    console.log('birthday() call 2 =', instance.exports.birthday(0));
  })
  .catch(function(err) {
    console.error('ERROR:', err.message);
    console.error(err.stack);
  });
