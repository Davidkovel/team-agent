"""Writes frontend/assets/car.svg from the widget's car (widget/team_widget/ui/car.py), so the Hub and the widget
show the same black coupe under the same slow studio light (SMIL animation, no script).
Run after changing the car: python scripts/make_car.py
"""
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "widget"))

from PySide6.QtGui import QPainterPath  # noqa: E402

from team_widget.ui import car  # noqa: E402

OUT = ROOT / "frontend" / "assets" / "car.svg"


def d(path: QPainterPath) -> str:
    """QPainterPath -> SVG path data (arcs are already cubic curves inside Qt)."""
    out, i, n = [], 0, path.elementCount()
    while i < n:
        e = path.elementAt(i)
        if e.type == QPainterPath.MoveToElement:
            out.append(f"M{e.x:.2f} {e.y:.2f}")
        elif e.type == QPainterPath.LineToElement:
            out.append(f"L{e.x:.2f} {e.y:.2f}")
        else:  # CurveToElement + two CurveToDataElement
            c2, end = path.elementAt(i + 1), path.elementAt(i + 2)
            out.append(f"C{e.x:.2f} {e.y:.2f} {c2.x:.2f} {c2.y:.2f} {end.x:.2f} {end.y:.2f}")
            i += 2
        i += 1
    return "".join(out)


def stops(pairs, colour="#fff") -> str:
    return "".join(f'<stop offset="{at:.3f}" stop-color="{colour}" stop-opacity="{a:g}"/>' for at, a in pairs)


def glide(name, x1, y1, x2, y2, peak) -> str:
    """A gradient band that crosses the car once per SWEEP_EVERY seconds, like car.py's sweep."""
    w, rest = car.W, car.SWEEP_TAKES / car.SWEEP_EVERY
    return (f'<linearGradient id="{name}" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" gradientUnits="userSpaceOnUse">'
            f'{stops(((0, 0), (0.5, peak), (1, 0)))}'
            f'<animateTransform attributeName="gradientTransform" type="translate" values="-80 0;{w + 80:g} 0;{w + 80:g} 0" '
            f'keyTimes="0;{rest:.3f};1" calcMode="spline" keySplines=".45 0 .55 1;0 0 1 1" dur="{car.SWEEP_EVERY:g}s" repeatCount="indefinite"/>'
            f'</linearGradient>')


