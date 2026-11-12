// Requires a built native verify CLI and real wasm-bindgen artifacts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createVerifier } from '../../js/index.js';
const wasm = await readFile(new URL('../../pkg/ckb_wasm_verifier_bg.wasm', import.meta.url));
const verifier = await createVerifier({ wasm });
const cli = process.env.CKB_NATIVE_VERIFY ?? fileURLToPath(new URL('../../target/debug/verify', import.meta.url));
const directory = new URL('../../fixtures/', import.meta.url);
const names = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();
assert.ok(names.length, 'Differential suite requires fixture JSON files');
function normalize(result) {
  return result.groups ? { ...result, groups: [...result.groups].sort((a, b) =>
    `${a.group_type}:${a.script_hash}`.localeCompare(`${b.group_type}:${b.script_hash}`)) } : result;
}
function nativeVerify(request) {
  return new Promise((resolve, reject) => {
    const child = spawn(cli, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Native verifier timed out')); }, 120_000);
    child.stdout.setEncoding('utf8').on('data', (data) => { stdout += data; });
    child.stderr.setEncoding('utf8').on('data', (data) => { stderr += data; });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.stdin.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`Native verifier exit ${code}: ${stderr}`));
      try { resolve(JSON.parse(stdout)); } catch (error) { reject(error); }
    });
    child.stdin.end(JSON.stringify(request));
  });
}
for (const name of names) {
  test(`native/WASM differential: ${name}`, async () => {
    const { request, expected } = JSON.parse(await readFile(new URL(name, directory), 'utf8'));
    assert.equal(typeof expected?.ok, 'boolean', 'Fixture requires expected.ok');
    const native = await nativeVerify(request);
    const wasm = await verifier.verify(request);
    assert.deepEqual(normalize(wasm), normalize(native));
    for (const [key, value] of Object.entries(expected)) {
      assert.deepEqual(normalize({ [key]: wasm[key] })[key], normalize({ [key]: value })[key], key);
    }
  });
}
