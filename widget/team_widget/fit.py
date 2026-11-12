"""The widget fits the screen it runs on: the cockpit was drawn for a 1080p monitor and was cut off below on a
MacBook Air (12 Nov, Marco: 906 px of cockpit on 859 px of screen) and on any small laptop.

Qt can only shrink everything by the same amount before the application exists (QT_SCALE_FACTOR), so the usable
height of the main screen is read straight from the system, without Qt. A screen that is tall enough changes nothing.
"""
import ctypes
import ctypes.util
import os
import platform
import sys

NEED = 990      # px the open cockpit takes with its shadow, at the size it was drawn
SMALLEST = 0.75  # below this the letters stop being readable: better cut than tiny
STEP = 0.05


def scale_for(usable: float | None, need: float = NEED) -> float:
    """1.0 when the cockpit fits in `usable` px of height, otherwise how much to shrink it, in steps of 5%."""
    if not usable or usable >= need:
        return 1.0
    steps = int(usable / need / STEP + 1e-9)   # rounded down: it has to fit
    return max(SMALLEST, round(steps * STEP, 2))


def _windows() -> float | None:
    class Rect(ctypes.Structure):
        _fields_ = [("left", ctypes.c_long), ("top", ctypes.c_long), ("right", ctypes.c_long), ("bottom", ctypes.c_long)]

    user32 = ctypes.windll.user32
    area = Rect()
    if not user32.SystemParametersInfoW(0x0030, 0, ctypes.byref(area), 0):   # SPI_GETWORKAREA: the screen less the taskbar
        return None
    try:
        dpi = user32.GetDpiForSystem()   # 96 when Windows already gives this process scaled numbers
    except AttributeError:
        dpi = 96
    return (area.bottom - area.top) * 96 / (dpi or 96)


def _mac() -> float | None:
    class Rect(ctypes.Structure):
        _fields_ = [("x", ctypes.c_double), ("y", ctypes.c_double), ("w", ctypes.c_double), ("h", ctypes.c_double)]

    ctypes.cdll.LoadLibrary(ctypes.util.find_library("AppKit"))
    objc = ctypes.cdll.LoadLibrary(ctypes.util.find_library("objc"))
    objc.objc_getClass.restype = objc.sel_registerName.restype = ctypes.c_void_p
    objc.objc_getClass.argtypes = objc.sel_registerName.argtypes = [ctypes.c_char_p]
    send = objc.objc_msgSend
    send.restype, send.argtypes = ctypes.c_void_p, [ctypes.c_void_p, ctypes.c_void_p]
    screen = send(objc.objc_getClass(b"NSScreen"), objc.sel_registerName(b"mainScreen"))
    if not screen:
        return None
    # visibleFrame: the screen less the menu bar and the Dock. On Intel a struct this big comes back through _stret.
    frame = objc.objc_msgSend_stret if platform.machine() == "x86_64" else objc.objc_msgSend
    if platform.machine() == "x86_64":
        rect = Rect()
        frame.restype, frame.argtypes = None, [ctypes.POINTER(Rect), ctypes.c_void_p, ctypes.c_void_p]
        frame(ctypes.byref(rect), screen, objc.sel_registerName(b"visibleFrame"))
        return rect.h or None
    frame = ctypes.CFUNCTYPE(Rect, ctypes.c_void_p, ctypes.c_void_p)(("objc_msgSend", objc))
    return frame(screen, objc.sel_registerName(b"visibleFrame")).h or None


def usable_height() -> float | None:
    """Height of the main screen that a window may use, in the px Qt counts in. None when it cannot be known."""
    try:
        if sys.platform == "win32":
            return _windows()
        if sys.platform == "darwin":
            return _mac()
    except Exception:
        pass
    return None


def apply(need: float | None = None):
    """Call before QApplication exists. Somebody who set QT_SCALE_FACTOR by hand keeps it."""
    if os.environ.get("QT_SCALE_FACTOR"):
        return
    need = need or float(os.environ.get("TEAM_WIDGET_NEED") or NEED)
    scale = scale_for(usable_height(), need)
    if scale < 1.0:
        os.environ["QT_SCALE_FACTOR"] = str(scale)
