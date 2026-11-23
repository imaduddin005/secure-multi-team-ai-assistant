"""Build the editable submission report from recorded project evidence.

Use a bundled Python runtime with python-docx. Render with an actual Word
processor and inspect every page before delivery. No live tests are rerun here.
"""
from pathlib import Path
import json
from datetime import datetime, timezone
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / 'output/docx/secure-multi-team-ai-assistant-report.docx'
live = json.loads((ROOT/'docs/live-final-run.json').read_text(encoding='utf-8'))
if not live.get('success'):
    raise RuntimeError('Successful dated live evidence is required; do not invent outcomes')
diagram = ROOT/'diagrams/simple-er-diagram.png'
if not diagram.is_file():
    raise RuntimeError('The simplified ER diagram must be generated first')

doc = Document()
section = doc.sections[0]
section.page_width = Inches(8.5)
section.page_height = Inches(11)
section.top_margin = Inches(.70)
section.bottom_margin = Inches(.65)
section.left_margin = section.right_margin = Inches(.8)
section.header_distance = section.footer_distance = Inches(.30)
styles = doc.styles
for name in ['Normal', 'Title', 'Subtitle', 'Heading 1', 'Heading 2', 'Heading 3', 'Caption', 'Header', 'Footer']:
    styles[name].font.name = 'Calibri'
    styles[name].font.color.rgb = RGBColor(0,0,0)
    styles[name].font.underline = False
    for border in list(styles[name].element.xpath('./w:pPr/w:pBdr')):
        border.getparent().remove(border)
styles['Normal'].font.size = Pt(11)
styles['Normal'].paragraph_format.space_after = Pt(7)
styles['Normal'].paragraph_format.line_spacing = 1.08
styles['Title'].font.size = Pt(25)
styles['Title'].font.bold = True
styles['Title'].paragraph_format.space_after = Pt(7)
styles['Heading 1'].font.size = Pt(16)
styles['Heading 1'].font.bold = True
styles['Heading 1'].paragraph_format.space_before = Pt(12)
styles['Heading 1'].paragraph_format.space_after = Pt(7)
styles['Heading 2'].font.size = Pt(11.5)
styles['Heading 2'].font.bold = True
styles['Heading 2'].paragraph_format.space_before = Pt(8)
styles['Heading 2'].paragraph_format.space_after = Pt(3)
styles['Caption'].font.size = Pt(9.5)
styles['Caption'].font.italic = False
styles['Caption'].paragraph_format.space_after = Pt(6)

header = section.header.paragraphs[0]
header.text = 'TECHCO   |   PROJECT REPORT'
header.style = 'Header'
header.runs[0].font.size = Pt(8)
footer = section.footer.paragraphs[0]
footer.alignment = WD_ALIGN_PARAGRAPH.RIGHT
run = footer.add_run('Page ')
run.font.size = Pt(9)
field = OxmlElement('w:fldSimple')
field.set(qn('w:instr'), 'PAGE')
footer._p.append(field)

def p(text):
    return doc.add_paragraph(text)

def h(text, level=1):
    return doc.add_heading(text, level=level)

def page():
    doc.add_page_break()

def table(rows, widths):
    t = doc.add_table(rows=1, cols=len(widths))
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.autofit = False
    for cell, width in zip(t.rows[0].cells, widths):
        cell.width = Inches(width)
    for i, row in enumerate(rows):
        cells = t.rows[0].cells if i == 0 else t.add_row().cells
        trpr = cells[0]._tc.getparent().get_or_add_trPr()
        trpr.append(OxmlElement('w:cantSplit'))
        if i == 0:
            trpr.append(OxmlElement('w:tblHeader'))
        for j, (cell, text) in enumerate(zip(cells,row)):
            cell.width = Inches(widths[j])
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            cell.text = text
            props = cell._tc.get_or_add_tcPr()
            borders = OxmlElement('w:tcBorders')
            for edge in ['top','left','bottom','right']:
                el = OxmlElement('w:'+edge)
                for key,value in [('val','single'),('sz','4'),('color','D9D9D9')]:
                    el.set(qn('w:'+key),value)
                borders.append(el)
            props.append(borders)
            margins = OxmlElement('w:tcMar')
            for edge,value in [('top','85'),('bottom','85'),('left','100'),('right','100')]:
                el=OxmlElement('w:'+edge);el.set(qn('w:w'),value);el.set(qn('w:type'),'dxa');margins.append(el)
            props.append(margins)
            if i == 0:
                fill=OxmlElement('w:shd');fill.set(qn('w:fill'),'DDEBF7');props.append(fill)
            for para in cell.paragraphs:
                para.paragraph_format.space_after = Pt(2)
                para.paragraph_format.line_spacing = 1.05
                for run in para.runs:
                    run.font.size=Pt(10.5)
                    run.font.bold=i==0
    doc.add_paragraph().paragraph_format.space_after=Pt(0)
    return t

