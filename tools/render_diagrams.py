"""Render local Mermaid design documents using an existing bundled renderer.

Documentation tooling only; this does not install or run the application.
Requires Python Playwright, a local Chromium browser, and the bundled
@oai/artifact-tool/dist/chunks directory. No external network is used.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from urllib.parse import unquote, urlparse

from playwright.sync_api import sync_playwright


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle-dir", type=Path, required=True)
    parser.add_argument("--browser", type=Path, required=True)
    parser.add_argument("--diagram-dir", type=Path, default=Path("diagrams"))
    args = parser.parse_args()
    bundle_dir = args.bundle_dir.resolve(strict=True)
    diagram_dir = args.diagram_dir.resolve(strict=True)
    entries = sorted(bundle_dir.glob("mermaid.core-*.mjs"))
    if len(entries) != 1:
        raise RuntimeError("Expected exactly one bundled Mermaid entry module")
    browser_path = args.browser.resolve(strict=True)
    # The distribution's Node-only require shim is unused by Mermaid in a browser.
    # Remove that wrapper in memory while serving the original browser modules.
    node_shim = re.compile(
        r'^import \{ createRequire as __createRequire \} from "node:module"; '
        r"const require = __createRequire\(import\.meta\.url\);\s*"
    )

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=str(browser_path), headless=True
        )
        context = browser.new_context(viewport={"width": 1600, "height": 1000})

        def serve_local(route: object) -> None:
            request_path = unquote(urlparse(route.request.url).path)
            if request_path == "/":
                route.fulfill(
                    content_type="text/html",
                    body=(
                        "<!doctype html><html><body "
                        "style='font-family:Arial,sans-serif'></body></html>"
                    ),
                )
                return
            if not request_path.startswith("/bundle/"):
                route.abort()
                return
            module_path = (bundle_dir / request_path.removeprefix("/bundle/")).resolve()
            if not module_path.is_relative_to(bundle_dir) or module_path.suffix != ".mjs":
                route.abort()
                return
            if not module_path.is_file():
                route.abort()
                return
            source = node_shim.sub("", module_path.read_text(encoding="utf-8"))
            route.fulfill(content_type="text/javascript", body=source)

        # Fulfilled locally by Playwright; no web server, CDN, or Internet request.
        context.route("http://diagram.local/**", serve_local)
        context.route(
            re.compile(r"^(?!http://diagram\.local/).+"), lambda route: route.abort()
        )
        page = context.new_page()
        page.goto("http://diagram.local/")
        page.evaluate(
            """async entry => {
                const module = await import('/bundle/' + entry);
                window.localMermaid = module.default;
            }""",
            entries[0].name,
        )
        results = []
        for diagram_name in ("schema", "architecture"):
            source = (diagram_dir / f"{diagram_name}.mmd").read_text(encoding="utf-8")
            rendered = page.evaluate(
                """async ({name, source}) => {
                    window.localMermaid.initialize({
                        startOnLoad: false, securityLevel: 'strict', htmlLabels: false,
                        fontFamily: 'Segoe UI, Arial, sans-serif',
                        maxTextSize: 100000, suppressErrorRendering: true,
                        er: {useMaxWidth: false},
                        flowchart: {htmlLabels: false, useMaxWidth: false}
                    });
                    await window.localMermaid.parse(source);
                    const result = await window.localMermaid.render(name + 'Diagram', source);
                    // Serialize as XML so any HTML void tags in foreignObject
                    // are valid in a standalone SVG, not only an HTML preview.
                    const parsed = new DOMParser().parseFromString(result.svg, 'text/html');
                    const svg = new XMLSerializer().serializeToString(parsed.querySelector('svg'));
                    return {svg, type: result.diagramType};
                }""",
                {"name": diagram_name, "source": source},
            )
            svg_path = diagram_dir / f"{diagram_name}.svg"
            svg_path.write_text(rendered["svg"], encoding="utf-8")
            page.evaluate(
                """svg => {
                    document.body.innerHTML = svg;
                    document.body.style.margin = '16px';
                    document.body.style.background = '#ffffff';
                    const image = document.querySelector('svg');
                    const box = image.viewBox.baseVal;
                    const width = Math.min(3000, box.width);
                    image.style.maxWidth = 'none';
                    image.style.width = width + 'px';
                    image.style.height = (box.height * width / box.width) + 'px';
                }""",
                rendered["svg"],
            )
            png_path = diagram_dir / f"{diagram_name}.png"
            page.locator("svg").screenshot(path=str(png_path))
            results.append(
                {
                    "diagram": diagram_name,
                    "parsed_type": rendered["type"],
                    "svg_bytes": svg_path.stat().st_size,
                    "png_bytes": png_path.stat().st_size,
                    "preview_bounds": page.locator("svg").bounding_box(),
                }
            )
        browser.close()
    print(json.dumps({"network": "local route only", "rendered": results}, indent=2))


if __name__ == "__main__":
    main()
