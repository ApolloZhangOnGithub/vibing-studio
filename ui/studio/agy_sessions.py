"""Read Antigravity session metadata and transcripts from the local filesystem."""
import argparse
import asyncio
import difflib
import gzip
import hashlib
import fcntl
import os
import signal
import pty
import shlex
import tempfile
import struct
import termios
import time
from contextlib import closing
from collections import deque
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import shutil
import uuid
import sqlite3
import subprocess
import sys
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from urllib.parse import unquote, urlsplit
from uuid import UUID, uuid5

# This helper also runs from inside the signed macOS application bundle.
sys.dont_write_bytecode = True
import agy_acp


VERIFICATION_DIR = Path.home() / "Library/Application Support/Vibing Studio/verification-sessions"


def create_session(verification=False):
    with subprocess.Popen(["agy", "acp"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True) as proc:
        try:
            for seq, (method, params) in enumerate([
                ("initialize", {"protocolVersion": 1, "clientCapabilities": {}}),
                ("session/new", {"cwd": str(Path.home()), "mcpServers": []})
            ], 1):
                proc.stdin.write(json.dumps(dict(jsonrpc="2.0", id=seq, method=method, params=params)) + "\n")
                proc.stdin.flush()
                for line in proc.stdout:
                    msg = json.loads(line)
                    if msg.get("id") == seq:
                        if "error" in msg:
                            raise ValueError(msg["error"]["message"])
                        break
                else:
                    raise ValueError("AGY 连接已关闭")
            sid = str(uuid.UUID(msg["result"]["sessionId"]))
            log = Path.home() / ".gemini/antigravity-cli/brain" / sid / ".system_generated/logs/transcript.jsonl"
            log.parent.mkdir(parents=True, exist_ok=True)
            log.touch(exist_ok=True)
            if verification or os.environ.get("NADOS_TESTJS") or os.environ.get("NADOS_SELFTEST") == "1":
                VERIFICATION_DIR.mkdir(parents=True, exist_ok=True)
                (VERIFICATION_DIR / ("agy-" + sid)).touch()
            return {"sessionId": sid}
        finally:
            proc.terminate()


def transcripts():
    files = {}
    for folder in ("antigravity-cli", "antigravity"):
        root = Path.home() / ".gemini" / folder
        for path in (root / "brain").glob("*/.system_generated/logs/transcript.jsonl"):
            sid = path.parents[2].name
            if sid not in files or path.stat().st_mtime > files[sid].stat().st_mtime:
                files[sid] = path
    return files


def session_transcript(sid):
    paths = (Path.home() / ".gemini" / folder / "brain" / sid / ".system_generated/logs/transcript.jsonl"
             for folder in ("antigravity-cli", "antigravity"))
    return max((p for p in paths if p.is_file()), key=lambda p: p.stat().st_mtime_ns, default=None)


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


def subagent_metadata(root):
    db = root / "conversation_summaries.db"
    if not db.is_file():
        return {}
    with closing(sqlite3.connect(db.as_uri() + "?mode=ro", uri=True)) as conn:
        columns = {row[1] for row in conn.execute("PRAGMA table_info(conversation_summaries)")}
        if not {"parent_conversation_id", "agent_name", "status", "killed"} <= columns:
            return {}
        return {sid: dict(parent=parent, role=role, updated=updated, status="stopped" if killed else
                          "running" if status.endswith("_RUNNING") else "done")
                for sid, parent, role, status, killed, updated in conn.execute(
                    "SELECT conversation_id,parent_conversation_id,agent_name,status,killed,last_modified_time "
                    "FROM conversation_summaries WHERE parent_conversation_id != ''")}


WORKFLOW_AGENT = re.compile(
    rb"^- \[agent:([^]\r\n]+)\] (.+?): (done|running|failed|stopped) "
    rb"\(([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\)(?=:|\s|$)"
)


def workflow_children(root):
    # Task logs can also contain long shell output. Index each unchanged file only once.
    cache_dir = Path.home() / ".cache" / "vibing-studio"
    cache = cache_dir / (root.name + "-workflow-children-v1.json")
    try:
        previous = json.loads(cache.read_text())
    except (OSError, ValueError):
        previous = {}
    current, children = {}, {}
    for log in (root / "brain").glob("*/.system_generated/tasks/task-*.log"):
        parent = log.parents[2].name
        key = parent + "/" + log.name
        try:
            st = log.stat()
            signature = [st.st_mtime_ns, st.st_size, st.st_ino]
            entry = previous.get(key)
            if not entry or entry[0] != signature:
                records = {}
                with log.open("rb") as stream:
                    for line in stream:
                        match = WORKFLOW_AGENT.match(line)
                        if match:
                            role, label, status, sid = (v.decode("utf-8", "replace") for v in match.groups())
                            records[sid] = dict(role=role, label=label, status=status, parent=parent,
                                                workflow=log.stem)
                entry = [signature, records]
            current[key] = entry
            children.update(entry[1])
        except OSError:
            continue
    if current != previous:
        try:
            cache_dir.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(mode="w", dir=cache_dir, delete=False) as tmp:
                json.dump(current, tmp)
            os.replace(tmp.name, cache)
        except OSError:
            pass
    return children


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
    return sid if path.stat().st_size else "新会话"


def branch_rows(path, current):
    # A rewind reuses indices; the JSONL files keep both versions, sometimes out of order.
    # Keep offsets rather than a second copy of the entire conversation in memory.
    positions = {}
    with path.open("rb") as stream:
        while True:
            offset = stream.tell()
            line = stream.readline()
            if not line:
                break
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except ValueError:
                if line.endswith(b"\n"):
                    raise
                break
            index = row["step_index"]
            if index in current and (not current[index] or row.get("created_at", "")[:19] == current[index]):
                positions[index] = offset
        for index in sorted(positions):
            stream.seek(positions[index])
            yield json.loads(stream.readline())


def history_rows(path, current=None):
    read = rows if current is None else lambda file: branch_rows(file, current)
    full_path = path.with_name("transcript_full.jsonl")
    if not full_path.is_file():
        yield from read(path)
        return

    # Both logs are ordered by step_index and can be appended independently.
    full_rows = read(full_path)
    full = next(full_rows, None)
    for summary in read(path):
        index = summary["step_index"]
        while full is not None and full["step_index"] < index:
            yield full
            full = next(full_rows, None)
        if full is not None and full["step_index"] == index:
            yield {**summary, **full, "thinking": full.get("thinking") or summary.get("thinking")}
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
    current = None
    times = {}
    durations = {}
    context_limit = None
    try:
        with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True, timeout=0.2)) as db:
            db.execute("BEGIN")
            branch = {}
            for idx, metadata in db.execute("SELECT idx, substr(metadata, 1, 48) FROM steps"):
                stamp = None
                try:
                    key, value = next(wire_fields(metadata or b""))
                    if key == 1 and isinstance(value, bytes):
                        seconds = dict(wire_fields(value))[1]
                        stamp = datetime.fromtimestamp(seconds, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
                except (StopIteration, ValueError, IndexError, KeyError, OverflowError, OSError):
                    pass
                branch[idx] = stamp
            current = branch
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
    # AGY stores the effective checkpoint token limit in the executor configuration.
    try:
        with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True, timeout=0.2)) as db:
            row = db.execute("SELECT data FROM executor_metadata ORDER BY idx DESC LIMIT 1").fetchone()
            if row:
                field = row[0]
                for key in (10, 2, 5):
                    field = dict(wire_fields(field))[key]
                if isinstance(field, int) and field > 0:
                    context_limit = field
    except (sqlite3.Error, KeyError, TypeError, ValueError, IndexError):
        pass
    return times, durations, context_limit, current