# Page 1
doc.add_paragraph('Secure Multi Team AI Assistant',style='Title')
date_p=p('Project design and testing report   |   23 November 2026')
date_p.runs[0].font.size=Pt(10)
h('Project Overview')
p('The application gives teams inside TechCo their own document-based AI assistant. Each team uploads its files, and members ask questions that are answered from documents they are currently allowed to read. Answers include inspectable citations. The backend controls login, roles, background processing, feedback, audit records and monthly usage. The frontend provides Chat, Documents and Admin pages.')
h('Database Choice and Design')
p('PostgreSQL with pgvector is the canonical application database. PostgreSQL stores related records and enforces foreign keys, transactions and row-level security. pgvector stores document embeddings so relevant text can be searched within the same authorization boundary. This avoids maintaining a separate search database with potentially inconsistent permissions.')
p('Supabase is a hosted backend platform. This implementation uses Supabase Auth for accounts and signed login tokens, and private Supabase Storage for original files. The application tables are in a separate local PostgreSQL instance. Next.js supplies the frontend, NestJS the backend, and BullMQ with Redis delivers background work recorded durably in PostgreSQL.')
p('Users and teams are connected through memberships because one person can have a different role in each team. Documents, versions, selected-reader grants and answer sources are separate records so updates and access changes can be checked without losing history. Team-scoped foreign keys include the team ID, preventing cross-team references.')
table([
    ['Person','HR role','Engineering role'],
    ['Ali','Viewer','No membership'],
    ['Sara','Editor','Viewer'],
    ['Hina','Admin','No membership'],
    ['Ahmed','No membership','Admin'],
],[1.2,2.85,2.85])

# Page 2
page()
h('Database Diagram')
p('The simplified ER diagram shows the main relationships. Each arrow points from one parent record to its many related child records. The complete table catalog and detailed diagram are supplied separately in docs/database-design.md and diagrams/schema.svg.')
figure=doc.add_paragraph()
figure.alignment=WD_ALIGN_PARAGRAPH.CENTER
figure.add_run().add_picture(str(diagram),width=Inches(5.75))
for shape in doc.inline_shapes:
    shape._inline.docPr.set('descr','Simplified TechCo ER diagram linking organization, teams, users, memberships, documents, selected-reader grants, versions and searchable chunks.')
doc.add_paragraph('Figure 1  Main database relationships',style='Caption')
p('TechCo contains HR and Engineering teams. Sara has a separate membership in each team, with HR editor rights and Engineering viewer rights. Teams own documents. Restricted documents grant read access to selected memberships. Each document can have multiple versions, and each version contains searchable text chunks.')
p('In the physical schema, Read permissions means document_grants, File versions means document_versions, and Text chunks means document_chunks. Chat, source provenance, feedback, audit, usage and worker tables are omitted from this simplified picture for clarity; they remain part of the implemented database.')

# Page 3
page()
h('Rules and Reasons')
rules=[
('Roles and restricted access','Permissions belong to the current team membership. Viewers ask questions; editors also upload and change readable files; administrators manage members, sharing and budgets. New files are restricted to the uploader. Admin has no automatic read of another member\'s restricted file or private chat; an explicit audited self-grant is allowed. This avoids silent content access.'),
('Document updates','An update creates an immutable version. The old ready version continues working until a newer version finishes processing successfully. Failed or older delayed jobs cannot replace a newer successful version. Old citations stay linked to their original revision so the supporting evidence remains clear.'),
('Document deletion','Deletion immediately blocks access and clears the current version pointer. Dependent assistant answers and citations become unavailable. A background job later purges the original file and text chunks, so remote cleanup delays do not extend user access.'),
('Transfer to another team','There is no direct move operation. A permitted reader with upload rights in the destination team creates a new upload with fresh permissions. Deleting the old file is a separate authorized action. This prevents copying access rules accidentally between teams.'),
('Membership and role changes','Leaving a team ends that membership and revokes its grants. Rejoining creates a new membership identity, so old grants and private chats do not revive. Role changes are checked immediately against the database. Transactions prevent removing the final administrator.'),
('Old answers after access loss','All text supplied to the model is recorded as potential evidence, including uncited text. If any source becomes unreadable, the whole old assistant answer, citations, feedback target and replay become unavailable. Hiding only a quotation could leave a private paraphrase visible. Previously downloaded bytes cannot be recalled.'),
('Usage limits and durable jobs','Quota is reserved atomically before generation and charged with a successful saved grounded answer in its UTC month. Failed, insufficient or blocked attempts release their holds. Request identity and attempt fences prevent duplicate charging and stale completion. PostgreSQL retains durable jobs; Redis delivers them. Leases reject stale processing results.'),
]
for title,text in rules:
    h(title,2);p(text)

