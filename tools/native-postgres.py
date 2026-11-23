"""Project-local Windows PostgreSQL fallback. Does not modify the system service/data.
Requires installed PostgreSQL 18 binaries/headers and VS 2022 C++ tools.
Build pgvector from its pinned official source; keep all generated data in .tmp.
"""
from pathlib import Path
import argparse, io, os, shutil, subprocess, tarfile, urllib.request

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('action', choices=['prepare', 'start', 'stop'])
args = parser.parse_args()
runtime = root / '.tmp' / 'pgsql'
source = root / '.tmp' / 'pgvector'
installation = Path(os.environ.get('NATIVE_PG_INSTALL', r'C:\Program Files\PostgreSQL\18'))

def run(command, **kwargs):
    subprocess.run([str(x) for x in command], check=True, **kwargs)

if args.action == 'prepare':
    for folder in ['bin', 'lib', 'share', 'include']:
        shutil.copytree(installation / folder, runtime / folder, dirs_exist_ok=True)
    if not source.exists():
        data = urllib.request.urlopen('https://codeload.github.com/pgvector/pgvector/tar.gz/refs/tags/v0.8.7', timeout=90).read()
        with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
            archive.extractall(root / '.tmp', filter='data')
        (root / '.tmp' / 'pgvector-0.8.7').rename(source)
    vcvars = Path(os.environ.get('NATIVE_VCVARS', r'C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat'))
    command = f'call "{vcvars}" && set "PGROOT={runtime}" && nmake /F Makefile.win && nmake /F Makefile.win install'
    run(['cmd.exe', '/d', '/s', '/c', command], cwd=source)
    print('Prepared local PostgreSQL binaries and official pgvector v0.8.7.')
elif args.action == 'start':
    if not (runtime / 'lib' / 'vector.dll').exists():
        raise RuntimeError('Run prepare first')
    env = {}
    for line in (root / '.env').read_text(encoding='utf-8').splitlines():
        if '=' in line and not line.startswith('#'):
            key, value = line.split('=', 1); env[key] = value
    for label, port, secret in [('demo', 55432, 'LOCAL_POSTGRES_PASSWORD'), ('test', 55433, 'LOCAL_TEST_POSTGRES_PASSWORD')]:
        data = root / '.tmp' / f'pg-{label}'
        if not (data / 'PG_VERSION').exists():
            password_file = root / '.tmp' / f'pg-{label}-password'
            password_file.write_text(env[secret], encoding='utf-8')
            try:
                run([runtime/'bin/initdb.exe', '-D', data, '-U', 'postgres', '--encoding=UTF8', '--locale=C',
                     '--auth-host=scram-sha-256', '--auth-local=scram-sha-256', f'--pwfile={password_file}'])
            finally:
                password_file.unlink(missing_ok=True)
            with (data/'postgresql.conf').open('a', encoding='utf-8') as config:
                config.write(f"\nport={port}\nlisten_addresses='127.0.0.1'\ncluster_name='secure-assistant-{label}'\nshared_buffers='32MB'\nmax_connections=40\n")
        if subprocess.run([str(runtime/'bin/pg_ctl.exe'), '-D', str(data), 'status'], capture_output=True).returncode != 0:
            run([runtime/'bin/pg_ctl.exe', '-D', data, '-l', data/'server.log', '-w', 'start'])
        pg_env = {**os.environ, 'PGPASSWORD': env[secret]}
        name = 'assistant' if label == 'demo' else 'assistant_test'
        existing = subprocess.run([str(runtime/'bin/psql.exe'), '-h', '127.0.0.1', '-p', str(port), '-U', 'postgres',
                                   '-d', 'postgres', '-Atc', f"SELECT 1 FROM pg_database WHERE datname='{name}'"],
                                  env=pg_env, capture_output=True, text=True, check=True)
        if existing.stdout.strip() != '1':
            run([runtime/'bin/createdb.exe', '-h', '127.0.0.1', '-p', port, '-U', 'postgres', name], env=pg_env)
    print('Isolated native demo/test PostgreSQL servers ready on loopback. No system service modified.')
else:
    for label in ['demo', 'test']:
        data = root / '.tmp' / f'pg-{label}'
        if (data/'PG_VERSION').exists():
            run([runtime/'bin/pg_ctl.exe', '-D', data, '-m', 'fast', '-w', 'stop'])
