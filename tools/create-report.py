"""Create the short submission report and its readable 21-table relationship diagram.

Uses dated sanitized evidence only. Render and inspect all pages before delivery.
"""
from pathlib import Path
import argparse
import json
from datetime import date
from xml.sax.saxutils import escape
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table, TableStyle,
    PageBreak, NextPageTemplate,
)
from reportlab.graphics.shapes import Drawing, Rect, Line, Polygon, String
from reportlab.graphics import renderSVG, renderPDF
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.pagesizes import A4, landscape

root = Path(__file__).resolve().parent.parent
args = argparse.ArgumentParser(description=__doc__)
args.add_argument('--date', default=date.today().isoformat())
report_date = date.fromisoformat(args.parse_args().date)
out = root / 'output/pdf'
out.mkdir(parents=True, exist_ok=True)

def evidence(name):
    p = root / 'docs' / name
    return json.loads(p.read_text(encoding='utf-8')) if p.exists() else {}

live = evidence('live-final-run.json')
manual = evidence('manual-test-observations.json')
if not live.get('success'):
    raise RuntimeError('Final live acceptance evidence must exist and be successful; do not invent results')
green = colors.HexColor('#176853')
ink = colors.HexColor('#18342D')
muted = colors.HexColor('#53665F')
pale = colors.HexColor('#EDF5F0')
rule = colors.HexColor('#C9DAD2')
styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name='TitleLocal', fontName='Helvetica-Bold', fontSize=25, leading=29, textColor=ink, spaceAfter=13))
styles.add(ParagraphStyle(name='Kicker', fontName='Helvetica-Bold', fontSize=8, leading=11, textColor=green, spaceAfter=11))
styles['Heading1'].fontSize = 18
styles['Heading1'].leading = 22
styles['Heading1'].textColor = green
styles['Heading1'].spaceAfter = 11
styles['Heading2'].fontSize = 11.5
styles['Heading2'].leading = 15
styles['Heading2'].textColor = ink
styles['BodyText'].fontSize = 9.3
styles['BodyText'].leading = 13.3
styles['BodyText'].spaceAfter = 8
styles.add(ParagraphStyle(name='SmallLocal', fontSize=8.1, leading=11.3, textColor=muted, spaceAfter=7))
styles.add(ParagraphStyle(name='CellLocal', fontSize=8.4, leading=11.3, textColor=ink))
story = []
width = A4[0] - 104

def p(text, style='BodyText'):
    story.append(Paragraph(text, styles[style]))

def table(rows, widths):
    t = Table([[Paragraph(escape(str(v)), styles['CellLocal']) for v in row] for row in rows], colWidths=widths, hAlign='LEFT')
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), pale), ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LINEBELOW', (0, 0), (-1, 0), .7, green),
        ('LINEBELOW', (0, 1), (-1, -1), .3, rule),
        ('LEFTPADDING', (0, 0), (-1, -1), 7), ('RIGHTPADDING', (0, 0), (-1, -1), 7),
        ('TOPPADDING', (0, 0), (-1, -1), 6), ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]))
    story.extend([t, Spacer(1, 9)])

def newpage(template='Portrait'):
    story.extend([NextPageTemplate(template), PageBreak()])

