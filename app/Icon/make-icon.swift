// make-icon.swift —— App 图标：就是「系统设置 › Paimon」里那个图标（desk.css 的 .st-pm：#d77757 圆角方块里一个白色的 ✻），
// 按 macOS 图标的网格画（1024 画布里 824 的圆角方块、带一点投影），出一套 iconset，build.sh 再用 iconutil 合成 .icns
// 用法：make-icon <输出的 .iconset 目录>
// ICON_IMAGE=<图>：改用一张画（Paimon Terminal 用 Icon/terminal-logo.png）。那张画自己带着圆角方块的外框（一圈霓虹）、框外是黑的：
//   ICON_SHAPE=cx,cy,a,b,n —— 外框在画里是个超椭圆 |x/a|^n + |y/b|^n = 1（原图像素，左上角为原点；用 Icon/fit-rim.swift 量）。
//     整张画按外框缩放进 824 的方块，沿外框裁（框外的黑边不要），投影也照外框的形状
//   ICON_SMALL=x,y,边长 —— 32 像素及以下（Finder 列表、菜单）改用画里的一块正方形（只取脸：整张缩到那么小就糊了），裁成普通的圆角方块
import AppKit

let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "AppIcon.iconset"
let env = ProcessInfo.processInfo.environment
// ICON_STYLE=terminal：Paimon Terminal 的图标——反过来，深色方块里一个橙色的 ✻（同终端里 agent 的颜色）
let terminal = env["ICON_STYLE"] == "terminal"
try? FileManager.default.createDirectory(atPath: out, withIntermediateDirectories: true)
let logo: NSImage? = env["ICON_IMAGE"].flatMap { $0.isEmpty ? nil : NSImage(contentsOfFile: $0) }
func nums(_ key: String) -> [CGFloat] { (env[key] ?? "").split(separator: ",").compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }.map { CGFloat($0) } }
let shape = nums("ICON_SHAPE"), small = nums("ICON_SMALL")
// 原图的像素尺寸（NSImage 的 size 是点，可能不等于像素）
let pixels: NSSize = {
  guard let img = logo, let r = img.representations.first else { return logo?.size ?? .zero }
  return NSSize(width: r.pixelsWide, height: r.pixelsHigh)
}()

// 超椭圆：中心 c、半宽 a、半高 b、指数 n（n = 2 是椭圆，越大越方）
func superellipse(_ c: NSPoint, _ a: CGFloat, _ b: CGFloat, _ n: CGFloat) -> NSBezierPath {
  let p = NSBezierPath()
  for i in 0..<720 {
    let t = CGFloat(i) / 720 * 2 * .pi, ct = cos(t), st = sin(t)
    let pt = NSPoint(x: c.x + a * (ct < 0 ? -1 : 1) * pow(abs(ct), 2 / n), y: c.y + b * (st < 0 ? -1 : 1) * pow(abs(st), 2 / n))
    if i == 0 { p.move(to: pt) } else { p.line(to: pt) }
  }
  p.close()
  return p
}

