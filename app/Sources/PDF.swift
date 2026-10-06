// PDF.swift —— pdf.render：网页给一份要印的 HTML（带 CSS），在一个看不见的 WKWebView 里排好版，用 macOS 的打印「存储为 PDF」出一份真的 PDF：
// 分页（CSS 的 break-before / break-after 照样生效）、矢量、文字能选能搜，同「文件 › 导出为 PDF」。回 { b64, pages, bytes }
//   参数：html、css、title；width / height 纸的大小（点，1/72 英寸，默认 A4）；margin 页边距（点：一个数或者 [上, 右, 下, 左]，默认 0）
//   print: true —— 不出文件，弹 macOS 的打印对话框（挂在 App 的窗口上：选打印机、预览、在里面也能存成 PDF）；回 { printed }
//   CSS 里 1px = 0.75pt（同浏览器的打印）：页面照屏幕上的像素排好的分页、列宽，印出来一样
// 一次只印一份（同一个临时文件，印完读回来）；页面里的脚本不跑，除了最开始那一次载入哪儿也不去
import AppKit
import PDFKit
import WebKit

@MainActor
enum PDF {
  private static var busy = false
  private static var waiting: [CheckedContinuation<Void, Never>] = []
  static let scratch = FileManager.default.temporaryDirectory.appendingPathComponent("paimon-pdf-render.pdf")

  static func render(_ a: [String: Any], base: URL?, window: NSWindow?) async throws -> [String: Any] {
    guard let html = a["html"] as? String else { throw BridgeError.args("pdf.render { html, css?, title?, width?, height?, margin?, print? } — sizes in points (1/72 in)") }
    let w = num(a["width"]) ?? 595.28, h = num(a["height"]) ?? 841.89
    guard w >= 72, h >= 72, w <= 14400, h <= 14400 else { throw BridgeError.args("width / height should be 72–14400 points") }
    var m = [0.0, 0.0, 0.0, 0.0]
    if let arr = a["margin"] as? [Any] { for i in 0..<min(4, arr.count) { m[i] = max(0, num(arr[i]) ?? 0) } }
    else if let v = num(a["margin"]) { m = [v, v, v, v].map { max(0, $0) } }
    guard m[1] + m[3] < w - 36, m[0] + m[2] < h - 36 else { throw BridgeError.args("the margins leave no room on the page") }
    let toPrinter = a["print"] as? Bool == true
    if toPrinter && window == nil { throw BridgeError.failed("no window to show the print dialog on") }

    while busy { await withCheckedContinuation { waiting.append($0) } }
    busy = true
    defer { busy = false; if !waiting.isEmpty { waiting.removeFirst().resume() } }
    let job = PDFJob(html: html, css: a["css"] as? String ?? "", title: a["title"] as? String ?? "", paper: NSSize(width: w, height: h), margin: m, base: base)
    if toPrinter, let window { return ["printed": try await job.run(to: nil, panelOn: window)] }
    guard try await job.run(to: scratch, panelOn: nil) else { throw BridgeError.failed("printing to PDF failed") }
    guard var data = try? Data(contentsOf: scratch), data.count > 0, let pdf = PDFDocument(data: data) else { throw BridgeError.failed("printing produced no PDF") }
    let fixed = fixRadicals(data)
    if fixed != data, PDFDocument(data: fixed)?.pageCount == pdf.pageCount { data = fixed }
    return ["b64": data.base64EncodedString(), "pages": pdf.pageCount, "bytes": data.count]
  }

  static func num(_ v: Any?) -> Double? { (v as? NSNumber)?.doubleValue ?? (v as? String).flatMap(Double.init) }

