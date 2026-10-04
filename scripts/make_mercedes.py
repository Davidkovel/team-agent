"""Draws the front of the Mercedes for the Hub's Início, as two still pictures that sit one on top of the other:

    frontend/assets/mercedes-front.svg    the car in the dark: hood, grille with the star, headlights (off), bumper, floor
    frontend/assets/mercedes-lights.svg   only the light: the LED eyebrows and lenses, their glow, their reflection on the floor

Vector, so it stays sharp at any size and screen density (4K included); still, so the browser draws it once and keeps it.
The page fades the light in once per session (opacity only, done by the graphics card). The star is assets/mercedes-star.svg
copied in: an SVG shown as an <img> cannot load other files. Everything left of the middle is drawn once and mirrored.

Run after changing the car: python scripts/make_mercedes.py [output folder]   (default: frontend/assets)
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "frontend" / "assets"
W, H = 1600, 560
MIRROR = f'transform="translate({W} 0) scale(-1 1)"'

# ---------------------------------------------------------------- the shapes (left half, or whole when symmetric)
# the body's lower corners are cut away, so the front tyres show under the wings
BODY = ("M238 466C206 466 184 452 176 430L168 350C166 312 176 290 198 276C244 248 322 222 404 206"
        "C520 190 680 184 800 184C920 184 1080 190 1196 206C1278 222 1356 248 1402 276"
        "C1424 290 1434 312 1432 350L1424 430C1416 452 1394 466 1362 466Z")
HOOD_EDGE = "M404 206C520 190 680 184 800 184C920 184 1080 190 1196 206"
HOOD = HOOD_EDGE + "L1114 100C1012 92 902 88 800 88C698 88 588 92 486 100Z"
GLASS = "M486 100C588 92 698 88 800 88C902 88 1012 92 1114 100L1054 -4H546Z"
# slim and angular: tall at the wing, tapering into the grille
HEADLIGHT = ("M276 218L304 206C380 199 470 203 546 212L598 220C612 222 618 232 612 242L604 250"
             "C592 254 572 255 552 254L380 246C334 243 300 234 276 218Z")
DRL = "M292 214C330 205 420 203 546 214L594 222C604 224 608 232 604 240"   # the eyebrow, hooking down at the grille
STARS = [(332, 226, 7.5), (368, 229, 7.5)]                                  # the star-shaped daytime lights
MODULES = [(436, 236), (484, 239), (532, 242)]                              # the Multibeam lenses
GRILLE = "M638 212H962Q988 212 992 238L1006 322Q1010 348 982 348H618Q590 348 594 322L608 238Q612 212 638 212Z"
STAR_X, STAR_Y, STAR_R = 800, 280, 57
SLATS = [228 + i * 14.5 for i in range(8)]
INTAKE = "M560 386H1040Q1058 386 1056 402L1050 432Q1046 446 1030 446H570Q554 446 550 432L544 402Q542 386 560 386Z"
BLADE = "M536 386C640 378 960 378 1064 386"
SIDE_INTAKE = "M262 382L452 374Q466 374 464 387L458 424Q456 436 443 436L292 440Q278 440 274 430Z"
LIP = "M246 452C520 460 1080 460 1354 452"
TRI = "M0 -9L1.7 -1.2L8.2 5.2L0 2.1L-8.2 5.2L-1.7 -1.2Z"   # a three-pointed star, 18 units across


def grille_left(y: float) -> float:
    """x of the inside of the grille's left side at height y (the sides lean out towards the bottom)."""
    return 608 - (y - 238) * 14 / 84


def module(x: float, y: float, w: float = 36, h: float = 13) -> str:
    """A rounded lens box, leaning with the headlight (it rises towards the wing)."""
    return f'<rect x="{x - w / 2}" y="{y - h / 2}" width="{w}" height="{h}" rx="4" transform="rotate(3.4 {x} {y})"'


def louver(x1: float, x2: float, y: float, h: float = 9) -> str:
    r = h / 2
    return f"M{x1:.1f} {y - r:.1f}H{x2:.1f}a{r} {r} 0 0 1 0 {h}H{x1:.1f}a{r} {r} 0 0 1 0 -{h}Z"


