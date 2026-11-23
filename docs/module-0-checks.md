# Module 0 verification evidence

## Inspection commands and outcomes

- `Get-Location` and `Get-ChildItem -Force`: confirmed the actual local Windows project root and initially empty folder.
- `git status --short`: failed with “not a git repository”; no Git worktree/remote exists here and none was initialized.
- `rg --files -g 'AGENTS.md'` plus explicit ancestor-path inspection: no prior project or ancestor instructions found.
- `node --version`: v24.12.0; `npm --version`: 11.6.2; `python --version`: Python 3.12.4.
- `docker --version`: client 29.7.2, with an access-denied warning reading the user's Docker configuration. This did not establish daemon/Compose functionality.
- `psql --version`: command unavailable on PATH. Standalone `mmdc` also absent.
- Tool discovery located existing bundled Playwright and Mermaid; no package installation or application scaffold was performed.

## Mermaid parsing and rendering

Exact executed PowerShell command:

```powershell
python .\tools\render_diagrams.py --bundle-dir 'C:\Users\DELL\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\@oai\artifact-tool\dist\chunks' --browser 'C:\Program Files\Google\Chrome\Application\chrome.exe'
```

Actual final outcome: exit 0. Mermaid parsed `schema.mmd` as ER and `architecture.mmd` as flowchart. Both SVGs and PNG previews were generated locally using existing tooling, with no CDN/network. The bundled Mermaid renderer identifies version 11.16.1. Both final PNGs were visually inspected: no clipped table/node content was observed. The full ER diagram is dense and should be read/zoomed as SVG alongside the relationship ledger.

The first consistency run correctly failed on the architecture export: an HTML `<br>` inside a Mermaid label was not valid standalone XML. The renderer was corrected to disable HTML labels globally and serialize the SVG as XML. Both diagrams were regenerated, visually re-inspected, and the consistency check was rerun successfully. No failure was counted as a passing check.

| Artifact | Actual size |
| --- | --- |
| `diagrams/schema.svg` | 466,953 bytes |
| `diagrams/schema.png` | 321,013 bytes |
| `diagrams/architecture.svg` | 72,000 bytes |
| `diagrams/architecture.png` | 249,521 bytes |

These runtime/browser paths are specific to this laptop. On another machine pass that machine's installed bundle/browser paths to the same helper; an unavailable renderer is an environment issue, not a requirement to install application dependencies.

## Reproducible consistency check

Run from the project root. This verifies artifact presence, matching table catalog/ER entities, relationship endpoints, unique decision/requirement/scenario IDs, local Markdown links, well-formed SVG/readable PNG, placeholder environment keys, and the design-only boundary. It does not prove semantic correctness, actual SQL behavior, effective Git ignore behavior, or a comprehensive secret audit.