# Page 1: database choice and implemented system boundaries.
p('TECHCO / SUBMISSION REPORT / ' + report_date.strftime('%d %B %Y').upper(), 'Kicker')
p('Secure Multi-Team<br/>AI Assistant', 'TitleLocal')
p('1. Database choice and system design', 'Heading1')
p('<b>Purpose.</b> Teams inside one organization upload private or team-visible documents. Their members ask questions, inspect cited sources and rate answers. The backend controls access, background processing, audit records and monthly usage; the frontend has Chat, Documents and Admin pages.')
p('<b>Chosen database: PostgreSQL with pgvector.</b> PostgreSQL is the actual relational database. SQL is the language used to query it. pgvector stores numeric document embeddings so relevant text can be ranked inside the same permission-controlled database.')
p('<b>Supabase is a hosted backend platform, not the application framework.</b> This project uses its Auth service for accounts/tokens and its private Storage for original files. The canonical application tables are in a separate local PostgreSQL instance. Opening the Supabase dashboard does not start that local instance. NestJS and Next.js are the application frameworks.')
p('<b>Why this choice and shape.</b> Users can join multiple teams with different roles, so memberships connect users and teams. Documents need versions, per-reader grants and answer provenance, so these are separate related tables. Foreign keys prevent mismatched team references; transactions/locks protect access changes and the final quota slot; forced row-level security adds database enforcement. Keeping vectors with these records avoids a second search store with inconsistent permissions.')
table([
    ['Component', 'Responsibility'],
    ['Browser / Next.js', 'Sign in, select a team and call the API with a bearer token. No private server credentials.'],
    ['API / NestJS', 'Verify identity; resolve current membership; validate input; authorize document/chat/admin commands.'],
    ['PostgreSQL / pgvector', '21 business tables: permissions, immutable revisions, chunks, source provenance, jobs, audit and quota ledger.'],
    ['Worker / Redis / providers', 'Relay durable SQL jobs through BullMQ; fetch private originals, parse/embed, activate or purge. Gemini and Groq were used on synthetic files.'],
], [119, width - 119])
table([
    ['Person', 'HR membership', 'Engineering membership'],
    ['Ali', 'Viewer', 'None'], ['Sara', 'Editor', 'Viewer'],
    ['Hina', 'Admin', 'None'], ['Ahmed', 'None', 'Admin'],
], [90, 188, width - 278])
p('<b>Design-first and authorship.</b> Module 0 records the initial database design before application implementation. The working rules are AI-assisted proposals implemented in the MVP; they are not represented as the learner\'s independent engineering work or automatic adoption. Detailed decisions remain in docs/design-decisions.md.', 'SmallLocal')

# Page 2: beginner-friendly core ERD. Detailed schema remains supplied separately.
newpage()
p('2. Database relationship diagram', 'Heading1')
p('This simplified ER diagram shows the main tables for teams, roles, file access and document processing. Each arrow points from one parent record to its many child records. The full schema is supplied separately.', 'BodyText')
diagram = Drawing(491, 440)
nodes = {}

def node(name, label, note, x, y, w=139):
    nodes[name] = (x, y, w, 48)
    diagram.add(Rect(x, y, w, 48, rx=6, ry=6, fillColor=pale, strokeColor=green, strokeWidth=.9))
    diagram.add(String(x + w/2, y + 29, label, textAnchor='middle', fontName='Helvetica-Bold', fontSize=11, fillColor=ink))
    diagram.add(String(x + w/2, y + 13, note, textAnchor='middle', fontName='Helvetica', fontSize=8.4, fillColor=muted))

def arrow(a, b, route=None):
    ax, ay, aw, ah = nodes[a]
    bx, by, bw, bh = nodes[b]
    if route:
        points=route
    elif abs(ay-by) < 3:
        if bx > ax: x1,y1,x2,y2=ax+aw,ay+ah/2,bx,by+bh/2
        else: x1,y1,x2,y2=ax,ay+ah/2,bx+bw,by+bh/2
        points=[(x1,y1),(x2,y2)]
    else:
        if by < ay: x1,y1,x2,y2=ax+aw/2,ay,bx+bw/2,by+bh
        else: x1,y1,x2,y2=ax+aw/2,ay+ah,bx+bw/2,by
        points=[(x1,y1),(x2,y2)]
    for (x1,y1),(x2,y2) in zip(points,points[1:]):
        diagram.add(Line(x1,y1,x2,y2,strokeColor=green,strokeWidth=1))
    (x1,y1),(x2,y2)=points[-2:]
    from math import atan2, sin, cos
    angle=atan2(y2-y1,x2-x1)
    diagram.add(Polygon([x2,y2,x2-5*cos(angle)+2.5*sin(angle),y2-5*sin(angle)-2.5*cos(angle),x2-5*cos(angle)-2.5*sin(angle),y2-5*sin(angle)+2.5*cos(angle)],fillColor=green,strokeColor=green))