def log_revision(path):
    try:
        st = path.stat()
        return (st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns, st.st_ctime_ns)
    except FileNotFoundError:
        return None


def history(path, known_prefix=None, known_turns=None, known_last=None, known_source=None, *, owner_start=None):
    times, durations, context_limit, current = step_times(path)
    events = []
    model = ""
    tools = deque()
    background = {}
    notification_tasks = {}
    if owner_start is None:
        owner_start = active_since(path.parents[2].name)
    settings_path = path.parents[4] / "settings.json"
    settings = {}
    if settings_path.is_file():
        try:
            settings = json.loads(settings_path.read_text())
        except (OSError, ValueError):
            pass
    # WAL writes unrelated to displayed steps need no transcript parsing or diff generation.
    logs = (path, path.with_name("transcript_full.jsonl"))
    revisions = [log_revision(p) for p in logs]
    working = summary_working(path)
    inputs = [current, working, revisions, times, durations, context_limit, owner_start, settings.get("model"), settings.get("mode")]
    source = hashlib.sha256(json.dumps(inputs, sort_keys=True).encode()).hexdigest()
    if known_source == source:
        return {"unchanged": True, "source": source}
    owner_iso = datetime.fromtimestamp(owner_start / 1000, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    final_at = 0
    context_tokens = None
    for row in history_rows(path, current):
        if isinstance(row.get("input_tokens"), int):
            context_tokens = row["input_tokens"] + (row.get("cache_read_tokens") or 0)
        if row.get("model"):
            model = row["model"]
        kind = row.get("type")
        text = row.get("content") or ""
        final_at = 0
        if kind == "PLANNER_RESPONSE" and row.get("status") == "DONE" and text and not row.get("tool_calls"):
            final_at = times.get(row.get("step_index")) or 0
        if kind == "SYSTEM_MESSAGE" and owner_start:
            sender = re.search(r'\bsender=([^\s]+/task-\d+) ', text)
            task = background.get(sender[1]) if sender else None
            if re.search(r'sender=system .*?content=\[Notice\] All your subagents and background tasks have been stopped', text):
                for item in background.values():
                    if item["status"] == "running":
                        item.update(status="cancelled", endedAt=row.get("created_at"))
            if task and task["status"] == "running" and ("finished with result:" in text or "was canceled with result:" in text or task.get("once")):
                task["status"] = "cancelled" if "was canceled with result:" in text else "done"
                task["endedAt"] = row.get("created_at")
        if kind == "SYSTEM_MESSAGE" and row.get("step_index") == 0:
            assignment = re.search(r"<SYSTEM_MESSAGE>\s*\[Message\] timestamp=\S+ sender=[0-9a-fA-F-]{36} priority=\S+ content=(.*?)\s*</SYSTEM_MESSAGE>\s*$", text, re.S)
            if assignment:
                kind, text = "USER_INPUT", assignment[1]
        if kind == "USER_INPUT":
            tools.clear()
            events.append(dict(role="user_message_chunk", text=user_text(text), start_ms=times.get(row.get("step_index")), created_at=row.get("created_at")))
        elif kind == "PLANNER_RESPONSE":
            thinking = row.get("thinking")
            seconds = durations.get(row.get("step_index"))
            if thinking or seconds:
                events.append(dict(role="thinking", text=thinking or "", seconds=seconds))
            if text:
                events.append(dict(role="agent_message_chunk", step=row.get("step_index"), text=text, end_ms=times.get(row.get("step_index"))))
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
                tool = dict(role="tool", id=str(len(events)), title=str(label), action=action, created_at=row.get("created_at"),
                            kind="execute" if action == "run_command" else "tool")
                if action == "run_command":
                    timeout = str(args.get("NotificationTimeoutSeconds", "")).strip('"')
                    if timeout.isascii() and timeout.isdigit() and 0 < int(timeout) <= 2**53 - 1:
                        tool["notificationTimeoutSeconds"] = int(timeout)
                if action in ("write_file", "edit_file") and isinstance(args.get("Path"), str):
                    tool["file_path"] = args["Path"]
                    if action == "write_file" and isinstance(args.get("Content"), str):
                        tool["lines"] = args["Content"].splitlines()
                    if action == "edit_file" and all(isinstance(args.get(k), str) for k in ("Target", "Replacement")):
                        old, new = args["Target"].splitlines(), args["Replacement"].splitlines()
                        diff = []
                        for tag, a, b, c, d in difflib.SequenceMatcher(None, old, new, autojunk=False).get_opcodes():
                            if tag in ("replace", "delete"):
                                diff.extend({"t": "-", "l": line} for line in old[a:b])
                            if tag in ("replace", "insert"):
                                diff.extend({"t": "+", "l": line} for line in new[c:d])
                            if tag == "equal":
                                diff.extend({"t": " ", "l": line} for line in old[a:b])
                        tool["diff"] = diff
                if action == "update_steps":
                    steps = args.get("steps")
                    if isinstance(steps, str):
                        try:
                            steps = json.loads(steps)
                        except ValueError:
                            pass
                    tool["steps"] = steps
                if action == "ask_question":
                    tool["questions"] = args.get("questions") or []
                if action in ("manage_task", "manage_subagents", "invoke_subagent"):
                    tool["taskArgs"] = args
                if action == "schedule":
                    schedule = {}
                    for key in ("CronExpression", "DurationSeconds", "Prompt", "TimerCondition"):
                        value = args.get(key)
                        if isinstance(value, str) and value.startswith('"'):
                            try:
                                value = json.loads(value)
                            except ValueError:
                                pass
                        if value is not None:
                            schedule[key] = str(value)
                    tool["schedule"] = schedule
                if action == "run_command" and isinstance(args.get("toolSummary"), str):
                    tool["commandSummary"] = args["toolSummary"].strip()
                events.append(tool)
                tools.append(tool)
        elif kind == "GENERIC" and tools:
            tool = tools.popleft()
            match = re.search(r'^Tool is running as a background task with task id: (\S+)', text, re.M)
            if match and tool.get("notificationTimeoutSeconds"):
                desc = re.search(r"^Task Description: (.+)$", text, re.M)
                notification_tasks[match[1]] = dict(cmd=desc[1] if desc else tool["title"],
                    createdAt=row.get("created_at"), notificationTimeoutSeconds=tool["notificationTimeoutSeconds"])
            if owner_start and (row.get("created_at") or "") >= owner_iso:
                if match and tool["action"] in ("run_command", "schedule"):
                    schedule = tool.get("schedule") or {}
                    background[match[1]] = dict(id=match[1], kind="cron" if schedule else "shell",
                        desc=schedule.get("Prompt") or tool["title"], cmd=tool["title"], status="running",
                        notificationTimeoutSeconds=tool.get("notificationTimeoutSeconds"),
                        once=bool(schedule and not schedule.get("CronExpression")),
                        createdAt=row.get("created_at"), duration=schedule.get("DurationSeconds"),
                        cron=schedule.get("CronExpression"), condition=schedule.get("TimerCondition"))
                args = tool.get("taskArgs") or {}
                target = background.get(str(args.get("TaskId", "")).strip('"'))
                states = {"DONE":"done", "COMPLETED":"done", "FAILED":"error", "CANCELLED":"cancelled", "CANCELED":"cancelled"}
                status = re.search(r'^Status:\s*(DONE|COMPLETED|FAILED|CANCELLED|CANCELED)\b', text, re.M)
                cancelled = re.search(r'^Task "([^"\n]+)" cancel(?:l)?ed\.$', text, re.M)
                if cancelled:
                    target = background.get(cancelled[1])
                if target and (cancelled or status):
                    completed = re.search(r'^Completed At: (\S+)', text, re.M)
                    target["endedAt"] = completed[1] if completed else row.get("created_at")
                    target["status"] = "cancelled" if cancelled else states[status[1]]
            tool.update(status="failed" if row.get("error") else "completed", output=text, error=row.get("error"))
    # A conditional one-shot can end silently when its watched task finishes.
    for timer in background.values():
        if timer.get("once") and timer["status"] == "running":
            watched = background.get(timer.get("condition"))
            if watched and watched["status"] in ("done", "cancelled", "error"):
                timer.update(status="cancelled", endedAt=watched.get("endedAt"))
    hashes = []
    starts = []
    for index, event in enumerate(events):
        if not hashes or event["role"] == "user_message_chunk":
            starts.append(index)
            hashes.append(hashlib.sha256())
        hashes[-1].update(json.dumps(event, ensure_ascii=False).encode())
    digests = [h.hexdigest() for h in hashes]
    prefix = hashlib.sha256("".join(digests[:-1]).encode()).hexdigest()
    count = len(digests) - 1 if known_turns is None else known_turns
    reused = 0
    if 0 <= count < len(digests) and known_prefix == hashlib.sha256("".join(digests[:count]).encode()).hexdigest():
        reused = count + int(digests[count] == known_last)
    latest_steps = next((e["steps"] for e in reversed(events)
                         if e.get("action") == "update_steps" and e.get("status") == "completed"
                         and not e.get("error") and isinstance(e.get("steps"), list)), [])
    offset = starts[reused] if reused < len(starts) else len(events)
    return {"source": source if revisions == [log_revision(p) for p in logs] else None,
            "foregroundToolWorking": bool(tools and working), "contextLimit": context_limit, "contextTokens": context_tokens, "finalAt": final_at, "background": list(background.values()), "notificationTasks": notification_tasks, "steps": latest_steps, "events": events[offset:], "prefix": prefix,
            "reuseTurns": reused, "turnHashes": digests, "model": model, "selectedModel": settings.get("model"),
            "mode": settings.get("mode") or "auto"}


def terminal_sessions(foreground=False, retired_marker=None):
    presence = Path.home() / ".gemini/antigravity-cli/presence"
    if not presence.is_dir():
        return {}
    scan = subprocess.run(["/usr/sbin/lsof", "-nP", "-Fpcn", "+d", str(presence)],
                          capture_output=True, text=True, timeout=8)
    if scan.stderr.strip() or scan.returncode not in (0, 1):
        raise OSError("无法检查本地终端进程")
    owners = {}
    pid = None
    for line in scan.stdout.splitlines():
        if line.startswith("p"):
            pid = line[1:]
        elif line == "cagy":
            owners[pid] = set()
        elif pid in owners and line.startswith("n") and line.endswith(".lock"):
            owners[pid].add(Path(line[1:]).stem)
    retired_parents = set()
    if retired_marker:
        markers = [p for p in [retired_marker, *retired_marker.parent.glob("*/" + retired_marker.name)]
                   if p.is_file() and p != activity_file(retired_marker.name)]
    if retired_marker and markers:
        opened = subprocess.run(["/usr/sbin/lsof", "-t", *map(str, markers)],
                                capture_output=True, text=True, timeout=4)
        retired_parents.update(opened.stdout.split())
    sessions = {}
    for pid, ids in owners.items():
        if retired_parents:
            parent = subprocess.run(["/bin/ps", "-p", pid, "-o", "ppid="],
                                    capture_output=True, text=True).stdout.strip()
            if parent in retired_parents:
                continue
        fields = subprocess.run(["/bin/ps", "-p", pid, "-o", "tty=,pgid=,tpgid="],
                                capture_output=True, text=True).stdout.split()
        if len(fields) != 3 or (foreground and fields[1] != fields[2]):
            continue
        if not ids and re.fullmatch(r"ttys[0-9]+", fields[0]):
            files = subprocess.run(["/usr/sbin/lsof", "-nP", "-p", pid, "-Fn"],
                                   capture_output=True, text=True, timeout=4)
            database_dir = presence.parent / "conversations"
            ids = {Path(line[1:]).stem for line in files.stdout.splitlines()
                   if line.startswith("n") and line.endswith(".db") and Path(line[1:]).parent == database_dir}
            if len(ids) != 1:
                continue
        for sid in ids:
            sessions[sid] = (fields[0], pid) if foreground else fields[0]
    return sessions


def activity_file(sid):
    base = Path.home() / "Library/Application Support/Vibing Studio/agy-runs"
    # A reconnected conversation keeps its old worker alive for existing background tools.
    route = base / (sid + ".connection")
    if route.is_file():
        generation = UUID(route.read_text().strip()).hex
        return base / generation / sid
    return base / sid


def connection_for_send(sid):
    marker = activity_file(sid)
    executable = shutil.which("agy")
    if not executable or not marker.exists():
        return marker
    installed = Path(executable).resolve()
    metadata = installed.stat()
    fields = marker.read_text().splitlines()[1:]
    legacy_owner = fields[:1] == ["acp"] and fields != ["acp", agy_acp.OWNER_VERSION]
    if (not legacy_owner and marker.stat().st_mtime_ns >= metadata.st_ctime_ns) or not Path(agy_acp.endpoint(marker)).exists():
        return marker
    if not agy_acp.turn_finished(transcripts().get(sid)):
        return marker

    # Only migrate a Studio-owned ACP child actually mapped to a replaced executable.
    owners = subprocess.run(["/usr/sbin/lsof", "-t", str(marker)], capture_output=True, text=True).stdout.split()
    for owner in owners:
        children = subprocess.run(["/usr/bin/pgrep", "-P", owner, "-x", "agy"],
                                  capture_output=True, text=True).stdout.split()
        for child in children:
            mapped = subprocess.run(["/usr/sbin/lsof", "-a", "-p", child, "-d", "txt", "-Fin"],
                                    capture_output=True, text=True).stdout.splitlines()
            inode = None
            for field in mapped:
                if field.startswith("i"):
                    inode = field[1:]
                if field.startswith("n") and (field[1:] == str(installed) or field[1:].startswith(str(installed) + ".")):
                    if not inode or (not legacy_owner and inode == str(metadata.st_ino)):
                        break
                    base = marker.parent if marker.parent.name == "agy-runs" else marker.parent.parent
                    generation = uuid5(UUID(sid), f"{metadata.st_dev}:{metadata.st_ino}:{agy_acp.OWNER_VERSION}").hex
                    with tempfile.NamedTemporaryFile(mode="w", dir=base, delete=False) as tmp:
                        tmp.write(generation)
                    os.replace(tmp.name, base / (sid + ".connection"))
                    return activity_file(sid)
    return marker


def active_since(sid):
    try:
        with activity_file(sid).open() as marker:
            try:
                fcntl.flock(marker, fcntl.LOCK_SH | fcntl.LOCK_NB)
            except BlockingIOError:
                return int(marker.readline() or 0)
    except (OSError, ValueError):
        pass
    return 0


def weekly_quota():
    # Launch an idle CLI with a session-only status line. The collector writes
    # just the Gemini quota, never the rest of the account/status payload.
    with tempfile.TemporaryDirectory() as folder:
        sample = Path(folder) / "quota"
        collector = "import json,sys,pathlib; q=json.load(sys.stdin).get('quota',{}); q and pathlib.Path(sys.argv[1]).write_text(json.dumps(q))"
        cmd = shlex.join([sys.executable, "-c", collector, str(sample)])
        settings = json.dumps({"statusLine": {"enabled": True, "command": cmd}})
        master, slave = pty.openpty()
        try:
            fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 35, 120, 0, 0))
            with subprocess.Popen(["agy", "--settings", settings], stdin=slave, stdout=slave, stderr=slave,
                                  cwd=folder, start_new_session=True) as proc:
                try:
                    os.set_blocking(master, False)
                    for _ in range(100):
                        try:
                            os.read(master, 65536)
                        except BlockingIOError:
                            pass
                        if sample.exists() and sample.stat().st_size:
                            buckets = json.loads(sample.read_text())
                            q = buckets.get("gemini-weekly", {})
                            if isinstance(q.get("remaining_fraction"), (int, float)):
                                return {"remaining": q["remaining_fraction"], "reset": q.get("reset_time"),
                                        "buckets": [{"name": name, "remaining": item["remaining_fraction"], "reset": item.get("reset_time")}
                                                    for name, item in buckets.items() if isinstance(item, dict) and isinstance(item.get("remaining_fraction"), (int, float))]}
                        if proc.poll() is not None:
                            break
                        time.sleep(0.12)
                finally:
                    if proc.poll() is None:
                        proc.terminate()
                        try:
                            proc.wait(2)
                        except subprocess.TimeoutExpired:
                            proc.kill()
        finally:
            os.close(master)
            os.close(slave)
    return {}


