"""Real browser/API/PostgreSQL checks with explicitly test-only Auth/AI/Storage.
Requires a built API + production frontend and the isolated test PostgreSQL cluster.
Starts only its own loopback processes; never modifies real environment files.
"""
from pathlib import Path
from datetime import datetime, timezone
import json, os, shutil, socket, subprocess, time, urllib.request
from playwright.sync_api import sync_playwright, expect

root=Path(__file__).resolve().parents[2]
scratch=root/'.tmp/browser';scratch.mkdir(parents=True,exist_ok=True)
shots=root/'docs/screenshots';shots.mkdir(parents=True,exist_ok=True)
node=shutil.which('node')
browser_path=os.environ.get('BROWSER_EXECUTABLE',r'C:\Program Files\Google\Chrome\Application\chrome.exe')
processes=[];logs=[];checks=[]
hr='30000000-0000-4000-8000-000000000001';eng='30000000-0000-4000-8000-000000000002'
salary='50000000-0000-4000-8000-000000000002';sara_hr='40000000-0000-4000-8000-000000000002'
auth='http://127.0.0.1:44000';api='http://127.0.0.1:44001'

def record(name):checks.append({'name':name,'status':'passed'});print('PASS '+name,flush=True)
def launch(label,args,extra):
    stream=(scratch/(label+'.log')).open('wb');logs.append(stream)
    process=subprocess.Popen([node,*args],cwd=root,env={**os.environ,**extra,'NEXT_TELEMETRY_DISABLED':'1'},
        stdout=stream,stderr=subprocess.STDOUT,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    processes.append(process);return process
def stop(process):
    if process.poll() is None:
        subprocess.run(['taskkill','/PID',str(process.pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,
            creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0),check=False)
        process.wait(timeout=15)
def ready(url,process):
    deadline=time.monotonic()+100
    while time.monotonic()<deadline:
        if process.poll() is not None:raise RuntimeError('A test-owned server stopped before readiness; inspect .tmp/browser logs')
        try:
            with urllib.request.urlopen(url,timeout=3) as response:
                if response.status==200:return
        except Exception:pass
        time.sleep(.25)
    raise RuntimeError('Local server readiness timeout; inspect .tmp/browser logs')
def local_only(route):
    from urllib.parse import urlparse
    if urlparse(route.request.url).hostname in ('localhost','127.0.0.1'):route.continue_()
    else:route.abort()
def no_overflow(page):
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+1')
def login(page,name,team=hr):
    page.get_by_label('Email',exact=True).fill(name+'@example.test')
    page.get_by_label('Password',exact=True).fill('test-only-password')
    page.get_by_role('button',name='Sign in →',exact=True).click()
    expect(page.get_by_label('Active team')).to_be_visible(timeout=20000)
    page.get_by_label('Active team').select_option(team)
    expect(page.get_by_label('Active team')).to_have_value(team)
    page.get_by_role('button',name='Refresh',exact=True).click()
def logout(page):
    page.get_by_role('button',name='Sign out',exact=True).click()
    expect(page.get_by_role('heading',name='Welcome to your private workspace.')).to_be_visible()
def tab(page,name):page.locator('nav button').filter(has_text=name).click()
def ask(page,text):
    page.get_by_label('Question',exact=True).fill(text)
    page.get_by_role('button',name='Ask →',exact=True).click()

try:
    for port in (3030,3002,44000,44001):
        with socket.socket() as probe:probe.bind(('127.0.0.1',port))
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=browser_path,headless=True)
        errors=[]
        production=launch('production',['node_modules/next/dist/bin/next','start','apps/web','--hostname','127.0.0.1','--port','3030'],{})
        ready('http://127.0.0.1:3030',production)
        context=browser.new_context(viewport={'width':1365,'height':900});context.route('**/*',local_only)
        page=context.new_page();page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto('http://localhost:3030',wait_until='networkidle')
        expect(page.get_by_role('heading',name='Welcome to your private workspace.')).to_be_visible()
        expect(page.get_by_role('button',name='Sign in →')).to_be_disabled()
        no_overflow(page);page.screenshot(path=str(shots/'local-setup-desktop.png'),full_page=True)
        record('Production login fails closed without real public Auth settings; desktop layout fits')
        page.set_viewport_size({'width':390,'height':844});no_overflow(page)
        page.screenshot(path=str(shots/'local-setup-mobile.png'),full_page=True)
        record('Production login fits a mobile viewport')
        context.close();stop(production)

        fixture=launch('fixture',['--env-file-if-exists=.env','dist/tests/browser/server.js'],{'NODE_ENV':'test'})
        ready(auth+'/test-only/ready',fixture)
        frontend=launch('frontend',['--max-old-space-size=1536','node_modules/next/dist/bin/next','dev','apps/web','--webpack','--hostname','127.0.0.1','--port','3002'],{
            'NODE_ENV':'development','NEXT_PUBLIC_SUPABASE_URL':auth,'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY':'test-only-public','NEXT_PUBLIC_API_BASE_URL':api})
        ready('http://127.0.0.1:3002',frontend)
        context=browser.new_context(viewport={'width':1365,'height':1000});context.route('**/*',local_only)
        page=context.new_page();page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto('http://localhost:3002',wait_until='networkidle');login(page,'ali')
        tab(page,'Documents');expect(page.locator('table')).to_contain_text('Leave Policy')
        expect(page.locator('table')).not_to_contain_text('Salary Plan');expect(page.get_by_role('button',name='Upload',exact=True)).to_have_count(0)
        record('Viewer sees authorized documents, hidden restricted title and no upload control')
        tab(page,'Chat');ask(page,'How do I request leave?')
        expect(page.locator('.message.assistant .answer')).to_contain_text('Synthetic fixture answer',timeout=20000)
        page.locator('button.source').first.click()
        expect(page.get_by_role('dialog',name='Authorized source')).to_contain_text('planned leave')
        page.get_by_role('button',name='Close',exact=True).click()
        page.get_by_label('Optional feedback comment').fill('Synthetic browser feedback')
        page.get_by_role('button',name='Helpful',exact=True).click();expect(page.get_by_role('status')).to_contain_text('Feedback saved')
        page.screenshot(path=str(shots/'test-only-viewer-chat.png'),full_page=True)
        record('Viewer asks through the real API, inspects source and saves optional feedback')
        logout(page);record('Sign-out clears protected screens')
        assert context.request.post(auth+'/test-only/restart-api').ok

        login(page,'sara',hr);tab(page,'Documents')
        expect(page.get_by_role('button',name='Upload',exact=True)).to_be_visible()
        page.get_by_placeholder('Document title (optional)').fill('UI private note')
        page.locator('input[type=file]').set_input_files(root/'demo-files/Leave Policy.txt')
        page.get_by_role('button',name='Upload',exact=True).click();expect(page.get_by_role('status')).to_contain_text('Uploaded privately',timeout=20000)
        assert context.request.post(auth+'/test-only/drain').ok
        page.get_by_role('button',name='Refresh',exact=True).click()
        row=page.locator('tr').filter(has_text='UI private note');expect(row).to_contain_text('ready')
        row.get_by_role('button',name='Versions',exact=True).click()
        with page.expect_download() as result:page.get_by_role('button',name='Download',exact=True).click()
        assert 'TechCo' in Path(result.value.path()).read_text(encoding='utf-8')
        page.screenshot(path=str(shots/'test-only-documents.png'),full_page=True)
        record('Editor upload, real SQL processing, ready status, versions and private download work')

        page.get_by_label('Active team').select_option(eng);tab(page,'Documents')
        expect(page.locator('table')).to_contain_text('API Guide');expect(page.locator('table')).not_to_contain_text('UI private note')
        expect(page.get_by_role('button',name='Upload',exact=True)).to_have_count(0)
        record('Sara changes from HR editor to Engineering viewer and old protected state clears')
        page.get_by_label('Active team').select_option(hr);tab(page,'Chat')
        signed=context.request.post(auth+'/auth/v1/token?grant_type=password',data={'email':'hina@example.test','password':'test-only-password'})
        assert signed.ok;admin_headers={'Authorization':'Bearer '+signed.json()['access_token']}
        assert context.request.post(api+f'/teams/{hr}/documents/{salary}/grants',headers=admin_headers,data={'membershipId':sara_hr}).ok
        ask(page,'Explain the available training policies.')
        expect(page.locator('.message.assistant .answer')).to_contain_text('Synthetic fixture answer',timeout=20000)
        assert context.request.delete(api+f'/teams/{hr}/documents/{salary}/grants/{sara_hr}',headers=admin_headers).ok
        page.get_by_role('button',name='Refresh',exact=True).click()
        expect(page.locator('.message.assistant')).to_contain_text('sources are no longer accessible')
        expect(page.locator('.message.assistant button.source')).to_have_count(0)
        page.screenshot(path=str(shots/'test-only-revoked-history.png'),full_page=True)
        record('Grant revocation hides an entire old answer and citation controls after refresh')
        logout(page)
        assert context.request.post(auth+'/test-only/restart-api').ok
        login(page,'hina');tab(page,'Documents')
        expect(page.locator('table')).not_to_contain_text('UI private note')
        record('Admin has no implicit read of another uploader\'s restricted document')
        tab(page,'Chat');expect(page.locator('.message.assistant')).to_have_count(0)
        record('Admin cannot see another membership\'s private conversation')
        tab(page,'Admin');expect(page.locator('.metric')).to_be_visible()
        page.get_by_label('Monthly answer limit').fill('0');page.get_by_role('button',name='Set limit',exact=True).click()
        expect(page.get_by_role('status')).to_contain_text('Budget updated and audited')
        expect(page.locator('table').last).to_contain_text('usage.budget_changed')
        page.screenshot(path=str(shots/'test-only-admin.png'),full_page=True)
        record('Admin changes a real SQL quota and sees its safe audit event')
        logout(page)
        # This is a separate quota scenario, not a stress test of one shared IP.
        assert context.request.post(auth+'/test-only/restart-api').ok
        login(page,'ali');tab(page,'Chat');ask(page,'Another allowed policy question')
        expect(page.locator('.alert.error')).to_contain_text('monthly answer limit reached',timeout=20000)
        record('Quota denial is displayed without a generated answer')
        page.set_viewport_size({'width':390,'height':844});no_overflow(page)
        record('Authenticated workspace fits a mobile viewport')
        assert not errors,'Unexpected browser JavaScript errors; inspect the local test run'
        record('No uncaught browser JavaScript errors in tested flows')
        context.close();browser.close()
    evidence={'executedAtUTC':datetime.now(timezone.utc).isoformat(),'command':'python tests/browser/smoke.py',
        'layer':'Real Chrome, Next.js, NestJS and isolated PostgreSQL; test-only Auth/AI/Storage; direct test SQL job dispatch, not Redis',
        'checks':checks,'passed':len(checks),'liveSupabaseAI':False,'liveRedis':False}
    (root/'docs/browser-run.json').write_text(json.dumps(evidence,indent=2)+'\n',encoding='utf-8')
    print(f'Browser checks passed: {len(checks)}. Sanitized evidence: docs/browser-run.json',flush=True)
finally:
    for process in reversed(processes):stop(process)
    for stream in logs:stream.close()
