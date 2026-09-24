var ExtendX = require('./ExtendX.js');
global.self = global;
self.ExtendX = ExtendX;
var RegX = require('./RegX.js');

var failures = 0;
function readString(inst, ptr) {
  var dv = new DataView(inst.exports.memory.buffer);
  var len = Number(dv.getBigInt64(Number(ptr), true));
  var bytes = new Uint8Array(inst.exports.memory.buffer, Number(ptr) + 8, len);
  return Buffer.from(bytes).toString('utf8');
}
function checkStr(label, actual, expected) {
  var ok = actual === expected;
  if (!ok) failures++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + '  got=' + JSON.stringify(actual) + ' want=' + JSON.stringify(expected));
}

function run(label, source, calls) {
  return RegX.compileAndRun(source, {})
    .then(function(instance) { return calls(instance, label); })
    .catch(function(err) {
      console.log('THREW (unexpected)  ' + label + '  ' + err.message);
      failures++;
    });
}

// typeof resolved for every real value category this compiler has:
// number (i64/f64), string, array/object, function (closure), boolean.
var src = `
class C {
  constructor(x) {
    this.x = x;
    this.ratio = 2.5;
    this.name = 'hi';
    this.arr = [1, 2];
    this.obj = { a: 1 };
    this.f = () => x;
  }
  tInt() { return typeof this.x; }
  tFloat() { return typeof this.ratio; }
  tStr() { return typeof this.name; }
  tArr() { return typeof this.arr; }
  tObj() { return typeof this.obj; }
  tFunc() { return typeof this.f; }
  tBoolLit() { return typeof true; }
  tExpr() { return typeof (this.x + 1); }
}
`;

Promise.resolve()
  .then(function() {
    return run('typeof across every real value category', src, function(inst) {
      inst.exports.init(0, 5n);
      checkStr('typeof this.x (i64)', readString(inst, inst.exports.tInt(0)), 'number');
      checkStr('typeof this.ratio (f64)', readString(inst, inst.exports.tFloat(0)), 'number');
      checkStr('typeof this.name (string)', readString(inst, inst.exports.tStr(0)), 'string');
      checkStr('typeof this.arr (array)', readString(inst, inst.exports.tArr(0)), 'object');
      checkStr('typeof this.obj (object)', readString(inst, inst.exports.tObj(0)), 'object');
      checkStr('typeof this.f (closure)', readString(inst, inst.exports.tFunc(0)), 'function');
      checkStr('typeof true (boolean literal)', readString(inst, inst.exports.tBoolLit(0)), 'boolean');
      checkStr('typeof (this.x + 1) (composite expr)', readString(inst, inst.exports.tExpr(0)), 'number');
    });
  })
  .then(function() {
    console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
  });
