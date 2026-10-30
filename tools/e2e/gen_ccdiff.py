# gen_ccdiff.py —— 测试用：一个短的 Claude Code 会话，里面有一次 Edit（diff：长行折好几行、红绿底），给选区的测试用（tests/seldiff.js）
#   python3 gen_ccdiff.py <家目录>
import json, os, sys, uuid, datetime
home = sys.argv[1]
sid = "5c0f1e2d-0000-4000-8000-0000000d1ff0"
cwd = "/tmp/seltest"
d = os.path.join(home, ".claude", "projects", "-tmp-seltest")
os.makedirs(d, exist_ok=True)
lines, parent, k = [], None, 0
def push(o):
    global parent, k
    o.update({"parentUuid": parent, "isSidechain": False, "userType": "external", "cwd": cwd, "sessionId": sid, "version": "2.1.281", "gitBranch": "main", "uuid": str(uuid.UUID(int=k + 1)), "timestamp": datetime.datetime.fromtimestamp(1790000000 + k * 30, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")})
    parent = o["uuid"]; k += 1
    lines.append(json.dumps(o, ensure_ascii=False))
old = '  var SET_DEF = { guiDetail: "standard", mdLineNumbers: false, linkOpen: "builtin", chatWidth: "efficient", agentNotify: "done", lang: "auto", ui: "tui", os: "vscode", devFeatures: false, claudeTheme: "system", claudeChatFont: "system" };'
new = '  var SET_DEF = { blankPage: "new", guiDetail: "standard", mdLineNumbers: false, linkOpen: "builtin", chatWidth: "efficient", agentNotify: "done", lang: "auto", ui: "tui", os: "vscode" };'
before = ["  // 设置的默认值", "  //   不要状态栏 / 缩略图 / 路径导航。"]
after = ["  var SET = {};", "  var getv = function (k) { return SET[k]; };"]
push({"type": "user", "message": {"role": "user", "content": "改一下默认值"}})
tid = "toolu_seldiff_1"
push({"type": "assistant", "message": {"id": "msg_sd_1", "type": "message", "role": "assistant", "model": "claude-opus-5-5", "content": [{"type": "tool_use", "id": tid, "name": "Edit", "input": {"file_path": cwd + "/studio.js", "old_string": old, "new_string": new}}], "stop_reason": "tool_use", "usage": {"input_tokens": 100, "output_tokens": 50}}})
patch = [{"oldStart": 3600, "oldLines": 5, "newStart": 3600, "newLines": 5, "lines": [" " + x for x in before] + ["-" + old, "+" + new] + [" " + x for x in after]}]
push({"type": "user", "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": tid, "content": "The file has been updated.", "is_error": False}]}, "toolUseResult": {"filePath": cwd + "/studio.js", "oldString": old, "newString": new, "originalFile": "", "structuredPatch": patch, "userModified": False, "replaceAll": False}})
push({"type": "assistant", "message": {"id": "msg_sd_2", "type": "message", "role": "assistant", "model": "claude-opus-5-5", "content": [{"type": "text", "text": "改好了。"}], "stop_reason": "end_turn", "usage": {"input_tokens": 100, "output_tokens": 10}}})
open(os.path.join(d, sid + ".jsonl"), "w").write("\n".join(lines) + "\n")
print(sid)