# Page 4
page()
h('Hard Cases Tested and Results')
p('Testing used actual PostgreSQL transactions and locks. Controlled Auth, AI and Storage fixtures made failure timing reproducible. Separate live scenarios used the normal API and worker with real Supabase Auth and Storage, Redis, Gemini embeddings and Groq answers.')
table([
['Action performed','Observed result'],
['Upload together as Hina and Sara','Both files obtained distinct document and version identities, reached Ready, matched their original bytes and had separate nonduplicated text chunks.'],
['Submit questions concurrently and repeat a request','With capacity available, both questions succeeded. With one slot left, one succeeded and the other received a quota refusal; only one answer was charged. Duplicate submissions saved and charged once; replay returned the same message.'],
['Delete or revoke during generation','Controlled pauses with real database locks showed that access loss before the final gate blocked the answer. If completion occurred first, it was authorized then; later history hid it after revocation. Arbitrary real-provider timing was not separately established.'],
['Probe private files and another team','Ali was denied the private practice file before a grant. A correct grant enabled REPORT-742 with a citation. Revocation blocked the old answer, source, original, feedback and replay. Ahmed was denied HR access.'],
['Update and delete a document','New answers used the new DRILL-926 revision; old citations retained historical DRILL-815. Deletion hid dependent answers. Failed replacement and out-of-order activation were tested separately with controlled providers and real SQL.'],
['Upload instructions that try to trick the model','An authorized synthetic source requested hidden files and an injected marker. The answer used the supported SAFE-415 fact, did not return the marker and received no hidden Salary Plan source. This limited example does not establish general injection immunity.'],
['Change role and check ratings and audit','Sara immediately lost upload rights after demotion, then her role was restored. Feedback persisted; the grant audit matched Hina and the document. Unsupported JSON was rejected. Missing/private facts produced a safe refusal without a successful-answer charge.'],
],[1.65,5.25])
p('Temporary permissions, roles and the original team limit were restored. The practice original was preserved, temporary test documents were deleted through the normal cleanup path, and test chats were purged. Successful saved answers remain charged. Detailed dated results are retained in the project evidence files.')

# Page 5
page()
h('Changes Before Real Use')
h('Reliability and operational security',2)
p('Add database and worker readiness checks, service monitoring, managed secrets, TLS and distributed rate limits. Define a deliberate account-disable and session policy. Run isolated Redis interruption, lost-queue, hosted Storage late-write, crash recovery and backup/restore drills before claiming production reliability.')
h('File and model safety',2)
p('Expand grounding and malicious-source evaluation to a broader corpus, including multilingual prompts and free-provider timeout or rate-limit behavior. Add malware scanning and stronger operating-system isolation for document parsing. OCR is not implemented. Current support is text PDF and UTF-8 TXT up to 20 MiB, bounded parsing/retries and one active embedding profile.')
h('Scale and accounting verification',2)
p('Measure larger document collections, sustained concurrent requests, vector-search performance and memory use. Test a real UTC month transition and service restarts around outstanding reservations. Existing deterministic ledger tests do not replace these operational measurements. Provider billing remains separate from the application answer quota.')
h('User experience and maintenance',2)
p('Distinguish a failed membership lookup from a genuine lack of membership. Improve document-ID and recipient guidance, clear stale notices across account changes, and add a processing-completion notification and persistent feedback display. Complete automated real-provider browser coverage, define retention and reindex procedures, and obtain an independent security review.')
p('The demonstrated system is a local MVP. Full outage recovery, backup restore, production load, broad model safety and a complete real-provider browser matrix remain unverified. These limits should be resolved or accepted explicitly before real organizational use.')

doc.core_properties.title='Secure Multi Team AI Assistant Project Report'
doc.core_properties.subject='Project overview database design rules testing and production improvements'
doc.core_properties.author=''
doc.core_properties.last_modified_by=''
doc.core_properties.created=doc.core_properties.modified=datetime(2026,11,23,tzinfo=timezone.utc)
DEST.parent.mkdir(parents=True,exist_ok=True)
doc.save(DEST)
print('Created '+str(DEST.relative_to(ROOT)))
