"""Export sanitized Jest names/counts; never include failures, tokens or fixture bodies."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib, json, subprocess

root=Path(__file__).resolve().parent.parent
data=json.loads((root/'.tmp/test-results.json').read_text(encoding='utf-8'))
if not data.get('success') or data.get('numFailedTests') or data.get('numPendingTests'):
    raise RuntimeError('Final passing evidence requires a complete successful run without skipped tests')
lock=json.loads((root/'package-lock.json').read_text(encoding='utf-8'))
versions={name:lock['packages'][f'node_modules/{name}']['version'] for name in ['@nestjs/core','pg','jest','pdf-parse','jose','@supabase/supabase-js','bullmq']}
rows=[]
for suite in data['testResults']:
    path=Path(suite['name']).relative_to(root).as_posix().removeprefix('dist/')
    path=path.removesuffix('.js')+'.ts'
    for test in suite['assertionResults']:
        rows.append({'file':path,'test':test['fullName'],'status':test['status'],'durationMs':test.get('duration')})
sources=sorted((root/'database/migrations').glob('*.sql'))+sorted((root/'apps/api/src').glob('*.ts'))+sorted((root/'tests').rglob('*.ts'))
if any(p.stat().st_mtime*1000>data['startTime'] for p in sources):
    raise RuntimeError('Source changed after this test run started; rerun the suite before exporting evidence')
checksums={p.relative_to(root).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in sources}
evidence={'startedAtUTC':datetime.fromtimestamp(data['startTime']/1000,timezone.utc).isoformat(),
    'command':'npm run test:all','node':subprocess.check_output(['node','--version'],text=True).strip(),
    'database':'Real project-local PostgreSQL 18.4 + pgvector 0.8.7, isolated test cluster',
    'packages':versions,'suites':{'passed':data['numPassedTestSuites'],'total':data['numTotalTestSuites']},
    'tests':{'passed':data['numPassedTests'],'total':data['numTotalTests'],'skipped':data['numPendingTests']},
    'limits':['JWT tests use a local cryptographically verified JWKS fixture, not live Supabase Auth.',
              'AI and original-file Storage tests use explicit test-only adapters.',
              'PostgreSQL outbox tests do not establish real Redis/BullMQ transport recovery.',
              'Actual PDF extraction is tested with synthetic text and no-text files.',
              'Prior-period ledger settlement is tested; actual timed UTC rollover is not injected.',
              'Live Supabase bucket policies, real provider behavior and live authenticated browser acceptance remain separate from the browser fixtures.'],
    'cases':rows,'sourceSHA256':checksums}
(root/'docs/test-run.json').write_text(json.dumps(evidence,indent=2)+'\n',encoding='utf-8')
print(f"Wrote sanitized evidence: {data['numPassedTests']}/{data['numTotalTests']} tests, {data['numPassedTestSuites']} suites.")