def stream_input(message):
    return (json.dumps({"event": "user", "message": {"content": message}}, ensure_ascii=False) + "\n").encode()


def submit_running(sid, message):
    marker = activity_file(sid)
    control = marker.with_suffix(".input-count")
    try:
        with marker.with_suffix(".write-lock").open("a") as serial, control.open("r+") as state:
            fcntl.flock(serial, fcntl.LOCK_EX)
            fcntl.flock(state, fcntl.LOCK_EX)
            count = int(state.read() or 0)
            if count < 1:
                return False
            fd = os.open(marker.with_suffix(".fifo"), os.O_WRONLY | os.O_NONBLOCK)
            with os.fdopen(fd, "wb", buffering=0) as pipe:
                state.seek(0)
                state.truncate()
                state.write(str(count + 1))
                state.flush()
                # Reserve the turn before releasing state. The reader can finish
                # earlier turns while a large prompt is still entering its pipe.
                fcntl.flock(state, fcntl.LOCK_UN)
                os.set_blocking(fd, True)
                data = memoryview(stream_input(message))
                while data:
                    data = data[pipe.write(data):]
        return True
    except OSError as error:
        if isinstance(error, BlockingIOError):
            sys.exit("agy 输入管道正忙，草稿已保留")
        return False


def rewind_messages(sid, target=None):
    path = session_transcript(sid)
    if not path:
        sys.exit("找不到会话记录")
    database = path.parents[4] / "conversations" / (sid + ".db")
    with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)) as db:
        query = "SELECT idx, metadata, step_payload FROM steps WHERE step_type=14"
        found = []
        for idx, meta, payload in db.execute(query + (" AND idx=?" if target is not None else " ORDER BY idx DESC"),
                                             (target,) if target is not None else ()):
            body = next((v for k, v in wire_fields(payload) if k == 19), b"")
            text = next((v.decode("utf-8") for k, v in wire_fields(body) if k == 2), "")
            stamp = hashlib.sha256(meta or b"").hexdigest()
            found.append(dict(index=idx, key=stamp, text=text if target is not None else text[:160]))
        return found