node('organizations','Organization','TechCo',176,390)
node('teams','Teams','HR / Engineering',176,298)
node('users','Users','Ali / Sara / Hina / Ahmed',0,206)
node('memberships','Memberships','User + team + role',176,206)
node('documents','Documents','Files owned by a team',352,206)
node('document_grants','Read permissions','Selected readers of a file',176,114)
node('document_versions','File versions','v1, v2 and later revisions',352,114)
node('document_chunks','Text chunks','Small searchable text parts',352,22)
arrow('organizations','teams')
arrow('teams','memberships')
arrow('users','memberships')
arrow('teams','documents',[(315,322),(421.5,322),(421.5,254)])
arrow('memberships','document_grants')
arrow('documents','document_grants',[(371,206),(371,183),(305,183),(305,162)])
arrow('documents','document_versions')
arrow('document_versions','document_chunks')
story.append(diagram)
renderSVG.drawToFile(diagram, str(root/'diagrams/simple-er-diagram.svg'))
# Export the same picture independently for the learner's chat/download.
preview_path=root/'.tmp/simple-er-diagram-preview.pdf'
c=canvas.Canvas(str(preview_path),pagesize=(531,535))
c.setFont('Helvetica-Bold',19);c.setFillColor(ink);c.drawString(20,506,'TechCo - Simple ER Diagram')
renderPDF.draw(diagram,c,20,52)
c.setFont('Helvetica',9);c.setFillColor(muted);c.drawString(20,31,'Arrows: one parent can have many child records.')
c.drawString(20,16,'Core tables only. The full ER diagram is supplied separately.')
c.showPage();c.save()
import pypdfium2 as pdfium
preview=pdfium.PdfDocument(preview_path)
preview[0].render(scale=2.5).to_pil().save(root/'diagrams/simple-er-diagram.png')
preview.close()
p('<b>Example.</b> TechCo has HR and Engineering teams. Sara has a separate membership in each: HR editor and Engineering viewer. Each team has its documents. A restricted document grants read access to selected memberships. Every document can have versions, and each version is split into searchable text chunks.')
p('<b>Table names.</b> Read permissions = document_grants; File versions = document_versions; Text chunks = document_chunks. This picture omits chat, citations, feedback, audit, quota and worker tables to keep the main relationships easy to understand. Their full keys and relationships are in diagrams/schema.svg and the database catalog.', 'SmallLocal')

# Page 3: explicit rules, reasons, access/history decisions.
newpage()
p('3. Rules decided and why', 'Heading1')
p('These are explicit implemented MVP choices. The learner should review the reasons and tradeoffs, then adopt or revise them in their own words.')
table([
    ['Situation', 'Rule and reason'],
    ['Roles and restricted uploads', 'Permissions belong to the current team membership. A new file is restricted to its uploader. Admin manages ACLs but has no implicit content/chat read; explicit self-grant is allowed and audited. This separates administration from silent content access.'],
    ['Document updated', 'Create an immutable revision; keep the old ready version until the newer one finishes successfully. Failed/older out-of-order work cannot replace a newer successful version. Old citations keep their original revision, preserving evidence.'],
    ['Document deleted', 'Tombstone immediately, clear its current pointer and reject reads. Whole dependent assistant answers/citations become unavailable. Durable worker cleanup later removes originals/chunks; access denial does not wait for remote deletion.'],
    ['Document moved to another team', 'No in-place move. A permitted reader with destination upload permission creates a new upload/identity with fresh grants. Source deletion is a separate authorized action, avoiding accidental permission transfer.'],
    ['Member leaves or role changes', 'Removal is terminal for that membership and revokes its grants; rejoin creates a new identity, so old grants/chats do not revive. Demotion uses current SQL role checks immediately. Transactions also prevent removing the last administrator.'],
    ['Old chat loses a source', 'Record every chunk supplied to the model, including uncited input. If any potential source becomes unreadable, hide the entire old assistant answer, citation, feedback target and replay. Hiding just a quote could leave paraphrased private information.'],
    ['Two requests share one remaining slot', 'Atomically reserve before provider work; settle successful saved grounded answers in the original UTC month. Release failed/insufficient/blocked holds. Scoped idempotency and attempt fences prevent double charges and stale completions. Default monthly limit: 1,000.'],
    ['Worker/provider failure', 'PostgreSQL jobs and outbox are durable; Redis is delivery, not the sole work record. Leases/fences reject duplicate/stale activation. Missing citations produce a fixed insufficient-sources reply; invalid provider output fails safely.'],
], [115, width-115])
p('<b>How a question is protected.</b> Verify login -> resolve current team membership -> reserve quota -> retrieve only authorized current-ready chunks -> call the model with untrusted evidence and no tools -> validate citation labels -> lock/recheck all supplied sources -> save answer, provenance and charge together. History, original downloads and replay recheck current access.', 'SmallLocal')
p('<b>Boundary.</b> A valid citation label does not guarantee factual accuracy. Trusted server/Storage/database credentials remain powerful. Revocation protects subsequent app responses; it cannot recall an already downloaded file, screenshot or authorized response.', 'SmallLocal')

