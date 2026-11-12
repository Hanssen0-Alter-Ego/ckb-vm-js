import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { releaseMetadata, parseVersion, compareVersions, checkRegistryMetadata, checkTarball, checkGitContext } from '../../scripts/release.mjs';
const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
const lock = JSON.parse(await readFile(new URL('../../package-lock.json', import.meta.url), 'utf8'));
const meta = releaseMetadata(pkg, lock, `v${pkg.version}`);

test('release requires exact tag, package identity, repository and lockfile version', () => {
  assert.equal(meta.dist_tag, 'latest');
  assert.throws(() => releaseMetadata(pkg, lock, 'refs/heads/main'));
  assert.throws(() => releaseMetadata({ ...pkg, name: 'other' }, lock, meta.tag));
  assert.throws(() => releaseMetadata({ ...pkg, private: true }, lock, meta.tag));
  assert.throws(() => releaseMetadata({ ...pkg, repository: { url: 'https://example.com' } }, lock, meta.tag));
  assert.throws(() => releaseMetadata(pkg, { ...lock, version: '9.0.0' }, meta.tag));
  assert.throws(() => releaseMetadata(pkg, { ...lock, packages: {} }, meta.tag));
});
test('prereleases use next and must agree with GitHub Release flag', () => {
  const version = '0.3.0-rc.1';
  const p = { ...pkg, version }, l = { ...lock, version, packages: { '': { name: pkg.name, version } } };
  assert.equal(releaseMetadata(p, l, `v${version}`, true).dist_tag, 'next');
  assert.throws(() => releaseMetadata(p, l, `v${version}`, false));
  assert.throws(() => releaseMetadata(pkg, lock, meta.tag, true));
});
test('release versions reject ambiguous versions and control/shell characters', () => {
  for (const bad of ['01.2.3', '1.2', '1.2.3+build', '1.2.3-01', '1.2.3-rc..1', '1.2.3\n', '1.2.3;echo x', '1.2.3/other', '9007199254740992.0.0']) assert.throws(() => parseVersion(bad), bad);
});
test('version ordering handles numeric prereleases and stable promotion', () => {
  const versions = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-rc.2', '1.0.0-rc.10', '1.0.0', '1.0.1', '2.0.0'];
  for (let i = 1; i < versions.length; i++) assert.equal(compareVersions(versions[i - 1], versions[i]), -1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
});
test('registry gate rejects missing package, duplicate versions and tag rollback', () => {
  assert.throws(() => checkRegistryMetadata(meta, {}));
  assert.throws(() => checkRegistryMetadata(meta, { name: pkg.name, versions: {} }));
  assert.throws(() => checkRegistryMetadata(meta, { name: pkg.name, versions: { [pkg.version]: {} } }));
  assert.throws(() => checkRegistryMetadata(meta, { name: pkg.name, versions: { '9.0.0': {} }, 'dist-tags': { latest: '9.0.0' } }));
  assert.doesNotThrow(() => checkRegistryMetadata(meta, { name: pkg.name, versions: { '0.1.0': {} }, 'dist-tags': { latest: '0.1.0' } }));
});
test('publish artifact must retain tested bytes and expected package identity', () => {
  const bytes = Buffer.from('test tarball'), hash = checkTarball(bytes, undefined, pkg, meta);
  assert.equal(checkTarball(bytes, hash, pkg, meta), hash);
  assert.throws(() => checkTarball(Buffer.from('changed'), hash, pkg, meta));
  assert.throws(() => checkTarball(bytes, hash, { ...pkg, version: '9.0.0' }, meta));
});
test('git guard verifies tag/event identity and main ancestry', () => {
  const calls = [], sha = 'a'.repeat(40);
  const git = args => { calls.push(args); return sha; };
  assert.equal(checkGitContext(meta.tag, sha, git), sha);
  assert.deepEqual(calls.at(-1), ['merge-base', '--is-ancestor', sha, 'refs/remotes/origin/main']);
  assert.throws(() => checkGitContext(meta.tag, 'b'.repeat(40), git));
  assert.throws(() => checkGitContext(meta.tag, sha, args => { if (args[0] === 'merge-base') throw new Error('not on main'); return sha; }));
  assert.throws(() => checkGitContext(meta.tag, sha, args => args[1] === 'HEAD' ? sha : 'b'.repeat(40)));
});

test('git guard also rejects an actual unmerged local test tag', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { execFileSync } = await import('node:child_process');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const directory = await mkdtemp(join(tmpdir(), 'ckb-release-graph-'));
  const git = args => execFileSync('git', args, { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const commit = message => git(['-c', 'user.name=Release Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', message]);
  try {
    git(['init', '-q', '-b', 'main']);
    await writeFile(join(directory, 'file'), 'main');
    git(['add', 'file']); commit('main fixture');
    const sha = git(['rev-parse', 'HEAD']);
    git(['update-ref', 'refs/remotes/origin/main', sha]);
    git(['tag', 'v1.0.0']);
    assert.equal(checkGitContext('v1.0.0', sha, git), sha);
    git(['checkout', '-qb', 'side']);
    await writeFile(join(directory, 'file'), 'unmerged');
    git(['add', 'file']); commit('unmerged fixture');
    git(['tag', 'v1.0.1']);
    assert.throws(() => checkGitContext('v1.0.1', undefined, git));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
