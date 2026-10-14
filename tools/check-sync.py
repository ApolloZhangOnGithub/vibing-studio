#!/usr/bin/env python3
# 两份要一样的东西有没有分叉：换版本的那几步（原生 app/Sources/AppUpdate.swift 的 installLines、tidyLines ↔ 页面 ui/studio/studio.js 的 INSTALL_SH、TIDY_SH）。
#   tools/deploy.sh 发布前跑；不一样就不发（同一台 Mac 上原生换、页面换，结果得一样）
import json, os, re, sys
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
swift = open(os.path.join(HERE, "app/Sources/AppUpdate.swift"), encoding="utf-8").read()
js = open(os.path.join(HERE, "ui/studio/studio.js"), encoding="utf-8").read()
def swift_list(name):
    i = swift.index("static let %s = [" % name)
    blk = swift[i:swift.index("\n  ]\n", i)]
    return [l.replace('\\"', '"').replace("\\\\", "\\") for l in re.findall(r'^\s*"(.*)",\s*(?://.*)?$', blk, re.M)]
def js_list(name):
    m = re.search(r"var %s = (\[.*?\]);\n" % name, js, re.S)
    return json.loads(m.group(1)) if m else None
bad = []
for s_name, j_name in (("installLines", "INSTALL_SH"), ("tidyLines", "TIDY_SH")):
    a, b = swift_list(s_name), js_list(j_name)
    if a != b: bad.append("%s ≠ %s" % (s_name, j_name))
if bad:
    print("check-sync: out of sync: " + ", ".join(bad) + " (copy the Swift lines into ui/studio/studio.js)", file=sys.stderr); sys.exit(1)
print("check-sync: OK")