def star() -> str:
    """assets/mercedes-star.svg as a nested picture, its ids renamed so they cannot clash with the car's."""
    src = (ASSETS / "mercedes-star.svg").read_text(encoding="utf-8")
    inner = re.search(r"<svg[^>]*>(.*)</svg>", src, re.S).group(1)
    inner = re.sub(r"<desc>.*?</desc>", "", inner, flags=re.S)
    inner = re.sub(r'id="([^"]+)"', r'id="st-\1"', inner)
    inner = re.sub(r"url\(#([^)]+)\)", r"url(#st-\1)", inner)
    size = STAR_R * 2
    return f'<svg x="{STAR_X - STAR_R}" y="{STAR_Y - STAR_R}" width="{size}" height="{size}" viewBox="0 0 64 64">{inner}</svg>'


# ---------------------------------------------------------------- shared pieces of the two files
CHROME = """<linearGradient id="chrome" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f6f9fc"/><stop offset=".26" stop-color="#cdd5df"/><stop offset=".5" stop-color="#5f6a7a"/>
      <stop offset=".57" stop-color="#2a313e"/><stop offset=".8" stop-color="#b3bdca"/><stop offset="1" stop-color="#eaeff5"/></linearGradient>
    <linearGradient id="chrome-dim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#a3afc0"/><stop offset=".5" stop-color="#394252"/><stop offset="1" stop-color="#7d8898"/></linearGradient>"""

# the car fades into the page at its edges and its top, so it sits in the dark like the photo it stands for
FADE = """<radialGradient id="fade-r" cx="800" cy="258" r="800" gradientUnits="userSpaceOnUse"
        gradientTransform="translate(0 258) scale(1 .58) translate(0 -258)">
      <stop offset=".6" stop-color="#fff"/><stop offset=".84" stop-color="#fff" stop-opacity=".4"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <linearGradient id="fade-t" x1="0" y1="0" x2="0" y2="140" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff"/></linearGradient>
    <mask id="fade-round" maskUnits="userSpaceOnUse" x="0" y="0" width="1600" height="560"><rect width="1600" height="560" fill="url(#fade-r)"/></mask>
    <mask id="fade-top" maskUnits="userSpaceOnUse" x="0" y="0" width="1600" height="560"><rect width="1600" height="560" fill="url(#fade-t)"/></mask>"""


def svg(defs: str, body: str) -> str:
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">\n'
            f"  <defs>\n    {defs}\n  </defs>\n"
            f'  <g mask="url(#fade-round)"><g mask="url(#fade-top)">\n{body}\n  </g></g>\n</svg>\n')


