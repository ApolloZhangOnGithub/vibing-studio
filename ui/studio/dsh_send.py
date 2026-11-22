"""Submit one text message to the local DSH host plugin."""
import json
import socket
import subprocess
import sys
from pathlib import Path

def deliver(session_id, request_id, text):
    hosts = []
    for path in (Path.home() / ".dsh/vibing-studio-ipc").glob("*.sock"):
        client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        client.settimeout(18)
        try:
            client.connect(str(path))
        except (ConnectionRefusedError, FileNotFoundError):
            client.close()
            continue
        hosts.append(client)
    try:
        if not hosts:
            result = subprocess.run(["dsh", "headless", "--session-id", session_id, "--", "-"],
                                    input=text, text=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            if result.returncode:
                if "one-shot runner does not compose" in result.stderr:
                    raise ValueError("DSH headless 不支持这条会话的预设；桌面端当前未连接")
                raise ValueError(result.stderr.strip() or "DSH 未确认接收")
            return
        if len(hosts) != 1:
            raise ValueError("检测到多个 DSH 连接器实例，无法确定目标")
        client = hosts[0]
        client.sendall(json.dumps(dict(sessionId=session_id, requestId=request_id, text=text), ensure_ascii=False).encode())
        client.shutdown(socket.SHUT_WR)
        with client.makefile("r", encoding="utf-8") as response:
            receipt = json.load(response)
        if receipt.get("accepted") is not True:
            raise ValueError(receipt.get("error") or "DSH 未确认接收")
    finally:
        for client in hosts:
            client.close()

if __name__ == "__main__":
    try:
        deliver(*sys.argv[1:], sys.stdin.read())
    except (ValueError, OSError) as error:
        sys.exit(str(error))
