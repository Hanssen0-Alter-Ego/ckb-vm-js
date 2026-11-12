import { readFile } from 'node:fs/promises';
import { createVerifier } from '../js/index.js';

// Accept either a raw request or a repository {request, expected} fixture.
const file = process.argv[2] ?? new URL('../fixtures/valid.json', import.meta.url);
const input = JSON.parse(await readFile(file, 'utf8'));
const verifier = await createVerifier({
  wasm: await readFile(new URL('../pkg/ckb_wasm_verifier_bg.wasm', import.meta.url)),
});
const result = await verifier.verify(input.request ?? input);
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