def rewind_owner(sid):
    marker = activity_file(sid)

    def pid():
        owners = subprocess.run(["/usr/sbin/lsof", "-t", str(marker)], capture_output=True, text=True).stdout.split() if marker.exists() else []
        for owner in owners:
            children = subprocess.run(["/usr/bin/pgrep", "-P", owner, "-x", "agy"], capture_output=True, text=True).stdout.split()
            if len(children) == 1:
                return children[0]
        return None

    current = pid()
    if current:
        return current
    external = terminal_sessions(foreground=True).get(sid)
    if external:
        return external[1]
    # Start the normal persistent Studio connection and resume without sending a prompt.
    start_owner(sid, marker, {"open": True})
    current = pid()
    if not current:
        sys.exit("未找到此会话的 AGY 服务")
    return current


def apply_rewind(sid, index, key, conversation_only):
    pid = rewind_owner(sid)
    files = subprocess.check_output(["/usr/sbin/lsof", "-nP", "-p", pid, "-Fn"], text=True)
    logdir = Path.home() / ".gemini/antigravity-cli/log"
    port = None
    for line in files.splitlines():
        path = Path(line[1:])
        if not line.startswith("n") or path.parent != logdir or path.suffix != ".log":
            continue
        with path.open("rb") as stream:
            boot = stream.read(128 * 1024)
        if not re.search(rb"Starting language server process with pid " + pid.encode() + rb"\b", boot):
            continue
        match = re.search(rb"listening on random port at (\d+) for HTTP\b", boot)
        if match:
            port = int(match[1])
            break
    if not port:
        sys.exit("无法定位此会话的 AGY 服务端口")
    rows = rewind_messages(sid, index)
    if not rows or rows[0]["key"] != key:
        sys.exit("历史消息已变化，请重新选择回退位置")
    url = f"http://127.0.0.1:{port}/exa.language_server_pb.LanguageServerService/RevertToCascadeStep"
    body = dict(cascadeId=sid, stepIndex=index - 1, conversationOnly=conversation_only)
    request = Request(url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    try:
        with urlopen(request, timeout=30) as response:
            json.load(response)
    except HTTPError as error:
        sys.exit(json.loads(error.read()).get("message") or str(error))
    return {"text": rows[0]["text"]}


def send_message(sid, message, model=None, configure=False, slash_command=False):
    if not message.strip() and not (configure and model):
        sys.exit("消息为空")
    marker_path = connection_for_send(sid)
    if configure and active_since(sid) and marker_path.read_text().splitlines()[1:] != ["acp", agy_acp.OWNER_VERSION]:
        sys.exit("当前回合使用旧版连接，结束后可切换模型")
    request = {"message": message, "model": model, "configure": configure}
    if slash_command and message.strip() == "/rewind":
        return send_terminal(sid, "/rewind", slash_command=True)
    result = agy_acp.exchange(marker_path, request)
    if result is not None:
        return result
    if active_since(sid):
        # The owner can be between taking the session lock and publishing stdin,
        # or between closing stdin after a result and releasing the session.
        until = time.monotonic() + 3
        while active_since(sid):
            result = agy_acp.exchange(marker_path, request)
            if result is not None:
                return result
            if submit_running(sid, message):
                return {"sent": True}
            fields = marker_path.read_text().splitlines()
            if len(fields) == 2 and fields[1].isdigit():
                cmd = subprocess.run(["/bin/ps", "-p", fields[1], "-o", "command="],
                                     capture_output=True, text=True).stdout
                if f"--conversation {sid} --output-format stream-json --print " in cmd:
                    sys.exit("未发送：当前 agy 进程以单次输入模式启动，无法接收追加消息。草稿已保留。")
            if time.monotonic() >= until:
                sys.exit("agy 的消息输入通道尚未就绪，草稿已保留")
            time.sleep(0.05)
    retired = marker_path.parent.parent / sid if marker_path.parent.name != "agy-runs" else None
    tty = terminal_sessions(retired_marker=retired).get(sid)
    if tty and re.fullmatch(r"ttys[0-9]+", tty):
        if configure:
            sys.exit("请在当前 AGY 终端切换模型")
        return send_terminal(sid, message, slash_command=slash_command)
    if tty:
        sys.exit("此会话由外部后台进程持有，Studio 没有它的输入通道")
    return start_owner(sid, marker_path, request)


def start_owner(sid, marker_path, request):
    path = transcripts().get(sid)
    if not path:
        sys.exit("找不到本机会话文件")
    executable = shutil.which("agy")
    if not executable:
        sys.exit("找不到 agy 命令")
    directories = workspace_dirs(path.parents[4]).get(sid, [])
    cwd = next((directory for directory in directories if Path(directory).is_dir()), None)
    owner = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "--acp-owner", sid],
                             cwd=cwd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL, start_new_session=True)
    until = time.monotonic() + 10
    while time.monotonic() < until:
        result = agy_acp.exchange(marker_path, request)
        if result is not None:
            return result
        if owner.poll() is not None and not active_since(sid):
            break
        time.sleep(0.05)
    sys.exit("无法启动 agy ACP 会话，草稿已保留")


