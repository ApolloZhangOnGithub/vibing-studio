import Cocoa

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data(message.utf8))
    exit(1)
}
func attribute(_ element: AXUIElement, _ key: String) -> CFTypeRef? {
    var value: CFTypeRef?
    AXUIElementCopyAttributeValue(element, key as CFString, &value)
    return value
}
func descendants(_ element: AXUIElement, matching predicate: (AXUIElement) -> Bool) -> [AXUIElement] {
    var matches = predicate(element) ? [element] : []
    for child in attribute(element, "AXChildren") as? [AXUIElement] ?? [] {
        matches += descendants(child, matching: predicate)
    }
    return matches
}
func value(_ element: AXUIElement) -> String? { attribute(element, "AXValue") as? String }
guard CommandLine.arguments.count == 2,
      let text = String(data: FileHandle.standardInput.readDataToEndOfFile(), encoding: .utf8),
      !text.isEmpty else { fail("缺少消息或会话名称") }
guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: "com.deepseek.dsh").first else {
    fail("请在 DeepSeek Harness 打开这条会话后重试")
}
guard AXIsProcessTrusted() else { fail("请在系统设置的辅助功能中允许 Vibing Studio 操作 DSH") }
let root = AXUIElementCreateApplication(app.processIdentifier)
AXUIElementSetAttributeValue(root, "AXManualAccessibility" as CFString, kCFBooleanTrue)
let title = CommandLine.arguments[1] + " — DeepSeek Harness"
let windows = (attribute(root, "AXWindows") as? [AXUIElement] ?? []).filter { attribute($0, "AXTitle") as? String == title }
guard windows.count == 1 else { fail("请先在 DeepSeek Harness 打开所选会话") }
let window = windows[0]
let editors = descendants(window) { attribute($0,"AXRole") as? String == "AXTextArea" }
guard editors.count == 1, let editor = editors.first, value(editor) == "" else {
    fail("DSH 输入框已有草稿或无法定位，请先检查")
}
guard AXUIElementSetAttributeValue(editor, "AXFocused" as CFString, kCFBooleanTrue) == .success,
      attribute(editor,"AXFocused") as? Bool == true else { fail("无法聚焦 DSH 输入框") }
var chunk = [UniChar]()
func insertChunk() {
    guard !chunk.isEmpty else { return }
    for down in [true, false] {
        guard let key = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: down) else { fail("无法输入 DSH 消息") }
        key.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: chunk)
        key.postToPid(app.processIdentifier)
    }
    chunk.removeAll(keepingCapacity: true)
}
for scalar in text.unicodeScalars {
    let units = String(scalar).utf16
    if chunk.count + units.count > 20 { insertChunk() }
    chunk.append(contentsOf: units)
}
insertChunk()
for _ in 0..<30 where value(editor) != text { Thread.sleep(forTimeInterval: 0.05) }
guard value(editor) == text, attribute(window,"AXTitle") as? String == title else {
    fail("DSH 输入框未收到完整消息，未点击发送")
}
let buttons = descendants(window) {
    let label = (attribute($0,"AXDescription") as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    return attribute($0,"AXRole") as? String == "AXButton" && ["发送消息","Send message"].contains(label)
}
guard buttons.count == 1, attribute(buttons[0],"AXEnabled") as? Bool == true,
      AXUIElementPerformAction(buttons[0], kAXPressAction as CFString) == .success else {
    fail("消息已填入 DSH，发送按钮当前不可用")
}
for _ in 0..<40 where value(editor) == text { Thread.sleep(forTimeInterval: 0.05) }
guard value(editor) == "" else { fail("DSH 未确认发送，请检查原会话") }
