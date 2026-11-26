"""Build reproducible helpers and pin their hashes in both installers."""
from pathlib import Path
import hashlib
import json
import os
import re
import subprocess

ROOT = Path(__file__).resolve().parent
RESOURCES = ROOT.parents[1] / 'backend/open_webui/resources/workspace'
out = RESOURCES / 'transport'
out.mkdir(exist_ok=True)
hashes = {}
for system in ('windows', 'darwin', 'linux'):
    for arch in ('amd64', 'arm64'):
        platform = system + '-' + arch
        target = out / platform
        subprocess.run([os.environ.get('GO', 'go'), 'build', '-trimpath', '-buildvcs=false', '-ldflags=-s -w', '-o', str(target), '.'],
                       cwd=ROOT, env={**os.environ, 'GOOS': system, 'GOARCH': arch, 'CGO_ENABLED': '0'}, check=True)
        hashes[platform] = hashlib.sha256(target.read_bytes()).hexdigest()
(ROOT/'manifest.json').write_text(json.dumps(hashes, indent=2)+'\n')
ps = RESOURCES/'kividas-ssh-setup.ps1'
text = ps.read_text(encoding='utf-8-sig')
block = '# BEGIN TRANSPORT HASHES\n$TransportHashes = @{\n' + ''.join("    '%s' = '%s'\n" % (k, v) for k,v in hashes.items() if k.startswith('windows-')) + '}\n# END TRANSPORT HASHES'
text, count = re.subn(r'# BEGIN TRANSPORT HASHES.*?# END TRANSPORT HASHES', lambda _: block, text, flags=re.S)
assert count == 1
ps.write_text(text, encoding='utf-8-sig')
sh = RESOURCES/'kividas-ssh-setup.sh'
text = sh.read_text()
block = '# BEGIN TRANSPORT HASHES\ncase "$platform" in\n' + ''.join('  %s) transport_hash=%s ;;\n' % (k,v) for k,v in hashes.items() if not k.startswith('windows-')) + "  *) fail '暂不支持此电脑架构。' ;;\nesac\n# END TRANSPORT HASHES"
text, count = re.subn(r'# BEGIN TRANSPORT HASHES.*?# END TRANSPORT HASHES', lambda _: block, text, flags=re.S)
assert count == 1
sh.write_text(text)
print(json.dumps({'platforms': list(hashes), 'pinned': True}))