def interrupt(sid):
    result = agy_acp.exchange(activity_file(sid), {"interrupt":True})
    if result is not None:
        return result
    if active_since(sid):
        with activity_file(sid).open() as marker:
            fields = marker.read().splitlines()
        if len(fields) == 2:
            pid = int(fields[1])
            command = subprocess.run(["/bin/ps", "-p", str(pid), "-o", "command="],
                                     capture_output=True, text=True).stdout.strip()
            if re.match(r"^.*?/agy --conversation " + re.escape(sid) + r" (?:--input-format stream-json )?--output-format stream-json ", command):
                os.kill(pid, signal.SIGINT)
                return {"interrupted": True}
    return send_terminal(sid, "", cancel=True)


def send_terminal(sid, message, cancel=False, slash_command=False):
    target = terminal_sessions(foreground=True).get(sid)
    if not target or not re.fullmatch(r"ttys[0-9]+", target[0]):
        sys.exit("该会话没有在终端前台运行")
    if not cancel and (not message.strip() or any(ord(c) < 32 and c != "\n" for c in message)):
        sys.exit("消息为空或包含终端控制字符")
    tty, pid = target
    script = """on checkOwner(targetPID, targetTTY)
set procInfo to words of (do shell script "/bin/ps -p " & quoted form of targetPID & " -o pgid=,tpgid=,tty=,ucomm=")
if (count of procInfo) is not 4 then error "AGY 已退出"
if item 1 of procInfo is not item 2 of procInfo or item 4 of procInfo is not "agy" or ("/dev/" & item 3 of procInfo) is not targetTTY then error "AGY 已离开目标终端前台"
end checkOwner

on run argv
set targetTTY to item 1 of argv
set targetPID to item 2 of argv
set msg to item 3 of argv
set op to item 4 of argv
if op is "send" then set msg to (ASCII character 27) & "[200~" & msg & (ASCII character 27) & "[201~"
if application id "com.googlecode.iterm2" is running then
tell application id "com.googlecode.iterm2"
repeat with w in windows
repeat with t in tabs of w
repeat with s in sessions of t
if tty of s is targetTTY then
my checkOwner(targetPID, targetTTY)
if op is "interrupt" then
write s text (ASCII character 27) newline no
else
if op is "command" then
select w
select t
select s
activate
end if
write s text msg newline yes
end if
return "sent"
end if
end repeat
end repeat
end repeat
end tell
end if
if application id "com.apple.Terminal" is running then
tell application id "com.apple.Terminal"
repeat with w in windows
repeat with i from 1 to count tabs of w
if tty of tab i of w is targetTTY then
my checkOwner(targetPID, targetTTY)
if op is "interrupt" then
set selected tab of w to tab i of w
set index of w to 1
activate
if tty of selected tab of front window is not targetTTY then error "目标终端标签页未选中"
my checkOwner(targetPID, targetTTY)
tell application "System Events" to tell application process "Terminal"
if not frontmost then error "终端未在前台"
key code 53
end tell
else
if op is "command" then
set selected tab of w to tab i of w
set index of w to 1
activate
end if
do script msg in tab i of w
end if
return "sent"
end if
end repeat
end repeat
end tell
end if
error "找不到该 AGY 会话所在的终端标签页"
end run"""
    mode = "interrupt" if cancel else "command" if slash_command and "\n" not in message else "send"
    result = subprocess.run(["/usr/bin/osascript", "-", "/dev/" + tty, pid, message, mode],
                            input=script, capture_output=True, text=True, timeout=15)
    if result.returncode or result.stdout.strip() != "sent":
        error = result.stderr.strip()
        if cancel and ("1002" in error or "辅助访问" in error or "发送按键" in error):
            sys.exit("macOS 未允许发送按键，请在已选中的终端标签页按 Esc 中断。")
        sys.exit(re.sub(r"^.*?execution error: ", "", error) or "终端未确认输入")
    return {"sent": True}


