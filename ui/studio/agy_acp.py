"""Keep one ACP session available while its background tools are alive."""
import asyncio
import base64
import contextlib
import fcntl
import json
import mimetypes
import os
from pathlib import Path
import re
import socket
import sys
import time


def endpoint(marker):
    folder = Path("/tmp") / f"vibing-agy-{os.getuid()}"
    folder.mkdir(mode=0o700, exist_ok=True)
    if folder.is_symlink() or folder.stat().st_uid != os.getuid() or folder.stat().st_mode & 0o077:
        raise PermissionError("agy 会话通信目录权限无效")
    return str(folder / marker.name)


def exchange(marker, request):
    with socket.socket(socket.AF_UNIX) as conn:
        try:
            conn.connect(endpoint(marker))
        except (FileNotFoundError, ConnectionRefusedError):
            return None
        conn.sendall((json.dumps(request) + "\n").encode())
        with conn.makefile("rb") as stream:
            for line in stream:
                event = json.loads(line)
                if "error" in event:
                    sys.exit(event["error"])
                if "result" in event:
                    return event["result"]
                print(json.dumps(event), flush=True)
        sys.exit("agy 连接已关闭，请检查会话记录")


def prompt_parts(message):
    parts = [{"type": "text", "text": message}]
    for match in re.finditer(r'@("(?:[^"\\]|\\.)*")', message):
        path = Path(json.loads(match[1]))
        mime = mimetypes.guess_type(path.name)[0]
        if path.is_absolute() and mime and mime.startswith("image/") and path.is_file():
            parts.append({"type": "image", "mimeType": mime, "data": base64.b64encode(path.read_bytes()).decode()})
    return parts


def turn_finished(transcript):
    if not transcript:
        return False
    with transcript.open("rb") as stream:
        stream.seek(0, os.SEEK_END)
        end = stream.tell()
        size = 4096
        while end:
            start = max(0, end - size)
            stream.seek(start)
            lines = stream.read().rstrip().splitlines()
            if lines and (not start or len(lines) > 1):
                try:
                    row = json.loads(lines[-1])
                except ValueError:
                    return False
                return (row.get("type") == "PLANNER_RESPONSE" and row.get("status") == "DONE"
                        and bool(row.get("content")) and not row.get("tool_calls"))
            if not start:
                break
            size *= 2
    return False


async def serve(marker, cwd, transcript):
    sid = marker.name
    marker.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with marker.open("a+") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        lock.seek(0)
        lock.truncate()
        lock.write(str(int(time.time() * 1000)) + "\nacp")
        lock.flush()
        proc = await asyncio.create_subprocess_exec("agy", "acp", cwd=cwd, stdin=-1, stdout=-1, limit=32 << 20)
        outstanding = {}
        background = set()
        serial = asyncio.Lock()
        active_prompts = set()
        current = None
        loaded = False
        clients = 0
        sequence = 0
        last_activity = time.monotonic()

        def send(packet):
            proc.stdin.write((json.dumps({"jsonrpc": "2.0", **packet}) + "\n").encode())

        async def rpc(method, params):
            nonlocal sequence
            sequence += 1
            key = sequence
            future = asyncio.get_running_loop().create_future()
            outstanding[key] = future
            try:
                send({"id": key, "method": method, "params": params})
                return await future
            finally:
                outstanding.pop(key, None)

        def emit(writer, packet):
            if writer and not writer.is_closing():
                writer.write((json.dumps(packet) + "\n").encode())

        async def receive():
            nonlocal last_activity
            try:
                async for line in proc.stdout:
                    packet = json.loads(line)
                    last_activity = time.monotonic()
                    key = packet.get("id")
                    if "method" in packet and key is not None:
                        if packet["method"] == "session/request_permission":
                            send({"id":key, "result":{"outcome":{"outcome":"cancelled"}}})
                        else:
                            send({"id":key, "error":{"code":-32601, "message":"Unsupported client capability"}})
                    elif key in outstanding:
                        f = outstanding[key]
                        if not f.done():
                            if "error" in packet:
                                f.set_exception(RuntimeError(packet["error"].get("message", "ACP error")))
                            else:
                                f.set_result(packet.get("result", {}))
                    elif packet.get("method") == "session/update" and loaded:
                        update = packet["params"]["update"]
                        kind = update.get("sessionUpdate")
                        if kind in ("tool_call", "tool_call_update"):
                            tool = update.get("toolCallId")
                            if update.get("status") in ("completed", "failed", "cancelled"):
                                background.discard(tool)
                            elif tool:
                                background.add(tool)
                        if current and kind in ("agent_message_chunk", "agent_thought_chunk"):
                            text = update.get("content", {}).get("text", "")
                            emit(current, {"thinking":kind == "agent_thought_chunk", "step":"acp", "delta":text})
            finally:
                for future in outstanding.values():
                    if not future.done():
                        future.set_exception(RuntimeError("agy ACP 已退出"))

        async def handle(reader, writer):
            nonlocal clients, current, loaded, last_activity
            clients += 1
            try:
                request = json.loads(await reader.readline())
                if request.get("interrupt"):
                    send({"method":"session/cancel", "params":{"sessionId":sid}})
                    emit(writer, {"result":{"interrupted":True}})
                else:
                    async with serial:
                        if not loaded:
                            await rpc("initialize", {"protocolVersion":1, "clientCapabilities":{}})
                            await rpc("session/resume", {"sessionId":sid, "cwd":cwd, "mcpServers":[]})
                            loaded = True
                        if request.get("model") and not active_prompts:
                            await rpc("session/set_model", {"sessionId":sid, "modelId":request["model"]})
                        # ACP updates identify the session, not the originating prompt.
                        # During steering the transcript supplies authoritative turn ownership.
                        current = None if active_prompts else writer
                        active_prompts.add(writer)
                    try:
                        await rpc("session/prompt", {"sessionId":sid, "prompt":prompt_parts(request["message"])})
                        emit(writer, {"result":{"sent":True}})
                    finally:
                        active_prompts.discard(writer)
                        if current is writer:
                            current = None
            except Exception as error:
                emit(writer, {"error":str(error)})
            finally:
                clients -= 1
                last_activity = time.monotonic()
                writer.close()
                with contextlib.suppress(ConnectionError):
                    await writer.wait_closed()

        address = Path(endpoint(marker))
        address.unlink(missing_ok=True)
        pump = asyncio.create_task(receive())
        try:
            async with await asyncio.start_unix_server(handle, path=str(address), limit=32 << 20):
                while not pump.done():
                    await asyncio.sleep(1)
                    if not clients and not background and time.monotonic() - last_activity > 20:
                        if not loaded or turn_finished(transcript):
                            break
                        last_activity = time.monotonic()
        finally:
            address.unlink(missing_ok=True)
            proc.stdin.close()
            try:
                await asyncio.wait_for(proc.wait(), 3)
            except asyncio.TimeoutError:
                proc.terminate()
                await proc.wait()
            await pump
