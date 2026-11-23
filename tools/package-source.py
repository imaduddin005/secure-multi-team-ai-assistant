"""Create an allowlisted, secret-scanned source ZIP. Never archive the workspace wholesale."""
from pathlib import Path
import hashlib, os, re, zipfile

root=Path(__file__).resolve().parent.parent
destination=root/'deliverables'/'secure-multi-team-ai-assistant-source.zip'
destination.parent.mkdir(exist_ok=True)
top={'README.md','.env.example','.gitignore','compose.yaml','package.json','package-lock.json',
     'tsconfig.api.json','tsconfig.database.json','jest.config.cjs','jest.database.config.cjs','requirements-tools.txt'}
directories={'apps','database','docs','diagrams','tools','tests','demo-files'}
excluded={'node_modules','.next','.tmp','.git','dist','build','coverage','__pycache__','runtime','uploads','storage-data','postgres-data','redis-data'}
extensions={'.ts','.tsx','.js','.mjs','.cjs','.json','.css','.md','.sql','.mmd','.svg','.png','.py','.ps1','.txt','.yaml','.yml','.pdf'}
submission_docs={'api.md','database-design.md','design-decisions.md','free-ai-setup.md','free-redis-setup.md',
                 'operations.md','requirements.md','testing.md','testing-results.json'}
submission_diagrams={'schema.mmd','schema.svg','simple-er-diagram.png'}
files=[root/name for name in top if (root/name).is_file()]
for dirname in directories:
    for folder,subdirs,names in os.walk(root/dirname):
        subdirs[:]=[name for name in subdirs if name not in excluded and dirname not in {'docs','diagrams'}]
        for name in names:
            p=Path(folder)/name
            if dirname=='docs' and name not in submission_docs:continue
            if dirname=='diagrams' and name not in submission_diagrams:continue
            if name.startswith('.env') or p.suffix.lower() not in extensions or name.endswith('.tsbuildinfo'):continue
            if p.is_symlink():raise RuntimeError('Symlinks are not included in a submission')
            files.append(p)
word_report=root/'output'/'docx'/'secure-multi-team-ai-assistant-report.docx'
approved_report=root/'output'/'pdf'/'secure-multi-team-ai-assistant-report-final.pdf'
report=next((p for p in [approved_report,word_report,root/'output'/'pdf'/'secure-multi-team-ai-assistant-report.pdf'] if p.is_file()),None)
if report is None:raise RuntimeError('Generate and visually verify the final Word or PDF report first')
files.append(report)
secrets=[]
for line in (root/'.env').read_text(encoding='utf-8').splitlines():
    if not line or line.startswith('#') or '=' not in line:continue
    name,value=line.split('=',1);value=value.strip().strip('"').strip("'")
    if re.search(r'PASSWORD|(?:^|_)KEY$|_DATABASE_URL$|_JWT$',name) and len(value)>=20 and not re.search(r'YOUR_|REPLACE_ME|CHOOSE_IN_',value):
        secrets.append(value.encode())
# Local demo passwords are not environment variables. Check them too without
# displaying the file contents or copying the private learner-results folder.
credential_notes=root/'.tmp'/'demo-login-credentials.txt'
if credential_notes.is_file():
    for value in re.findall(r'^Password: ([^\r\n]+)',credential_notes.read_text(encoding='utf-8'),re.MULTILINE):
        if len(value)>=12:secrets.append(value.encode())
easy_password=root/'learner-test-kit'/'results'/'SARA-PASSWORD-PRIVATE.txt'
if easy_password.is_file():
    value=easy_password.read_bytes().strip()
    if len(value)>=12:secrets.append(value)
for p in files:
    if not p.resolve().is_relative_to(root.resolve()):raise RuntimeError('Source path escaped workspace')
    payloads=[p.read_bytes()]
    if p.suffix.lower()=='.docx':
        with zipfile.ZipFile(p) as word_archive:
            if word_archive.testzip() is not None:raise RuntimeError('Word package integrity check failed')
            payloads.extend(word_archive.read(name) for name in word_archive.namelist())
    if any(secret in data for data in payloads for secret in secrets):raise RuntimeError(f'Private configuration found in source candidate: {p.relative_to(root)}')
with zipfile.ZipFile(destination,'w',zipfile.ZIP_DEFLATED) as archive:
    for p in sorted(set(files)):
        archive.write(p,'secure-multi-team-ai-assistant/'+p.relative_to(root).as_posix())
with zipfile.ZipFile(destination) as archive:
    if archive.testzip() is not None:raise RuntimeError('ZIP validation failed')
    for name in archive.namelist():
        parts=Path(name).parts
        if any(part in excluded for part in parts) or (Path(name).name.startswith('.env') and Path(name).name!='.env.example'):
            raise RuntimeError('Excluded runtime/configuration entered the archive')
print(f'Created {destination.relative_to(root)} with {len(set(files))} allowlisted files; real env values absent.')
print('SHA256 '+hashlib.sha256(destination.read_bytes()).hexdigest())