# ---------------------------------------------------------------- the car, lights off
def front() -> str:
    defs = f"""{CHROME}
    {FADE}
    <linearGradient id="body" x1="0" y1="180" x2="0" y2="470" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#121c2f"/><stop offset=".32" stop-color="#0a111e"/><stop offset="1" stop-color="#04060b"/></linearGradient>
    <linearGradient id="body-sides" x1="160" y1="0" x2="1440" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#000" stop-opacity=".75"/><stop offset=".16" stop-color="#000" stop-opacity="0"/>
      <stop offset=".84" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".75"/></linearGradient>
    <linearGradient id="hood" x1="0" y1="86" x2="0" y2="200" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#080d18"/><stop offset=".7" stop-color="#101a2c"/><stop offset="1" stop-color="#172338"/></linearGradient>
    <radialGradient id="hood-sheen" cx="800" cy="150" r="320" gradientUnits="userSpaceOnUse"
        gradientTransform="translate(0 150) scale(1 .16) translate(0 -150)">
      <stop offset="0" stop-color="#9fb6dc" stop-opacity=".16"/><stop offset="1" stop-color="#9fb6dc" stop-opacity="0"/></radialGradient>
    <linearGradient id="edge-gleam" x1="400" y1="0" x2="1200" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#dfe9ff" stop-opacity="0"/><stop offset=".22" stop-color="#dfe9ff" stop-opacity=".55"/>
      <stop offset=".5" stop-color="#ffffff" stop-opacity=".8"/><stop offset=".78" stop-color="#dfe9ff" stop-opacity=".55"/>
      <stop offset="1" stop-color="#dfe9ff" stop-opacity="0"/></linearGradient>
    <linearGradient id="line-fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#b9cbea" stop-opacity="0"/><stop offset=".55" stop-color="#b9cbea" stop-opacity=".22"/>
      <stop offset="1" stop-color="#b9cbea" stop-opacity="0"/></linearGradient>
    <linearGradient id="glass" x1="0" y1="0" x2="0" y2="98" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#03060c"/><stop offset="1" stop-color="#0c1525"/></linearGradient>
    <linearGradient id="hl-glass" x1="0" y1="200" x2="0" y2="268" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#1a2840"/><stop offset=".5" stop-color="#0b1424"/><stop offset="1" stop-color="#05080f"/></linearGradient>
    <linearGradient id="hl-sheen" x1="0" y1="200" x2="0" y2="236" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#e6efff" stop-opacity=".2"/><stop offset="1" stop-color="#e6efff" stop-opacity="0"/></linearGradient>
    <pattern id="hl-cells" width="6" height="4.5" patternUnits="userSpaceOnUse" patternTransform="rotate(4)">
      <rect x=".4" y=".4" width="5.2" height="3.7" rx=".8" fill="none" stroke="#24344f" stroke-width=".5"/></pattern>
    <linearGradient id="grille-deep" x1="0" y1="214" x2="0" y2="356" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#0d131e"/><stop offset=".5" stop-color="#05080e"/><stop offset="1" stop-color="#020306"/></linearGradient>
    <radialGradient id="star-well" cx="{STAR_X}" cy="{STAR_Y}" r="78" gradientUnits="userSpaceOnUse">
      <stop offset=".72" stop-color="#000" stop-opacity=".85"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    <radialGradient id="floor-shadow" cx="800" cy="472" r="720" gradientUnits="userSpaceOnUse"
        gradientTransform="translate(0 472) scale(1 .05) translate(0 -472)">
      <stop offset="0" stop-color="#000" stop-opacity=".9"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    <pattern id="grille-fine" width="8" height="7" patternUnits="userSpaceOnUse">
      <rect width="8" height="7" fill="#03050a"/><rect y="5.6" width="8" height="1.1" fill="#1a2334"/><rect width=".9" height="7" fill="#0c121c"/></pattern>
    <pattern id="mesh" width="14" height="12" patternUnits="userSpaceOnUse">
      <rect width="14" height="12" fill="#030509"/>
      <path d="M3.5 0L0 6L3.5 12M10.5 0L14 6L10.5 12M3.5 0H10.5M3.5 12H10.5M0 6H-1M14 6H15" fill="none" stroke="#1c2635" stroke-width="1"/></pattern>
    <clipPath id="grille-clip"><path d="{GRILLE}"/></clipPath>
    <clipPath id="hl-clip"><path d="{HEADLIGHT}"/></clipPath>
    <clipPath id="intake-clip"><path d="{INTAKE}"/></clipPath>
    <linearGradient id="lens-box" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2c3d5e"/><stop offset=".5" stop-color="#070b14"/><stop offset="1" stop-color="#3a4c6e"/></linearGradient>
    <radialGradient id="bumper-sheen" cx="800" cy="368" r="540" gradientUnits="userSpaceOnUse"
        gradientTransform="translate(0 368) scale(1 .05) translate(0 -368)">
      <stop offset="0" stop-color="#b3c6e8" stop-opacity=".09"/><stop offset="1" stop-color="#b3c6e8" stop-opacity="0"/></radialGradient>
    <g id="headlight">
      <path d="{HEADLIGHT}" fill="url(#hl-glass)"/>
      <g clip-path="url(#hl-clip)">
        <path d="{HEADLIGHT}" fill="url(#hl-cells)" opacity=".7"/>
        <path d="M404 228L566 238Q578 239 577 248Q576 256 564 256L404 248Q392 247 393 238Q394 228 404 228Z" fill="#0a1220" stroke="#8ea4c6" stroke-opacity=".16"/>
        {''.join(f'{module(x, y)} fill="url(#chrome-dim)"/>{module(x, y, 31, 8.5)} fill="url(#lens-box)"/>'
                 f'{module(x, y - 2.6, 24, 1)} fill="#fff" fill-opacity=".35"/>' for x, y in MODULES)}
        {''.join(f'<path d="{TRI}" transform="translate({x} {y}) scale({s / 9:.3f})" fill="#34445f" stroke="#a8bbd9" stroke-opacity=".3" stroke-width=".5"/>'
                 for x, y, s in STARS)}
        <path d="M318 238C400 246 500 251 590 252" fill="none" stroke="#7a5326" stroke-opacity=".45" stroke-width="2" stroke-linecap="round"/>
        <path d="{HEADLIGHT}" fill="url(#hl-sheen)"/>
        <path d="M296 224L322 208M600 226L582 252" stroke="#c9d8f2" stroke-opacity=".06" stroke-width="9" stroke-linecap="round"/>
      </g>
      <path d="{DRL}" fill="none" stroke="#61789c" stroke-opacity=".6" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="{DRL}" fill="none" stroke="#d6e2f5" stroke-opacity=".22" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="{HEADLIGHT}" fill="none" stroke="url(#chrome-dim)" stroke-width="1.8"/>
      <path d="M304 206C380 199 470 203 546 212" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width=".8"/>
    </g>
    <g id="side-intake">
      <path d="{SIDE_INTAKE}" fill="url(#mesh)" stroke="#9fb3d4" stroke-opacity=".12" stroke-width="1.2"/>
      <path d="M280 396L460 390M284 416L458 410" stroke="url(#chrome-dim)" stroke-width="2.6" stroke-linecap="round"/>
      <path d="M266 378L452 370" stroke="#c6d4ec" stroke-opacity=".22" stroke-width="1.2" stroke-linecap="round"/>
    </g>
    <g id="tyre">
      <rect x="160" y="388" width="94" height="84" rx="20" fill="#040509"/>
      <path d="M166 404H250M166 414H250M166 424H250M166 434H250M166 444H250M166 454H250" stroke="#0f141d" stroke-width="2.2"/>
      <path d="M168 398C163 420 163 446 170 466" fill="none" stroke="#c9d6ec" stroke-opacity=".08" stroke-width="3"/>
    </g>
    <g id="flank">
      <path d="M198 276C244 248 322 222 404 206" fill="none" stroke="#c4d4f0" stroke-opacity=".26" stroke-width="1.5"/>
      <path d="M404 206L486 100" stroke="#000" stroke-opacity=".7" stroke-width="2.4"/>
      <path d="M406 207L488 101" stroke="#a9bde0" stroke-opacity=".1" stroke-width="1"/>
      <path d="M672 104C684 134 700 162 720 186" fill="none" stroke="#9fb6dc" stroke-opacity=".035" stroke-width="20"/>
      <path d="M652 104C664 134 680 162 700 186" fill="none" stroke="url(#line-fade)" stroke-width="1.6"/>
      <path d="M190 300C184 340 186 390 196 426" fill="none" stroke="#bccde9" stroke-opacity=".05" stroke-width="7"/>
      <path d="M190 300C184 340 186 390 196 426" fill="none" stroke="#bccde9" stroke-opacity=".12" stroke-width="1.4"/>
      <path d="M292 288C410 304 520 324 594 346" fill="none" stroke="#bccde9" stroke-opacity=".13" stroke-width="1.2"/>
      <path d="M452 374C486 371 520 376 546 388" fill="none" stroke="url(#chrome-dim)" stroke-width="2"/>
      <path d="M486 100L546 -4" stroke="#000" stroke-width="10"/>
      <path d="M492 100L552 -4" stroke="#8fa6cc" stroke-opacity=".12" stroke-width="1.2"/>
    </g>"""

    slats = "".join(louver(grille_left(y) + 7, W - grille_left(y) - 7, y, 3.6) for y in SLATS)
    body = f"""    <ellipse cx="800" cy="472" rx="720" ry="36" fill="url(#floor-shadow)"/>
    <use href="#tyre"/><use href="#tyre" {MIRROR}/>
    <path d="{GLASS}" fill="url(#glass)"/>
    <path d="M600 94L702 -4H772L662 92Z" fill="#c8d8f5" fill-opacity=".05"/>
    <path d="{BODY}" fill="url(#body)"/>
    <path d="{HOOD}" fill="url(#hood)"/>
    <path d="{HOOD}" fill="url(#hood-sheen)"/>
    <path d="{BODY}" fill="url(#body-sides)"/>
    <ellipse cx="800" cy="368" rx="540" ry="27" fill="url(#bumper-sheen)"/>
    <use href="#flank"/><use href="#flank" {MIRROR}/>
    <path d="{HOOD_EDGE}" fill="none" stroke="#000" stroke-opacity=".75" stroke-width="3" transform="translate(0 3)"/>
    <path d="{HOOD_EDGE}" fill="none" stroke="url(#edge-gleam)" stroke-width="1.6"/>
    <use href="#headlight"/><use href="#headlight" {MIRROR}/>
    <path d="{GRILLE}" fill="url(#grille-deep)"/>
    <path d="{GRILLE}" fill="url(#grille-fine)" fill-opacity=".9"/>
    <g clip-path="url(#grille-clip)">
      <path d="{slats}" fill="url(#chrome)"/>
      <path d="{slats}" fill="none" stroke="#000" stroke-opacity=".55" stroke-width=".7"/>
      <path d="{GRILLE}" fill="none" stroke="#000" stroke-opacity=".6" stroke-width="16"/>
      <circle cx="{STAR_X}" cy="{STAR_Y}" r="78" fill="url(#star-well)"/>
    </g>
    <circle cx="{STAR_X}" cy="{STAR_Y}" r="{STAR_R + 1}" fill="#03050a"/>
    {star()}
    <path d="{GRILLE}" fill="none" stroke="url(#chrome)" stroke-width="6"/>
    <path d="M638 209.5H962" stroke="#fff" stroke-opacity=".8" stroke-width="1"/>
    <use href="#side-intake"/><use href="#side-intake" {MIRROR}/>
    <path d="{INTAKE}" fill="url(#mesh)"/>
    <g clip-path="url(#intake-clip)"><path d="M542 392H1058" stroke="#000" stroke-opacity=".75" stroke-width="10"/></g>
    <path d="{INTAKE}" fill="none" stroke="#9fb3d4" stroke-opacity=".12" stroke-width="1.2"/>
    <path d="{BLADE}" fill="none" stroke="url(#chrome)" stroke-width="6" stroke-linecap="round"/>
    <path d="{BLADE}" fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="1.1" transform="translate(0 -2.4)"/>
    <path d="{LIP}L1350 465H250Z" fill="#020307"/>
    <path d="{LIP}" fill="none" stroke="#c0cfe8" stroke-opacity=".16" stroke-width="1.2"/>
    <path d="M640 492H760M840 492H960" stroke="#d8e4f8" stroke-opacity=".05" stroke-width="3" stroke-linecap="round"/>"""
    return svg(defs, body)


