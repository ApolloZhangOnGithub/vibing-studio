"""Read Antigravity session metadata and transcripts from the local filesystem."""
import argparse
from contextlib import closing
from collections import deque
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
from urllib.parse import unquote, urlsplit
from uuid import UUID


def transcripts():
    files = {}
    for folder in ("antigravity-cli", "antigravity"):
        root = Path.home() / ".gemini" / folder
        for path in (root / "brain").glob("*/.system_generated/logs/transcript.jsonl"):
            sid = path.parents[2].name
            if sid not in files or path.stat().st_mtime > files[sid].stat().st_mtime:
                files[sid] = path
    return files


def workspace_dirs(root):
    db = root / "conversation_summaries.db"
    result = {}
    try:
        with closing(sqlite3.connect(db.as_uri() + "?mode=ro", uri=True)) as conn:
            for sid, raw in conn.execute("SELECT conversation_id, workspace_uris FROM conversation_summaries"):
                try:
                    uris = json.loads(raw or "[]")
                    if isinstance(uris, list):
                        paths = [urlsplit(uri) for uri in uris if isinstance(uri, str)]
                        result[sid] = list(dict.fromkeys(unquote(p.path) for p in paths
                            if p.scheme == "file" and p.netloc in ("", "localhost") and p.path.startswith("/")))
                except ValueError:
                    continue
    except sqlite3.Error:
        pass
    return result


def rows(path):
    with path.open(encoding="utf-8") as stream:
        for line in stream:
            if line.strip():
                try:
                    yield json.loads(line)
                except json.JSONDecodeError:
                    if line.endswith("\n"):
                        raise


def user_text(text):
    match = re.search(r"<USER_REQUEST>\n?(.*?)\n?</USER_REQUEST>", text, re.S)
    return match.group(1) if match else text


def title(path, sid):
    annotation = path.parents[4] / "annotations" / (sid + ".pbtxt")
    if annotation.is_file():
        match = re.search(r'^title:\s*("(?:\\.|[^"\\])*")', annotation.read_text(), re.M)
        if match:
            return json.loads(match.group(1))
    for row in rows(path):
        if row.get("type") == "USER_INPUT":
            return user_text(row.get("content", "")).strip()[:80] or sid
    return sid


def history_rows(path):
    full_path = path.with_name("transcript_full.jsonl")
    if not full_path.is_file():
        yield from rows(path)
        return

    # Both logs are ordered by step_index and can be appended independently.
    full_rows = rows(full_path)
    full = next(full_rows, None)
    for summary in rows(path):
        index = summary["step_index"]
        while full is not None and full["step_index"] < index:
            yield full
            full = next(full_rows, None)
        if full is not None and full["step_index"] == index:
            yield full
            full = next(full_rows, None)
        else:
            yield summary
    if full is not None:
        yield full
        yield from full_rows


def wire_fields(data):
    """Read the scalar and length-delimited fields in agy's protobuf step metadata."""
    offset = 0

    def varint():
        nonlocal offset
        value = 0
        for shift in range(0, 70, 7):
            byte = data[offset]
            offset += 1
            value |= (byte & 127) << shift
            if byte < 128:
                return value
        raise ValueError("invalid varint")

    while offset < len(data):
        tag = varint()
        wire = tag & 7
        if wire == 0:
            yield tag >> 3, varint()
        elif wire == 2:
            length = varint()
            end = offset + length
            if end > len(data):
                raise ValueError("incomplete field")
            yield tag >> 3, data[offset:end]
            offset = end
        elif wire in (1, 5):
            offset += 8 if wire == 1 else 4
        else:
            raise ValueError("unknown field encoding")


def step_times(path):
    database = path.parents[4] / "conversations" / (path.parents[2].name + ".db")
    times = {}
    durations = {}
    try:
        with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True, timeout=0.2)) as db:
            for idx, kind, blob, payload in db.execute("SELECT idx, step_type, metadata, step_payload FROM steps WHERE step_type IN (14,15) AND status=3"):
                # Field 1 is creation. Field 8 on a completed planner response is its end.
                wanted = 1 if kind == 14 else 8
                try:
                    if kind == 15:
                        planner = next((v for k, v in wire_fields(payload or b"") if k == 20), b"")
                        duration = next((v for k, v in wire_fields(planner) if k == 11), None)
                        if isinstance(duration, bytes):
                            fields = dict(wire_fields(duration))
                            durations[idx] = fields.get(1, 0) + fields.get(2, 0) / 1e9
                    stamp = next((v for k, v in wire_fields(blob or b"") if k == wanted), None)
                    if isinstance(stamp, bytes):
                        parts = dict(wire_fields(stamp))
                        sec, nanos = parts.get(1), parts.get(2, 0)
                        if isinstance(sec, int) and isinstance(nanos, int) and 0 <= nanos < 1000000000:
                            times[idx] = sec * 1000 + nanos // 1000000
                except (IndexError, ValueError):
                    continue
    except sqlite3.Error:
        pass
    return times, durations


