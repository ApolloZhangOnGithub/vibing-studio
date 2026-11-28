"""Serve a single open video to the local Studio player until its input pipe closes."""

import os
import re
import secrets
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def main(path, content_type):
    fd = os.open(path, os.O_RDONLY)
    size = os.fstat(fd).st_size
    resource = "/" + secrets.token_urlsafe(32)

    class Video(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_HEAD(self):
            self.serve(False)

        def do_GET(self):
            self.serve(True)

        def serve(self, send_body):
            if self.path != resource:
                self.send_error(404)
                return
            start, end = 0, size - 1
            requested = self.headers.get("Range")
            if requested:
                match = re.fullmatch(r"bytes=(\d*)-(\d*)", requested)
                if match and any(match.groups()):
                    first, last = match.groups()
                    if first:
                        start = int(first)
                        if last:
                            end = min(end, int(last))
                    else:
                        start = max(0, size - int(last))
                else:
                    start = size
                if start > end:
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{size}")
                    self.end_headers()
                    return
            self.send_response(206 if requested else 200)
            self.send_header("Content-Type", content_type)
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", str(end - start + 1))
            self.send_header("Cache-Control", "no-store")
            if requested:
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.end_headers()
            try:
                while send_body and start <= end:
                    block = os.pread(fd, min(262144, end - start + 1), start)
                    if not block:
                        break
                    self.wfile.write(block)
                    start += len(block)
            except (BrokenPipeError, ConnectionResetError):
                pass  # Seeking cancels the previous range request.

    with ThreadingHTTPServer(("127.0.0.1", 0), Video) as server:
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        print(f"http://127.0.0.1:{server.server_port}{resource}", flush=True)
        try:
            sys.stdin.buffer.read()
        finally:
            server.shutdown()
            os.close(fd)


if __name__ == "__main__":
    main(*sys.argv[1:])
