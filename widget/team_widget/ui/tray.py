from PySide6.QtCore import QPointF, Qt
from PySide6.QtGui import QAction, QColor, QIcon, QPainter, QPixmap
from PySide6.QtWidgets import QMenu, QSystemTrayIcon

from . import prefs
from .window import COLORS, LOGO, WidgetWindow

MENU_STYLE = """
QMenu { background: #111113; border: 1px solid #2a2a2e; border-radius: 12px; padding: 6px; color: #f2f4f5;
        font-family: "Segoe UI Variable Text", "Segoe UI"; font-size: 9pt; }
QMenu::item { padding: 7px 22px 7px 14px; border-radius: 7px; }
QMenu::item:selected { background: #222226; }
QMenu::separator { height: 1px; background: #232327; margin: 5px 8px; }
"""


def start_tray(window: WidgetWindow):
    """System tray icon coloured by agent status. Returns None where no tray exists."""
    if not QSystemTrayIcon.isSystemTrayAvailable():
        return None

    logo = QPixmap(str(LOGO)).scaled(64, 64, Qt.KeepAspectRatio, Qt.SmoothTransformation)
    icons = {}

    def image(status: str) -> QIcon:
        """The logo with a small status-coloured dot in the corner."""
        if status not in icons:
            pix = QPixmap(logo)
            p = QPainter(pix)
            p.setRenderHint(QPainter.Antialiasing)
            p.setPen(Qt.NoPen)
            p.setBrush(QColor("#000000"))
            p.drawEllipse(QPointF(50, 50), 12, 12)
            p.setBrush(QColor(COLORS.get(status, COLORS["OFFLINE"])))
            p.drawEllipse(QPointF(50, 50), 8, 8)
            p.end()
            icons[status] = QIcon(pix)
        return icons[status]

    icon = QSystemTrayIcon(image("OFFLINE"), window)
    icon.setToolTip("Agente AMG")
    menu = QMenu()
    menu.setWindowFlags(menu.windowFlags() | Qt.FramelessWindowHint | Qt.NoDropShadowWindowHint)
    menu.setAttribute(Qt.WA_TranslucentBackground)
    menu.setStyleSheet(MENU_STYLE)
    send = window.client.send

    def item(text, action):
        a = QAction(text, menu)
        a.triggered.connect(action)
        menu.addAction(a)
        return a

    menu.setDefaultAction(item("Mostrar widget", window.show_panel))
    item("Abrir a central de comando", lambda: (window.show_panel(fade=False), window.expand()))
    item("Esconder widget", window.hide_panel)
    item("Abrir o Hub", window._open_dashboard)
    item("Abrir tarefa atual", window._open_task)
    item("Bater o ponto", window.punch_ponto)
    on_top = item("Sempre por cima", lambda: None)
    on_top.setCheckable(True)
    on_top.setChecked(bool(prefs.load().get("on_top")))
    on_top.toggled.connect(window.set_on_top)
    menu.addSeparator()
    item("Pausar agente", lambda: send("pause"))
    item("Retomar agente", lambda: send("resume"))
    item("Parar tarefa atual", lambda: send("stop"))
    menu.addSeparator()
    item("Fechar widget (o agente continua)", window.quit)
    icon.setContextMenu(menu)

    def activated(reason):
        if reason in (QSystemTrayIcon.Trigger, QSystemTrayIcon.DoubleClick):
            window.hide_panel() if window.isVisible() and window.isActiveWindow() else window.show_panel()

    icon.activated.connect(activated)

    def on_status(status: str):
        icon.setIcon(image(status))
        icon.setToolTip(f"Agente AMG - {status}")

    window.on_status = on_status
    window.notify = lambda title, text: icon.showMessage(title, text, QIcon(logo), 6000)
    window._tray_menu = menu  # keep it alive
    icon.show()
    return icon
