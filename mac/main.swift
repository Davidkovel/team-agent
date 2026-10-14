// Agente AMG para Mac: a estrela na barra de menus e o Hub numa janela própria.
import Cocoa
import WebKit
import ServiceManagement
import Carbon

let defaultHub = "https://desktop-njenvdr.tailcdbdef.ts.net/"

func hubURL() -> URL {
    let s = UserDefaults.standard.string(forKey: "hubURL") ?? defaultHub
    return URL(string: s) ?? URL(string: defaultHub)!
}

/// A estrela de três pontas dentro do círculo, desenhada em vetor (fica nítida em qualquer tamanho).
func starImage(size: CGFloat, color: NSColor, template: Bool) -> NSImage {
    let img = NSImage(size: NSSize(width: size, height: size), flipped: false) { rect in
        let c = NSPoint(x: rect.midX, y: rect.midY)
        let line = size * 0.085
        let R = size / 2 - line / 2 - size * 0.02
        color.set()
        let ring = NSBezierPath(ovalIn: NSRect(x: c.x - R, y: c.y - R, width: 2 * R, height: 2 * R))
        ring.lineWidth = line
        ring.stroke()
        let star = NSBezierPath()
        let tip = R - line * 0.3
        let inner = R * 0.17
        for i in 0..<6 {
            let a = (90.0 + Double(i) * 60.0) * .pi / 180
            let r = i % 2 == 0 ? tip : inner
            let p = NSPoint(x: c.x + CGFloat(cos(a)) * r, y: c.y + CGFloat(sin(a)) * r)
            i == 0 ? star.move(to: p) : star.line(to: p)
        }
        star.close()
        star.fill()
        return true
    }
    img.isTemplate = template
    return img
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, NSWindowDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var status: NSStatusItem!
    /// Só o «Sair de vez» da estrela (ou desligar o Mac) fecha a app; o resto esconde-a na barra.
    var reallyQuit = false

    func applicationDidFinishLaunching(_ note: Notification) {
        buildMenu()
        buildWindow()
        buildStatusItem()
        // Arranca só com a estrela: o Hub grande carrega quando for pedido.
        NSApp.setActivationPolicy(.accessory)
        startWidget()
        registerCodeShortcut()
        NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.willPowerOffNotification, object: nil, queue: .main) { [weak self] _ in
            self?.reallyQuit = true
        }
        // Arranca sozinha com o Mac, para a estrela estar sempre na barra.
        if SMAppService.mainApp.status != .enabled { try? SMAppService.mainApp.register() }
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if reallyQuit { return .terminateNow }
        hideToBar()
        return .terminateCancel
    }

    /// Esconde a janela e o ícone do Dock; a estrela continua na barra de cima.
    @objc func hideToBar() {
        window.orderOut(nil)
        NSApp.setActivationPolicy(.accessory)
    }

    @objc func quitForReal() {
        reallyQuit = true
        NSApp.terminate(nil)
    }

    // MARK: janela

    func buildWindow() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.preferences.javaScriptCanOpenWindowsAutomatically = true
        config.mediaTypesRequiringUserActionForPlayback = []
        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = true
        web.setValue(false, forKey: "drawsBackground")

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1400, height: 900),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                          backing: .buffered, defer: false)
        window.title = "Agente AMG"
        window.titlebarAppearsTransparent = true
        window.appearance = NSAppearance(named: .darkAqua)
        window.backgroundColor = NSColor(red: 0.04, green: 0.04, blue: 0.05, alpha: 1)
        window.minSize = NSSize(width: 420, height: 500)
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.contentView = web
        window.center()
        window.setFrameAutosaveName("AgenteAMGMain")
    }

    func load() {
        web.load(URLRequest(url: hubURL(), cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15))
    }

    @objc func reload() {
        if web.url == nil || web.url?.scheme == "about" { load() } else { web.reload() }
    }

    @objc func goHome() { load() }

    @objc func showWindow() {
        if web.url == nil { load() }
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }

    @objc func toggleWindow() {
        if window.isVisible && window.isKeyWindow && NSApp.isActive {
            hideToBar()
        } else {
            showWindow()
        }
    }

    // Fechar a janela só a esconde: a estrela continua na barra.
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        hideToBar()
        return false
    }

    func applicationShouldHandleReopen(_ app: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showWidget()
        return true
    }

    // MARK: atalho ⌥⌘C: conversa nova no separador Code do Claude

    var codeHotKey: EventHotKeyRef?

    /// O Option duas vezes do Claude abre sempre o Chat e não se muda; este atalho abre uma conversa de código.
    /// RegisterEventHotKey não pede permissões de Acessibilidade (ao contrário de vigiar o teclado todo).
    func registerCodeShortcut() {
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, _, _ in
            NSWorkspace.shared.open(URL(string: "claude://code/new")!)
            return noErr
        }, 1, &spec, nil, nil)
        let id = EventHotKeyID(signature: OSType(0x414D_4743), id: 1)  // 'AMGC'
        let st = RegisterEventHotKey(UInt32(kVK_ANSI_C), UInt32(cmdKey | optionKey), id, GetApplicationEventTarget(), 0, &codeHotKey)
        try? "atalho ⌥⌘C: \(st == noErr ? "ok" : "erro \(st)")\n".write(toFile: NSHomeDirectory() + "/.team-agent/atalho.txt", atomically: true, encoding: .utf8)
    }

    /// agenteamg://claude-code?q=… (ou sem q: o texto que está na área de transferência, que é onde o atalho
    /// «Claude» da Siri põe o que ditaste). Abre uma conversa de código no Claude com o pedido já escrito.
    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls where url.scheme == "agenteamg" && url.host == "claude-code" {
            var text = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "q" })?.value
            if text == nil || text!.isEmpty { text = NSPasteboard.general.string(forType: .string) }
            var c = URLComponents(string: "claude://code/new")!
            let ask = (text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if !ask.isEmpty { c.queryItems = [URLQueryItem(name: "q", value: String(ask.prefix(4000)))] }
            if let u = c.url { NSWorkspace.shared.open(u) }
        }
    }

    @objc func newCodeChat() {
        NSWorkspace.shared.open(URL(string: "claude://code/new")!)
    }

    // MARK: o widget do PC (team-agent/widget), a correr no Mac

    let widgetPython = NSHomeDirectory() + "/.team-agent/mac/venv/bin/python"
    let widgetLauncher = NSHomeDirectory() + "/.team-agent/mac/widget_mac.py"
    /// O socket onde o widget ouve "show" (QLocalServer: pasta temporária + nome do widget).
    var widgetSocket: String {
        (NSTemporaryDirectory() as NSString).appendingPathComponent("agente-amg-widget-\(NSUserName())-default")
    }

    /// Pede ao widget que já corre para aparecer. Falso quando não há widget a correr.
    func pokeWidget() -> Bool {
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { return false }
        defer { close(fd) }
        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        let path = Array(widgetSocket.utf8CString)
        guard path.count <= MemoryLayout.size(ofValue: addr.sun_path) else { return false }
        withUnsafeMutableBytes(of: &addr.sun_path) { buf in
            for (i, c) in path.enumerated() { buf[i] = UInt8(bitPattern: c) }
        }
        let ok = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) == 0
            }
        }
        guard ok else { return false }
        let msg = Array("show".utf8)
        return write(fd, msg, msg.count) == msg.count
    }

    func startWidget() {
        guard FileManager.default.isExecutableFile(atPath: widgetPython),
              FileManager.default.fileExists(atPath: widgetLauncher) else { return }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: widgetPython)
        p.arguments = [widgetLauncher]
        p.currentDirectoryURL = URL(fileURLWithPath: NSHomeDirectory() + "/.team-agent/mac/team-agent/widget")
        // O que o widget escreve fica em ~/.team-agent/widget-mac.log (para perceber um widget que não aparece).
        let log = NSHomeDirectory() + "/.team-agent/widget-mac.log"
        FileManager.default.createFile(atPath: log, contents: nil)
        let out = FileHandle(forWritingAtPath: log) ?? FileHandle.nullDevice
        p.standardOutput = out
        p.standardError = out
        try? p.run()
    }

    /// A estrela: mostra a aba pequena do widget no canto; se o widget estiver fechado, arranca-o.
    @objc func showWidget() {
        if !pokeWidget() { startWidget() }
    }

    @objc func restartWidget() {
        let k = Process()
        k.executableURL = URL(fileURLWithPath: "/usr/bin/pkill")
        k.arguments = ["-f", "widget_mac.py"]
        try? k.run()
        k.waitUntilExit()
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { self.startWidget() }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { false }

    // MARK: estrela na barra de menus

    func buildStatusItem() {
        status = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let b = status.button {
            b.image = starImage(size: 18, color: .black, template: true)
            b.toolTip = "Agente AMG"
            b.target = self
            b.action = #selector(statusClicked(_:))
            b.sendAction(on: [.leftMouseUp, .rightMouseUp])
        }
    }

    @objc func statusClicked(_ sender: NSStatusBarButton) {
        let ev = NSApp.currentEvent
        if ev?.type == .rightMouseUp || ev?.modifierFlags.contains(.control) == true {
            let m = NSMenu()
            m.addItem(withTitle: "Mostrar o widget", action: #selector(showWidget), keyEquivalent: "")
            m.addItem(withTitle: "Abrir o Hub numa janela grande", action: #selector(showWindow), keyEquivalent: "")
            m.addItem(withTitle: "Reiniciar o widget", action: #selector(restartWidget), keyEquivalent: "")
            m.addItem(.separator())
            let code = m.addItem(withTitle: "Nova conversa de código no Claude", action: #selector(newCodeChat), keyEquivalent: "c")
            code.keyEquivalentModifierMask = [.command, .option]
            m.addItem(.separator())
            m.addItem(withTitle: "Esconder o Hub", action: #selector(hideToBar), keyEquivalent: "")
            m.addItem(.separator())
            m.addItem(withTitle: "Sair de vez (a estrela desaparece)", action: #selector(quitForReal), keyEquivalent: "")
            for i in m.items { i.target = self }
            status.menu = m
            status.button?.performClick(nil)
            status.menu = nil
        } else {
            showWidget()
        }
    }

    // MARK: menu da app

    func buildMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Esconder o Agente AMG", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(.separator())
        // Cmd+Q e «Sair» no Dock passam por applicationShouldTerminate: só escondem.
        appMenu.addItem(withTitle: "Fechar janela (fica na barra)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        let editItem = NSMenuItem()
        main.addItem(editItem)
        let edit = NSMenu(title: "Editar")
        edit.addItem(withTitle: "Desfazer", action: Selector(("undo:")), keyEquivalent: "z")
        edit.addItem(withTitle: "Refazer", action: Selector(("redo:")), keyEquivalent: "Z")
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cortar", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copiar", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Colar", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Selecionar tudo", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit

        let viewItem = NSMenuItem()
        main.addItem(viewItem)
        let view = NSMenu(title: "Ver")
        let r = view.addItem(withTitle: "Recarregar", action: #selector(reload), keyEquivalent: "r")
        r.target = self
        let h = view.addItem(withTitle: "Início", action: #selector(goHome), keyEquivalent: "H")
        h.target = self
        view.addItem(withTitle: "Ecrã inteiro", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
            .keyEquivalentModifierMask = [.command, .control]
        viewItem.submenu = view

        let winItem = NSMenuItem()
        main.addItem(winItem)
        let win = NSMenu(title: "Janela")
        win.addItem(withTitle: "Minimizar", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        win.addItem(withTitle: "Fechar", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        winItem.submenu = win
        NSApp.windowsMenu = win

        NSApp.mainMenu = main
    }

    // MARK: navegação

    func isHub(_ url: URL?) -> Bool {
        guard let u = url else { return false }
        return u.host == hubURL().host || u.scheme == "about" || u.scheme == "data" || u.scheme == "blob"
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        // Links para fora do Hub abrem no browser; o Hub fica na janela.
        if action.targetFrame?.isMainFrame != false, let u = action.request.url, !isHub(u),
           u.scheme == "http" || u.scheme == "https" {
            NSWorkspace.shared.open(u)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    // target=_blank e window.open: dentro do Hub carrega aqui, fora vai para o browser.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let u = action.request.url {
            if isHub(u) { webView.load(action.request) } else { NSWorkspace.shared.open(u) }
        }
        return nil
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = NSAlert(); a.messageText = message; a.runModal(); completionHandler()
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = NSAlert(); a.messageText = message
        a.addButton(withTitle: "OK"); a.addButton(withTitle: "Cancelar")
        completionHandler(a.runModal() == .alertFirstButtonReturn)
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let p = NSOpenPanel()
        p.allowsMultipleSelection = parameters.allowsMultipleSelection
        p.canChooseDirectories = parameters.allowsDirectories
        p.begin { completionHandler($0 == .OK ? p.urls : nil) }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { offline(error) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { offline(error) }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if response.isForMainFrame, let r = response.response as? HTTPURLResponse, r.statusCode >= 500 {
            decisionHandler(.cancel)
            offline(nil)
            return
        }
        decisionHandler(.allow)
    }

    /// O PC com o Hub está desligado ou o Agent está fechado: página simples e volta a tentar sozinho.
    func offline(_ error: Error?) {
        if let e = error as NSError?, e.code == NSURLErrorCancelled { return }
        let html = """
        <html><head><meta charset="utf-8"><style>
        body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a0c;
             color:#e9ebee;font:15px -apple-system,system-ui;text-align:center}
        .b{max-width:440px;padding:24px} h1{font-size:20px;margin:0 0 10px} p{color:#9aa0a6;line-height:1.5}
        button{margin-top:14px;background:#f2f4f5;color:#000;border:0;border-radius:10px;padding:10px 18px;font-size:14px;cursor:pointer}
        </style></head><body><div class="b">
        <h1>O Agente AMG não responde</h1>
        <p>O Hub corre no teu PC com Windows. Confirma que o PC está ligado, com o Tailscale e o Agent abertos.<br>
        Volto a tentar sozinho de 10 em 10 segundos.</p>
        <button onclick="location.href='\(hubURL().absoluteString)'">Tentar agora</button>
        </div><script>setTimeout(function(){location.href='\(hubURL().absoluteString)'},10000)</script></body></html>
        """
        web.loadHTMLString(html, baseURL: hubURL())
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