  // Quartz 存 PDF 时，字体里跟部首共用字形的字（一、人、文、目、页、民……）在 ToUnicode 表里记成了部首（康熙部首 U+2F00–2FD5、部首补充 U+2E80–2EFF），
  // 复制出来、搜索都对不上。按那个字体把这些改回正常的汉字，改过的表追加在文件末尾（PDF 的增量更新：原来的字节不动，新的 xref 指过去）
  static func fixRadicals(_ data: Data) -> Data {
    guard let s = String(data: data, encoding: .isoLatin1).map({ $0 as NSString }) else { return data } // Latin-1：一个字节一个字，下标就是字节位置
    func match(_ pattern: String, _ range: NSRange? = nil, anchored: Bool = false) -> NSTextCheckingResult? {
      (try? NSRegularExpression(pattern: pattern, options: [.dotMatchesLineSeparators]))?.firstMatch(in: s as String, options: anchored ? [.anchored] : [], range: range ?? NSRange(location: 0, length: s.length))
    }
    func str(_ m: NSTextCheckingResult, _ i: Int) -> String { m.range(at: i).location == NSNotFound ? "" : s.substring(with: m.range(at: i)) }
    // 最后一个 xref 表（Quartz 写的是老式的表，不是 xref 流）和 trailer
    let tail = NSRange(location: max(0, s.length - 1024), length: min(1024, s.length))
    guard let sx = (try? NSRegularExpression(pattern: "startxref\\s+(\\d+)"))?.matches(in: s as String, range: tail).last,
          let xref = Int(str(sx, 1)), xref < s.length, s.substring(with: NSRange(location: xref, length: min(4, s.length - xref))) == "xref",
          let tr = match("trailer\\s*<<(.*?)>>\\s*startxref", NSRange(location: xref, length: s.length - xref)) else { return data }
    var offsets: [Int: Int] = [:], first = 0, idx = 0
    let table = s.substring(with: NSRange(location: xref + 4, length: tr.range.location - xref - 4))
    for line in table.split(whereSeparator: { $0 == "\n" || $0 == "\r" }) {
      let f = line.split(separator: " ")
      if f.count == 2, let a = Int(f[0]) { first = a; idx = 0 }
      else if f.count >= 3, let off = Int(f[0]) { if f[2].hasPrefix("n") { offsets[first + idx] = off }; idx += 1 }
    }
    let trailer = str(tr, 1)
    let keep = ["Size", "Root", "Info", "ID"].compactMap { k -> String? in
      guard let r = trailer.range(of: "/" + k + "\\s*(\\[[^\\]]*\\]|\\d+ \\d+ R|\\d+)", options: .regularExpression) else { return nil }
      return String(trailer[r])
    }
    // 每个 ToUnicode 表：解开、改、存成不压缩的新版本
    let refs = (try? NSRegularExpression(pattern: "/ToUnicode (\\d+) (\\d+) R"))?.matches(in: s as String, range: NSRange(location: 0, length: s.length)) ?? []
    var seen = Set<Int>(), out: [(Int, Int, String)] = []
    for r in refs {
      guard let n = Int(str(r, 1)), let g = Int(str(r, 2)), seen.insert(n).inserted, let at = offsets[n],
            let h = match("\\d+ \\d+ obj\\s*<<(.*?)>>\\s*stream\\r?\\n", NSRange(location: at, length: s.length - at), anchored: true) else { continue }
      let dict = str(h, 1)
      var len = 0
      if let m = dict.range(of: "/Length (\\d+) (\\d+) R", options: .regularExpression) {
        let ref = Int(dict[m].split(separator: " ")[1]) ?? -1
        if let lo = offsets[ref], let lm = match("\\d+ \\d+ obj\\s*(\\d+)", NSRange(location: lo, length: s.length - lo), anchored: true) { len = Int(str(lm, 1)) ?? 0 }
      } else if let m = dict.range(of: "/Length (\\d+)", options: .regularExpression) { len = Int(dict[m].dropFirst(8)) ?? 0 }
      let start = h.range.location + h.range.length
      guard len > 6, start + len <= data.count else { continue }
      var raw = data.subdata(in: start..<(start + len))
      if dict.contains("/FlateDecode") {
        guard let d = try? (raw.subdata(in: 2..<(raw.count - 4)) as NSData).decompressed(using: .zlib) else { continue } // zlib 头 2 字节、校验 4 字节
        raw = d as Data
      } else if dict.contains("/Filter") { continue }
      guard let cmap = String(data: raw, encoding: .isoLatin1) else { continue }
      // 这张表属于哪个字体：往回找同一个对象里的 /BaseFont
      let objStart = s.range(of: " obj", options: .backwards, range: NSRange(location: 0, length: r.range.location)).location
      let from = objStart == NSNotFound ? 0 : objStart
      let bf = match("/BaseFont\\s*/([^\\s/<>\\[\\]()]+)", NSRange(location: from, length: r.range.location - from))
      let fixed = fixCMap(cmap, radicalMap(bf.map { str($0, 1) } ?? ""))
      if fixed != cmap { out.append((n, g, fixed)) }
    }
    if out.isEmpty { return data }
    var add = "\n", offs: [(Int, Int, Int)] = []
    for (n, g, cmap) in out {
      offs.append((n, g, data.count + add.utf8.count))
      add += "\(n) \(g) obj\n<< /Length \(cmap.utf8.count) >>\nstream\n" + cmap + "\nendstream\nendobj\n"
    }
    let at = data.count + add.utf8.count
    add += "xref\n" + offs.map { String(format: "%d 1\n%010d %05d n \n", $0.0, $0.2, $0.1) }.joined()
    add += "trailer\n<< " + keep.joined(separator: " ") + " /Prev \(xref) >>\nstartxref\n\(at)\n%%EOF\n"
    return data + Data(add.utf8)
  }

