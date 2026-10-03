"""This PC's own numbers for the cockpit's dials: processor, memory, battery.

Straight from Windows (kernel32), so the widget needs no extra package. Anywhere else every reading is None.
"""
import ctypes
from ctypes import wintypes


class _FileTime(ctypes.Structure):
    _fields_ = [("low", wintypes.DWORD), ("high", wintypes.DWORD)]


class _Memory(ctypes.Structure):
    _fields_ = [("length", wintypes.DWORD), ("load", wintypes.DWORD), ("total", ctypes.c_ulonglong), ("free", ctypes.c_ulonglong),
                ("total_page", ctypes.c_ulonglong), ("free_page", ctypes.c_ulonglong), ("total_virtual", ctypes.c_ulonglong),
                ("free_virtual", ctypes.c_ulonglong), ("free_extended", ctypes.c_ulonglong)]


class _Power(ctypes.Structure):
    _fields_ = [("ac", ctypes.c_ubyte), ("flag", ctypes.c_ubyte), ("percent", ctypes.c_ubyte), ("saver", ctypes.c_ubyte),
                ("seconds", wintypes.DWORD), ("full_seconds", wintypes.DWORD)]


_kernel = getattr(getattr(ctypes, "windll", None), "kernel32", None)
_before = None      # (busy, total) at the last cpu() call


def cpu() -> float | None:
    """Processor use in percent since the last call; None on the first call."""
    global _before
    if _kernel is None:
        return None
    idle, kernel, user = _FileTime(), _FileTime(), _FileTime()
    if not _kernel.GetSystemTimes(ctypes.byref(idle), ctypes.byref(kernel), ctypes.byref(user)):
        return None
    idle, kernel, user = ((t.high << 32) | t.low for t in (idle, kernel, user))
    now = (kernel + user - idle, kernel + user)     # kernel time already counts the idle time
    before, _before = _before, now
    if before is None or now[1] <= before[1]:
        return None
    return max(0.0, min(100.0, 100.0 * (now[0] - before[0]) / (now[1] - before[1])))


def memory() -> dict | None:
    """{"pct", "used_gb", "total_gb"} of the physical memory."""
    if _kernel is None:
        return None
    m = _Memory()
    m.length = ctypes.sizeof(_Memory)
    if not _kernel.GlobalMemoryStatusEx(ctypes.byref(m)) or not m.total:
        return None
    gb = 1024 ** 3
    return {"pct": 100.0 * (m.total - m.free) / m.total, "used_gb": (m.total - m.free) / gb, "total_gb": m.total / gb}


def battery() -> dict | None:
    """{"pct", "plugged", "seconds"} (seconds left, None when unknown); None on a PC without a battery."""
    if _kernel is None:
        return None
    s = _Power()
    if not _kernel.GetSystemPowerStatus(ctypes.byref(s)) or s.flag & 128 or s.percent > 100:
        return None
    return {"pct": float(s.percent), "plugged": s.ac == 1, "seconds": None if s.seconds == 0xFFFFFFFF else s.seconds}
