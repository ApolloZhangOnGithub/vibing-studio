# 测试用：本机 127.0.0.1:<port> → sample server 的 unix socket（sfreerdp-server --local-only 只在 unix socket 上听）
import socket, sys, threading
SOCK, PORT = sys.argv[1], int(sys.argv[2])
srv = socket.socket()
srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(("127.0.0.1", PORT))
srv.listen(16)
print("listening", PORT, flush=True)


def pipe(a, b):
    try:
        while True:
            d = a.recv(65536)
            if not d:
                break
            b.sendall(d)
    except Exception:
        pass
    try:
        b.shutdown(socket.SHUT_WR)
    except Exception:
        pass


while True:
    c, _ = srv.accept()
    u = socket.socket(socket.AF_UNIX)
    try:
        u.connect(SOCK)
    except Exception as e:
        print("unix connect failed", e, flush=True)
        c.close()
        continue
    threading.Thread(target=pipe, args=(c, u), daemon=True).start()
    threading.Thread(target=pipe, args=(u, c), daemon=True).start()
