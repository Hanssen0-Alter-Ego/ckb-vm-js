#!/usr/bin/env python3
"""Generate distributable notices: python scripts/generate-third-party-notices.py metadata.json.
Run cargo metadata --format-version 1 to obtain metadata for the locked workspace first.
Upstream license snapshots and their source URLs live in scripts/licenses/.
"""
import json, pathlib, sys
root=pathlib.Path(__file__).resolve().parent.parent
meta=json.load(open(sys.argv[1])); snapshots=root/'scripts/licenses'
sources={(n,v):(u,f) for n,v,u,f in json.loads((snapshots/'sources.json').read_text())}
groups={}; gaps=[]; count=0
def add(text, label, source):
    groups.setdefault(text,[]).append((label,source))
def local(p,f,label=None):
    d=pathlib.Path(p['manifest_path']).parent
    source=(str(f.relative_to(root)) if f.is_relative_to(root) else f"https://crates.io/crates/{p['name']}/{p['version']} — {f.relative_to(d)}")
    add(f.read_text(),label or f"{p['name']} {p['version']} ({p['license']})",source)
for p in meta['packages']:
    if p['name']=='ckb-wasm-verifier':continue
    count+=1;d=pathlib.Path(p['manifest_path']).parent
    files=[f for f in d.iterdir() if f.is_file() and any(k in f.name.lower() for k in ['license','copying','notice'])]
    mit=[f for f in files if 'mit' in f.name.lower()]
    selected=mit or [f for f in files if f.name.lower() in ['license','license.md','copying']]
    selected+= [f for f in files if ('third-party' in f.name.lower() or 'unicode' in f.name.lower() or 'notice' in f.name.lower() or f.name.lower() == 'copying') and f not in selected]
    if not selected:
        if d.is_relative_to(root/'vendor/ckb'):selected=[root/'vendor/ckb/COPYING']
        elif d.is_relative_to(root/'vendor/ckb-vm'):selected=[root/'vendor/ckb-vm/COPYING']
        else:
            url,name=sources.get((p['name'],p['version']),('MISSING',''))
            if name:add((snapshots/name).read_text(),f"{p['name']} {p['version']} ({p['license']})",url)
            else:gaps.append(f"{p['name']} {p['version']} ({p['license']}); upstream: {p['repository']}")
    for f in selected:local(p,f)
    for f in d.rglob('*'):
        if f.is_file() and f.parent!=d and any(k in f.name.lower() for k in ['license','copying','notice']):local(p,f,f"{p['name']} {p['version']} bundled component: {f.relative_to(d)}")
    if p['name']=='blake2b-rs':
        f=d/'BLAKE2/ref/blake2b-ref.c';s=f.read_text();add(s[:s.index('*/')+2]+'\n','BLAKE2 bundled in blake2b-rs 0.2.0 (CC0-1.0 selected)',f"https://crates.io/crates/blake2b-rs/0.2.0 — {f.relative_to(d)}")
# siphasher 0.3.11 ships COPYRIGHT/choice text but omits the referred MIT body.
# Reproduce that body from the same upstream's locally available 1.0.4 release,
# retaining each release's original COPYING copyright notice above.
for p in meta['packages']:
    if p['name']=='siphasher' and p['version']=='1.0.4':
        local(p,pathlib.Path(p['manifest_path']).parent/'LICENSE-MIT','MIT license body referenced by siphasher 0.3.11 COPYING; body sourced from siphasher 1.0.4')
for name,url in json.loads((snapshots/'extra-sources.json').read_text()).items():
    add((snapshots/name).read_text(), 'ckb-system-scripts 0.5.4 bundled component: '+name,url)
lines=['# Third-party notices','',f'This inventory covers {count} third-party Cargo package/version entries from the locked build, including build-only and target-specific dependencies. Their inclusion does not imply every package is linked into the distributed WebAssembly. npm development tools are not bundled in the published package.','', 'License texts and notices below are reproduced from the published crate contents, pinned vendored source trees, or the upstream URLs shown. Identical texts are printed once. MIT is selected where an MIT alternative is available; additional Unicode and bundled-component notices remain included. BLAKE2 uses its offered CC0 option. Upstream URLs using a branch rather than a commit/tag are explicitly current-upstream fallbacks, not verified release snapshots.','', 'The project license does not replace these third-party terms. Preserve this file when redistributing the package.','']
if gaps:lines+=['## Unresolved release-notice gaps','', 'The following manifests declare licenses, but matching complete upstream license notices were not available in the collected sources. These entries must be resolved before treating this inventory as complete.','']+['- '+g for g in gaps]+['']
for i,(body,entries) in enumerate(groups.items(),1):
    lines += [f'## Notice {i}','']
    for label,source in entries:lines+=['- '+label+'; source: '+source]
    lines+=['','```text',body.rstrip('\n'),'```','']
(root/'THIRD_PARTY_NOTICES.md').write_text('\n'.join(lines))
print(f'{count} packages, {len(groups)} distinct notices; {len(gaps)} gaps')
for g in gaps:print(g)
