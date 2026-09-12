/**
 * @file research/lib/chain/tests/Data.unit.js
 * @author Will Fobbs
 * @description Comprehensive Data coverage: every SOURCE_TYPE, error paths, re-init.
 */
const assert = require('assert');
const Data = require('../Data.js');

/** @param {import('./TestRunner.js')} runner */
function register(runner)
{
  runner.suite('Data', () =>
  {
    runner.test('JSON_ARRAY normalizes rows and infers columns', () =>
    {
      const d = new Data().init([{ x: 1 }, { x: 2 }], { type: Data.SOURCE_TYPES.JSON_ARRAY });
      assert.deepStrictEqual(d.toArray(), [{ x: 1 }, { x: 2 }]);
      assert.deepStrictEqual(d.schema(), ['x']);
      assert.strictEqual(d.size(), 2);
    });

    runner.test('JSON_ARRAY rejects a non-array source', () =>
    {
      assert.throws(() => new Data().init({}, { type: Data.SOURCE_TYPES.JSON_ARRAY }), /must be an array/);
    });

    runner.test('JSON_MAP normalizes to key/value rows', () =>
    {
      const d = new Data().init({ a: 1, b: 2 }, { type: Data.SOURCE_TYPES.JSON_MAP });
      assert.deepStrictEqual(d.toArray(), [{ key: 'a', value: 1 }, { key: 'b', value: 2 }]);
    });

    runner.test('DELIMITED with header', () =>
    {
      const d = new Data().init('a,b\n1,2\n3,4', { type: Data.SOURCE_TYPES.DELIMITED });
      assert.deepStrictEqual(d.toArray(), [{ a: '1', b: '2' }, { a: '3', b: '4' }]);
    });

    runner.test('DELIMITED without header returns raw cell arrays', () =>
    {
      const d = new Data().init('1,2\n3,4', { type: Data.SOURCE_TYPES.DELIMITED, hasHeader: false });
      assert.deepStrictEqual(d.toArray(), [['1', '2'], ['3', '4']]);
    });

    runner.test('DB_TABLE normalizes columns+rows to records', () =>
    {
      const d = new Data().init({ columns: ['id', 'v'], rows: [[1, 10], [2, 20]] }, { type: Data.SOURCE_TYPES.DB_TABLE });
      assert.deepStrictEqual(d.toArray(), [{ id: 1, v: 10 }, { id: 2, v: 20 }]);
    });

    runner.test('BITMAP expands bytes to bits (MSB-first) with metadata', () =>
    {
      const d = new Data().init({ width: 2, height: 1, channels: 1, data: [255, 0] }, { type: Data.SOURCE_TYPES.BITMAP });
      assert.strictEqual(d.rows.join(''), '1111111100000000');
      assert.strictEqual(d.meta.width, 2);
      assert.strictEqual(d.meta.height, 1);
    });

    runner.test('UNICODE utf-8/16/32 produce the expected bit lengths for "H"', () =>
    {
      const u8 = new Data().init({ text: 'H', encoding: 'utf-8' }, { type: Data.SOURCE_TYPES.UNICODE });
      assert.strictEqual(u8.rows.length, 8);
      const u16 = new Data().init({ text: 'H', encoding: 'utf-16' }, { type: Data.SOURCE_TYPES.UNICODE });
      assert.strictEqual(u16.rows.length, 16);
      const u32 = new Data().init({ text: 'H', encoding: 'utf-32' }, { type: Data.SOURCE_TYPES.UNICODE });
      assert.strictEqual(u32.rows.length, 32);
    });

    runner.test('UNICODE plain string defaults to utf-8', () =>
    {
      const d = new Data().init('Hi', { type: Data.SOURCE_TYPES.UNICODE });
      assert.strictEqual(d.meta.encoding, 'utf-8');
      assert.strictEqual(d.rows.length, 16);
    });

    runner.test('ASCII "w" = 1110111 (7-bit)', () =>
    {
      const d = new Data().init('w', { type: Data.SOURCE_TYPES.ASCII });
      assert.strictEqual(d.rows.join(''), '1110111');
      assert.strictEqual(d.meta.bitsPerChar, 7);
    });

    runner.test('ASCII with bitsPerChar=8 pads to a byte', () =>
    {
      const d = new Data().init('w', { type: Data.SOURCE_TYPES.ASCII, bitsPerChar: 8 });
      assert.strictEqual(d.rows.join(''), '01110111');
    });

    runner.test('ASCII rejects non-ASCII code points', () =>
    {
      assert.throws(() => new Data().init('∆', { type: Data.SOURCE_TYPES.ASCII }), /non-ASCII/);
    });

    runner.test('init throws on missing source', () =>
    {
      assert.throws(() => new Data().init(null, { type: Data.SOURCE_TYPES.ASCII }), /source is required/);
    });

    runner.test('init throws on missing opts.type', () =>
    {
      assert.throws(() => new Data().init('x', {}), /opts\.type is required/);
    });

    runner.test('init throws on unknown type', () =>
    {
      assert.throws(() => new Data().init('x', { type: 'not-a-type' }), /unknown type/);
    });

    runner.test('re-init reuses the same instance (repeatability)', () =>
    {
      const d = new Data().init('a', { type: Data.SOURCE_TYPES.ASCII });
      assert.strictEqual(d.rows.length, 7);
      d.init('bb', { type: Data.SOURCE_TYPES.ASCII });
      assert.strictEqual(d.rows.length, 14);
    });
  });
}

if (require.main === module)
{
  const TestRunner = require('./TestRunner.js');
  const runner = new TestRunner();
  register(runner);
  runner.run().then((result) => { process.exitCode = result.failed > 0 ? 1 : 0; });
}

module.exports = register;