def history(path):
    times, durations = step_times(path)
    events = []
    model = ""
    tools = deque()
    for row in history_rows(path):
        if row.get("model"):
            model = row["model"]
        kind = row.get("type")
        text = row.get("content") or ""
        if kind == "USER_INPUT":
            tools.clear()
            events.append(dict(role="user_message_chunk", text=user_text(text), start_ms=times.get(row.get("step_index")), created_at=row.get("created_at")))
        elif kind == "PLANNER_RESPONSE":
            thinking = row.get("thinking")
            if isinstance(thinking, str) and thinking.strip():
                events.append(dict(role="thinking", text=thinking, seconds=durations.get(row.get("step_index"))))
            if text:
                events.append(dict(role="agent_message_chunk", text=text, end_ms=times.get(row.get("step_index"))))
            for call in row.get("tool_calls", []):
                args = call.get("args") or {}
                action = call.get("name") or "tool"
                fields = {"run_command": "CommandLine", "read_file": "Path", "view_file": "AbsolutePath",
                          "edit_file": "Path", "write_file": "Path", "search_web": "query"}
                label = args.get(fields.get(action)) or args.get("toolSummary") or action
                if isinstance(label, str) and label.startswith('"'):
                    try:
                        label = json.loads(label)
                    except ValueError:
                        pass
                tool = dict(role="tool", id=str(len(events)), title=str(label), action=action,
                            kind="execute" if action == "run_command" else "tool")
                events.append(tool)
                tools.append(tool)
        elif kind == "GENERIC" and tools:
            tool = tools.popleft()
            tool.update(status="failed" if row.get("error") else "completed", output=text, error=row.get("error"))
    settings_path = path.parents[4] / "settings.json"
    settings = {}
    if settings_path.is_file():
        try:
            settings = json.loads(settings_path.read_text())
        except (OSError, ValueError):
            pass
    return {"events": events, "model": model, "selectedModel": settings.get("model"),
            "mode": settings.get("mode") or "auto"}


def terminal_sessions(foreground=False):
    presence = Path.home() / ".gemini/antigravity-cli/presence"
    if not presence.is_dir():
        return {}
    scan = subprocess.run(["/usr/sbin/lsof", "-nP", "-Fpcn", "+d", str(presence)],
                          capture_output=True, text=True, timeout=8)
    if scan.stderr.strip() or scan.returncode not in (0, 1):
        raise OSError("无法检查本地终端进程")
    sessions = {}
    for line in scan.stdout.splitlines():
        if line.startswith("p"):
            pid = line[1:]
            command = ""
        elif line.startswith("c"):
            command = line[1:]
        elif command == "agy" and line.startswith("n") and line.endswith(".lock"):
            fields = subprocess.run(["/bin/ps", "-p", pid, "-o", "tty=,pgid=,tpgid="],
                                    capture_output=True, text=True).stdout.split()
            if len(fields) == 3 and (not foreground or fields[1] == fields[2]):
                sessions[Path(line[1:]).stem] = (fields[0], pid) if foreground else fields[0]
    return sessions


