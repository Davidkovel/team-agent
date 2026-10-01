from .window import COLORS, LOGO, WidgetWindow


def start_tray(window: WidgetWindow):
    """System tray icon coloured by agent status. Returns None where no tray backend exists."""
    try:
        import pystray
        from PIL import Image, ImageDraw
    except Exception:
        return None

    def image(status: str):
        """The logo with a small status-coloured dot in the corner."""
        img = Image.open(LOGO).convert("RGBA").resize((64, 64), Image.LANCZOS)
        draw = ImageDraw.Draw(img)
        draw.ellipse((38, 38, 62, 62), fill="#000000")
        draw.ellipse((42, 42, 58, 58), fill=COLORS.get(status, COLORS["OFFLINE"]))
        return img

    def on_ui(fn):
        # pystray runs in its own thread; tkinter must only be touched from the UI thread.
        return lambda *_: window.root.after(0, fn)

    def quit_widget(icon, _):
        icon.stop()
        window.root.after(0, window.root.destroy)

    send = window.client.send
    icon = pystray.Icon("team-agent", image("OFFLINE"), "Agente AMG", pystray.Menu(
        pystray.MenuItem("Mostrar widget", on_ui(window.show), default=True),
        pystray.MenuItem("Esconder widget", on_ui(window.hide)),
        pystray.MenuItem("Abrir o Hub", on_ui(window._open_dashboard)),
        pystray.MenuItem("Abrir tarefa atual", on_ui(window._open_task)),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Pausar agente", lambda *_: send("pause")),
        pystray.MenuItem("Retomar agente", lambda *_: send("resume")),
        pystray.MenuItem("Parar tarefa atual", lambda *_: send("stop")),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Fechar widget (o agente continua)", quit_widget),
    ))

    def on_status(status: str):
        icon.icon, icon.title = image(status), f"Agente AMG - {status}"

    window.on_status = on_status
    icon.run_detached()
    return icon
