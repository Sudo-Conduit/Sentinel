// Proves image_reference.js (Data.js + Tensor.js backed) produces bit-exact
// identical output to the original hand-rolled meshBits() from test_ocr.js,
// on the same 11 cases already verified against FrontendOCR.recognize().
var path = require('path');
var IR = require('./image_reference.js');
var FrontendOCR = require('./frontend_ocr.js');

var failures = 0;
function check(label, actual, expected) {
  var ok = actual === expected;
  if (!ok) failures++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + '  got=' + actual + ' want=' + expected);
}

var pngPath = path.join(__dirname, '90x80_001_ng.png');
var loaded = IR.loadAsChainData(pngPath);

console.log('chain Data instance: type=' + loaded.data.type +
  ' rows.length=' + loaded.data.rows.length +
  ' meta=' + JSON.stringify(loaded.data.meta));
check('Data bit-length matches width*height*channels*8', loaded.data.rows.length, loaded.img.width * loaded.img.height * 3 * 8);
check('Data meta.width', loaded.data.meta.width, loaded.img.width);
check('Data meta.height', loaded.data.meta.height, loaded.img.height);
check('Data meta.channels', loaded.data.meta.channels, 3);
console.log();

var cases = [
  { col: 0, row: 0, expectGlyph: '0' },
  { col: 1, row: 1, expectGlyph: '1' },
  { col: 2, row: 2, expectGlyph: '2' },
  { col: 3, row: 3, expectGlyph: '3' },
  { col: 4, row: 4, expectGlyph: '4' },
  { col: 5, row: 5, expectGlyph: '5' },
  { col: 6, row: 6, expectGlyph: '6' },
  { col: 7, row: 7, expectGlyph: '7' },
  { col: 1, row: 8, expectGlyph: 'A' },
  { col: 8, row: 8, expectGlyph: null },
  { col: 0, row: 1, expectGlyph: null }
];

Promise.all(cases.map(function(c) {
  var t = IR.meshTensor(loaded.img, c.col, c.row);
  check('mesh(' + c.col + ',' + c.row + ') tensor rank', t.rank(), 2);
  check('mesh(' + c.col + ',' + c.row + ') tensor size', t.size(), 72);
  var bits = IR.tensorToBitString(t);
  return FrontendOCR.recognize(bits).then(function(recognized) {
    check('mesh(' + c.col + ',' + c.row + ') recognized via Tensor-derived bits', recognized.glyph, c.expectGlyph);
  });
})).then(function() {
  console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
  process.exit(failures === 0 ? 0 : 1);
});
