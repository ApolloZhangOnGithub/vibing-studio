# Claude Code 在这台 Mac 上最近几天的用量（设置 › 用量 › Claude Code 用）：直接读 ~/.claude/projects/**/*.jsonl 里 assistant 的每条回复
# （message.model + message.usage），按本地日期、模型加起来；会话数是那天有回复的会话（子 agent 的记录算进用量，不算会话）。
# 快：只读最近 DAYS 天改过的文件；每个文件记着读到哪（增量缓存 ~/Library/Application Support/Vibing Studio/cc-usage.json），
# 下次只读新写的部分。同一条回复在记录里有好几行（每个内容块一行，usage 一样）、分叉的会话会把旧回复抄一份：按 message.id 只算一次。
# 输出一行 JSON：{ days: { "2026-09-29": { model: [回复数, 输入, 输出, 缓存读取, 缓存写入] } }, sess: { day: [会话 id…] }, ms, read, files }
import calendar, json, os, re, sys, time

DAYS = 8
HOME = os.path.expanduser("~")
ROOT = os.path.join(HOME, ".claude", "projects")
CACHE = os.environ.get("CC_USAGE_CACHE") or os.path.join(HOME, "Library", "Application Support", "Vibing Studio", "cc-usage.json")
VER = 1
t0 = time.time()
now = time.time()
cut = time.strftime("%Y-%m-%d", time.localtime(now - (DAYS - 1) * 86400))

try:
    with open(CACHE) as f:
        C = json.load(f)
    if C.get("v") != VER:
        raise ValueError
except Exception:
    C = {"v": VER, "files": {}, "days": {}, "sess": {}, "seen": {}}
files, days, sess, seen = C["files"], C["days"], C["sess"], C["seen"]

memo = {}


def day_of(ts):  # "2026-09-29T03:42:03.253Z" → 本地日期
    k = ts[:16]
    d = memo.get(k)
    if d is None:
        try:
            d = time.strftime("%Y-%m-%d", time.localtime(calendar.timegm(time.strptime(k, "%Y-%m-%dT%H:%M"))))
        except Exception:
            d = ""
        memo[k] = d
    return d


NUM = {k: re.compile(b'"' + k + b'":(\\d+)') for k in (b"input_tokens", b"output_tokens", b"cache_read_input_tokens", b"cache_creation_input_tokens")}
nread = 0
live = set()
for dp, dn, fn in os.walk(ROOT):
    for name in fn:
        if not name.endswith(".jsonl"):
            continue
        p = os.path.join(dp, name)
        try:
            st = os.stat(p)
        except OSError:
            continue
        if st.st_mtime < now - DAYS * 86400:
            continue
        live.add(p)
        rec = files.get(p) or {"off": 0}
        off = rec["off"] if st.st_size >= rec["off"] else 0  # 变短了（被重写）：从头读；读过的回复按 id 不重复算
        if off == st.st_size:
            files[p] = {"off": off}
            continue
        top = "/subagents/" not in p
        sid = name[:-6]
        pos = off
        try:
            f = open(p, "rb")
            f.seek(off)
        except OSError:
            continue
        for line in f:  # 一行一行读（几百 MB 的记录也不一下子读进内存）
            if not line.endswith(b"\n"):
                break  # 最后半行（还在写）：下次再读
            pos += len(line)
            if b'"type":"assistant"' not in line:
                continue
            i = line.find(b'"message":{"model":"')
            if i < 0:
                continue
            j = line.find(b'"', i + 20)
            model = line[i + 20:j].decode("utf-8", "replace")
            if model == "<synthetic>":
                continue
            k = line.find(b'"id":"', j)
            if k < 0 or k > j + 40:
                continue
            e = line.find(b'"', k + 6)
            mid = line[k + 6:e].decode("utf-8", "replace")
            if mid in seen:
                continue
            ti = line.rfind(b'"timestamp":"')
            if ti < 0:
                continue
            d = day_of(line[ti + 13:ti + 40].decode("ascii", "replace"))
            if not d or d < cut:
                continue
            u = line.rfind(b'"usage":{"input_tokens":')
            if u < 0:
                continue
            s = line[u:u + 400]
            v = [0, 0, 0, 0]
            for n, key in enumerate((b"input_tokens", b"output_tokens", b"cache_read_input_tokens", b"cache_creation_input_tokens")):
                m = NUM[key].search(s)
                if m:
                    v[n] = int(m.group(1))
            seen[mid] = d
            a = days.setdefault(d, {}).setdefault(model, [0, 0, 0, 0, 0])
            a[0] += 1
            for n in range(4):
                a[n + 1] += v[n]
            if top:
                ss = sess.setdefault(d, [])
                if sid not in ss:
                    ss.append(sid)
        f.close()
        nread += pos - off
        files[p] = {"off": pos}

# 过了窗口的：日子、会话、见过的 id、不再改的文件都不要了（缓存不越长越大）
for d in [d for d in days if d < cut]:
    del days[d]
for d in [d for d in sess if d < cut]:
    del sess[d]
for m in [m for m, d in seen.items() if d < cut]:
    del seen[m]
for p in [p for p in files if p not in live]:
    del files[p]
try:
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    tmp = CACHE + ".tmp%d" % os.getpid()
    with open(tmp, "w") as f:
        json.dump(C, f)
    os.replace(tmp, CACHE)
except Exception:
    pass
json.dump({"days": days, "sess": sess, "ms": int((time.time() - t0) * 1000), "read": nread, "files": len(live)}, sys.stdout)