def screen_status(sid):
    tty = terminal_sessions().get(sid)
    if not tty or not re.fullmatch(r"ttys[0-9]+", tty):
        return {}
    try:
        screen = terminal_screen(tty)
    except (OSError, subprocess.TimeoutExpired):
        screen = {}
    if "working" in screen:
        return screen
    path = session_transcript(sid)
    working = summary_working(path) if path else None
    return {"summaryWorking": working} if working is not None else {}


_background_cache = {}


def owner_has_background(transcript, owner_start):
    if summary_working(transcript) is True:
        return True
    revision = (owner_start, log_revision(transcript), log_revision(transcript.with_name("transcript_full.jsonl")))
    if revision not in _background_cache:
        tasks = history(transcript, owner_start=owner_start)["background"]
        _background_cache.clear()
        _background_cache[revision] = any(task["status"] == "running" for task in tasks)
    return _background_cache[revision]


def summary_working(path):
    db = path.parents[4] / "conversation_summaries.db"
    try:
        with closing(sqlite3.connect(db.as_uri() + "?mode=ro", uri=True, timeout=0.2)) as conn:
            row = conn.execute("SELECT status, killed FROM conversation_summaries WHERE conversation_id=?",
                               (path.parents[2].name,)).fetchone()
        if row and row[0] in ("CASCADE_RUN_STATUS_RUNNING", "CASCADE_RUN_STATUS_IDLE"):
            return row[0] == "CASCADE_RUN_STATUS_RUNNING" and not row[1]
    except sqlite3.Error:
        pass
    return None