# Page 4: actual tests, method and interpretation.
newpage()
p('4. Hard cases tested and actual outcomes', 'Heading1')
p('<b>Who performed the tests.</b> The actions below describe agent-executed project testing, assisted by AI tools. The learner\'s manual observations are recorded separately. This does not attribute independent testing/design work to the learner.')
p('<b>Test environments.</b> I used actual PostgreSQL with controlled Auth/AI/Storage fixtures for reproducible concurrency and failure scenarios (21 Nov 2026). I also used the running API/worker with real Supabase, Gemini/Groq and Redis/PostgreSQL for live scenarios (23 Nov 2026). The earlier regression was not rerun during report editing.')
table([
    ['What I tested', 'What happened'],
    ['Simultaneous uploads', 'I uploaded synthetic files as Hina and Sara at the same time. Each received its own document/version identity, reached Ready, matched its original bytes and had a separate nonduplicated chunk set.'],
    ['Concurrent questions, last slot and replay', 'I submitted questions together. With capacity available, both succeeded. With one remaining slot, one succeeded and the other received a quota refusal; only one answer was charged. Simultaneous duplicate submissions saved/charged once, and replay returned the same message.'],
    ['Deletion/revocation during generation', 'I used controlled provider pauses with real PostgreSQL locks. Removing access before the final gate blocked the answer. If completion won first, it was authorized at that point and later history hid it after revocation. The live deletion scenario was performed after saving answers; arbitrary live-vendor timing remains unverified.'],
    ['Restricted file and cross-team access', 'I tried the correct private file as Ali: search/original access was denied. After granting Ali read access, he received REPORT-742 with a citation. After revoking it, old answer/source/download/feedback/replay became unavailable. Ahmed was denied HR access.'],
    ['Update, old citations and deletion', 'I processed a new revision: new answers used DRILL-926 while the old citation still showed historical DRILL-815. Deleting the document hid dependent answers. Failed replacement and out-of-order activation were checked separately with controlled providers and real SQL.'],
    ['Document tries to trick the assistant', 'I supplied a synthetic document instructing the model to expose hidden files. It returned the supported SAFE-415 fact, did not return the injected marker and was not supplied hidden Salary Plan evidence. This was a limited example; broad injection immunity is not claimed.'],
    ['Roles, ratings, audit and missing facts', 'I demoted Sara and her existing login immediately lost upload permission, then restored her role. Feedback persisted in PostgreSQL; the grant audit identified Hina and the document. Unsupported JSON was rejected. Unanswerable/private questions produced a safe refusal without a successful-answer charge.'],
], [133, width-133])
p('<b>Cleanup.</b> Learner original/readers preserved; roles and original 1,000-answer limit restored; 3 synthetic documents tombstoned and their worker purge jobs succeeded; 7 private test chats purged. Final observed HR usage: 16 used / 1,000, 0 held. Successful answers, including an earlier observer-failed attempt, remain charged.', 'SmallLocal')
p('<b>Proof locations.</b> docs/test-run.json lists the recorded cases and source hashes; docs/live-final-run.json records live actions/results and cleanup; live-challenges-run.json records concurrency accounting. Earlier Chrome automation used real UI/API/SQL with synthetic Auth/AI/Storage. Full real-provider browser coverage remains separate.', 'SmallLocal')

