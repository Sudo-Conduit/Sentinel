// ─── fetch_emissions_coefficients.js — download, verify, freeze real Teads/CCF power data ──
//
// Same discipline as fetch_model_config.js: download the REAL published
// dataset (Cloud Carbon Footprint's own aws-instances.csv, built from
// turbostat + stress-ng measurements against real bare-metal reference
// hardware -- https://github.com/cloud-carbon-footprint/cloud-carbon-coefficients),
// verify it before trusting it, freeze the verified result.
//
// This is the Pidle/Pmax source for:
//   Estimated Power (W) = Pidle + (utilization/100) * (Pmax - Pidle)
// Fields used: "PkgWatt @ Idle" (Pidle) and "PkgWatt @ 100%" (Pmax), per
// real AWS instance type. CSV uses decimal COMMAS ("0,29"), not dots --
// a European-export format, handled explicitly below rather than silently
// mis-parsed as thousands separators.
var https = require('https');
var fs = require('fs');
var path = require('path');

var CSV_URL = 'https://raw.githubusercontent.com/cloud-carbon-footprint/cloud-carbon-coefficients/main/data/aws-instances.csv';
// Sourced and verified via web search against cloudcarbonfootprint.org's own
// methodology docs: "The Cloud Carbon Footprint team fixes the PUE at
// 1.185, which is the global value provided by the Microsoft
// Sustainability team." Not a guess -- a cited constant.
var PUE_GLOBAL_DEFAULT = 1.185;

function fetchText(url) {
  return new Promise(function(resolve, reject) {
    https.get(url, { headers: { 'User-Agent': 'llm-simulator-fetch/1.0' } }, function(res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(fetchText(res.headers.location));
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error('HTTP ' + res.statusCode + ' fetching ' + url));
        return;
      }
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() { resolve(Buffer.concat(chunks).toString('utf8')); });
    }).on('error', reject);
  });
}

// Minimal CSV line parser respecting double-quoted fields (needed because
// several fields are quoted decimal-comma numbers, e.g. "0,29").
function parseCsvLine(line) {
  var fields = [];
  var cur = '';
  var inQuotes = false;
  for (var i = 0; i < line.length; i++) {
    var c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === ',' && !inQuotes) {
      fields.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  fields.push(cur);
  return fields;
}

// "0,29" -> 0.29 (decimal comma, not a thousands separator -- these values
// are all well under 1000 so there's no real ambiguity, verified below by
// range-checking every parsed value).
function parseDecimalComma(s) {
  if (s === 'N/A' || s === '') return null;
  var n = Number(s.replace(',', '.'));
  return Number.isNaN(n) ? null : n;
}

async function main() {
  console.log('fetching ' + CSV_URL);
  var csv = await fetchText(CSV_URL);
  var lines = csv.split('\n').filter(function(l) { return l.trim().length > 0; });
  var header = parseCsvLine(lines[0]);

  var idx = {
    instanceType: header.indexOf('Instance type'),
    vCPU: header.indexOf('Instance vCPU'),
    platformVCPU: header.indexOf('Platform Total Number of vCPU'),
    cpuName: header.indexOf('Platform CPU Name'),
    pkgWattIdle: header.indexOf('PkgWatt @ Idle'),
    pkgWatt100: header.indexOf('PkgWatt @ 100%'),
    ramWattIdle: header.indexOf('RAMWatt @ Idle'),
    ramWatt100: header.indexOf('RAMWatt @ 100%')
  };
  var missingCols = Object.keys(idx).filter(function(k) { return idx[k] === -1; });
  if (missingCols.length) {
    throw new Error('expected columns missing from CSV header: ' + missingCols.join(', '));
  }

  var rows = [];
  var errors = [];
  for (var i = 1; i < lines.length; i++) {
    var f = parseCsvLine(lines[i]);
    var instanceType = f[idx.instanceType];
    var pkgIdle = parseDecimalComma(f[idx.pkgWattIdle]);
    var pkg100 = parseDecimalComma(f[idx.pkgWatt100]);
    var vCPU = Number(f[idx.vCPU]);

    if (pkgIdle === null || pkg100 === null) continue; // some rows are genuinely N/A (no measured data), skip rather than error
    // sanity check: Pmax must exceed Pidle, and both must be plausible
    // wattages for a package (not thousands-separator misparse artifacts)
    if (pkg100 <= pkgIdle) { errors.push(instanceType + ': PkgWatt@100% (' + pkg100 + ') <= PkgWatt@Idle (' + pkgIdle + ')'); continue; }
    // 2500W upper bound accommodates real massive multi-socket bare-metal
    // instances (e.g. u-24tb1.metal genuinely draws >1300W package power
    // across its many sockets) -- the original 1000W cap rejected real
    // valid rows, not bad data; found by inspecting what actually got
    // skipped rather than trusting the filter silently.
    if (pkgIdle < 0 || pkgIdle > 2500 || pkg100 < 0 || pkg100 > 2500) { errors.push(instanceType + ': wattage out of plausible range (' + pkgIdle + '/' + pkg100 + ')'); continue; }

    rows.push({
      instanceType: instanceType,
      vCPU: vCPU,
      platformVCPU: Number(f[idx.platformVCPU]) || null,
      cpuName: f[idx.cpuName],
      pkgWattIdle: pkgIdle,
      pkgWatt100: pkg100,
      ramWattIdle: parseDecimalComma(f[idx.ramWattIdle]),
      ramWatt100: parseDecimalComma(f[idx.ramWatt100])
    });
  }

  console.log('parsed ' + rows.length + ' valid rows out of ' + (lines.length - 1) + ' data lines (' + errors.length + ' skipped for failing sanity checks)');
  if (errors.length > 0 && errors.length < 20) {
    console.log('skipped rows:\n  ' + errors.join('\n  '));
  }
  if (rows.length < 100) {
    throw new Error('expected several hundred valid rows, got ' + rows.length + ' -- source format may have changed, refusing to freeze');
  }
  console.log('PASS  row count and Pmax > Pidle sanity checks');

  var frozen = {
    sourceUrl: CSV_URL,
    sourceProject: 'cloud-carbon-footprint/cloud-carbon-coefficients (Teads methodology)',
    fetchedAt: new Date().toISOString(),
    pueGlobalDefault: PUE_GLOBAL_DEFAULT,
    pueSource: 'cloudcarbonfootprint.org methodology docs, citing Microsoft Sustainability team global average',
    formula: 'Estimated Power (W) = Pidle + (CPU_Utilization/100) * (Pmax - Pidle)',
    rowCount: rows.length,
    instances: rows
  };

  var outPath = path.join(__dirname, '..', 'data', 'emissions', 'aws-instances.json');
  fs.writeFileSync(outPath, JSON.stringify(frozen, null, 2) + '\n');
  console.log('FROZEN -> ' + outPath);
}

main().catch(function(e) { console.error('FAIL: ' + e.message); process.exit(1); });
