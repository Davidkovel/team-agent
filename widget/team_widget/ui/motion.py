"""One frame clock for every animation in the widget.

Ticks at the monitor's refresh rate and never below 144 Hz, so motion stays smooth on a 60 Hz screen too.
Animations read the time they are given instead of counting frames, so a late frame never slows them down.
"""
import sys
import time

from PySide6.QtCore import QObject, QTimer, Qt, Signal
from PySide6.QtGui import QGuiApplication

MIN_FPS = 144


class FrameClock(QObject):
    frame = Signal(float)   # seconds since the clock was made

    def __init__(self):
        super().__init__()
        self._start = time.perf_counter()
        self._timer = QTimer(self)
        self._timer.setTimerType(Qt.PreciseTimer)
        self._timer.timeout.connect(lambda: self.frame.emit(time.perf_counter() - self._start))
        self._users = 0

    @staticmethod
    def target_fps() -> float:
        screen = QGuiApplication.primaryScreen()
        return max(MIN_FPS, screen.refreshRate() if screen else 0)

    def start(self):
        if sys.platform == "win32":
            try:  # 1 ms timer resolution; Windows defaults to 15.6 ms, which caps animation near 64 fps
                import ctypes
                ctypes.windll.winmm.timeBeginPeriod(1)
            except Exception:
                pass
        self._timer.start(max(1, int(1000 / self.target_fps())))

    def stop(self):
        self._timer.stop()


_clock = None


def clock() -> FrameClock:
    global _clock
    if _clock is None:
        _clock = FrameClock()
    return _clock
