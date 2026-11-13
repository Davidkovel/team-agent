"""Gmail inside the app: its own window, so nobody has to go to the browser.

Google refuses to sign in when it sees «QtWebEngine» in the browser name, so this window says it is plain Chrome (which
is what Qt's engine is underneath). It keeps its own profile on disk: you sign in once and the session stays, also
after the widget restarts. Every PC (David, Marco, Kovel) gets it with the widget."""

import os
import re

from PySide6.QtCore import QUrl
from PySide6.QtWebEngineCore import QWebEnginePage, QWebEngineProfile
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWidgets import QVBoxLayout, QWidget

GOOGLE = ("google.com", "gmail.com", "googleusercontent.com", "gstatic.com")


def is_google(url: QUrl) -> bool:
    host = url.host().lower()
    return url.scheme() == "mailto" or any(host == d or host.endswith("." + d) for d in GOOGLE)


_profile = None


def _google_profile() -> QWebEngineProfile:
    global _profile
    if _profile is None:
        _profile = QWebEngineProfile("amg-google")
        home = os.path.join(os.path.expanduser("~"), ".team-agent", "gmail")
        os.makedirs(home, exist_ok=True)
        _profile.setPersistentStoragePath(os.path.join(home, "storage"))
        _profile.setCachePath(os.path.join(home, "cache"))
        _profile.setPersistentCookiesPolicy(QWebEngineProfile.ForcePersistentCookies)
        ua = re.sub(r"\s*QtWebEngine/\S+", "", _profile.httpUserAgent())
        _profile.setHttpUserAgent(ua)
    return _profile


class _GooglePage(QWebEnginePage):
    """Google stays here; any other site goes to the browser."""

    def acceptNavigationRequest(self, url, nav_type, is_main_frame):
        if is_main_frame and url.scheme() in ("http", "https") and not is_google(url):
            from PySide6.QtGui import QDesktopServices

            QDesktopServices.openUrl(url)
            return False
        return True


class GmailWindow(QWidget):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Gmail · Agente AMG")
        self.resize(1200, 820)
        self.view = QWebEngineView()
        page = _GooglePage(_google_profile(), self.view)
        self.view.setPage(page)
        # Google opens some things in a new tab (attachments, «abrir noutra janela»): they open here too.
        page.newWindowRequested.connect(lambda req: self.view.load(req.requestedUrl()))
        box = QVBoxLayout(self)
        box.setContentsMargins(0, 0, 0, 0)
        box.addWidget(self.view)

    def open(self, url: QUrl):
        self.view.load(url)
        self.show()
        self.raise_()
        self.activateWindow()


_window = None


def open_gmail(url: QUrl):
    global _window
    if _window is None:
        _window = GmailWindow()
    _window.open(url)
