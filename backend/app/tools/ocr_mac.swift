// Lê o texto de imagens com o Vision do macOS (grátis, no próprio Mac). Uso: ocr <img> [<img> ...]
// Escreve uma linha JSON por imagem: {"path": ..., "text": ...}. memes_narr.py usa-o para ver o ecrã das lives do GTA 6.
import Foundation
import Vision
import AppKit

for path in CommandLine.arguments.dropFirst() {
    var text = ""
    if let img = NSImage(contentsOfFile: path), let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) {
        let req = VNRecognizeTextRequest()
        req.recognitionLevel = .accurate
        req.usesLanguageCorrection = false
        try? VNImageRequestHandler(cgImage: cg, options: [:]).perform([req])
        text = (req.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: " | ")
    }
    let obj: [String: String] = ["path": path, "text": text]
    if let d = try? JSONSerialization.data(withJSONObject: obj), let s = String(data: d, encoding: .utf8) { print(s) }
}
