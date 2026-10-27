# gen_cc.py —— 测试用：在假的家目录里造一个很长的 Claude Code 会话（同 2.1.281 写的格式），给滚动测试用。
#   python3 gen_cc.py <家目录> [问数]   → <家目录>/.claude/projects/-tmp-scrolltest/<会话 id>.jsonl，打印会话 id
#   每一问：你说的一两句、几次工具调用（Bash、Read，带几十行输出）、一段带代码块的 Markdown 回答——一问大约 20 KB，默认 600 问（约 12 MB，比一次读进来的 3 MB 多好几倍）
import json, os, sys, uuid, random

home = sys.argv[1]
n = int(sys.argv[2]) if len(sys.argv) > 2 else 600
random.seed(7)
sid = "5c0f1e2d-0000-4000-8000-00000000abcd"
cwd = "/tmp/scrolltest"
d = os.path.join(home, ".claude", "projects", "-tmp-scrolltest")
os.makedirs(d, exist_ok=True)
words = "render layout scroll buffer terminal session history block frame paint chunk parser module window pane tab sidebar status agent tool result output".split()
def sentence(k): return " ".join(random.choice(words) for _ in range(k)).capitalize() + "."
t0 = 1790000000.0
import datetime
def ts(i): return datetime.datetime.fromtimestamp(t0 + i * 37, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
lines, parent, k = [], None, 0
def push(o):
    global parent, k
    o.update({"parentUuid": parent, "isSidechain": False, "userType": "external", "cwd": cwd, "sessionId": sid, "version": "2.1.281", "gitBranch": "main", "uuid": str(uuid.UUID(int=random.getrandbits(128))), "timestamp": ts(k)})
    parent = o["uuid"]; k += 1
    lines.append(json.dumps(o, ensure_ascii=False))
for i in range(n):
    push({"type": "user", "message": {"role": "user", "content": "第 %d 问：%s %s" % (i + 1, sentence(8), sentence(6))}})
    for j in range(random.randint(2, 4)):
        tid = "toolu_%06d_%d" % (i, j)
        if j % 2 == 0:
            inp, name = {"command": "ls -la src/%s && wc -l src/%s/*.js" % (random.choice(words), random.choice(words)), "description": sentence(4)}, "Bash"
            out = "\n".join("-rw-r--r--  1 user  staff  %6d Oct %2d 12:%02d %s_%d.js" % (random.randint(100, 99999), random.randint(1, 28), random.randint(0, 59), random.choice(words), x) for x in range(random.randint(20, 50)))
        else:
            inp, name = {"file_path": "%s/src/%s.js" % (cwd, random.choice(words))}, "Read"
            out = "\n".join("%6d\t  var %s = %s(%d); // %s" % (x + 1, random.choice(words), random.choice(words), x, sentence(5)) for x in range(random.randint(20, 60)))
        push({"type": "assistant", "message": {"id": "msg_%06d_%d" % (i, j), "type": "message", "role": "assistant", "model": "claude-opus-5-5", "content": [{"type": "tool_use", "id": tid, "name": name, "input": inp}], "stop_reason": "tool_use", "usage": {"input_tokens": 1200, "output_tokens": 80}}})
        push({"type": "user", "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": tid, "content": out, "is_error": False}]}, "toolUseResult": {"stdout": out, "stderr": "", "interrupted": False}})
    body = "\n\n".join([sentence(14) + " " + sentence(12), "- " + sentence(7) + "\n- " + sentence(9) + "\n- " + sentence(6), "```js\n" + "\n".join("const %s = %s(%d);" % (random.choice(words), random.choice(words), x) for x in range(8)) + "\n```", sentence(16)])
    push({"type": "assistant", "message": {"id": "msg_%06d_t" % i, "type": "message", "role": "assistant", "model": "claude-opus-5-5", "content": [{"type": "text", "text": body}], "stop_reason": "end_turn", "usage": {"input_tokens": 1500, "output_tokens": 400}}})
f = os.path.join(d, sid + ".jsonl")
open(f, "w").write("\n".join(lines) + "\n")
print(sid, os.path.getsize(f))
