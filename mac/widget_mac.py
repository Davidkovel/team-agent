"""Arranca o widget do Agente AMG (team-agent/widget) no Mac sem mexer no repositório da equipa.

A única diferença para o Windows: a app fica sem ícone no Dock e sem o nome "Python" na barra de cima
(política "accessory" do macOS); o widget aparece no canto e a estrela da barra de menus abre-o.
Corre de ~/.team-agent/mac (cópia própria do repositório e venv), fora de Documentos: o macOS pede uma
autorização à app da barra para ler Documentos, e o widget ficava parado à espera dela.
Uso: ~/.team-agent/mac/venv/bin/python ~/.team-agent/mac/widget_mac.py  (o build.sh copia este ficheiro para lá)
"""
import ctypes
import ctypes.util
import os
import sys
from pathlib import Path

REPO = Path.home() / ".team-agent" / "mac" / "team-agent"


def pull():
    """Traz a versão mais recente do widget a cada arranque, como o iniciar.ps1 no Windows."""
    import subprocess
    try:
        subprocess.run(["/usr/bin/git", "-C", str(REPO), "pull", "--ff-only", "-q"], timeout=20,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except (OSError, subprocess.SubprocessError):
        pass


pull()
sys.path.insert(0, str(REPO / "widget"))
os.environ.setdefault("USERNAME", os.environ.get("USER", "david"))  # o nome do socket do widget usa-o

from PySide6.QtCore import Qt, QTimer  # noqa: E402
from PySide6.QtWidgets import QApplication  # noqa: E402

import team_widget.__main__ as entry  # noqa: E402


def no_dock_icon():
    objc = ctypes.cdll.LoadLibrary(ctypes.util.find_library("objc"))
    objc.objc_getClass.restype = ctypes.c_void_p
    objc.sel_registerName.restype = ctypes.c_void_p
    msg = ctypes.cast(objc.objc_msgSend, ctypes.c_void_p).value
    send = ctypes.CFUNCTYPE(ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p)(msg)
    send_long = ctypes.CFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_long)(msg)
    app = send(objc.objc_getClass(b"NSApplication"), objc.sel_registerName(b"sharedApplication"))
    send_long(app, objc.sel_registerName(b"setActivationPolicy:"), 1)  # NSApplicationActivationPolicyAccessory


def on_every_desktop(widget):
    """No Mac uma janela fica na secretária (Space) onde abriu: ao trocar de secretária o widget ficava para trás.
    Com «canJoinAllSpaces» aparece em todas, e com «fullScreenAuxiliary» também por cima das apps em ecrã inteiro."""
    objc = ctypes.cdll.LoadLibrary(ctypes.util.find_library("objc"))
    objc.sel_registerName.restype = ctypes.c_void_p
    msg = ctypes.cast(objc.objc_msgSend, ctypes.c_void_p).value
    send = ctypes.CFUNCTYPE(ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p)(msg)
    get_ulong = ctypes.CFUNCTYPE(ctypes.c_ulong, ctypes.c_void_p, ctypes.c_void_p)(msg)
    set_ulong = ctypes.CFUNCTYPE(None, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_ulong)(msg)
    ns_window = send(int(widget.winId()), objc.sel_registerName(b"window"))
    if not ns_window:
        return
    can_join_all_spaces, move_to_active_space, full_screen_auxiliary = 1 << 0, 1 << 1, 1 << 8
    behavior = get_ulong(ns_window, objc.sel_registerName(b"collectionBehavior"))
    behavior = (behavior & ~move_to_active_space) | can_join_all_spaces | full_screen_auxiliary
    set_ulong(ns_window, objc.sel_registerName(b"setCollectionBehavior:"), behavior)


class MacApp(QApplication):
    def __init__(self, argv):
        super().__init__(argv)
        QTimer.singleShot(0, no_dock_icon)
        # Cada janela do widget (estrela, painel, avisos, Hub) passa a ir contigo para todas as secretárias.
        # Revê-se de meio em meio segundo porque o Qt cria uma janela nova do macOS quando muda «sempre por cima».
        self._done = set()
        self._spaces = QTimer(self)
        self._spaces.timeout.connect(self._follow_desktops)
        self._spaces.start(500)

    def _follow_desktops(self):
        for w in self.topLevelWidgets():
            if not w.isVisible() or not w.testAttribute(Qt.WA_WState_Created):
                continue
            wid = int(w.winId())
            if wid in self._done:
                continue
            try:
                on_every_desktop(w)
                self._done.add(wid)
            except Exception:  # noqa: BLE001 — nunca deixar isto partir o widget
                pass


def no_maximize_to_hub():
    """No Windows, Win+Cima maximiza o widget e ele vira o Hub (WidgetWindow.changeEvent). No Mac o Qt diz que uma
    janela sem moldura e de tamanho fixo está «maximizada» logo ao aparecer, e o Hub abria sozinho em vez da estrela."""
    from PySide6.QtCore import QEvent
    from PySide6.QtWidgets import QWidget
    from team_widget.ui.window import WidgetWindow

    def change_event(self, e):
        if e.type() == QEvent.WindowStateChange and self.isMaximized():
            return QWidget.changeEvent(self, e)
        return original(self, e)

    original = WidgetWindow.changeEvent
    WidgetWindow.changeEvent = change_event


def no_wallpaper_look():
    """A estrela olha para o fundo do ecrã de 20 em 20 s para escolher letras brancas ou escuras (Orb._sample).
    No Mac isso é gravar o ecrã: pedia a permissão de Gravação do ecrã e, sem ela, rebentava. Fica sempre branco."""
    from team_widget.ui.window import Orb
    Orb._sample = lambda self: None


def menu_bar_star_toggles():
    """A estrela da barra de menus (Agente AMG.app) manda «show» pelo socket do widget. No Windows isso só traz o
    widget para a frente; aqui abre logo a aba pequena no canto e, se ela já estiver aberta, volta à estrela."""
    from PySide6.QtNetwork import QLocalServer

    def listen(name, window):
        server = QLocalServer()
        QLocalServer.removeServer(name)
        server.listen(name)

        def come_forward():
            page = ""
            while (peer := server.nextPendingConnection()) is not None:
                peer.disconnected.connect(peer.deleteLater)
                if not peer.bytesAvailable():
                    peer.waitForReadyRead(300)
                said = bytes(peer.readAll()).decode("utf-8", "replace")
                if said.startswith("open "):
                    page = said[5:].strip()
            if page:
                entry.open_page(window, page)
                return
            expander = getattr(window, "_expander", None)
            if expander is not None and expander.isVisible():
                expander.showNormal()
                expander.raise_()
                expander.activateWindow()
            elif window.isVisible() and window.mode == "panel":
                window.collapse()
            else:
                window.show_panel(fade=False)
                if window.mode == "orb":
                    window.expand()
        server.newConnection.connect(come_forward)
        return server

    entry.listen_for_second_copy = listen


no_maximize_to_hub()
no_wallpaper_look()
menu_bar_star_toggles()
entry.QApplication = MacApp
entry.main()