def terminal_screen(tty):
    device = '"/dev/' + tty + '"'
    # AppleScript's "contents of t" dereferences a repeat variable to the
    # tab object itself. Read the screen property on an indexed tab/session.
    for app, body in [
        ("com.googlecode.iterm2",
         "repeat with j from 1 to count sessions of tab i of w\n"
         f"if tty of session j of tab i of w is {device} then return contents of session j of tab i of w\n"
         "end repeat"),
        ("com.apple.Terminal", f"if tty of tab i of w is {device} then return contents of tab i of w"),
    ]:
        script = (f'if application id "{app}" is running then\ntell application id "{app}"'
                  '\nrepeat with w in windows\nrepeat with i from 1 to count tabs of w\n' + body +
                  '\nend repeat\nend repeat\nend tell\nend if')
        capture = subprocess.run(["/usr/bin/osascript", "-e", script], capture_output=True, text=True, timeout=4)
        lines = capture.stdout.rstrip().splitlines()
        if not lines:
            continue
        footer = re.search(r"(?:auto|plan|accept-edits)\s*·\s*[^·]+\s*·\s*\S+", lines[-1], re.I)
        rules = [i for i, line in enumerate(lines) if re.fullmatch(r"\s*─{6,}\s*", line)]
        if not footer:
            return {}
        # The task tray adds another separator below the composer.
        composer = next(((top, bottom) for top, bottom in reversed(list(zip(rules, rules[1:])))
                         if any(line.lstrip().startswith((">", "❯")) for line in lines[top + 1:bottom])), None)
        if composer is None:
            return {}
        top, bottom = composer
        tasks = []
        for line in lines[bottom + 1:-1]:
            task = re.search(r"\[(\d{2}:\d{2}:\d{2})\]\s+(.+?)\s+(running|completed|failed|cancelled)\s*$", line, re.I)
            if task:
                clock, label, state = task.groups()
                tasks.append(dict(id=f"{clock}:{label}", kind="cron" if label.lower().startswith("cron (") else "shell", cmd=label,
                                  clock=clock, desc=label if label.lower().startswith("cron (") else f"[{clock}] {label}", status={"completed": "done", "failed": "error"}.get(state.lower(), state.lower())))
        before = [line.strip() for line in lines[:top] if line.strip()]
        recent = before[-8:]
        spinner = next((line for line in reversed(recent) if re.match(r"^[⠁-⣿]", line)), "")
        busy = re.search(r"esc to (?:cancel|interrupt|stop)", lines[-1], re.I)
        if busy or spinner:
            status = re.sub(r"(?i)\b\d+\s+(?:lines?|turns?)\b", "", spinner)
            status = re.sub(r"\s*[·•|,]\s*(?=[·•|,)]|$)", "", status).strip()
            preview = [] if spinner else [line for line in recent[-4:] if not line.startswith(("└ Tip:", ">"))]
        else:
            status = ""
            preview = []
        return {"tasks": tasks, "working": bool(busy or spinner), "status": status, "footer": footer.group().strip(), "preview": preview}
    return {}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rewind", type=UUID)
    parser.add_argument("--step", type=int)
    parser.add_argument("--step-key")
    parser.add_argument("--with-files", action="store_true")
    parser.add_argument("--acp-owner", type=UUID)
    parser.add_argument("--session", type=UUID)
    parser.add_argument("--interrupt", type=UUID)
    parser.add_argument("--known-prefix")
    parser.add_argument("--known-source")
    parser.add_argument("--known-turns", type=int)
    parser.add_argument("--known-last")
    parser.add_argument("--screen", type=UUID)
    parser.add_argument("--send", type=UUID)
    parser.add_argument("--send-iterm", type=UUID)
    parser.add_argument("--models", action="store_true")
    parser.add_argument("--weekly", action="store_true")
    parser.add_argument("--configure", type=UUID)
    parser.add_argument("--model")
    parser.add_argument("--message")
    parser.add_argument("--slash-command", action="store_true", help="Submit a recognized command in the interactive terminal")
    parser.add_argument("--verification", action="store_true")
    parser.add_argument("--create", action="store_true")
    args = parser.parse_args()
    if args.create:
        return create_session(args.verification)
    if args.rewind:
        if args.step is None:
            return rewind_messages(str(args.rewind))
        return apply_rewind(str(args.rewind), args.step, args.step_key, not args.with_files)
    if args.acp_owner:
        asyncio.run(agy_acp.serve(activity_file(str(args.acp_owner)), os.getcwd(), transcripts().get(str(args.acp_owner)), owner_has_background))
        return {}
    if args.weekly:
        return weekly_quota()
    if args.models:
        output = subprocess.check_output(["agy", "models"], text=True, timeout=30)
        return [dict(id=key, name=name) for row in output.splitlines() if "\t" in row
                for key, name in [row.split("\t", 1)]]
    if args.interrupt:
        return interrupt(str(args.interrupt))
    if args.configure:
        return send_message(str(args.configure), "", args.model, configure=True)
    if args.send:
        return send_message(str(args.send), args.message or "", args.model, slash_command=args.slash_command)
    if args.send_iterm:
        return send_terminal(str(args.send_iterm), args.message or "", slash_command=args.slash_command)
    if args.screen:
        return screen_status(str(args.screen))
    if args.session:
        path = session_transcript(str(args.session))
        if not path:
            sys.exit("找不到本机会话文件")
        return history(path, args.known_prefix, args.known_turns, args.known_last, args.known_source)
    files = transcripts()
    try:
        terminals = terminal_sessions()
    except (OSError, subprocess.TimeoutExpired):
        terminals = None
    sources = {root: workspace_dirs(root) for root in {path.parents[4] for path in files.values()}}
    children = {root: {**workflow_children(root), **subagent_metadata(root)} for root in sources}
    verification = {p.name for p in VERIFICATION_DIR.glob("agy-*")}
    sessions = []
    for sid, path in sorted(files.items(), key=lambda pair: pair[1].stat().st_mtime, reverse=True):
        dirs = sources[path.parents[4]].get(sid, [])
        child = children[path.parents[4]].get(sid)
        if child:
            if child["status"] != "stopped" and child.get("updated") and path.stat().st_mtime > datetime.fromisoformat(child["updated"]).timestamp():
                child["status"] = "done" if agy_acp.turn_finished(path) else "running"
            first = next(rows(path), {})
            child["createdAt"] = first.get("created_at")
            assignment = re.search(r"sender=" + re.escape(child["parent"]) + r" [^\n]*?content=([^\n]+)", first.get("content", ""))
            label = child.get("label") or (assignment[1][:120] if assignment else child["role"] or "Subagent")
        else:
            label = title(path, sid)
        owner_started = started = active_since(sid)
        if started:
            try:
                owner, turn = map(int, activity_file(sid).with_suffix(".turn").read_text().split())
                if owner == started:
                    started = turn
            except (OSError, ValueError):
                pass  # Older owners only publish their connection timestamp.
        queued = 0
        if started and not Path(agy_acp.endpoint(activity_file(sid))).exists():
            try:
                queued = max(0, int(activity_file(sid).with_suffix(".input-count").read_text()) - 1)
            except (OSError, ValueError):
                pass
        sessions.append(dict(verification=("agy-" + sid in verification), workingSince=started, cascadeWorking=summary_working(path) if owner_started or sid in (terminals or {}) else None, queuedInputs=queued, path=str(path), cwd=dirs[0] if dirs else "", workspaces=dirs,
                             tty=terminals.get(sid, "") if terminals is not None else None,
                             sessionId=sid, title=label, subagent=child,
                             updatedAt=datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat()))
    return {"sessions": sessions}