# ---------------------------------------------------------------- only the light (it goes on top of the car)
def lights() -> str:
    defs = f"""{FADE}
    <radialGradient id="bloom" cx=".5" cy=".5" r=".5">
      <stop offset="0" stop-color="#e8f0ff" stop-opacity=".42"/><stop offset=".4" stop-color="#a9c3ff" stop-opacity=".14"/>
      <stop offset="1" stop-color="#a9c3ff" stop-opacity="0"/></radialGradient>
    <radialGradient id="lens-glow" cx=".5" cy=".5" r=".5">
      <stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".25" stop-color="#e3edff" stop-opacity=".55"/>
      <stop offset="1" stop-color="#b8ceff" stop-opacity="0"/></radialGradient>
    <radialGradient id="floor-glow" cx=".5" cy=".5" r=".5">
      <stop offset="0" stop-color="#d8e6ff" stop-opacity=".3"/><stop offset="1" stop-color="#d8e6ff" stop-opacity="0"/></radialGradient>
    <radialGradient id="halo" cx="{STAR_X}" cy="{STAR_Y}" r="84" gradientUnits="userSpaceOnUse">
      <stop offset=".62" stop-color="#e9f1ff" stop-opacity="0"/><stop offset=".72" stop-color="#e9f1ff" stop-opacity=".28"/>
      <stop offset="1" stop-color="#e9f1ff" stop-opacity="0"/></radialGradient>
    <g id="light">
      <ellipse cx="444" cy="230" rx="250" ry="56" fill="url(#bloom)" transform="rotate(4 444 230)"/>
      <ellipse cx="520" cy="202" rx="150" ry="9" fill="url(#bloom)"/>
      <path d="{DRL}" fill="none" stroke="#7fa6ff" stroke-opacity=".1" stroke-width="26" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="{DRL}" fill="none" stroke="#a9c4ff" stroke-opacity=".22" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="{DRL}" fill="none" stroke="#dbe7ff" stroke-opacity=".6" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="{DRL}" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      {''.join(f'<ellipse cx="{x}" cy="{y}" rx="30" ry="14" fill="url(#lens-glow)" transform="rotate(3.4 {x} {y})"/>'
               f'{module(x, y, 22, 2.6)} fill="#fff"/>' for x, y in MODULES)}
      {''.join(f'<circle cx="{x}" cy="{y}" r="16" fill="url(#lens-glow)"/>'
               f'<path d="{TRI}" transform="translate({x} {y}) scale({s / 9:.3f})" fill="#fff"/>' for x, y, s in STARS)}
      <ellipse cx="445" cy="490" rx="210" ry="13" fill="url(#floor-glow)"/>
    </g>"""
    body = f"""    <use href="#light"/><use href="#light" {MIRROR}/>
    <circle cx="{STAR_X}" cy="{STAR_Y}" r="84" fill="url(#halo)"/>
    <ellipse cx="800" cy="212" rx="130" ry="5" fill="url(#bloom)"/>"""
    return svg(defs, body)


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else ASSETS
    for name, text in (("mercedes-front.svg", front()), ("mercedes-lights.svg", lights())):
        (out / name).write_text(text, encoding="utf-8")
        print("written", out / name, f"{len(text) // 1024} KB")


if __name__ == "__main__":
    main()
