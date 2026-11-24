"""Read committed messages from local DeepSeek Harness v4 sessions."""
import difflib
import json
import os
from pathlib import Path
import subprocess
import sys
from contextlib import contextmanager

ROOT = Path(os.environ.get("DSH_HOME") or Path.home() / ".dsh") / "sessions"


@contextmanager
def records(path, *, complete=False):
    with subprocess.Popen(["zstd", "-qdc", "--", str(path)], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL) as proc:
        try:
            yield (json.loads(line) for line in proc.stdout if line.strip())
            if complete and proc.wait() != 0:
                raise OSError("DSH 会话记录解压不完整")
        finally:
            proc.stdout.close()


def list_sessions(paths):
    try:
        index = json.loads((Path.home() / ".dsh-tui/session-index.json").read_text())["entries"]
    except (OSError, ValueError, KeyError):
        index = {}
    try:
        state = json.loads((ROOT.parent / "storages/workspace.json").read_text())
    except FileNotFoundError:
        state = {}
    archived = set(state.get("global", {}).get("archivedSessionIds", []))
    workspaces = {sid: ws for ws in state.get("tables", {}).get("workspaces", {}).values()
                  for sid in ws.get("sessionIds", [])}
    sessions = []
    for path in paths:
        try:
            with records(path) as rows:
                header = next(rows)
            sid = path.parent.name
            meta = index.get(sid, {}).get("derived", {})
            workspace = workspaces.get(sid, {})
            title = meta.get("label") or meta.get("title")
            projection = ROOT.parent / "storages/session_projcache/sessions" / (sid + ".json")
            try:
                rows = json.loads(projection.read_text())["record"]["rows"]
            except (FileNotFoundError, ValueError, KeyError):
                rows = {}
            title = rows.get("title", {}).get("val") or title
            if state.get("global", {}).get("initialized") and sid not in workspaces and sid not in archived:
                continue
            has_prompt = False
            if not title and sid not in archived:
                with records(path) as events:
                    for event in events:
                        if event.get("type") == "user/message" and event.get("data", {}).get("source", {}).get("kind", "user") == "user":
                            has_prompt = True
                        if event.get("type") == "session/title":
                            title = event.get("data", {}).get("title") or title
                if not title and sid not in workspaces:
                    continue
            empty_draft = not title and not has_prompt and sid not in archived
            title = title or "新会话"
            selection = (rows.get("modelSelection", {}).get("val") or {}).get("lastUsed") or {}
            model = selection.get("model") or meta.get("model", "")
            if selection.get("provider") == "deepseek-account" and model == "deepseek-flash":
                model = "DeepSeek-V4.1-Flash"
            sessions.append(dict(id=sid, path=str(path), cwd=header.get("cwd") or workspace.get("path", ""), title=title,
                                 workspace=workspace.get("title", ""), archived=sid in archived,
                                 model=model, selection=selection, emptyDraft=empty_draft, updated=path.stat().st_mtime * 1000))
        except (OSError, ValueError, KeyError, StopIteration):
            continue
    folders = state.get("tables", {}).get("workspaces", {})
    return {"sessions": sorted(sessions, key=lambda s: s["updated"], reverse=True),
            "workspaces": [{"id": key, "path": ws["path"], "title": ws["title"]} for key, ws in folders.items()]}


