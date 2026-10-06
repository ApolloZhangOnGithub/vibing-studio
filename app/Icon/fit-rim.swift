// fit-rim.swift —— 量一张「自带圆角方块外框」的图标画：外框（一圈亮边、框外是黑的）拟合成超椭圆 |x/a|^n + |y/b|^n = 1，
// 打出 make-icon 要的 ICON_SHAPE=cx,cy,a,b,n（原图像素，左上角为原点）。换了 Icon/terminal-logo.png 就跑一下，把结果填进 build.sh
// 用法：xcrun swiftc -O Icon/fit-rim.swift -o build/fit-rim && build/fit-rim Icon/terminal-logo.png [跳过的区域 x0,y0,x1,y1 …]
//   跳过的区域：外框被画里的东西挡住的地方（比如头顶的光环压在上边框上），那里的边不算；默认跳过上边中间一段
// 做法：从中心往外打射线，每条只在当前形状附近 ±band 像素里找「由暗变亮最陡」的一点（外框的外沿），用稳健的最小二乘迭代几轮
import AppKit

let args = CommandLine.arguments
guard args.count > 1, let data = try? Data(contentsOf: URL(fileURLWithPath: args[1])), let rep = NSBitmapImageRep(data: data) else {
  print("用法：fit-rim <图> [x0,y0,x1,y1 …]"); exit(2)
}
let w = rep.pixelsWide, h = rep.pixelsHigh
let skips: [[Double]] = args.count > 2
  ? args.dropFirst(2).map { $0.split(separator: ",").compactMap { Double($0) } }.filter { $0.count == 4 }
  : [[Double(w) * 0.18, 0, Double(w) * 0.74, Double(h) * 0.18]]
var cache = [Double](repeating: -1, count: w * h)
func lum(_ x: Int, _ y: Int) -> Double {
  let x = min(max(x, 0), w - 1), y = min(max(y, 0), h - 1)
  if cache[y * w + x] >= 0 { return cache[y * w + x] }
  let c = rep.colorAt(x: x, y: y)!.usingColorSpace(.sRGB)!
  let v = Double(0.2126 * c.redComponent + 0.7152 * c.greenComponent + 0.0722 * c.blueComponent)
  cache[y * w + x] = v
  return v
}
func sample(_ x: Double, _ y: Double) -> Double {
  let x0 = Int(floor(x)), y0 = Int(floor(y)), fx = x - Double(x0), fy = y - Double(y0)
  return lum(x0, y0) * (1 - fx) * (1 - fy) + lum(x0 + 1, y0) * fx * (1 - fy) + lum(x0, y0 + 1) * (1 - fx) * fy + lum(x0 + 1, y0 + 1) * fx * fy
}
// 形状在方向 θ 上离中心多远
func radius(_ th: Double, _ a: Double, _ b: Double, _ n: Double) -> Double {
  1 / pow(pow(abs(cos(th)) / a, n) + pow(abs(sin(th)) / b, n), 1 / n)
}
var q = [Double(w) / 2, Double(h) / 2, Double(w) / 2 - 8, Double(h) / 2 - 8, 5] // cx cy a b n
var band = 25.0
for _ in 0..<5 {
  var pts: [(Double, Double)] = []
  for i in 0..<1440 {
    let th = Double(i) * 0.25 * .pi / 180, dx = cos(th), dy = sin(th)
    let r0 = radius(th, q[2], q[3], q[4])
    var best = 0.0, at = 0.0, prev = sample(q[0] + dx * (r0 + band), q[1] + dy * (r0 + band)), t = r0 + band - 0.5
    while t >= r0 - band {
      let v = sample(q[0] + dx * t, q[1] + dy * t)
      if v - prev > best { best = v - prev; at = t + 0.25 }
      prev = v
      t -= 0.5
    }
    let x = q[0] + dx * at, y = q[1] + dy * at
    if best > 0.1 && !skips.contains(where: { x >= $0[0] && y >= $0[1] && x <= $0[2] && y <= $0[3] }) { pts.append((x, y)) }
  }
  func res(_ p: (Double, Double), _ q: [Double]) -> Double {
    let dx = p.0 - q[0], dy = p.1 - q[1]
    return sqrt(dx * dx + dy * dy) - radius(atan2(dy, dx), q[2], q[3], q[4])
  }
  // 稳健代价：偏得远的点（画里的东西压过了外框）只按线性算
  func cost(_ q: [Double]) -> Double { pts.reduce(0) { let r = abs(res($1, q)); return $0 + (r < 2 ? r * r : 4 * r - 4) } }
  var step = [2.0, 2.0, 2.0, 2.0, 0.25]
  for _ in 0..<600 {
    var improved = false
    for k in 0..<5 { for s in [-1.0, 1.0] { var t = q; t[k] += s * step[k]; if cost(t) < cost(q) { q = t; improved = true } } }
    if !improved { step = step.map { $0 / 2 }; if step[0] < 0.005 { break } }
  }
  let rs = pts.map { abs(res($0, q)) }.sorted()
  FileHandle.standardError.write(String(format: "中心 (%.1f, %.1f) 半宽 %.1f 半高 %.1f n %.2f · %d 个点，偏差中位 %.1f、九成 %.1f 像素\n", q[0], q[1], q[2], q[3], q[4], pts.count, rs[rs.count / 2], rs[rs.count * 9 / 10]).data(using: .utf8)!)
  band = max(8, band * 0.6)
}
print(String(format: "ICON_SHAPE=%.2f,%.2f,%.2f,%.2f,%.3f", q[0], q[1], q[2], q[3], q[4]))