# Page 5: learner evidence, failures, limits and delivery.
newpage()
p('5. Learner observations, limits and submission', 'Heading1')
p('<b>Learner evidence.</b> The learner reports manual testing through T07. Supplied screenshots were preserved with SHA-256 hashes; exact capture times were not supplied. The observations below describe what those images establish. Agent-executed actions are recorded separately.')
table([
    ['Observation', 'Honest interpretation'],
    ['Login / roles', 'Hina HR Admin, Ali HR Viewer and Ahmed Engineering Admin UI states are visible. Sara expected-valid browser login failed; later agent password-reset/login verified HR editor / Engineering viewer. Learner Sara browser retry is not demonstrated.'],
    ['T03 upload', 'Hina uploaded Practice Policy.txt: Restricted / Ready is visible. Queued -> Ready and no success toast were learner-reported. This is an admin upload, not the planned Sara-editor screenshot. Agent concurrent upload separately verified the editor path.'],
    ['T05 / T06 access attempts', 'The search/question used Report Practice Policy 01 while the file was Practice Policy.txt. That negative result alone is confounded. Initial grant input 03 correctly failed UUID validation. Later acknowledgement had Hina selected and a clipped ID; it did not prove Ali access. The final agent run tested the correct document and recipient.'],
], [114, width-114])
p('<b>Failures and corrections retained.</b> Earlier local database/Redis stoppages caused missing-team/service/worker errors; startup was recovered without data reset. Earlier live Groq output omitted citations, causing a wrong HTTP error; the adapter now uses a fixed safe insufficient response and regression checks passed. The final runner initially assumed isCurrent and insufficient response names, then lacked its read-only SQL observer role. These runner failures were corrected without weakening application rules; their JSON records remain. One observer-failed saved answer stayed charged.')
p('6. What should change before real use', 'Heading1')
p('<b>Service reliability and security:</b> add proper readiness/monitoring, managed secrets, TLS/ingress, distributed rate limits and a deliberate account-disable/session policy. Perform isolated Redis outage/lost-queue, hosted Storage late-write/orphan, crash/restart and backup/restore drills. No such production fault or restore pass is claimed here.')
p('<b>Model and file safety:</b> expand groundedness and malicious-source evaluations to a corpus, measure free-tier timeout/429 behavior and large-corpus performance, add malware scanning/OS parser isolation and OCR only if required. Current support is text PDF/TXT up to 20 MiB with bounded parsing/retries and one active embedding profile; no universal factuality/injection guarantee.')
p('<b>User experience and remaining verification:</b> distinguish failed membership loading from no membership; improve UUID/recipient guidance; clear stale notices across account changes; add a completion notification and persisted feedback display. The learner observed a stale access-change banner in Ali chat. Full automated real-provider browser coverage, actual timed UTC rollover, scale tests, automatic age retention and independent security review remain unverified or unsupported.')
p('<b>Delivered locally.</b> Source code, this report, a simplified core ER diagram plus the detailed ERD/architecture, setup README and sanitized evidence. Credentials, raw originals, database/runtime data and dependencies are excluded from the source package. README separates native PostgreSQL/Redis startup from the three application terminals. The learner will upload code to GitHub; no push/deployment/publication was performed.', 'SmallLocal')

def footer(canvas, doc):
    w, h = canvas._pagesize
    canvas.saveState()
    canvas.setStrokeColor(rule)
    canvas.line(52, 37, w-52, 37)
    canvas.setFont('Helvetica', 7.8)
    canvas.setFillColor(green)
    canvas.drawString(52, 23, 'TECHCO / AI-ASSISTED LEARNING MVP / DATED EVIDENCE')
    canvas.drawRightString(w-52, 23, str(doc.page))
    canvas.restoreState()

destination = out / 'secure-multi-team-ai-assistant-report.pdf'
doc = BaseDocTemplate(str(destination), pagesize=A4, title='Secure Multi-Team AI Assistant - Database Design and Test Report', author='AI-assisted project workspace')
templates = []
for name, size in [('Portrait', A4), ('Landscape', landscape(A4))]:
    w, h = size
    templates.append(PageTemplate(id=name, pagesize=size, frames=[Frame(52, 49, w-104, h-92, leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)], onPage=footer))
doc.addPageTemplates(templates)
doc.build(story)
print('Created ' + str(destination.relative_to(root)) + '; render every page before release.')