def transcript(path):
    turns = []
    calls = {}
    started_at = None
    effort = ""
    progress = {"turn": 0, "steps": 0, "phase": ""}
    with records(path, complete=True) as rows:
        for event in rows:
            kind = event.get("type")
            if kind == "turn/start":
                progress["turn"] = event.get("data", {}).get("turn", progress["turn"] + 1)
                started_at = event.get("time")
                progress["startedAt"] = started_at
                progress["phase"] = "running"
            elif kind == "turn/end":
                progress["phase"] = (event.get("data", {}).get("reason") or {}).get("kind", "ended")
                ended_at = event.get("time")
                if (progress["phase"] == "completed" and turns and isinstance(started_at, int)
                        and isinstance(ended_at, int) and ended_at >= started_at):
                    turns[-1]["stats"] = {"ms": ended_at - started_at, "at": ended_at}
                started_at = None
            elif kind == "step/start":
                progress["steps"] += 1
            if kind == "request/header":
                effort = event.get("data", {}).get("header", {}).get("config", {}).get("reasoningEffort", "")
            data = event.get("data", {})
            msg = data.get("message", data)
            content = msg.get("content", [])
            blocks = [{"type": "text", "text": content}] if isinstance(content, str) else content
            text = "".join(b.get("text", "") for b in blocks if b.get("type") == "text")
            if kind == "user/message" and data.get("source", {}).get("kind", "user") == "user":
                turns.append(dict(ask=text, at=event.get("time"), parts=[]))
                continue
            if not turns:
                continue
            parts = turns[-1]["parts"]
            if kind == "assistant/message":
                starts, ends = {}, {}
                for item in data.get("stream") or []:
                    chunk = item.get("chunk") or {}
                    if chunk.get("type") == "block-start" and chunk.get("blockType") == "reasoning":
                        starts[chunk.get("index")] = item.get("time")
                    elif chunk.get("type") == "block-end":
                        ends[chunk.get("index")] = item.get("time")
                for index, block in enumerate(blocks):
                    if block.get("type") == "reasoning" and block.get("text"):
                        part = dict(kind="thinking", text=block["text"])
                        start, end = starts.get(index), ends.get(index)
                        if isinstance(start, int) and isinstance(end, int) and end >= start:
                            part["seconds"] = round((end - start) / 1000, 1)
                        parts.append(part)
                    elif block.get("type") == "text" and block.get("text"):
                        parts.append(dict(kind="text", text=block["text"], whole=True))
            elif kind == "user/message":
                source = data.get("source", {}).get("kind", "")
                parts.append(dict(kind="tool", name="Context Injection", input={"description": source},
                                  status="done", detail=text.splitlines()))
            elif kind == "tool/call":
                args = data.get("arguments", {})
                if isinstance(args, str):
                    try:
                        args = json.loads(args)
                    except ValueError:
                        args = {"description": args}
                name = data.get("name", "Tool")
                tool = dict(kind="tool", id=data.get("callId"), name={"bash": "Bash", "read": "Read", "edit": "Edit", "glob": "Glob", "grep": "Grep", "web_fetch": "WebFetch"}.get(name, name),
                            input=args if isinstance(args, dict) else {}, status="running")
                calls[tool["id"]] = tool
                parts.append(tool)
            elif kind == "tool/result":
                tool = calls.get(msg.get("toolCallId"))
                if tool:
                    tool["status"] = "error" if msg.get("isError") else "done"
                    tool["detail"] = text.splitlines()
                    if tool["name"] == "Edit" and tool["status"] == "done":
                        args = tool["input"]
                        old, new = args.get("old_string"), args.get("new_string")
                        if isinstance(old, str) and isinstance(new, str):
                            changes = difflib.unified_diff(old.splitlines(True), new.splitlines(True), n=3)
                            diff = []
                            for line in list(changes)[2:]:
                                if line.startswith("@@"):
                                    if diff:
                                        diff.append({"t": "…"})
                                else:
                                    diff.append({"t": line[0], "l": line[1:].rstrip("\r\n")})
                            if diff:
                                tool["diff"] = diff
                    if msg.get("isError"):
                        tool["error"] = text.splitlines()[0] if text else "DSH 工具执行失败"
    projection = ROOT.parent / "storages/session_projcache/sessions" / (path.parent.name + ".json")
    try:
        rows = json.loads(projection.read_text())["record"]["rows"]
    except (OSError, ValueError, KeyError):
        rows = {}
    progress["stats"] = rows.get("sessionStats", {}).get("val", {})
    progress["usage"] = rows.get("tokenUsage", {}).get("val", {}).get("totals", {})
    progress["breakdown"] = rows.get("contextBreakdown", {}).get("val", {}).get("breakdown", {})
    progress["pressure"] = rows.get("contextPressure", {}).get("val", {})
    return {"turns": turns, "progress": progress, "effort": effort if isinstance(effort, str) else ""}


if __name__ == "__main__":
    paths = []
    for folder in ROOT.glob("*/*"):
        for name in ("session.v4.jsonl.zstd", "session.jsonl.zstd"):
            path = folder / name
            if path.is_file() and path.stat().st_size:
                paths.append(path)
                break
    if len(sys.argv) == 1:
        result = list_sessions(paths)
    else:
        path = next((p for p in paths if p.parent.name == sys.argv[1]), None)
        if path is None:
            sys.exit("找不到 DSH 会话")
        result = transcript(path)
    print(json.dumps(result, ensure_ascii=False))