def send_iterm(sid, message):
    target = terminal_sessions(foreground=True).get(sid)
    if not target or not re.fullmatch(r"ttys[0-9]+", target[0]):
        sys.exit("该会话没有在终端前台运行")
    if not message.strip() or any(ord(c) < 32 and c != "\n" for c in message):
        sys.exit("消息为空或包含终端控制字符")
    tty, pid = target
    script = """on run argv
set targetTTY to item 1 of argv
set targetPID to item 2 of argv
set msg to item 3 of argv
if application id "com.googlecode.iterm2" is running then
tell application id "com.googlecode.iterm2"
repeat with w in windows
repeat with t in tabs of w
repeat with s in sessions of t
if tty of s is targetTTY then
set procInfo to words of (do shell script "/bin/ps -p " & quoted form of targetPID & " -o pgid=,tpgid=,ucomm=")
if (count of procInfo) is not 3 then error "agy 已退出"
if item 1 of procInfo is not item 2 of procInfo or item 3 of procInfo is not "agy" then error "agy 已离开前台"
write s text ((ASCII character 27) & "[200~" & msg & (ASCII character 27) & "[201~") newline yes
return "sent"
end if
end repeat
end repeat
end repeat
end tell
end if
error "找不到此会话的 iTerm2 分屏"
end run"""
    result = subprocess.run(["/usr/bin/osascript", "-", "/dev/" + tty, pid, message],
                            input=script, capture_output=True, text=True, timeout=15)
    if result.returncode or result.stdout.strip() != "sent":
        sys.exit(result.stderr.strip() or "iTerm2 未确认输入")
    return {"sent": True}


def screen_status(sid):
    tty = terminal_sessions().get(sid)
    if not tty or not re.fullmatch(r"ttys[0-9]+", tty):
        return {}
    device = '"/dev/' + tty + '"'
    for app, collection, value in [
        ("com.googlecode.iterm2", "sessions of t", "contents of itemRef"),
        ("com.apple.Terminal", "", "contents of t"),
    ]:
        body = "repeat with itemRef in " + collection + "\nif tty of itemRef is " + device + " then return " + value + "\nend repeat" if collection else "if tty of t is " + device + " then return " + value
        script = ('if application id "' + app + '" is running then\ntell application id "' + app +
                  '"\nrepeat with w in windows\nrepeat with t in tabs of w\n' + body +
                  '\nend repeat\nend repeat\nend tell\nend if')
        capture = subprocess.run(["/usr/bin/osascript", "-e", script], capture_output=True, text=True, timeout=4)
        lines = capture.stdout.rstrip().splitlines()
        if not lines:
            continue
        footer = re.search(r"(?:auto|plan|accept-edits)\s*·\s*[^·]+\s*·\s*\S+", lines[-1], re.I)
        rules = [i for i, line in enumerate(lines) if re.fullmatch(r"\s*─{6,}\s*", line)]
        if not footer or len(rules) < 2 or not any(line.lstrip().startswith((">", "❯")) for line in lines[rules[-2]+1:rules[-1]]):
            return {}
        before = [line.strip() for line in lines[:rules[-2]] if line.strip()]
        recent = before[-8:]
        spinner = next((line for line in reversed(recent) if re.match(r"^[⠁-⣿]", line)), "")
        busy = re.search(r"esc to (?:cancel|interrupt|stop)", lines[-1], re.I)
        if busy:
            status = spinner or "正在生成"
            preview = [] if spinner else [line for line in recent[-4:] if not line.startswith(("└ Tip:", ">"))]
        else:
            status = ""
            preview = []
        return {"status": status, "footer": footer.group().strip(), "preview": preview}
    return {}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--session", type=UUID)
    parser.add_argument("--screen", type=UUID)
    parser.add_argument("--send-iterm", type=UUID)
    parser.add_argument("--message")
    args = parser.parse_args()
    if args.send_iterm:
        return send_iterm(str(args.send_iterm), args.message or "")
    if args.screen:
        return screen_status(str(args.screen))
    files = transcripts()
    if args.session:
        path = files.get(str(args.session))
        if not path:
            sys.exit("找不到本机会话文件")
        return history(path)
    try:
        terminals = terminal_sessions()
    except (OSError, subprocess.TimeoutExpired):
        terminals = None
    sources = {root: workspace_dirs(root) for root in {path.parents[4] for path in files.values()}}
    sessions = []
    for sid, path in sorted(files.items(), key=lambda pair: pair[1].stat().st_mtime, reverse=True):
        dirs = sources[path.parents[4]].get(sid, [])
        sessions.append(dict(path=str(path), cwd=dirs[0] if dirs else "", workspaces=dirs,
                             tty=terminals.get(sid, "") if terminals is not None else None,
                             sessionId=sid, title=title(path, sid),
                             updatedAt=datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat()))
    return {"sessions": sessions}


if __name__ == "__main__":
    print(json.dumps(main(), ensure_ascii=False))
