"""Open a notebook on Studio's loopback JupyterLab server for its directory."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import sys
import time
from urllib.parse import quote
from urllib.request import ProxyHandler, Request, build_opener


def ready(base, token):
    try:
        req = Request(base + "/api/status", headers={"Authorization": "token " + token})
        with build_opener(ProxyHandler({})).open(req, timeout=1) as response:
            return "kernels" in json.load(response)
    except (OSError, ValueError):
        return False


def open_lab(path):
    path = path.resolve(strict=True)
    key = hashlib.sha256(os.fsencode(path.parent)).hexdigest()
    runtime = Path.home() / "Library/Caches/Vibing Studio/jupyterlab" / key
    runtime.mkdir(mode=0o700, parents=True, exist_ok=True)
    state = runtime / "server.json"
    with (runtime / "lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if state.exists():
            base, token = json.loads(state.read_text())
            if ready(base, token):
                return base + "/lab/tree/" + quote(path.name) + "?token=" + token
        lab = shutil.which("jupyter-lab")
        if not lab:
            raise RuntimeError("当前环境找不到 jupyter-lab")
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        base = f"http://127.0.0.1:{port}"
        token = secrets.token_hex(32)
        env = dict(os.environ, JUPYTER_TOKEN=token)
        with (runtime / "server.log").open("w") as log:
            proc = subprocess.Popen([lab, "--no-browser", "--ip=127.0.0.1", f"--port={port}",
                                     "--ServerApp.port_retries=0", "--ServerApp.shutdown_no_activity_timeout=900",
                                     "--MappingKernelManager.cull_idle_timeout=3600",
                                     "--MappingKernelManager.cull_connected=False"],
                                    cwd=path.parent, env=env, stdin=subprocess.DEVNULL,
                                    stdout=log, stderr=log, start_new_session=True)
        for _ in range(120):
            if proc.poll() is not None:
                raise RuntimeError(f"JupyterLab 启动失败，见 {runtime / 'server.log'}")
            if ready(base, token):
                tmp = state.with_suffix(".tmp")
                tmp.write_text(json.dumps([base, token]))
                tmp.replace(state)
                return base + "/lab/tree/" + quote(path.name) + "?token=" + token
            time.sleep(.2)
        proc.terminate()
        raise RuntimeError("JupyterLab 启动超时")


if __name__ == "__main__":
    try:
        print(open_lab(Path(sys.argv[1])))
    except (RuntimeError, OSError, ValueError) as exc:
        sys.exit(str(exc))
