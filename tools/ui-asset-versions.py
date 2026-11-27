"""Fingerprint script and stylesheet URLs referenced by Studio's entry pages."""
import hashlib
import json
from html.parser import HTMLParser
from pathlib import Path

root = Path(__file__).resolve().parents[1]
ui = root / "ui"
versions = {}


class Assets(HTMLParser):
    def handle_starttag(self, tag, attrs):
        key = {"script": "src", "link": "href"}.get(tag)
        name = dict(attrs).get(key, "")
        if name.endswith((".js", ".css")) and "://" not in name and not name.startswith("/"):
            path = ui / name
            if path.is_file() and name not in versions:
                versions[name] = hashlib.sha256(path.read_bytes()).hexdigest()[:20]


for page in ui.glob("*.html"):
    Assets().feed(page.read_text())
out = root / "web/src/ui-asset-versions.js"
content = "export default " + json.dumps(versions, indent=2, sort_keys=True) + ";\n"
if not out.exists() or out.read_text() != content:
    out.write_text(content)
