var ExtendX = require('./ExtendX.js');
global.self = global;
self.ExtendX = ExtendX;
var RegX = require('./RegX.js');

RegX.enableDebug();

var personCode = `
class Person {
  constructor(name, age) {
    this.name = name;
    this.age = age;
  }
  greet() {
    return this.age + 1;
  }
}
`;

RegX.compileAndRun(personCode, {})
  .then(function(instance) {
    console.log('SUCCESS');
    console.log('Exports:', Object.keys(instance.exports));
    if (instance.exports.init) {
      // Data params are i64 now (RegX's new default numeric type) — WASM
      // i64 requires BigInt from the JS side, plain numbers throw.
      instance.exports.init(0, 42n, 25n);
    }
    if (instance.exports.greet) {
      console.log('greet() =', instance.exports.greet(0));
    }
  })
  .catch(function(err) {
    console.error('ERROR:', err.message);
  });
