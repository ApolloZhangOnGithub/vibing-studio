import json, sys, base64
name = sys.argv[1]
d = json.load(open(name + ".json"))
p = d.get("page") or d
print("errs", p.get("errs"))
for k, g in (p.get("geo") or {}).items(): print(k, json.dumps(g))
for k, u in (p.get("shots") or {}).items():
    if isinstance(u, str) and u.startswith("data:"):
        open(f"{name}-{k}.jpg", "wb").write(base64.b64decode(u.split(",", 1)[1])); print("wrote", f"{name}-{k}.jpg")