  // 这个字体里跟部首共用同一个字形的汉字：部首 → 汉字。隐藏的系统字体（.PingFangUIText… 这种按名字打不开）按苹方算
  private static var radicalMaps: [String: [UInt32: UInt32]] = [:]
  static func radicalMap(_ baseFont: String) -> [UInt32: UInt32] {
    var name = baseFont
    if let plus = name.firstIndex(of: "+"), name.distance(from: name.startIndex, to: plus) == 6 { name = String(name[name.index(after: plus)...]) } // 子集前缀 ABCDEF+
    if name.isEmpty || name.hasPrefix(".") || name.contains("PingFang") { name = name.contains("TC") ? "PingFangTC-Regular" : name.contains("HK") ? "PingFangHK-Regular" : "PingFangSC-Regular" }
    if let m = radicalMaps[name] { return m }
    var font = CTFontCreateWithName(name as CFString, 12, nil)
    if (CTFontCopyPostScriptName(font) as String) != name { font = CTFontCreateWithName("PingFangSC-Regular" as CFString, 12, nil) }
    let han = (0x3400...0x4DBF).map { UniChar($0) } + (0x4E00...0x9FFF).map { UniChar($0) }, rad = (0x2E80...0x2FDF).map { UniChar($0) }
    var hg = [CGGlyph](repeating: 0, count: han.count), rg = [CGGlyph](repeating: 0, count: rad.count)
    _ = CTFontGetGlyphsForCharacters(font, han, &hg, han.count) // 有的字没有字形也照样填（填 0）
    _ = CTFontGetGlyphsForCharacters(font, rad, &rg, rad.count)
    var byGlyph: [CGGlyph: UInt32] = [:], m: [UInt32: UInt32] = [:]
    for (i, g) in hg.enumerated() where g != 0 && byGlyph[g] == nil { byGlyph[g] = UInt32(han[i]) }
    for (i, g) in rg.enumerated() where g != 0 { if let h = byGlyph[g] { m[UInt32(rad[i])] = h } }
    radicalMaps[name] = m
    return m
  }