func draw(_ px: Int) -> Data? {
  guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { return nil }
  rep.size = NSSize(width: px, height: px)
  NSGraphicsContext.saveGraphicsState()
  defer { NSGraphicsContext.restoreGraphicsState() }
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  NSGraphicsContext.current?.imageInterpolation = .high
  let k = CGFloat(px) / 1024
  let t = NSAffineTransform()
  t.scale(by: k)
  t.concat()
  let box = NSRect(x: 100, y: 100, width: 824, height: 824)
  // 图标的形状和画放在哪：默认是普通圆角方块；画带外框的话照外框
  var path = NSBezierPath(roundedRect: box, xRadius: 185, yRadius: 185)
  var art: (NSRect, NSRect)? = nil // (画在图标里的位置, 取原图的哪一块)
  var rimClip: NSBezierPath? = nil // ICON_FIT=rim：画只画在自己的外框里
  if let img = logo {
    let sx = img.size.width / pixels.width, sy = img.size.height / pixels.height // 原图像素 → NSImage 的点
    if px <= 32 && small.count == 3 {
      art = (box, NSRect(x: small[0] * sx, y: (pixels.height - small[1] - small[2]) * sy, width: small[2] * sx, height: small[2] * sy))
    } else if shape.count == 5 {
      // 图标的外形必须是 macOS 的标准圆角方块（上面的 path）：外形不合规矩，macOS 26 起会把它关进一个灰底方块里。
      // 画自己的外框比标准的圆，所以：ICON_FIT=bleed（默认）把画放大一点，外框落在标准外形外面，画铺满；ICON_FIT=rim 保留外框，外框外面的角用 ICON_BASE 的颜色补上
      let (cx, cy, a, b, n) = (shape[0], shape[1], shape[2], shape[3], shape[4])
      let bleed = (env["ICON_FIT"] ?? "bleed") != "rim"
      let s = 824 / (2 * max(a, b)) * (bleed ? 1.075 : 1) // 外框的长边 = 824（bleed 再放大一点）
      if !bleed { rimClip = superellipse(NSPoint(x: 512, y: 512), a * s, b * s, n) }
      // 外框中心对到 (512, 512)；原图 y 朝下，图标 y 朝上
      art = (NSRect(x: 512 - cx * s, y: 512 - (pixels.height - cy) * s, width: pixels.width * s, height: pixels.height * s), NSRect(origin: .zero, size: img.size))
    } else {
      art = (box, NSRect(origin: .zero, size: img.size))
    }
  }
  // 投影：用形状本身投
  NSGraphicsContext.saveGraphicsState()
  let sh = NSShadow()
  sh.shadowColor = NSColor.black.withAlphaComponent(0.28)
  sh.shadowOffset = NSSize(width: 0, height: -10)
  sh.shadowBlurRadius = 22
  sh.set()
  let base = nums("ICON_BASE") // r,g,b（0–255）：ICON_FIT=rim 时外框外面那几个角的颜色
  (base.count == 3 ? NSColor(srgbRed: base[0] / 255, green: base[1] / 255, blue: base[2] / 255, alpha: 1) : terminal ? NSColor(srgbRed: 0x1c / 255.0, green: 0x1c / 255.0, blue: 0x1e / 255.0, alpha: 1) : NSColor(srgbRed: 0xd7 / 255.0, green: 0x77 / 255.0, blue: 0x57 / 255.0, alpha: 1)).setFill()
  path.fill()
  NSGraphicsContext.restoreGraphicsState()
  if let img = logo, let (dst, src) = art {
    NSGraphicsContext.saveGraphicsState()
    path.addClip()
    rimClip?.addClip()
    img.draw(in: dst, from: src, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: [.interpolation: NSImageInterpolation.high])
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])
  }
  // ✻：字号和方块的比例同 .st-pm（44 的方块里 24 号字）；字体由系统按字符回退（和网页里菜单栏上的同一个字形），按真正画出来的范围居中
  let glyph = NSAttributedString(string: "✻", attributes: [.font: NSFont.systemFont(ofSize: 824 * 24 / 44), .foregroundColor: terminal ? NSColor(srgbRed: 0xd7 / 255.0, green: 0x77 / 255.0, blue: 0x57 / 255.0, alpha: 1) : NSColor.white])
  let line = CTLineCreateWithAttributedString(glyph), cg = NSGraphicsContext.current!.cgContext
  let ib = CTLineGetImageBounds(line, cg)
  cg.textPosition = CGPoint(x: box.midX - ib.midX, y: box.midY - ib.midY)
  CTLineDraw(line, cg)
  return rep.representation(using: .png, properties: [:])
}

for (name, px) in [("16x16", 16), ("16x16@2x", 32), ("32x32", 32), ("32x32@2x", 64), ("128x128", 128), ("128x128@2x", 256), ("256x256", 256), ("256x256@2x", 512), ("512x512", 512), ("512x512@2x", 1024)] {
  guard let data = draw(px) else { fatalError("draw \(px) failed") }
  try data.write(to: URL(fileURLWithPath: out + "/icon_" + name + ".png"))
}
print("wrote " + out)
