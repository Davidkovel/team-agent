"""Where the Claude of this computer is working, on the screen (17 Nov, Marco: «tinha de estar sempre a identificar onde é
que o robôzinho ou o Claude estava a mexer»).

Claude Code puts its state in the terminal's title: a spinning ◐ ◓ ◑ ◒ while it works, ✳ when it waits. So the windows
whose title carries the spinner are the ones working, and the system tells where they are. No polling of anything else,
one call every few seconds (about a millisecond). Mac: the window list of CoreGraphics; Windows: the top windows' titles.
Returns [(title, x, y, w, h)] in screen points, front-most first, only the ones you can see: a window hidden behind
another (Chrome over the terminal) does not count, so the Farol never floats over something else. Without the right to read titles (macOS Screen
Recording) the list is just empty, and the Farol stays home."""
import ctypes
import re
import sys

SPIN = re.compile(r"(^|[—\-:|]\s*)[◐◑◒◓⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⠂⠐✶✻✽✢]\s")
_LIBS = []


def working_windows() -> list:
    try:
        if sys.platform == "darwin":
            return _mac()
        if sys.platform == "win32":
            return _win()
    except (OSError, AttributeError, ValueError, TypeError):
        pass
    return []


class _Rect(ctypes.Structure):
    _fields_ = [("x", ctypes.c_double), ("y", ctypes.c_double), ("w", ctypes.c_double), ("h", ctypes.c_double)]


def _mac() -> list:
    if not _LIBS:
        cf = ctypes.cdll.LoadLibrary("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation")
        cg = ctypes.cdll.LoadLibrary("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics")
        vp = ctypes.c_void_p
        cg.CGWindowListCopyWindowInfo.restype, cg.CGWindowListCopyWindowInfo.argtypes = vp, [ctypes.c_uint32, ctypes.c_uint32]
        cg.CGRectMakeWithDictionaryRepresentation.restype = ctypes.c_bool
        cg.CGRectMakeWithDictionaryRepresentation.argtypes = [vp, ctypes.POINTER(_Rect)]
        cf.CFArrayGetCount.restype, cf.CFArrayGetCount.argtypes = ctypes.c_long, [vp]
        cf.CFArrayGetValueAtIndex.restype, cf.CFArrayGetValueAtIndex.argtypes = vp, [vp, ctypes.c_long]
        cf.CFDictionaryGetValue.restype, cf.CFDictionaryGetValue.argtypes = vp, [vp, vp]
        cf.CFStringCreateWithCString.restype = vp
        cf.CFStringCreateWithCString.argtypes = [vp, ctypes.c_char_p, ctypes.c_uint32]
        cf.CFStringGetCString.restype = ctypes.c_bool
        cf.CFStringGetCString.argtypes = [vp, ctypes.c_char_p, ctypes.c_long, ctypes.c_uint32]
        cf.CFNumberGetValue.restype, cf.CFNumberGetValue.argtypes = ctypes.c_bool, [vp, ctypes.c_int, vp]
        cf.CFRelease.argtypes = [vp]
        keys = {k: cf.CFStringCreateWithCString(None, k.encode(), 0x08000100)
                for k in ("kCGWindowName", "kCGWindowOwnerName", "kCGWindowBounds", "kCGWindowLayer")}
        _LIBS.extend((cf, cg, keys))
    cf, cg, keys = _LIBS

    def text(ref) -> str:
        if not ref:
            return ""
        buf = ctypes.create_string_buffer(1024)
        return buf.value.decode("utf-8", "replace") if cf.CFStringGetCString(ref, buf, 1024, 0x08000100) else ""

    arr = cg.CGWindowListCopyWindowInfo(1 | 16, 0)        # on screen only, no desktop elements; front-most first
    if not arr:
        return []
    out, front = [], []
    try:
        for i in range(cf.CFArrayGetCount(arr)):
            d = cf.CFArrayGetValueAtIndex(arr, i)
            layer = ctypes.c_int(0)
            ref = cf.CFDictionaryGetValue(d, keys["kCGWindowLayer"])
            if ref:
                cf.CFNumberGetValue(ref, 9, ctypes.byref(layer))
            if layer.value != 0:
                continue
            if text(cf.CFDictionaryGetValue(d, keys["kCGWindowOwnerName"])).lower().startswith("python"):
                continue                                   # the widget's own windows
            r = _Rect()
            if not cg.CGRectMakeWithDictionaryRepresentation(cf.CFDictionaryGetValue(d, keys["kCGWindowBounds"]),
                                                             ctypes.byref(r)) or r.w < 60 or r.h < 40:
                continue
            title = text(cf.CFDictionaryGetValue(d, keys["kCGWindowName"]))
            box = (round(r.x), round(r.y), round(r.w), round(r.h))
            if title and SPIN.search(title) and r.w > 120 and r.h > 80 and _seen(box, front):
                out.append((title,) + box)
            front.append(box)
    finally:
        cf.CFRelease(arr)
    return out


def _seen(box, front) -> bool:
    """Is the top right of this window (where the Farol stands) free of the windows in front of it?"""
    x, y, w, h = box
    px, py = x + w * 0.75, y + 12
    return not any(fx <= px <= fx + fw and fy <= py <= fy + fh for fx, fy, fw, fh in front)


def _win() -> list:
    u = ctypes.windll.user32
    out, front = [], []

    class RECT(ctypes.Structure):
        _fields_ = [("l", ctypes.c_long), ("t", ctypes.c_long), ("r", ctypes.c_long), ("b", ctypes.c_long)]

    @ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
    def each(hwnd, _):
        if u.IsWindowVisible(hwnd) and not u.IsIconic(hwnd):
            r = RECT()
            u.GetWindowRect(hwnd, ctypes.byref(r))
            box = (r.l, r.t, r.r - r.l, r.b - r.t)
            if box[2] < 60 or box[3] < 40:
                return True
            n = u.GetWindowTextLengthW(hwnd)
            buf = ctypes.create_unicode_buffer(n + 1)
            if n:
                u.GetWindowTextW(hwnd, buf, n + 1)
            if n and SPIN.search(buf.value) and box[2] > 120 and box[3] > 80 and _seen(box, front):
                out.append((buf.value,) + box)
            front.append(box)
        return True

    u.EnumWindows(each, 0)
    return out
