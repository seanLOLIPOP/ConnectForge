from pathlib import Path
import zipfile, json
root=Path(__file__).resolve().parent.parent
version=json.loads((root/'package.json').read_text())['version']
with zipfile.ZipFile(root/f'dist/SI-Remote-{version}-Source.zip','w',zipfile.ZIP_DEFLATED) as z:
    for folder in ['app','admin','server','scripts','assets']:
        for p in (root/folder).rglob('*'):
            if p.is_file() and 'node_modules' not in p.parts and p.suffix not in ['.key','.log']:
                z.write(p,p.relative_to(root))
    for name in ['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','README.md','.gitignore','test/updates.test.mjs','test/clipboard.test.mjs','test/service.test.mjs','test/electron-harness.cjs']:
        z.write(root/name,name)
print('Source archive created without local data or credentials.')
