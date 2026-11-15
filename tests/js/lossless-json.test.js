import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLossless, stringifyLossless, rawNumber } from '../../web/lossless-json.js';

test('unknown numeric JSON tokens survive cloning and mutation without coercion', () => {
  const text = '{"big":9007199254740993,"negative":-18446744073709551615,"fraction":0.1234567890123456789,"exponent":1e400,"zero":-0,"safe":17,"nested":[9007199254740993],"text":"9007199254740993"}';
  const object = structuredClone(parseLossless(text));
  assert.equal(rawNumber(object.big), '9007199254740993');
  object.safe = 18;
  const output = stringifyLossless(object);
  for (const value of ['9007199254740993','-18446744073709551615','0.1234567890123456789','1e400','-0']) assert.ok(output.includes(value));
  assert.match(output, /"text": "9007199254740993"/);
  assert.match(output, /"safe": 18/);
});

test('marker-looking strings and object keys remain untouched; invalid JSON is rejected', () => {
  const text = '{"__ckb_workbench_number_0__":"7","nested":{"__ckb_workbench_placeholder_1__":"9007199254740993"},"n":9007199254740993}';
  const output = stringifyLossless(structuredClone(parseLossless(text)));
  assert.match(output, /"__ckb_workbench_number_0__": "7"/);
  assert.match(output, /"__ckb_workbench_placeholder_1__": "9007199254740993"/);
  assert.match(output, /"n": 9007199254740993/);
  assert.throws(() => parseLossless('{"n":01}'), SyntaxError);
});
