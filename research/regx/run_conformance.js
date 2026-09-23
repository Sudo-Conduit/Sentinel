// Minimal driver for RegXConformance.js's CASES array — bypasses the
// TestReport dependency (not vendored here) by iterating and scoring
// cases directly. Real first-party results, not a browser-pasted summary.
global.self = global;
var ExtendX = require('./ExtendX.js');
self.ExtendX = ExtendX;
var RulesEngine = require('./RulesEngine.js');
self.RulesEngine = RulesEngine;
var RegX = require('./RegX.js');
self.RegX = RegX;
var RegXConformance = require('./RegXConformance.js');

var cases = RegXConformance.CASES;
var pass = 0, fail = 0, xfail = 0, xpass = 0, skip = 0;
var failures = [];

cases.forEach(function(c) {
  var r;
  try { r = c.run(RegX); } catch (e) { r = { ok: false, detail: 'HARNESS THREW: ' + e.message }; }
  var tag;
  if (r.ok === null) {
    tag = 'SKIP'; skip++;
  } else if (c.xfail) {
    tag = r.ok ? 'XFAIL' : 'XPASS?';
    if (r.ok) xfail++; else xpass++;
  } else {
    tag = r.ok ? 'PASS' : 'FAIL';
    if (r.ok) pass++; else { fail++; failures.push(c.id + ' ' + c.name); }
  }
  console.log(tag.padEnd(7) + c.id + '  ' + c.name);
  console.log('        ' + r.detail);
});

console.log('');
console.log('pass=' + pass + ' fail=' + fail + ' xfail(locked)=' + xfail + ' xpass(unlocked)=' + xpass + ' skip=' + skip);
if (failures.length) {
  console.log('FAILURES:');
  failures.forEach(function(f) { console.log('  ' + f); });
}
process.exit(fail > 0 ? 1 : 0);
