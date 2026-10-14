# 测试用：一个接了 TCP 连接就不吭声的端口（像握手卡住的远程桌面）
import socket
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(("127.0.0.1", 33977))
s.listen(16)
held = []
while True:
    c, _ = s.accept()
    held.append(c)  # 不读不写，一直拿着
