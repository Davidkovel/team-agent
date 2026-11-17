"""Turns Marco's chrome Farol into the AMG Night look: black chrome and smoked headlight glass, the eyes taken out
(the widget draws them live, so they can blink, look around and change expression)."""
import math
import sys
from PySide6.QtGui import QImage, QColor
EYES = {"idle": ((121, 102, 138, 117), (158, 101, 175, 117)),
        "think": ((164, 89, 177, 100), (202, 77, 214, 89)),
        "work": ((115, 130, 127, 143), (151, 136, 163, 150))}
src_dir, out_dir = sys.argv[1], sys.argv[2]
for pose, eyes in EYES.items():
    img = QImage(f"{src_dir}/farol-{pose}.png").convertToFormat(QImage.Format_ARGB32)
    ells = [((x0+x1)/2, (y0+y1)/2, (x1-x0)/2+11, (y1-y0)/2+14) for x0, y0, x1, y1 in eyes]
    for y in range(img.height()):
        for x in range(img.width()):
            c = QColor.fromRgba(img.pixel(x, y))
            a = c.alpha()
            if a == 0:
                continue
            r, g, b = c.redF(), c.greenF(), c.blueF()
            L = 0.2126*r + 0.7152*g + 0.0722*b
            d = min(((x-cx)/rx)**2 + ((y-cy)/ry)**2 for cx, cy, rx, ry in ells)
            warm = (r - b) > 0.05 and r >= g >= b * 0.98
            if d <= 1.0:
                # where the eye was: plain smoked glass with its faint vertical ribs
                v = 0.055 + 0.018 * math.sin(x * 1.25)
                nr, ng, nb = v*0.86, v*0.94, v*1.14
            elif warm:
                v = 0.04 + 0.30 * L ** 1.35            # the warm headlight glass, smoked
                nr, ng, nb = v*0.86, v*0.94, v*1.14
            else:
                v = 0.045 + 0.92 * L ** 1.7            # chrome -> black chrome, highlights kept
                nr, ng, nb = v*0.93, v*0.96, v*1.04
            if 1.0 < d < 1.35 and (warm or L > 0.5):  # the eyes' soft edge: blend into the glass
                v = 0.06 + 0.10 * L
                nr, ng, nb = v*0.86, v*0.94, v*1.14
            img.setPixelColor(x, y, QColor.fromRgbF(min(1, nr), min(1, ng), min(1, nb), a/255))
    img.save(f"{out_dir}/farol-{pose}.png")