if __name__ == "__main__":
    try:
        payload = main()
        paged = os.environ.get("VIBING_PACK_HISTORY") == "2" and bool(payload.get("events"))
        result = "" if paged else json.dumps(payload, ensure_ascii=False)
        ticket = os.environ.get("VIBING_HISTORY_TOKEN", "")
        target = "/tmp/vibing-history-" + str(UUID(ticket)) + ".gz" if ticket else None
        if paged or target or (os.environ.get("VIBING_PACK_HISTORY") and len(result) > 128 * 1024):
            with tempfile.NamedTemporaryFile(dir="/tmp" if target else None, prefix="vibing-history-", suffix=".gz", delete=False) as snapshot:
                try:
                    with gzip.GzipFile(fileobj=snapshot, mode="wb", compresslevel=1) as stream:
                        if paged:
                            events = payload.pop("events")
                            stream.write((json.dumps(payload, ensure_ascii=False) + "\n").encode())
                            for event in events:
                                stream.write((json.dumps(event, ensure_ascii=False) + "\n").encode())
                        else:
                            stream.write(result.encode())
                    snapshot.flush()
                    if target:
                        os.replace(snapshot.name, target)
                    result = json.dumps({"historyFile": target or snapshot.name, "bytes": snapshot.tell()})
                except BaseException:
                    os.unlink(snapshot.name)
                    raise
        print(result)
    except OSError as exc:
        sys.exit(str(exc))
