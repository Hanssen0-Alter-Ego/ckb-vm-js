// Smoke-test the distributable exactly as an offline Node consumer would use it.
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = await mkdtemp(path.join(tmpdir(), 'ckb-package-'));
try {
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const tarball = path.join(root, `ckb-vm-js-${version}.tgz`);
  execFileSync('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', path.join(directory, 'cache'), tarball], { cwd: directory, stdio: 'inherit' });
  const { request } = JSON.parse(await readFile(new URL('../fixtures/valid.json', import.meta.url), 'utf8'));
  await writeFile(path.join(directory, 'request.json'), JSON.stringify(request));
  await writeFile(path.join(directory, 'verify.mjs'), `
    import { readFile } from 'node:fs/promises';
    import { createVerifier } from 'ckb-vm-js';
    const wasm = await readFile(new URL(import.meta.resolve('ckb-vm-js/wasm')));
    await readFile(new URL(import.meta.resolve('ckb-vm-js/worker')));
    const verifier = await createVerifier({ wasm });
    const request = JSON.parse(await readFile('./request.json', 'utf8'));
    const result = await verifier.verify(request);
    if (!result.ok || result.cycles !== '0x21b') throw new Error(JSON.stringify(result));
    console.log('Installed package verified offline:', result.scope, result.cycles);
  `);
  execFileSync(process.execPath, ['verify.mjs'], { cwd: directory, stdio: 'inherit' });
} finally { await rm(directory, { recursive: true, force: true }); }