  // CMap 里映射到部首的（bfchar 的 <src> <dst>；bfrange 的 <lo><hi><dst> 是连着的一串，碰到部首就拆成一个一个的）改成对应的汉字：先按字体，没有再按 NFKC。
  // 改过的块重新数条数（一块最多 100 条）
  static func fixCMap(_ cmap: String, _ map: [UInt32: UInt32]) -> String {
    func better(_ v: UInt32) -> UInt32? {
      guard (0x2E80...0x2FDF).contains(v), let u = Unicode.Scalar(v) else { return nil }
      if let h = map[v] { return h }
      let n = String(Character(u)).precomposedStringWithCompatibilityMapping.unicodeScalars
      guard n.count == 1, let c = n.first, c.value != v, c.value <= 0xFFFF else { return nil }
      return c.value
    }
    let hex4 = { (v: UInt32) in String(format: "%04x", v) }
    let ns = cmap as NSString
    guard let block = try? NSRegularExpression(pattern: "\\d+\\s+beginbf(char|range)(.*?)endbf(?:char|range)", options: [.dotMatchesLineSeparators]),
          let charRe = try? NSRegularExpression(pattern: "<([0-9a-fA-F]+)>\\s*<([0-9a-fA-F]+)>"),
          let rangeRe = try? NSRegularExpression(pattern: "<([0-9a-fA-F]+)>\\s*<([0-9a-fA-F]+)>\\s*(?:<([0-9a-fA-F]+)>|\\[([^\\]]*)\\])") else { return cmap }
    var out = "", last = 0, changed = false
    for b in block.matches(in: cmap, range: NSRange(location: 0, length: ns.length)) {
      let kind = ns.substring(with: b.range(at: 1)), body = ns.substring(with: b.range(at: 2)), bns = body as NSString
      let g = { (m: NSTextCheckingResult, i: Int) -> String in m.range(at: i).location == NSNotFound ? "" : bns.substring(with: m.range(at: i)) }
      var entries: [String] = [], touched = false
      if kind == "char" {
        for m in charRe.matches(in: body, range: NSRange(location: 0, length: bns.length)) {
          let src = g(m, 1), dst = g(m, 2)
          if dst.count == 4, let v = UInt32(dst, radix: 16), let h = better(v) { entries.append("<" + src + "> <" + hex4(h) + ">"); touched = true } else { entries.append("<" + src + "> <" + dst + ">") }
        }
      } else {
        for m in rangeRe.matches(in: body, range: NSRange(location: 0, length: bns.length)) {
          let lo = g(m, 1), hi = g(m, 2), dst = g(m, 3), arr = g(m, 4)
          if !arr.isEmpty { // <lo><hi>[<d1> <d2> …]：一个一个换
            let items = arr.components(separatedBy: CharacterSet(charactersIn: "<> ")).filter { !$0.isEmpty }.map { h -> String in
              if h.count == 4, let v = UInt32(h, radix: 16), let x = better(v) { touched = true; return hex4(x) }
              return h
            }
            entries.append("<" + lo + "><" + hi + ">[" + items.map { "<" + $0 + ">" }.joined(separator: " ") + "]")
            continue
          }
          guard dst.count == 4, let d = UInt32(dst, radix: 16), let a = UInt32(lo, radix: 16), let z = UInt32(hi, radix: 16), z >= a, z - a < 256,
                (0...(z - a)).contains(where: { better(d + $0) != nil }) else { entries.append("<" + lo + "><" + hi + "><" + dst + ">"); continue }
          touched = true
          for i in 0...(z - a) {
            let src = String(format: "%0\(lo.count)x", a + i), v = d + i
            entries.append("<" + src + "><" + src + "><" + hex4(better(v) ?? v) + ">")
          }
        }
      }
      guard touched else { continue }
      changed = true
      out += ns.substring(with: NSRange(location: last, length: b.range.location - last))
      out += stride(from: 0, to: entries.count, by: 100).map { i -> String in
        let part = entries[i..<min(i + 100, entries.count)]
        return "\(part.count) beginbf\(kind)\n" + part.joined(separator: "\n") + "\nendbf\(kind)"
      }.joined(separator: "\n")
      last = b.range.location + b.range.length
    }
    guard changed else { return cmap }
    return out + ns.substring(from: last)
  }
}

@MainActor
final class PDFJob: NSObject, WKNavigationDelegate {
  private let html: String, css: String, title: String, paper: NSSize, margin: [Double], base: URL?
  private let web: WKWebView
  private let window: NSWindow
  private var started = false
  private var loading: CheckedContinuation<Void, Error>?
  private var printing: CheckedContinuation<Bool, Never>?

