"""Submit one text message to the local DSH host plugin."""
import fcntl
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

def find_cli():
    cli = shutil.which("dsh")
    if sys.platform == "darwin":
        location = subprocess.run(["osascript", "-e", 'POSIX path of (path to application id "com.deepseek.dsh")'],
                                  capture_output=True, text=True)
        if location.returncode == 0:
            bundled = Path(location.stdout.strip()) / "Contents/Resources/runtime/cli/bin/dsh"
            if bundled.is_file():
                cli = str(bundled)
    if not cli:
        raise ValueError("请先安装 DeepSeek Harness")
    return cli


def install_connector():
    cli = find_cli()
    if sys.platform == "darwin":
        running = subprocess.run(["osascript", "-e", 'application id "com.deepseek.dsh" is running'],
                                 capture_output=True, text=True)
        if running.stdout.strip() == "true":
            raise ValueError("请先退出 DeepSeek Harness，再点击连接桌面端。")
    package = Path(__file__).resolve().with_name("dsh-connector")
    for profile in ("desktop", "web"):
        subprocess.run([cli, "plugin", "--profile", profile, "add", "link:" + str(package)], check=True)


def configured(home, profile):
    package = home / "profiles" / profile / "package.json"
    return package.exists() and "@vibing-studio/dsh-connector" in json.loads(package.read_text()).get("dependencies", {})


def session_owner(home, session_id):
    if not session_id or not re.fullmatch(r"session-[0-9a-f-]{36}", session_id):
        return None
    lock = next((home / "sessions").glob("*/" + session_id + "/session.lock"), None)
    if lock is None:
        return None
    result = subprocess.run(["/usr/sbin/lsof", "-Fpa", str(lock)], capture_output=True, text=True)
    pid = None
    for line in result.stdout.splitlines():
        if line.startswith("p"):
            pid = line[1:]
        elif line in ("aw", "au") and pid and pid.isdigit():
            return pid
    return None


def connect_host(directory, settings=False, owner=None):
    # Prefer the desktop host when both the desktop and Studio's background host exist.
    for path in sorted(directory.glob("*.sock.balance" if settings and settings.get("action") == "balance" else "*.sock"), key=lambda p: (p.name.startswith("studio-"), -p.stat().st_mtime if settings else 0)):
        if owner and path.stem not in (owner, "studio-" + owner):
            continue
        client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        client.settimeout(18)
        try:
            client.connect(str(path))
            return client
        except (ConnectionRefusedError, FileNotFoundError):
            client.close()


def deliver(session_id, request_id, text, create=False, settings=None):
    home = Path(os.environ.get("DSH_HOME") or Path.home() / ".dsh")
    directory = home / "vibing-studio-ipc"
    directory.mkdir(mode=0o700, exist_ok=True)
    with (directory / "startup.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        target = settings.get("selection", {}).get("sessionId") if settings else session_id
        owner = session_owner(home, target)
        client = connect_host(directory, settings, owner)
        if owner and not client:
            raise ValueError("持有此会话的 DSH 尚未连接 Studio。请在该 DSH 中加载连接器。")
        if not client:
            if not configured(home, "web") and configured(home, "desktop"):
                package = Path(__file__).resolve().with_name("dsh-connector")
                subprocess.run([find_cli(), "plugin", "--profile", "web", "add", "link:" + str(package)], check=True)
            if not configured(home, "web"):
                if create or settings:
                    raise ValueError("请先在连接器设置中连接 DSH")
                fcntl.flock(lock, fcntl.LOCK_UN)
                result = subprocess.run([find_cli(), "headless", "--session-id", session_id, "--", "-"],
                                        input=text, text=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
                if not result.returncode:
                    return
                if "one-shot runner does not compose" not in result.stderr:
                    raise ValueError(result.stderr.strip() or "DSH 未确认接收")
                raise ValueError("请先在 Studio 设置 → 连接器 → DeepSeek Harness 中连接桌面端")
            proc = subprocess.Popen([find_cli(), "web", "--host", "127.0.0.1", "--port", "0", "--no-open"],
                                    stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                    start_new_session=True, env={**os.environ, "VIBING_DSH_BACKGROUND": "1"})
            for _ in range(150):
                client = connect_host(directory, settings)
                if client or proc.poll() is not None:
                    break
                time.sleep(0.1)
            if not client:
                if proc.poll() is None:
                    proc.terminate()
                raise ValueError("DSH 后台服务没有就绪，请检查 web 配置中的连接器")
    with client:
        client.sendall(json.dumps(settings or ({"action": "create", "workspaceId": session_id} if create else dict(sessionId=session_id, requestId=request_id, text=text)), ensure_ascii=False).encode())
        client.shutdown(socket.SHUT_WR)
        with client.makefile("r", encoding="utf-8") as response:
            receipt = json.load(response)
        if (create or settings) and receipt.get("error") == "无效的 DSH 消息":
            raise ValueError("当前 DSH 进程使用旧版连接器。请在会话工作结束后重新启动该 DSH 服务以启用模型切换。")
        if receipt.get("accepted") is not True:
            raise ValueError(receipt.get("error") or "DSH 未确认接收")

        if settings:
            print(json.dumps(receipt["value"]))
        elif create:
            print(receipt["sessionId"])

if __name__ == "__main__":
    try:
        if sys.argv[1:] == ["--install"]:
            install_connector()
        elif sys.argv[1:] == ["--balance"]:
            deliver(None, None, None, settings={"action": "balance"})
        elif sys.argv[1:2] == ["--catalog"]:
            deliver(None, None, None, settings={"action": "catalog"})
        elif sys.argv[1:2] == ["--select-model"]:
            deliver(None, None, None, settings={"action": "selectModel", "selection": json.loads(sys.argv[2])})
        elif sys.argv[1:2] == ["--create"]:
            deliver(sys.argv[2], None, None, create=True)
        else:
            deliver(*sys.argv[1:], sys.stdin.read())
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        sys.exit(str(error))
