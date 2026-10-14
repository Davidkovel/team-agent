// Gera o ícone da app (estrela da Mercedes do projeto sobre fundo escuro) em PNG.
// Uso: swift makeicon.swift <svg> <png de saída> <tamanho>
import Cocoa

let args = CommandLine.arguments
let svg = NSImage(contentsOf: URL(fileURLWithPath: args[1]))!
let size = CGFloat(Double(args[3])!)
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size), pixelsHigh: Int(size), bitsPerSample: 8,
                           samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                           bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
// Grelha dos ícones do macOS: quadrado arredondado com margem de ~10%.
let inset = size * 0.1
let box = NSRect(x: inset, y: inset, width: size - 2 * inset, height: size - 2 * inset)
let shape = NSBezierPath(roundedRect: box, xRadius: box.width * 0.225, yRadius: box.width * 0.225)
NSGradient(starting: NSColor(white: 0.16, alpha: 1), ending: NSColor(white: 0.02, alpha: 1))!.draw(in: shape, angle: -90)
NSColor(white: 1, alpha: 0.08).setStroke()
shape.lineWidth = size * 0.004
shape.stroke()
let s = box.width * 0.74
svg.draw(in: NSRect(x: box.midX - s / 2, y: box.midY - s / 2, width: s, height: s))
NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: args[2]))