  init(html: String, css: String, title: String, paper: NSSize, margin: [Double], base: URL?) {
    self.html = html; self.css = css; self.title = title; self.paper = paper; self.margin = margin; self.base = base
    let cfg = WKWebViewConfiguration()
    cfg.websiteDataStore = .default() // 同 App 的网页：要登录才给的图片一样拿得到
    cfg.defaultWebpagePreferences.allowsContentJavaScript = false
    cfg.preferences.inactiveSchedulingPolicy = .none
    cfg.preferences.shouldPrintBackgrounds = true // 底色、填充色照印（同打印对话框里勾上「打印背景」）
    cfg.suppressesIncrementalRendering = true
    let frame = NSRect(x: 0, y: 0, width: (paper.width - margin[1] - margin[3]) / 0.75, height: 800)
    web = WKWebView(frame: frame, configuration: cfg)
    window = NSWindow(contentRect: frame.offsetBy(dx: -40000, dy: -40000), styleMask: [.borderless], backing: .buffered, defer: false)
    super.init()
    window.isReleasedWhenClosed = false
    window.contentView = web
    web.navigationDelegate = self
  }

  // out：存成这个 PDF 文件；nil 就是弹打印对话框（panelOn 那个窗口上）。回：印成了没有（对话框里点了取消 = false）
  func run(to out: URL?, panelOn host: NSWindow?) async throws -> Bool {
    defer { window.contentView = nil; window.close() }
    // 版心的宽（CSS px）：WebKit 印的时候按「内容的宽」缩到纸上（至少缩到 1/1.25），让内容正好这么宽，缩放就是 0.75（96 dpi → 72 dpi），同浏览器
    let px = (paper.width - margin[1] - margin[3]) / 0.75
    let esc = { (s: String) in s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;") }
    let doc = "<!doctype html><html><head><meta charset=\"utf-8\"><title>" + esc(title) + "</title><style>" + css + "</style>" +
      "<style>html{min-width:" + String(format: "%.3f", px) + "px}</style></head><body>" + html + "</body></html>"
    try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
      loading = c
      web.loadHTMLString(doc, baseURL: base)
      DispatchQueue.main.asyncAfter(deadline: .now() + 120) { [weak self] in
        MainActor.assumeIsolated { self?.finishLoad(BridgeError.failed("the document took too long to lay out")) }
      }
    }
    // 图片都解码好、字体都到了再印
    _ = try? await web.callAsyncJavaScript("await Promise.all(Array.from(document.images, i => i.decode().catch(() => {}))); await document.fonts.ready; return 1", arguments: [:], in: nil, contentWorld: .defaultClient)

    let info = NSPrintInfo()
    info.paperSize = paper
    info.orientation = paper.width > paper.height ? .landscape : .portrait
    info.paperSize = paper
    info.topMargin = margin[0]; info.rightMargin = margin[1]; info.bottomMargin = margin[2]; info.leftMargin = margin[3]
    info.horizontalPagination = .automatic
    info.verticalPagination = .automatic
    info.isHorizontallyCentered = false
    info.isVerticallyCentered = false
    if let out {
      info.jobDisposition = .save
      info.dictionary()[NSPrintInfo.AttributeKey.jobSavingURL] = out
    }
    let op = web.printOperation(with: info)
    op.showsPrintPanel = out == nil
    op.showsProgressPanel = out == nil
    if !title.isEmpty { op.jobTitle = title }
    op.view?.frame = web.bounds // 不设的话印出来是白纸（WKWebView 的老问题）
    return await withCheckedContinuation { (c: CheckedContinuation<Bool, Never>) in
      printing = c
      op.runModal(for: host ?? window, delegate: self, didRun: #selector(printed(_:success:contextInfo:)), contextInfo: nil)
    }
  }

  @objc private func printed(_ op: NSPrintOperation, success: Bool, contextInfo: UnsafeMutableRawPointer?) {
    printing?.resume(returning: success)
    printing = nil
  }

  private func finishLoad(_ err: Error?) {
    guard let c = loading else { return }
    loading = nil
    if let err { c.resume(throwing: err) } else { c.resume() }
  }

  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
    if !started && action.targetFrame?.isMainFrame == true { started = true; decisionHandler(.allow) } else { decisionHandler(.cancel) }
  }
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { finishLoad(nil) }
  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { finishLoad(BridgeError.failed("couldn't lay out the document: \(error.localizedDescription)")) }
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { finishLoad(BridgeError.failed("couldn't lay out the document: \(error.localizedDescription)")) }
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { finishLoad(BridgeError.failed("the renderer quit")) }
}
