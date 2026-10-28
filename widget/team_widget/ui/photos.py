"""The partners' pictures: their GitHub profile photos, as in the Hub (frontend/hub/ui.js, GITHUB), round.

28 Oct, Marco: «a nossa foto tem ainda a do Volvo... a gente já trocou de foto lá no GitHub». The widget used to draw the
star for everyone; now each row shows the person's own photo, kept in ~/.team-agent/avatars and fetched again every few
hours off the UI thread, so a new photo on GitHub reaches the widget the same day. With no photo (no network the first
time) the caller draws the star as before.
"""
import threading
import time
import urllib.request
from pathlib import Path

from PySide6.QtCore import QObject, QRectF, Qt, Signal
from PySide6.QtGui import QImage, QPainter, QPainterPath, QPixmap

GITHUB = {"owner": "Davidkovel", "mark": "SLayer-marco", "david": "Daviddsstt"}   # Hub login -> GitHub account
FOLDER = Path.home() / ".team-agent" / "avatars"
FRESH = 6 * 3600   # seconds a photo on disk is good for before GitHub is asked again


class Photos(QObject):
    ready = Signal()   # a photo arrived: the rows that show it repaint

    def __init__(self):
        super().__init__()
        self._images: dict[str, QImage] = {}
        self._round: dict[tuple, QPixmap] = {}
        self._asked: dict[str, float] = {}

    def _file(self, user: str) -> Path:
        return FOLDER / f"{GITHUB[user]}.png"

    def _fetch(self, user: str):
        try:
            with urllib.request.urlopen(f"https://github.com/{GITHUB[user]}.png?size=160", timeout=10) as r:
                data = r.read()
            if len(data) > 200:
                FOLDER.mkdir(parents=True, exist_ok=True)
                tmp = self._file(user).with_suffix(".tmp")
                tmp.write_bytes(data)
                tmp.replace(self._file(user))
                self._images.pop(user, None)
                self._round = {k: v for k, v in self._round.items() if k[0] != user}
                self.ready.emit()
        except OSError:
            pass   # offline: the photo on disk (or the star) stays

    def photo(self, user: str, size: int, dpr: float) -> QPixmap | None:
        """The person's photo in a circle `size` across, or None until there is one."""
        if user not in GITHUB:
            return None
        f = self._file(user)
        stale = not f.exists() or time.time() - f.stat().st_mtime > FRESH
        if stale and time.time() - self._asked.get(user, 0) > 600:
            self._asked[user] = time.time()
            threading.Thread(target=self._fetch, args=(user,), daemon=True).start()
        if user not in self._images:
            img = QImage(str(f)) if f.exists() else QImage()
            if img.isNull():
                return None
            self._images[user] = img
        key = (user, size, round(dpr, 2))
        if key not in self._round:
            pix = QPixmap(round(size * dpr), round(size * dpr))
            pix.setDevicePixelRatio(dpr)
            pix.fill(Qt.transparent)
            p = QPainter(pix)
            p.setRenderHint(QPainter.Antialiasing)
            p.setRenderHint(QPainter.SmoothPixmapTransform)
            clip = QPainterPath()
            clip.addEllipse(QRectF(0, 0, size, size))
            p.setClipPath(clip)
            img = self._images[user]
            side = min(img.width(), img.height())
            src = QRectF((img.width() - side) / 2, (img.height() - side) / 2, side, side)
            p.drawImage(QRectF(0, 0, size, size), img, src)
            p.end()
            self._round[key] = pix
        return self._round[key]


_photos: Photos | None = None


def photos() -> Photos:
    global _photos
    if _photos is None:
        _photos = Photos()
    return _photos
