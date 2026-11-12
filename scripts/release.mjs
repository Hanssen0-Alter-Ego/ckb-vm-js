// Release checks only. This module never publishes, creates tags or changes accounts.
import { readFile, writeFile, mkdir, copyFile, appendFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const packageName = 'ckb-vm-js';
export const repository = 'Hanssen0-Alter-Ego/ckb-vm-js';
export const registry = 'https://registry.npmjs.org';

export function parseVersion(version) {
  if (typeof version !== 'string' || version.length > 128) throw new Error('Invalid release version');
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(version);
  if (!match || match.slice(1, 4).some(n => !Number.isSafeInteger(Number(n)))) {
    throw new Error('Use canonical SemVer without build metadata');
  }
  const prerelease = match[4]?.split('.') ?? [];
  if (prerelease.some(id => /^\d+$/.test(id) && id.length > 1 && id.startsWith('0'))) {
    throw new Error('Numeric prerelease identifiers cannot have leading zeros');
  }
  return { core: match.slice(1, 4).map(Number), prerelease };
}

export function compareVersions(left, right) {
  const a = parseVersion(left), b = parseVersion(right);
  for (let i = 0; i < 3; i++) if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i] ? 1 : -1;
  if (!a.prerelease.length || !b.prerelease.length) return Math.sign(b.prerelease.length) - Math.sign(a.prerelease.length);
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const x = a.prerelease[i], y = b.prerelease[i];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    if (xn && yn) return BigInt(x) > BigInt(y) ? 1 : -1;
    if (xn !== yn) return xn ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

export function releaseMetadata(pkg, lock, tag, releasePrerelease) {
  const version = pkg.version;
  const parsed = parseVersion(version);
  if (pkg.name !== packageName || pkg.private === true) throw new Error('Unexpected/private package');
  if (pkg.repository?.url !== `git+https://github.com/${repository}.git`) throw new Error('repository.url must match the trusted repository');
  if (tag !== `v${version}`) throw new Error('Release tag must equal v + package.json version');
  if (lock.name !== pkg.name || lock.version !== version || lock.packages?.['']?.name !== pkg.name || lock.packages?.['']?.version !== version) {
    throw new Error('package-lock.json name/version does not match package.json');
  }
  const prerelease = parsed.prerelease.length > 0;
  if (releasePrerelease !== undefined && releasePrerelease !== prerelease) throw new Error('GitHub Release prerelease flag disagrees with SemVer');
  return { version, tag, dist_tag: prerelease ? 'next' : 'latest', filename: `${packageName}-${version}.tgz` };
}

export function checkGitContext(tag, eventSha, git = args => execFileSync('git', args, { encoding: 'utf8' }).trim()) {
  const commit = git(['rev-parse', 'HEAD']);
  if (git(['rev-parse', `refs/tags/${tag}^{commit}`]) !== commit) throw new Error('Tag moved or checkout is not the release tag');
  if (eventSha && eventSha !== commit) throw new Error('Release event SHA disagrees with current tag');
  git(['merge-base', '--is-ancestor', commit, 'refs/remotes/origin/main']);
  return commit;
}

export function checkRegistryMetadata(meta, data) {
  if (data?.name !== packageName || !data.versions || typeof data.versions !== 'object' || Array.isArray(data.versions) || Object.keys(data.versions).length === 0) throw new Error('A public bootstrap version is required; see docs/publishing.md');
  if (Object.hasOwn(data.versions, meta.version)) throw new Error(`${packageName}@${meta.version} already exists; do not republish or overwrite it`);
  const current = data['dist-tags']?.[meta.dist_tag];
  if (current && compareVersions(meta.version, current) <= 0) throw new Error(`Refusing to move ${meta.dist_tag} backwards from ${current}`);
}

export function checkTarball(bytes, expectedSha, manifest, meta) {
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (expectedSha && digest !== expectedSha) throw new Error('Tarball SHA-256 differs from the tested build');
  if (manifest.name !== packageName || manifest.version !== meta.version || manifest.private === true || manifest.repository?.url !== `git+https://github.com/${repository}.git`) {
    throw new Error('Tarball manifest does not match the release');
  }
  return digest;
}

async function output(values) {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''));
  console.log(JSON.stringify(values));
}

async function main(command) {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
  const live = process.env.GITHUB_EVENT_NAME === 'release';
  let prerelease;
  if (live) {
    prerelease = JSON.parse(process.env.RELEASE_PRERELEASE ?? 'null');
    if (typeof prerelease !== 'boolean') throw new Error('Missing GitHub Release prerelease flag');
  }
  const meta = releaseMetadata(pkg, lock, process.env.RELEASE_TAG, prerelease);
  if (command === 'check') {
    if (process.env.GITHUB_REPOSITORY !== repository) throw new Error('Unexpected GitHub repository');
    const commit_sha = checkGitContext(meta.tag, live ? process.env.GITHUB_SHA : undefined);
    await output({ ...meta, commit_sha });
    return;
  }
  if (!['artifact', 'prepublish'].includes(command)) throw new Error('Use check, artifact or prepublish');
  const filename = command === 'artifact' ? meta.filename : path.join('dist', meta.filename);
  const bytes = await readFile(filename);
  const manifest = JSON.parse(execFileSync('tar', ['-xOf', filename, 'package/package.json'], { encoding: 'utf8' }));
  const sha256 = checkTarball(bytes, command === 'prepublish' ? process.env.EXPECTED_SHA256 : undefined, manifest, meta);
  if (command === 'artifact') {
    await mkdir('dist', { recursive: true });
    await copyFile(filename, path.join('dist', meta.filename));
    await writeFile(path.join('dist', 'SHA256SUMS'), `${sha256}  ${meta.filename}\n`);
    await output({ ...meta, sha256 });
    return;
  }
  if (!live || process.env.GITHUB_REPOSITORY !== repository || !/^[a-f0-9]{64}$/.test(process.env.EXPECTED_SHA256 ?? '')) throw new Error('Live release event and tested artifact digest required');
  checkGitContext(meta.tag, process.env.GITHUB_SHA);
  const response = await fetch(`${registry}/${packageName}`, { signal: AbortSignal.timeout(20_000) });
  if (response.status === 404) throw new Error('No public bootstrap package; create/approve its first version before configuring OIDC. See docs/publishing.md');
  if (!response.ok) throw new Error(`Registry read failed: HTTP ${response.status}; not treating this as an unpublished version`);
  checkRegistryMetadata(meta, await response.json());
  await output({ ...meta, sha256 });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
}
