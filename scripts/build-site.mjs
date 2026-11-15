import { cp, mkdir, readFile, rm } from 'node:fs/promises';
// Require real compiled bindings; never publish a mock or an empty playground.
for (const file of ['pkg/ckb_wasm_verifier.js', 'pkg/ckb_wasm_verifier_bg.wasm']) await readFile(file);
await rm('site-dist', { recursive: true, force: true });
await mkdir('site-dist/docs', { recursive: true });
for (const file of ['index.html', 'app.js', 'guided.js', 'workbench.js', 'workbench-model.js', 'lossless-json.js', 'worker.js', 'style.css']) await cp(`web/${file}`, `site-dist/${file}`);
for (const dir of ['js', 'pkg', 'fixtures']) await cp(dir, `site-dist/${dir}`, { recursive: true });
for (const file of ['javascript.md', 'verification.md']) await cp(`docs/${file}`, `site-dist/docs/${file}`);
await cp('crates/verifier/SCHEMA.md', 'site-dist/docs/SCHEMA.md');
for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) await cp(file, `site-dist/${file}`);
console.log('Built site-dist with real WASM and relative project-site URLs.');

