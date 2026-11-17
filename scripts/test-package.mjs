// Install the exact tarball into an empty consumer, then exercise its public exports.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { chromium } from '@playwright/test';
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = await mkdtemp(path.join(tmpdir(), 'ckb-package-'));
let server, browser;
try {
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const tarball = path.join(root, `ckb-vm-js-${version}.tgz`);
  const entries = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' }).trim().split('\n');
  for (const entry of entries) assert.match(entry, /^package\/(?:package\.json|README\.md|LICENSE|THIRD_PARTY_NOTICES\.md|js\/[\w.-]+|pkg\/[\w.-]+\.(?:js|wasm|ts)|docs\/[\w.-]+\.md|crates\/verifier\/SCHEMA\.md)$/);
  execFileSync('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', path.join(directory, 'cache'), tarball], { cwd: directory, stdio: 'inherit' });
  const { request } = JSON.parse(await readFile(new URL('../fixtures/selected-lock.json', import.meta.url), 'utf8'));
  request.transaction.hash = '0x0ddc389e29dacea4405331a65ea4c9ee2d731984e598baff039bdf3f1da3d576';
  request.context.tip_header.hash = '0x431643f20c2ddc95980bb2797c2a020d78cc05c849b70ab1a041c7e2768ec106';
  request.context.verification.candidate_header.hash = '0x411e38f46d127390be4606bf4fec8c2db53321a8b3bdafd7b3428ebdb2bd5e64';
  request.context.headers = [{ ...request.context.tip_header, nonce: '0x1', hash: '0x771ff3bbda2687be90ceb8af09de258fa83d294e0e3ec7e430cdbdc0ae0ef087' }];
  const check = async (verifier, request) => {
    const matching = await verifier.verifyScriptGroup(request, request.script_group);
    if (!matching.ok || matching.scope !== 'script_group') throw new Error(JSON.stringify(matching));
    for (const key of ['transaction', 'tip', 'candidate', 'extra']) {
      const invalid = structuredClone(request);
      const item = key === 'transaction' ? invalid.transaction : key === 'tip' ? invalid.context.tip_header : key === 'candidate' ? invalid.context.verification.candidate_header : invalid.context.headers[0];
      item.hash = `0x${'00'.repeat(32)}`;
      const rejected = await verifier.verifyScriptGroup(invalid, invalid.script_group);
      if (rejected.error?.code !== 'InvalidRequest' || !rejected.error.message.includes('hash does not match')) throw new Error(`${key}: ${JSON.stringify(rejected)}`);
    }
    return matching.cycles;
  };
  await writeFile(path.join(directory, 'request.json'), JSON.stringify(request));
  await writeFile(path.join(directory, 'verify.mjs'), `
    import { readFile } from 'node:fs/promises';
    import { createVerifier } from 'ckb-vm-js';
    const wasm = await readFile(new URL(import.meta.resolve('ckb-vm-js/wasm')));
    await readFile(new URL(import.meta.resolve('ckb-vm-js/worker')));
    const verifier = await createVerifier({ wasm });
    const request = JSON.parse(await readFile('./request.json', 'utf8'));
    console.log('Installed Node package: matching hashes and four mismatches passed; cycles', await (${check})(verifier, request));
  `);
  execFileSync(process.execPath, ['verify.mjs'], { cwd: directory, stdio: 'inherit' });
  await writeFile(path.join(directory, 'consumer.ts'), `import { createVerifier, type Header, type Transaction, type VerifyRequest } from 'ckb-vm-js';
    async function use(request: VerifyRequest) { const v = await createVerifier({ wasm: new Uint8Array() }); return v.verify(request); }
    const headerHash: Header['hash'] = '0x00'; const txHash: Transaction['hash'] = '0x00'; void [use, headerHash, txHash];`);
  execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--module', 'NodeNext', '--target', 'ES2022', 'consumer.ts'], { cwd: directory, stdio: 'inherit' });
  console.log('Installed package public types passed');
  if (!process.argv.includes('--node-only')) {
    const installed = path.join(directory, 'node_modules/ckb-vm-js');
    server = createServer(async (req, res) => {
      try {
        if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Installed package consumer</title>'); return; }
        const filename = path.resolve(installed, '.' + new URL(req.url, 'http://localhost').pathname);
        if (!filename.startsWith(installed + path.sep)) { res.writeHead(403).end(); return; }
        res.setHeader('Content-Type', filename.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        res.end(await readFile(filename));
      } catch { res.writeHead(404).end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(async () => {
      const api = await import('/js/index.js');
      window.verifiers = [await api.createVerifier(), await api.createWorkerVerifier()];
    });
    await page.context().setOffline(true);
    const cycles = await page.evaluate(async ({ request, checkSource }) => {
      const check = (0, eval)(`(${checkSource})`);
      try { return await Promise.all(window.verifiers.map(v => check(v, request))); }
      finally { window.verifiers[1].dispose(); }
    }, { request, checkSource: String(check) });
    assert.equal(cycles[0], cycles[1]);
    console.log('Installed package types, browser and real Worker: matching hashes and all four mismatches passed offline', cycles);
  }
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