def oval(name, cx, cy, rx, ry, pairs, colour="#fff", breathe=False) -> str:
    anim = (f'<animate attributeName="opacity" values=".88;1;.88" dur="{car.BREATH:g}s" repeatCount="indefinite" '
            f'calcMode="spline" keyTimes="0;.5;1" keySplines=".45 0 .55 1;.45 0 .55 1"/>') if breathe else ""
    return (f'<radialGradient id="{name}" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" '
            f'gradientTransform="translate({cx} {cy}) scale({rx} {ry})">{stops(pairs, colour)}</radialGradient>',
            f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="url(#{name})">{anim}</ellipse>')


def wheel(cx: float, cy: float) -> str:
    r = car.WHEEL_R
    spokes = []
    for i in range(10):
        a = math.radians(i * 36 - 90)
        x1, y1, x2, y2 = cx + 4.2 * math.cos(a), cy + 4.2 * math.sin(a), cx + 14.8 * math.cos(a), cy + 14.8 * math.sin(a)
        spokes.append(f'<path d="M{x1:.2f} {y1:.2f}L{x2:.2f} {y2:.2f}" stroke="#34373c" stroke-width="1.7"/>'
                      f'<path d="M{x1:.2f} {y1 - .6:.2f}L{x2:.2f} {y2 - .6:.2f}" stroke="#fff" stroke-opacity=".1" stroke-width=".45"/>')
    return (f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="url(#tyre)"/>'
            f'<circle cx="{cx}" cy="{cy}" r="15.5" fill="#0b0b0c"/><circle cx="{cx}" cy="{cy}" r="12" fill="#111214"/>'
            f'{"".join(spokes)}'
            f'<circle cx="{cx}" cy="{cy}" r="15.3" stroke="#4b4e54" stroke-opacity=".7" stroke-width=".7"/>'
            f'<circle cx="{cx}" cy="{cy}" r="3.4" fill="#1a1b1e" stroke="#3d4045" stroke-width=".6"/>'
            f'<path d="M{cx + (r - .5) * math.cos(math.radians(45)):.2f} {cy - (r - .5) * math.sin(math.radians(45)):.2f}'
            f'A{r - .5} {r - .5} 0 0 0 {cx - (r - .5) * math.cos(math.radians(45)):.2f} {cy - (r - .5) * math.sin(math.radians(45)):.2f}" '
            f'stroke="#fff" stroke-opacity=".13" stroke-width=".9"/>')


def main():
    w, h, g, top = car.W, car.H, car.GROUND, car.TOP
    paint = d(car.body_path()) + d(car.mirror_path())
    body, glass, seams = d(car.body_path()), d(car.glass_path()), d(car.seam_path())
    seams_low = d(car.seam_path().translated(0, 0.7))
    span = car.RIM_STOPS[-1][0] - car.RIM_STOPS[0][0]
    rim = [((y - car.RIM_STOPS[0][0]) / span, a) for y, a in car.RIM_STOPS]
    paint_stops = "".join(f'<stop offset="{at:.3f}" stop-color="{c}"/>' for at, c in car.stops_y(30, 93, car.BODY_STOPS))
    back_def, back = oval("back", 176, 62, 185, 58, ((0, .055), (1, 0)), breathe=True)
    spot_def, spot = oval("spot", 176, g + 1, 200, 22, ((0, .12), (.6, .03), (1, 0)), breathe=True)
    shadow_def, shadow = oval("shadow", 176, g, 158, 5.5, ((0, .94), (1, 0)), colour="#000")
    head_def, head_glow = oval("head", 318, 65.5, 11, 11, ((0, .22), (1, 0)), breathe=True)

    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 {top:g} {w:g} {h - top:g}" fill="none" stroke-linecap="round" stroke-linejoin="round">
  <!-- Made by scripts/make_car.py from widget/team_widget/ui/car.py: a black coupe in profile under a slow studio light. -->
  <defs>
    {back_def}{spot_def}{shadow_def}{head_def}
    <linearGradient id="paint" x1="0" y1="30" x2="0" y2="93" gradientUnits="userSpaceOnUse">{paint_stops}</linearGradient>
    <linearGradient id="ends" x1="20" y1="0" x2="332" y2="0" gradientUnits="userSpaceOnUse">{stops(((0, .59), (.18, 0), (.82, 0), (1, .51)), "#000")}</linearGradient>
    <linearGradient id="floorlight" x1="0" y1="70" x2="0" y2="84" gradientUnits="userSpaceOnUse">{stops(((0, 0), (.55, .045), (1, 0)))}</linearGradient>
    <linearGradient id="sheen" x1="80" y1="30" x2="200" y2="54" gradientUnits="userSpaceOnUse">{stops(((0, 0), (.35, .07), (.5, .02), (.7, .06), (1, 0)))}</linearGradient>
    <linearGradient id="rim" x1="0" y1="{car.RIM_STOPS[0][0]}" x2="0" y2="{car.RIM_STOPS[-1][0]}" gradientUnits="userSpaceOnUse">{stops(rim)}</linearGradient>
    <radialGradient id="tyre"><stop offset=".78" stop-color="#09090a"/><stop offset=".94" stop-color="#18191b"/><stop offset="1" stop-color="#060607"/></radialGradient>
    {glide("band", -55, 75, 55, 20, .16)}
    {glide("bandglass", -40, 75, 40, 20, .2)}
    {glide("edge", -70, 0, 70, 0, .45)}
    <clipPath id="upper"><rect width="{w:g}" height="61"/></clipPath>
  </defs>
  {back}{spot}{shadow}
  <path d="{paint}" fill="url(#paint)"/>
  <path d="{body}" fill="url(#ends)"/>
  <path d="{body}" fill="url(#floorlight)"/>
  <path d="{glass}" fill="#050607"/>
  <path d="{glass}" fill="url(#sheen)"/>
  <path d="{seams_low}" stroke="#fff" stroke-opacity=".05" stroke-width=".6"/>
  <path d="{seams}" stroke="#000" stroke-opacity=".9" stroke-width=".8"/>
  <path d="{d(car.shoulder_path())}" stroke="#fff" stroke-opacity=".09" stroke-width="1.1"/>
  <path d="{paint}" stroke="url(#rim)" stroke-width=".9"/>
  <path d="{d(car.taillight_path())}" fill="#1c1d20" stroke="#fff" stroke-opacity=".1" stroke-width=".5"/>
  {wheel(car.WHEELS[0].x(), car.WHEELS[0].y())}
  {wheel(car.WHEELS[1].x(), car.WHEELS[1].y())}
  {head_glow}
  <path d="{d(car.headlight_path())}" fill="#d7dadd" fill-opacity=".86"/>
  <path d="{paint}" fill="url(#band)"/>
  <path d="{glass}" fill="url(#bandglass)"/>
  <path d="{paint}" stroke="url(#edge)" stroke-width=".9" clip-path="url(#upper)"/>
</svg>
'''
    OUT.write_text(svg, encoding="utf-8", newline="\n")
    print("car written", OUT)


if __name__ == "__main__":
    main()
