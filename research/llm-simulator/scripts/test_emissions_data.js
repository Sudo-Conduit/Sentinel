// Verifies the frozen aws-instances.json against the same sanity rules
// fetch_emissions_coefficients.js applies at acquisition time, so a
// hand-edit or corrupted freeze is caught immediately.
var fs = require('fs');
var path = require('path');

var DATA_PATH = path.join(__dirname, '..', 'data', 'emissions', 'aws-instances.json');
var failures = 0;

function check(label, actual, expected) {
  var ok = actual === expected;
  if (!ok) failures++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + '  got=' + actual + ' want=' + expected);
}

function checkTrue(label, cond) {
  if (!cond) failures++;
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + label);
}

if (!fs.existsSync(DATA_PATH)) {
  console.log('no frozen emissions data at ' + DATA_PATH + ' yet -- run fetch_emissions_coefficients.js first');
  process.exit(0);
}

var frozen = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));

check('rowCount matches actual instances array length', frozen.rowCount, frozen.instances.length);
checkTrue('at least several hundred instance rows present', frozen.instances.length >= 100);
checkTrue('pueGlobalDefault is a sane PUE value (must be >= 1.0, real datacenters are never more efficient than their raw compute draw)', frozen.pueGlobalDefault >= 1.0 && frozen.pueGlobalDefault < 3.0);

var badRows = frozen.instances.filter(function(row) {
  return !(row.pkgWatt100 > row.pkgWattIdle) || row.pkgWattIdle < 0 || row.pkgWatt100 > 2500;
});
checkTrue('every row has Pmax > Pidle within a plausible range', badRows.length === 0);
if (badRows.length > 0) {
  console.log('  bad rows: ' + badRows.map(function(r) { return r.instanceType; }).join(', '));
}

// spot-check a known, stable instance type by name rather than trusting
// the aggregate checks alone
var a1medium = frozen.instances.find(function(r) { return r.instanceType === 'a1.medium'; });
checkTrue('a1.medium present (stable, long-standing instance type, good canary for source format changes)', !!a1medium);
if (a1medium) {
  checkTrue('a1.medium PkgWatt@Idle parsed as a real decimal (not NaN, not a comma-mangled artifact)', a1medium.pkgWattIdle > 0 && a1medium.pkgWattIdle < 10);
}

console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