```powershell
@'
from pathlib import Path
import json
import re
import xml.etree.ElementTree as ET
from PIL import Image

root = Path.cwd()
required = [
    "AGENTS.md", "README.md", ".env.example", ".gitignore",
    "docs/requirements.md", "docs/design-decisions.md",
    "docs/database-design.md", "docs/verification-plan.md",
    "docs/module-progress.md", "docs/module-0-checks.md",
    "diagrams/schema.mmd", "diagrams/schema.svg", "diagrams/schema.png",
    "diagrams/architecture.mmd", "diagrams/architecture.svg",
    "diagrams/architecture.png", "tools/render_diagrams.py",
]
assert all((root / name).is_file() for name in required), "Required artifact missing"
expected = set("""organizations users teams memberships documents document_grants
embedding_profiles storage_intents document_versions document_chunks processing_jobs
outbox_events conversations messages message_sources feedback usage_budgets
usage_periods usage_reservations usage_attempts audit_logs""".split())
catalog = re.findall(r"^### ([a-z_]+)$", (root / "docs/database-design.md").read_text(encoding="utf-8"), re.M)
schema = (root / "diagrams/schema.mmd").read_text(encoding="utf-8")
entities = re.findall(r"^    ([a-z_]+) \{", schema, re.M)
assert len(catalog) == len(set(catalog)) == len(expected) == 21
assert set(catalog) == set(entities) == expected, "Catalog/ER entity disagreement"
edges = re.findall(r"^    ([a-z_]+) [|o{}]+--[|o{}]+ ([a-z_]+) :", schema, re.M)
assert edges and all(a in expected and b in expected for a, b in edges)
decisions = re.findall(r"^## (D\d{2}) ", (root / "docs/design-decisions.md").read_text(encoding="utf-8"), re.M)
assert decisions == [f"D{i:02}" for i in range(1, 23)]
requirements = re.findall(r"^\| ([A-Z]\d{2}) \|", (root / "docs/requirements.md").read_text(encoding="utf-8"), re.M)
assert len(requirements) == len(set(requirements))
scenarios = re.findall(r"^\| `([a-z][a-z0-9_.]+)` \|", (root / "docs/verification-plan.md").read_text(encoding="utf-8"), re.M)
assert len(scenarios) == len(set(scenarios)) and len(scenarios) >= 25
local_links = 0
for document in root.rglob("*.md"):
    for href in re.findall(r"\[[^\]]+\]\(([^)]+)\)", document.read_text(encoding="utf-8")):
        if "://" in href or href.startswith(("#", "mailto:")):
            continue
        target = href.split("#", 1)[0].strip("<>")
        if target:
            assert (document.parent / target).is_file(), f"Broken link: {document.name} -> {target}"
            local_links += 1
sizes = {}
for name in ("schema", "architecture"):
    svg = root / f"diagrams/{name}.svg"
    assert ET.parse(svg).getroot().tag.endswith("svg")
    with Image.open(root / f"diagrams/{name}.png") as preview:
        preview.verify()
    with Image.open(root / f"diagrams/{name}.png") as preview:
        sizes[name] = list(preview.size)
assert sorted(p.name for p in root.glob(".env*")) == [".env.example"]
env_text = (root / ".env.example").read_text(encoding="utf-8")
for line in env_text.splitlines():
    if line and not line.startswith("#") and "=" in line:
        key, value = line.split("=", 1)
        if key.endswith("_KEY"):
            assert value.startswith("YOUR_"), f"Non-placeholder credential: {key}"
assert not any(root.rglob("*.sql")), "Unexpected migration in design-only module"
assert not any((root / name).exists() for name in ("apps", "src", "migrations", "package.json"))
print(json.dumps({"result": "PASS", "required_artifacts": len(required),
                  "tables": len(expected), "er_relationships": len(edges),
                  "decisions": len(decisions), "requirement_ids": len(requirements),
                  "planned_scenarios": len(scenarios), "valid_local_links": local_links,
                  "png_dimensions": sizes, "application_tests_run": 0}, indent=2))
'@ | python -
```

Final consistency-check output: exit 0.

```json
{
  "result": "PASS",
  "required_artifacts": 17,
  "tables": 21,
  "er_relationships": 37,
  "decisions": 22,
  "requirement_ids": 66,
  "planned_scenarios": 33,
  "valid_local_links": 7,
  "png_dimensions": {
    "schema": [3000, 1820],
    "architecture": [2345, 2236]
  },
  "application_tests_run": 0
}
```

The 37 ER edges are a readable subset of the full foreign-key ledger, not a claim that only 37 FKs will exist. The 33 hard-case scenarios are planned contracts, not implemented tests. No application/Jest/PostgreSQL tests have run.

## Manual design review

Reviewed the blueprint for: roles on memberships; restricted admin read denial; same-team composite references; last-admin serialization; durable upload/queue recovery; immutable monotone version activation; deletion invalidation before chunk purge; all-source history checks; non-streamed final authorization ordering/network window; quota counter/fence/month rules; private Storage policy testing; non-content audit projections; and explicit proposal/adoption status.

This is engineering review of a proposed design. Real-service behavior, actual PostgreSQL policies/locks, parser reliability, model grounding, and failure recovery remain unverified until their authorized implementation modules.
