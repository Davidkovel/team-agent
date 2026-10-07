"""One frame clock for every animation in the widget.

Ticks at the monitor's refresh rate and never below 144 Hz, so motion stays smooth on a 60 Hz screen too, but only while
something moves: whatever animates asks for frames with clock().need(self) and lets go with clock().need(self, False) once
it is at rest. With nothing moving the clock stops, and with it the 1 ms Windows timer resolution: a widget at rest does
no work at all. Animations read the time they are given instead of counting frames, so a late frame never slows them down.
"""
import sys
import time

from PySide6.QtCore import QObject, QTimer, Qt, Signal
from PySide6.QtGui import QGuiApplication

MIN_FPS = 144

_fine = set()   # whatever needs the 1 ms Windows timer resolution right now


def fine_timers(holder, on: bool = True):
    """The 1 ms Windows timer resolution, held while `holder` moves (on) and let go when it rests (off). Windows defaults
    to 15.6 ms, which caps animation near 64 fps; held when nothing moves, it only keeps the PC waking up for nothing."""
    had = bool(_fine)
    if on:
        _fine.add(holder)
    else:
        _fine.discard(holder)
    if sys.platform != "win32" or had == bool(_fine):
        return
    try:
        import ctypes
        if _fine:
            ctypes.windll.winmm.timeBeginPeriod(1)
        else:
            ctypes.windll.winmm.timeEndPeriod(1)
    except Exception:
        pass


class FrameClock(QObject):
    frame = Signal(float)   # seconds since the clock was made

    def __init__(self):
        super().__init__()
        self._start = time.perf_counter()
        self._timer = QTimer(self)
        self._timer.setTimerType(Qt.PreciseTimer)
        self._timer.timeout.connect(lambda: self.frame.emit(time.perf_counter() - self._start))
        self._moving = set()   # whatever asked for frames and has not come to rest yet

    @staticmethod
    def target_fps() -> float:
        screen = QGuiApplication.primaryScreen()
        return max(MIN_FPS, screen.refreshRate() if screen else 0)

    def need(self, who, on: bool = True):
        """`who` starts moving (on) or comes to rest (off). The clock ticks while anything moves and stops when all rest."""
        if on:
            self._moving.add(who)
        else:
            self._moving.discard(who)
        try:
            ticking = self._timer.isActive()
        except RuntimeError:   # Python is closing and Qt has already deleted the timer: nothing left to tick
            return
        if self._moving and not ticking:
            fine_timers(self)
            self._timer.start(max(1, int(1000 / self.target_fps())))
        elif not self._moving and ticking:
            self._timer.stop()
            fine_timers(self, False)


_clock = None


def clock() -> FrameClock:
    global _clock
    if _clock is None:
        _clock = FrameClock()
    return _clock
