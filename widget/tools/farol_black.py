"""Make the black (AMG «night») Farol pictures from the original ones, once: assets/farol-<pose>-black.png.

17 Nov, Marco: «mete ele com tons preto... MG». The chrome turns into black chrome, keeping every reflection of the
original (the shade is a curve on the brightness, so the shape and the highlights stay where they were). The star on the
helmet and the AMG plate stay brushed silver, and the eyes of the thinking pose keep their colours.

    python widget/tools/farol_black.py
"""
from pathlib import Path

import numpy as np
from PySide6.QtGui import QImage

ASSETS = Path(__file__).resolve().parent.parent / "team_widget" / "assets"

# (cx, cy, rx, ry) in the picture's pixels: what stays silver, and the eyes that keep their colours
SILVER = {"idle": [("ellipse", 150, 20, 21, 20), ("rect", 104, 246, 190, 299)],
          "think": [("ellipse", 147, 19, 21, 20), ("rect", 140, 252, 218, 303)]}
EYES = {"idle": [], "think": [(156.5, 90.5, 22.5, 24.5), (200, 78, 17.5, 23)]}


def _array(img: QImage) -> np.ndarray:
    img = img.convertToFormat(QImage.Format_RGBA8888)
    a = np.frombuffer(img.constBits(), np.uint8, img.sizeInBytes()).reshape(img.height(), img.bytesPerLine() // 4, 4)
    return a[:, :img.width()].astype(np.float32) / 255.0


def _mask(shape, regions, h, w):
    yy, xx = np.mgrid[0:h, 0:w]
    m = np.zeros((h, w), bool)
    for r in regions:
        if r[0] == "ellipse":
            _, cx, cy, rx, ry = r
            m |= ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2 <= 1
        else:
            _, x0, y0, x1, y1 = r
            m |= (xx >= x0) & (xx <= x1) & (yy >= y0) & (yy <= y1)
    return m


def blacken(pose: str):
    src = _array(QImage(str(ASSETS / f"farol-{pose}.png")))
    h, w = src.shape[:2]
    rgb, alpha = src[..., :3], src[..., 3:]
    L = (0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2])[..., None]
    # black chrome: deep body, the soft light kept low, the sharp highlights kept bright
    t = np.clip((L - 0.70) / 0.30, 0, 1)
    v = 0.030 + 0.42 * L ** 2.4 + 0.62 * t * t * (3 - 2 * t)
    black = np.clip(v * np.array([0.93, 0.97, 1.06]), 0, 1)
    # brushed silver for the star and the plate
    silver = np.clip((0.10 + 0.95 * L ** 1.35) * np.array([0.97, 0.99, 1.03]), 0, 1)
    out = np.where(_mask(None, SILVER[pose], h, w)[..., None], silver, black)
    keep = np.zeros((h, w), bool)
    yy, xx = np.mgrid[0:h, 0:w]
    for cx, cy, rx, ry in EYES[pose]:
        keep |= ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2 <= 1
    eye_like = (L[..., 0] > 0.62) | (rgb[..., 2] - rgb[..., 0] > 0.06) | (L[..., 0] < 0.10)   # white, blue iris, pupil
    keep &= eye_like
    out = np.where(keep[..., None], rgb, out)
    px = (np.concatenate([out, alpha], axis=2) * 255 + 0.5).astype(np.uint8)
    img = QImage(px.tobytes(), w, h, w * 4, QImage.Format_RGBA8888).copy()
    img.save(str(ASSETS / f"farol-{pose}-black.png"))


if __name__ == "__main__":
    for pose in ("idle", "think"):
        blacken(pose)
        print("ok", pose)
