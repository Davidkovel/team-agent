from .window import COLORS, WidgetWindow


def start_tray(window: WidgetWindow):
    """System tray icon coloured by agent status. Returns None where no tray backend exists."""
    try:
        import pystray
        from PIL import Image, ImageDraw
    except Exception:
        return None

    def image(status: str):
        img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
        ImageDraw.Draw(img).ellipse((8, 8, 56, 56), fill=COLORS.get(status, COLORS["OFFLINE"]))
        return img

    def on_ui(fn):
        # pystray runs in its own thread; tkinter must only be touched from the UI thread.
        return lambda *_: window.root.after(0, fn)

    def quit_widget(icon, _):
        icon.stop()
        window.root.after(0, window.root.destroy)

    send = window.client.send
    icon = pystray.Icon("team-agent", image("OFFLINE"), "Team Agent", pystray.Menu(
        pystray.MenuItem("Show widget", on_ui(window.show), default=True),
        pystray.MenuItem("Hide widget", on_ui(window.hide)),
        pystray.MenuItem("Open Dashboard", on_ui(window._open_dashboard)),
        pystray.MenuItem("Open Current Task", on_ui(window._open_task)),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Pause Agent", lambda *_: send("pause")),
        pystray.MenuItem("Resume Agent", lambda *_: send("resume")),
        pystray.MenuItem("Stop Current Task", lambda *_: send("stop")),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Quit widget (agent keeps running)", quit_widget),
    ))

    def on_status(status: str):
        icon.icon, icon.title = image(status), f"Team Agent - {status}"

    window.on_status = on_status
    icon.run_detached()
    return icon
