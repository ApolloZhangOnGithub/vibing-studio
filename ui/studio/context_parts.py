"""Count readable Codex context since the most recent replacement snapshot."""
import base64
import collections
import json
import mmap
import re
import struct
import sys

counts = collections.Counter()
images = encrypted = 0
cjk = re.compile(r"[\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]")

def add(key, value):
    if not value:
        return
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    wide = len(cjk.findall(text))
    counts[key] += wide * .9 + (len(text) - wide) / 3.6

def item(p):
    global images, encrypted
    kind = p.get("type", "")
    if kind == "message":
        group = {"user": "userText", "assistant": "assistantText"}.get(p.get("role"), "system")
        for block in p.get("content", []):
            if block.get("type") == "input_image":
                images += 1
                # Estimate visual tokens from the PNG dimensions, never from base64 length.
                url = block.get("image_url", "")
                if isinstance(url, str) and url.startswith("data:image/png;base64,"):
                    try:
                        header = base64.b64decode(url[22:54], validate=True)
                        if header[:8] == b"\x89PNG\r\n\x1a\n" and header[12:16] == b"IHDR":
                            width, height = struct.unpack(">II", header[16:24])
                            counts["imageInput"] += min(1536, ((width + 31) // 32) * ((height + 31) // 32))
                    except (ValueError, struct.error):
                        pass
            else:
                add(group, block.get("text"))
    elif kind.endswith("_call_output") or kind == "tool_search_output":
        add("toolOutput", p.get("output"))
    elif kind.endswith("_call"):
        add("toolInput", p.get("arguments") or p.get("input") or p.get("action"))
    elif kind == "additional_tools":
        add("sysTools", p.get("tools"))
    elif p.get("encrypted_content"):
        encrypted += 1

with open(sys.argv[1], "rb") as f, mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as data:
    marker = data.rfind(b',"type":"compacted","payload":')
    if marker >= 0:
        data.seek(data.rfind(b"\n", 0, marker) + 1)
    for line in iter(data.readline, b""):
        try:
            record = json.loads(line)
        except ValueError:
            continue
        p = record.get("payload", {})
        if record.get("type") == "compacted":
            counts.clear()
            images = encrypted = 0
            for entry in p.get("replacement_history", []):
                item(entry)
        elif record.get("type") == "response_item":
            item(p)
        elif record.get("type") == "session_meta":
            add("system", p.get("base_instructions"))
print(json.dumps(dict(counts=dict(counts), images=images, encrypted=encrypted)))
