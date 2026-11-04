# Reel BMW 330e (F. Fernandes Automóveis) no estilo das duas referências imobiliárias (ref/ref1.mp4, ref/ref2.mp4):
#  - fala: frase construída palavra-a-palavra junto à cabeça (fina minúscula + bold itálico)
#  - palavra-herói gigante ATRÁS da pessoa (máscara rembg)
#  - b-roll: legenda pequena itálica em maiúsculas em baixo
#  - cortes: whip-pan com motion blur + punch-in
#  - cartão de marca letra-a-letra
# Uso: python render.py            -> reel_novo.mp4
#      python render.py 1.0 5.9    -> stills/ (frames de verificação)
import subprocess, sys, os, math
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont, ImageFilter

SRC, OUT, FPS, W, H = "src/reel.mp4", "reel_novo.mp4", 30, 1080, 1920
DUR = 48.85
F = "fonts/"
FONTS = {
    "l": (F + "Poppins-Light.ttf", 66),
    "b": (F + "Poppins-ExtraBoldItalic.ttf", 100),
    "h": (F + "Anton-Regular.ttf", 250),
    "c": (F + "Poppins-Italic.ttf", 44),
    "brand": (F + "Poppins-ExtraBold.ttf", 92),
    "sub": (F + "Poppins-Light.ttf", 38),
}

# talk: linhas de (t, palavra, estilo); hero=True -> atrás da pessoa
P = [
    dict(k="talk", s=0.0, e=0.68, L=[[(0.0, "olá", "l"), (0.35, "a", "l")], [(0.5, "todos,", "b")]]),
    dict(k="talk", s=0.7, e=1.38, L=[[(0.7, "eu", "l"), (0.8, "sou", "l"), (0.85, "o", "l")], [(0.9, "Vasco", "b")]]),
    dict(k="talk", s=1.4, e=2.18, L=[[(1.4, "e", "l"), (1.45, "hoje", "l"), (1.5, "venho", "l")], [(1.7, "apresentar-vos", "b")]]),
    dict(k="talk", s=2.2, e=3.42, hero=True, L=[[(2.2, "o", "l"), (2.25, "BMW", "l")], [(2.4, "330e", "h")]]),
    dict(k="talk", s=4.5, e=5.58, L=[[(4.5, "esta", "l"), (4.9, "viatura", "l")], [(5.2, "combina", "b")]]),
    dict(k="talk", s=5.6, e=6.38, hero=True, L=[[(5.6, "desportividade", "h")]]),
    dict(k="talk", s=6.4, e=7.38, L=[[(6.4, "conforto", "b")], [(6.8, "e", "l"), (6.9, "eficiência", "b")]]),
    dict(k="talk", s=7.4, e=8.7, L=[[(7.4, "na", "l")], [(7.7, "perfeição.", "b")]]),
    dict(k="cap", s=10.55, e=12.4, L=[[(10.55, "CONFORTO", "c"), (10.75, "EM", "c"), (10.85, "CADA", "c"), (11.0, "DETALHE", "c")]]),
    dict(k="cap", s=12.62, e=13.8, L=[[(12.62, "PAINEL", "c"), (12.8, "100%", "c"), (12.95, "DIGITAL", "c")]]),
    dict(k="talk", s=14.12, e=14.98, L=[[(14.12, "debaixo", "l"), (14.5, "do", "l")], [(14.6, "capô", "b")]]),
    dict(k="talk", s=15.0, e=15.98, hero=True, L=[[(15.0, "temos", "l"), (15.2, "um", "l"), (15.3, "motor", "l")], [(15.5, "2.0", "h")]]),
    dict(k="cap", s=16.02, e=17.15, L=[[(16.02, "DE", "c"), (16.3, "QUATRO", "c"), (16.5, "CILINDROS", "c")]]),
    dict(k="cap", s=17.2, e=18.75, L=[[(17.2, "ACOPLADO", "c"), (17.6, "A", "c"), (17.7, "UM", "c")], [(17.8, "MOTOR", "c"), (18.0, "ELÉTRICO", "c")]]),
    dict(k="cap", s=18.8, e=18.98, L=[[(18.8, "E", "c"), (18.85, "UMA", "c")]]),
    dict(k="cap", s=19.0, e=20.5, L=[[(19.0, "CAIXA", "c"), (19.2, "AUTOMÁTICA", "c")], [(19.5, "DE", "c"), (19.7, "8", "c"), (19.8, "VELOCIDADES", "c")]]),
    dict(k="cap", s=20.65, e=22.15, L=[[(20.65, "NO", "c"), (20.7, "INTERIOR", "c"), (20.8, "TEMOS", "c")], [(21.1, "VOLANTE", "c"), (21.3, "M", "c"), (21.5, "MULTIFUNÇÕES", "c")]]),
    dict(k="cap", s=22.2, e=23.2, L=[[(22.2, "COM", "c"), (22.4, "PATILHAS", "c"), (22.7, "NO", "c"), (22.8, "VOLANTE", "c")]]),
    dict(k="cap", s=23.5, e=25.25, L=[[(23.5, "TEM", "c"), (23.8, "TAMBÉM", "c")], [(24.2, "HEAD-UP", "c"), (24.5, "DISPLAY", "c")]]),
    dict(k="talk", s=25.3, e=26.18, L=[[(25.3, "e", "l"), (25.5, "se", "l"), (25.55, "és", "l")], [(25.6, "como", "b"), (25.8, "eu", "b")]]),
    dict(k="talk", s=26.2, e=26.98, L=[[(26.2, "e", "l"), (26.25, "tens", "l"), (26.35, "alguma", "l")], [(26.5, "dificuldade", "b")]]),
    dict(k="talk", s=27.0, e=27.58, L=[[(27.0, "em", "l")], [(27.1, "estacionar,", "b")]]),
    dict(k="talk", s=27.6, e=29.08, L=[[(27.6, "este", "l"), (28.0, "carro", "l"), (28.1, "vem", "l")], [(28.5, "equipado", "b")], [(28.9, "com", "l")]]),
    dict(k="talk", s=29.1, e=30.22, hero=True, L=[[(29.1, "estacionamento", "l")], [(29.7, "automático", "h")]]),
    dict(k="brand", s=31.2, e=36.3),
    dict(k="talk", s=39.52, e=41.08, L=[[(39.52, "espero", "l"), (39.95, "que", "l"), (40.0, "tenham", "l")], [(40.1, "gostado", "b")], [(40.4, "do", "l"), (40.5, "vídeo", "b")]]),
    dict(k="talk", s=41.1, e=41.88, L=[[(41.1, "espero", "l"), (41.15, "que", "l"), (41.3, "tenham", "l"), (41.35, "ficado", "l")], [(41.5, "a", "l"), (41.6, "conhecer", "b")]]),
    dict(k="talk", s=41.9, e=43.35, L=[[(41.9, "um", "l"), (41.95, "bocadinho", "l"), (42.1, "mais", "l"), (42.3, "do", "l")], [(42.4, "330e", "b")]]),
    dict(k="talk", s=43.4, e=46.2, hero=True, L=[[(43.4, "e", "l"), (43.7, "até", "l"), (43.9, "à", "l")], [(44.1, "próxima", "h")]]),
    dict(k="sign", s=46.5, e=48.85),
]

# cortes (início, fim) — clusters de flash do original incluídos
CUTS = [(3.48, 3.52), (4.58, 4.92), (10.35, 10.39), (12.48, 12.52), (13.83, 14.04), (16.05, 16.09),
        (19.05, 19.09), (20.55, 20.59), (23.25, 23.29), (25.35, 25.39), (30.15, 30.9), (36.5, 36.54), (39.18, 39.82)]
PRE, POST, WHIP = 0.10, 0.14, 520


def font(st, size=None):
    p, s = FONTS[st]
    return ImageFont.truetype(p, size or s)


_cache = {}
COL = {"b": (34, 46, 205)}   # azul da ref2 nas palavras-chave


def m_emblem(f):
    """'M' da legenda trocado pela insígnia M: três riscas inclinadas (azul claro, azul escuro, vermelho) + M itálico."""
    ref = f.getbbox("M")
    ch = ref[3] - ref[1]                      # altura das maiúsculas
    fi = ImageFont.truetype(F + "Poppins-ExtraBoldItalic.ttf", f.size)
    mb = fi.getbbox("M")
    sw, gap, sl = max(4, ch // 5), max(2, ch // 14), ch * 0.32
    stripes_w = int(3 * sw + 2 * gap + sl)
    w = stripes_w + int(ch * 0.12) + (mb[2] - mb[0]) + 40
    h = f.getbbox("ÁÉgjpqy|")[3] + 40
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    y0, y1 = 20 + ref[1], 20 + ref[3]
    for i, c in enumerate([(0, 156, 222), (40, 70, 170), (226, 35, 40)]):
        x = 20 + i * (sw + gap)
        d.polygon([(x + sl, y0), (x + sl + sw, y0), (x + sw, y1), (x, y1)], fill=c + (255,))
    d.text((20 + stripes_w + int(ch * 0.12) - mb[0], 20), "M", font=fi, fill=(255, 255, 255, 250))
    a = im.split()[3].filter(ImageFilter.GaussianBlur(10))
    sh = Image.new("RGBA", im.size, (0, 0, 0, 0))
    sh.putalpha(a.point(lambda v: int(v * 0.35)))
    out = Image.new("RGBA", im.size, (0, 0, 0, 0))
    out.alpha_composite(sh, (0, 4))
    out.alpha_composite(im)
    return out


def word_img(word, st, size=None):
    key = (word, st, size)
    if key not in _cache and word == "M" and st == "c":
        _cache[key] = m_emblem(font(st, size))
    if key not in _cache:
        f = font(st, size)
        track = 3 if st == "c" else 0
        bb = f.getbbox(word)
        w = bb[2] - bb[0] + track * len(word) + 40
        h = (f.getbbox("ÁÉgjpqy|")[3]) + 40
        im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        x = 20 - bb[0]
        alpha = {"l": 235, "c": 245, "h": 240}.get(st, 255)
        for ch in (word if track else [word]):
            d.text((x, 20), ch, font=f, fill=COL.get(st, (255, 255, 255)) + (alpha,))
            x += f.getlength(ch) + track
        # sombra suave
        a = im.split()[3].filter(ImageFilter.GaussianBlur(10 if st != "h" else 18))
        sh = Image.new("RGBA", im.size, (0, 0, 0, 0))
        sh.putalpha(a.point(lambda v: int(v * (0.35 if st != "h" else 0.25))))
        out = Image.new("RGBA", im.size, (0, 0, 0, 0))
        out.alpha_composite(sh, (0, 4))
        out.alpha_composite(im)
        _cache[key] = out
    return _cache[key]


def ease(x):
    x = min(max(x, 0.0), 1.0)
    return 1 - (1 - x) ** 3


# ---------- segmentação ----------
_sess = None
_masks = {}


def person_mask(frame, idx):
    global _sess
    if idx in _masks:
        return _masks[idx]
    if _sess is None:
        from rembg import new_session
        _sess = new_session("u2net_human_seg")
    from rembg import remove
    small = Image.fromarray(frame).resize((540, 960))
    m = remove(small, session=_sess, only_mask=True)
    m = np.array(m.resize((W, H), Image.BILINEAR)).astype(np.float32) / 255.0
    m = cv2.GaussianBlur(m, (0, 0), 1.6)
    m = np.clip((m - 0.25) / 0.5, 0, 1)
    _masks[idx] = m
    return m


def head_anchor(mask):
    ys, xs = np.where(mask > 0.5)
    if len(ys) < 3000:
        return None
    top = ys.min()
    bot = ys.max()
    band = ys < top + 0.08 * (bot - top) + 30
    return int(np.median(xs[band])), int(top), int(bot - top)


# ---------- layout ----------
def layout(ph, anchor):
    lines = ph["L"]
    rows = []
    for li, line in enumerate(lines):
        row = []
        for t, w, st in line:
            size = None
            if st == "h":
                f = font("h")
                size = 250
                while f.getlength(w) > 880 and size > 120:
                    size -= 10
                    f = font("h", size)
            row.append((t, w, st, word_img(w, st, size)))
        rows.append(row)
    sp = {"l": 16, "b": 20, "h": 0, "c": 22}
    dims = []
    for row in rows:
        rw = sum(im.width for *_, im in row) - 40 * (len(row) - 1) + sum(sp[r[2]] for r in row[1:])
        rh = max(im.height for *_, im in row)
        dims.append((rw, rh))
    gap = -36
    bw = max(d[0] for d in dims)
    bh = sum(d[1] for d in dims) + gap * (len(dims) - 1)
    hero = ph.get("hero")
    if ph["k"] == "cap":
        cx, top = W // 2, 1200
        pos = []
        y = top
        for (rw, rh), row in zip(dims, rows):
            x = cx - rw // 2
            for t, w, st, im in row:
                pos.append((t, im, x, y))
                x += im.width - 40 + sp[st]
            y += rh + gap + 12
        return pos
    if anchor is None:
        hx, ht, hh = W // 2, 700, 900
    else:
        hx, ht, hh = anchor
    if hero:
        # palavra-herói: linha de base um pouco abaixo do topo da cabeça -> a cabeça tapa só a base
        hrw, hrh = dims[-1]
        him = rows[-1][-1][3]
        asc = ImageFont.truetype(FONTS["h"][0], 250).getmetrics()[0] * (him.height / word_img("Ag", "h").height)
        hero_top = int(ht + 0.045 * hh - 20 - asc)
        hero_top = max(hero_top, 260)
        hcx = int((W / 2 + hx) / 2)
        hleft = min(max(hcx - hrw // 2, 70), W - 80 - hrw)
        pos = []
        y = hero_top
        for (rw, rh), row in reversed(list(zip(dims, rows))):
            x = min(max(hleft + hrw // 2 - rw // 2, 70), W - 80 - rw)
            if row is not rows[-1]:
                y -= rh + gap - 30
            for t, w, st, im in row:
                pos.append((t, im, x, y))
                x += im.width - 40 + sp[st]
        return pos
    else:
        left = min(max(hx - bw // 2 - 60, 70), W - 80 - bw - 34 * (len(rows) - 1))
        top = ht - 40 - bh
        if top < 230:
            top = 230
    pos = []
    y = top
    for li, ((rw, rh), row) in enumerate(zip(dims, rows)):
        x = left + (0 if hero else li * 34)   # escada como na ref1
        if hero and li == len(rows) - 1:
            x = min(max(hx - rw // 2, 30), W - 30 - rw)
        for t, w, st, im in row:
            pos.append((t, im, x, y))
            x += im.width - 40 + sp[st]
        y += rh + gap
    return pos


_layouts = {}


def text_layer(t, frame, fidx):
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    behind = False
    for i, ph in enumerate(P):
        if not (ph["s"] <= t < ph["e"]):
            continue
        out = ease((ph["e"] - t) / 0.12)
        if ph["k"] in ("brand", "sign"):
            draw_brand(layer, t, ph, out)
            continue
        if i not in _layouts:
            anchor = None
            if ph["k"] == "talk":
                anchor = head_anchor(person_mask(frame, ("a", i)))
            _layouts[i] = layout(ph, anchor)
        for wt, im, x, y in _layouts[i]:
            if t < wt:
                continue
            k = ease((t - wt) / 0.18)
            a = k * out
            dy = int((1 - k) * 26 - (1 - out) * 12)
            img = im
            if im.height > 200:  # herói: escala
                s = 1.12 - 0.12 * k
                img = im.resize((int(im.width * s), int(im.height * s)), Image.BILINEAR)
                x -= (img.width - im.width) // 2
                y -= (img.height - im.height) // 2
            if a < 1:
                img = img.copy()
                img.putalpha(img.split()[3].point(lambda v: int(v * a)))
            layer.alpha_composite(img, (max(x, 0), max(y + dy, 0)))
        if ph.get("hero"):
            behind = True
    return layer, behind


def draw_brand(layer, t, ph, out):
    if ph["k"] == "brand":
        name, f, y, step = "FERNANDES AUTO", font("brand"), 470, 0.045
        track = 14
    else:
        name, f, y, step = "FERNANDES AUTO", font("brand", 44), 1330, 0.02
        track = 8
    total = sum(f.getlength(c) for c in name) + track * (len(name) - 1)
    x = (W - total) / 2
    d = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    dd = ImageDraw.Draw(d)
    for i, c in enumerate(name):
        k = ease((t - ph["s"] - i * step) / 0.25)
        if k > 0:
            dd.text((x, y + (1 - k) * 30), c, font=f, fill=(255, 255, 255, int(255 * k * out)))
        x += f.getlength(c) + track
    if ph["k"] == "brand":
        sub = "B M W   3 3 0 e"
        fs = font("sub")
        k = ease((t - ph["s"] - 0.9) / 0.4)
        sw = fs.getlength(sub)
        dd.text(((W - sw) / 2, y + 130 + (1 - k) * 14), sub, font=fs, fill=(255, 255, 255, int(220 * k * out)))
        k2 = ease((t - ph["s"] - 0.7) / 0.5)
        lw = int(140 * k2)
        dd.line([((W - lw) / 2, y + 118), ((W + lw) / 2, y + 118)], fill=(255, 255, 255, int(200 * out)), width=2)
    a = d.split()[3].filter(ImageFilter.GaussianBlur(40))
    sh = Image.new("RGBA", d.size, (0, 0, 0, 0))
    sh.putalpha(a.point(lambda v: min(255, int(v * 1.1))))
    layer.alpha_composite(sh, (0, 6))
    a = d.split()[3].filter(ImageFilter.GaussianBlur(10))
    sh = Image.new("RGBA", d.size, (0, 0, 0, 0))
    sh.putalpha(a.point(lambda v: int(v * 0.45)))
    layer.alpha_composite(sh, (0, 4))
    layer.alpha_composite(d)


# ---------- câmara: whip + punch ----------
def camera(frame, t, idx):
    dx = dy = 0.0
    zoom = 1.0
    vel = 0.0
    for n, (c1, c2) in enumerate(CUTS):
        horiz = n % 3 != 2
        sign = 1 if n % 2 == 0 else -1
        if c1 - PRE <= t < c1:
            u = (t - (c1 - PRE)) / PRE
            off, vel = -WHIP * u * u, 2 * WHIP * u / PRE
        elif c1 <= t < c2:
            off, vel = 0, 3 * WHIP / PRE
        elif c2 <= t < c2 + POST:
            u = (t - c2) / POST
            off, vel = WHIP * (1 - u) ** 2, 2 * WHIP * (1 - u) / POST
            zoom = 1.0 + 0.07 * (1 - u)
        elif c2 + POST <= t < c2 + POST + 0.35:
            u = (t - c2 - POST) / 0.35
            zoom = 1.0 + 0.07 * (1 - ease(u))
            continue
        else:
            continue
        if horiz:
            dx = sign * off
        else:
            dy = sign * off
        break
    if dx == dy == 0 and zoom == 1.0 and vel == 0:
        return frame
    M = np.float32([[zoom, 0, (1 - zoom) * W / 2 + dx], [0, zoom, (1 - zoom) * H / 2 + dy]])
    fr = cv2.warpAffine(frame, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    L = int(min(vel / FPS * 0.9, 160))
    if L > 3:
        k = np.zeros((L, L), np.float32)
        if dy != 0:
            k[:, L // 2] = 1.0 / L
        else:
            k[L // 2, :] = 1.0 / L
        fr = cv2.filter2D(fr, -1, k)
    return fr


BASE_VF = ("crop=880:1564:100:0,scale=1080:1920:flags=lanczos,fps=30,"
           "eq=contrast=1.08:saturation=0.9:gamma=0.98,"
           "colorbalance=rs=-0.02:bs=0.03:rh=0.04:gh=0.01:bh=-0.04,"
           "curves=master='0/0.03 0.25/0.22 0.75/0.79 1/0.97',vignette=PI/5")


def process(frame, fidx):
    t = fidx / FPS
    frame = camera(frame, t, fidx)
    layer, behind = text_layer(t, frame, fidx)
    if layer.getbbox() is None:
        return frame
    base = Image.fromarray(frame).convert("RGBA")
    base.alpha_composite(layer)
    out = np.array(base.convert("RGB"))
    if behind:
        m = person_mask(frame, fidx)[..., None]
        out = (frame * m + out * (1 - m)).astype(np.uint8)
    return out


def stills(times):
    os.makedirs("stills", exist_ok=True)
    for t in times:
        fidx = int(round(t * FPS))
        # layouts dependem do frame do início da frase: aquecer com esse frame
        for i, ph in enumerate(P):
            if ph["s"] <= t < ph["e"] and ph["k"] == "talk" and i not in _layouts:
                f0 = grab(ph["s"])
                _layouts[i] = layout(ph, head_anchor(person_mask(camera(f0, ph["s"], -1), ("a", i))))
        fr = grab(t)
        Image.fromarray(process(fr, fidx)).resize((540, 960)).save(f"stills/s_{t:05.2f}.png")
    print("stills ok")


def grab(t):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-i", SRC, "-vf", BASE_VF, "-frames:v", "1",
                          "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw[:W * H * 3], np.uint8).reshape(H, W, 3).copy()


def main():
    dec = subprocess.Popen(["ffmpeg", "-v", "error", "-i", SRC, "-t", str(DUR), "-vf", BASE_VF,
                            "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
    enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
                            "-r", str(FPS), "-i", "-", "-i", SRC, "-map", "0:v", "-map", "1:a", "-t", str(DUR),
                            "-af", "afade=t=out:st=47.9:d=0.95",
                            "-vf", "fade=t=out:st=48.25:d=0.6,format=yuv420p",
                            "-c:v", "libx264", "-crf", "17", "-preset", "medium", "-c:a", "aac", "-b:a", "192k",
                            "-movflags", "+faststart", OUT], stdin=subprocess.PIPE)
    n = 0
    while True:
        raw = dec.stdout.read(W * H * 3)
        if len(raw) < W * H * 3:
            break
        fr = np.frombuffer(raw, np.uint8).reshape(H, W, 3).copy()
        enc.stdin.write(process(fr, n).tobytes())
        n += 1
        if n % 150 == 0:
            print("frame", n, flush=True)
    enc.stdin.close()
    enc.wait()
    dec.wait()
    print("ok", OUT, n, "frames")



# ---------- auto-verificação para Reels ----------
# Zona segura Reels 1080x1920: topo 220, baixo 1920-440 (legenda/botões), direita 1080-150 (ícones) abaixo de y=900
SEGS = [(0, 3.5), (3.5, 4.48), (4.48, 10.37), (10.37, 12.5), (12.5, 13.93), (13.93, 16.0), (16.0, 19.0), (19.0, 20.57), (20.57, 23.27), (23.27, 25.28), (25.28, 30.24), (30.24, 36.52), (36.52, 39.45), (39.45, 48.85)]


def check():
    bad = 0
    for i, ph in enumerate(P):
        inseg = [n for n, (a, b) in enumerate(SEGS, 1) if a <= ph["s"] and ph["e"] <= b + 0.01]
        if not inseg:
            print(f"FRASE {i} ({ph['s']}-{ph['e']}) atravessa um corte de fragmento"); bad += 1
        if ph["k"] in ("brand", "sign"):
            continue
        anchor = None
        if ph["k"] == "talk":
            f0 = grab(ph["s"])
            anchor = head_anchor(person_mask(camera(f0, ph["s"], -1), ("a", i)))
        for t, im, x, y in layout(ph, anchor):
            l, tp, r, b = im.split()[3].point(lambda v: 255 if v > 60 else 0).getbbox()
            X0, Y0, X1, Y1 = x + l, y + tp, x + r, y + b
            right = 930 if Y1 > 1150 else 1000
            if X0 < 60 or Y0 < 220 or X1 > right or Y1 > 1480:
                print(f"FORA frase {i} t={t}: box=({X0},{Y0},{X1},{Y1})"); bad += 1
    print("PROBLEMAS:", bad)




# ---------- v3: o texto NUNCA fica em cima da pessoa ----------
def ink_rects(pos):
    out = []
    for t, im, x, y in pos:
        bb = im.split()[3].point(lambda v: 255 if v > 40 else 0).getbbox()
        if bb:
            out.append((x + bb[0], y + bb[1], x + bb[2], y + bb[3]))
    return out


def union_mask(i, ph):
    s0, dur = ph["s"], ph["e"] - ph["s"]
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{s0:.3f}", "-t", f"{dur:.3f}", "-i", SRC, "-vf",
                          BASE_VF + ",fps=10", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True).stdout
    n = len(raw) // (W * H * 3)
    u = np.zeros((H, W), np.float32)
    first = None
    for k in range(n):
        fr = np.frombuffer(raw[k * W * H * 3:(k + 1) * W * H * 3], np.uint8).reshape(H, W, 3)
        t = s0 + k / 10
        m = person_mask(camera(fr.copy(), t, -1), ("u", i, k))
        if first is None:
            first = m
        u = np.maximum(u, m)
    b = (u > 0.3).astype(np.uint8)
    b = cv2.dilate(b, np.ones((71, 71), np.uint8))   # margem de ~35 px à volta da pessoa
    return b, head_anchor(first if first is not None else u)


def place(i, ph):
    pos = layout(ph, None)
    rects = ink_rects(pos)
    X0 = min(r[0] for r in rects); Y0 = min(r[1] for r in rects)
    pos = [(t, im, x - X0, y - Y0) for t, im, x, y in pos]
    mask, anc = union_mask(i, ph)
    ii = cv2.integral(mask)
    hx, ht = (anc[0], anc[1]) if anc else (W // 2, 900)
    best = None
    for sc in (1.0, 0.85, 0.72, 0.6, 0.5):
        P2 = []
        for t, im, x, y in pos:
            im2 = im if sc == 1.0 else im.resize((max(1, int(im.width * sc)), max(1, int(im.height * sc))), Image.LANCZOS)
            P2.append((t, im2, int(x * sc), int(y * sc)))
        R = ink_rects(P2)
        bw = max(r[2] for r in R); bh = max(r[3] for r in R)
        tx, ty = hx - bw / 2, ht - 50 - bh
        for oy in range(230, 1480 - bh, 12):
            right = 930 if oy + bh > 1150 else 1000
            for ox in range(70, right - bw, 12):
                ov = 0
                for a, b, c, d in R:
                    x0, y0, x1, y1 = ox + a, oy + b, ox + c, oy + d
                    ov += ii[y1, x1] - ii[y0, x1] - ii[y1, x0] + ii[y0, x0]
                score = (ov > 0) * 1e9 + ov * 1e3 + (1 - sc) * 4e5 + (ox - tx) ** 2 + (oy - ty) ** 2
                if best is None or score < best[0]:
                    best = (score, ox, oy, P2)
        if best and best[0] < 1e9 and sc == 1.0:
            break
        if best and best[0] < 1e9:
            break
    _, ox, oy, P2 = best
    return [(t, im, ox + x, oy + y) for t, im, x, y in P2]


def text_layer(t, frame, fidx):
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    for i, ph in enumerate(P):
        if not (ph["s"] <= t < ph["e"]):
            continue
        out = ease((ph["e"] - t) / 0.12)
        if ph["k"] in ("brand", "sign"):
            draw_brand(layer, t, ph, out)
            continue
        if i not in _layouts:
            _layouts[i] = place(i, ph) if ph["k"] == "talk" else layout(ph, None)
        for wt, im, x, y in _layouts[i]:
            if t < wt:
                continue
            k = ease((t - wt) / 0.18)
            a = k * out
            dy = int((1 - k) * 26 - (1 - out) * 12)
            img = im
            if a < 1:
                img = img.copy()
                img.putalpha(img.split()[3].point(lambda v: int(v * a)))
            layer.alpha_composite(img, (max(x, 0), max(y + dy, 0)))
    return layer, False


OVERLAP = []


def process(frame, fidx):
    t = fidx / FPS
    frame = camera(frame, t, fidx)
    layer, _ = text_layer(t, frame, fidx)
    if layer.getbbox() is None:
        return frame
    if fidx % 3 == 0 and any(p["k"] == "talk" and p["s"] <= t < p["e"] for p in P):   # auto-verificação: texto vs pessoa neste frame
        m = person_mask(frame, fidx) > 0.5
        a = np.array(layer.split()[3]) > 60
        ov = int((m & a).sum())
        if ov > 0:
            OVERLAP.append((round(t, 2), ov))
    base = Image.fromarray(frame).convert("RGBA")
    base.alpha_composite(layer)
    return np.array(base.convert("RGB"))


# ================= v4: elementos das referências =================
# ref1: etiquetas com linha presas às peças (como "Leiria" no mapa), número gigante animado ("44"),
#       texto no céu preso à cena ("10.000M2"), cartão final com logótipo, grão de película
# ref2: palavras-chave a azul, legenda palavra-a-palavra quando está sentado, céu dia->noite, logótipo a aparecer
TAG_RED = (226, 35, 45)

P[:] = [p for p in P if not (p["k"] == "cap" and 16.0 <= p["s"] < 20.6)]
_one = [p for p in P if p["k"] == "talk" and 25.2 <= p["s"] < 29.0]
P[:] = [p for p in P if p not in _one]
P.append(dict(k="one", s=_one[0]["s"], e=_one[-1]["e"], W=[w for p in _one for line in p["L"] for w in line]))
P.append(dict(k="tags", s=16.1, e=18.98))
P.append(dict(k="count", s=19.05, e=20.5))
P.append(dict(k="sky", s=36.75, e=39.2))
P.sort(key=lambda p: p["s"])
for p in P:
    if p["k"] == "sign":
        p["k"], p["s"] = "end", 46.3


def decode(s, e):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{s:.3f}", "-t", f"{e - s:.3f}", "-i", SRC, "-vf", BASE_VF,
                          "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True).stdout
    n = len(raw) // (W * H * 3)
    return [np.frombuffer(raw[k * W * H * 3:(k + 1) * W * H * 3], np.uint8).reshape(H, W, 3) for k in range(n)]


_tracks = {}


def track(name, s, e, t_ref, region=None):
    """Homografias ref->frame por fluxo óptico (LK + RANSAC), encadeadas a partir de t_ref."""
    if name in _tracks:
        return _tracks[name]
    fr = decode(s, e)
    g = [cv2.cvtColor(f, cv2.COLOR_RGB2GRAY) for f in fr]
    m = None
    if region:
        m = np.zeros((H, W), np.uint8)
        x0, y0, x1, y1 = region
        m[y0:y1, x0:x1] = 255

    def step(a, b):
        p0 = cv2.goodFeaturesToTrack(g[a], 500, 0.01, 9, mask=m)
        if p0 is None or len(p0) < 12:
            return np.eye(3)
        p1, st, _ = cv2.calcOpticalFlowPyrLK(g[a], g[b], p0, None, winSize=(31, 31), maxLevel=4)
        ok = st.ravel() == 1
        if ok.sum() < 12:
            return np.eye(3)
        Hm, _ = cv2.findHomography(p0[ok], p1[ok], cv2.RANSAC, 3.0)
        return Hm if Hm is not None else np.eye(3)

    r = min(max(int(round((t_ref - s) * FPS)), 0), len(fr) - 1)
    Hs = [None] * len(fr)
    Hs[r] = np.eye(3)
    for k in range(r + 1, len(fr)):
        Hs[k] = step(k - 1, k) @ Hs[k - 1]
    for k in range(r - 1, -1, -1):
        Hs[k] = np.linalg.inv(step(k, k + 1)) @ Hs[k + 1]
    _tracks[name] = (s, Hs)
    return _tracks[name]


def H_at(name, t):
    s, Hs = _tracks[name]
    k = min(max(int(round((t - s) * FPS)), 0), len(Hs) - 1)
    return Hs[k]


def proj(Hm, x, y):
    v = Hm @ np.array([x, y, 1.0])
    return v[0] / v[2], v[1] / v[2]


def soft_shadow(layer, tmp, blur, k, dy=6):
    sh = tmp.split()[3].filter(ImageFilter.GaussianBlur(blur)).point(lambda v: min(255, int(v * k)))
    shl = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    shl.putalpha(sh)
    layer.alpha_composite(shl, (0, dy))
    layer.alpha_composite(tmp)


# ---------- etiquetas presas ao motor ----------
TAGS = [  # (início, fim, ponto no frame de referência t=16.5, texto, deslocamento da etiqueta)
    (16.1, 17.2, (490, 1194), "4 CILINDROS", (-40, -330)),
    (16.45, 17.2, (330, 1090), "MOTOR 2.0", (-120, -560)),
    (17.25, 18.98, (640, 1132), "MOTOR ELÉTRICO", (40, -420)),
]


def draw_tags(frame, t):
    track("eng", 16.08, 19.0, 16.5, region=(0, 950, W, 1700))
    Hm = H_at("eng", t)
    im = Image.fromarray(frame).convert("RGBA")
    lay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    for s0, e0, (px, py), txt, (ox, oy) in TAGS:
        if not (s0 <= t < e0):
            continue
        out = ease((e0 - t) / 0.15)
        ax, ay = proj(Hm, px, py)
        lx, ly = ax + ox, ay + oy
        k1 = ease((t - s0) / 0.15)
        k2 = ease((t - s0 - 0.08) / 0.28)
        k3 = ease((t - s0 - 0.3) / 0.22)
        A = int(255 * out)
        d.ellipse((ax - 18 * k1, ay - 18 * k1, ax + 18 * k1, ay + 18 * k1), outline=(255, 255, 255, int(A * 0.6)), width=3)
        d.ellipse((ax - 7 * k1, ay - 7 * k1, ax + 7 * k1, ay + 7 * k1), fill=TAG_RED + (A,))
        if k2 > 0:
            d.line((ax, ay, ax + (lx - ax) * k2, ay + (ly - ay) * k2), fill=(255, 255, 255, int(A * 0.9)), width=4)
        if k3 > 0:
            sc = 0.85 + 0.15 * k3
            fs = ImageFont.truetype(F + "Poppins-ExtraBold.ttf", max(10, int(46 * sc)))
            tw = fs.getlength(txt)
            w2, h2 = tw + 56 * sc, 88 * sc
            d.rounded_rectangle((lx - w2 / 2, ly - h2 / 2, lx + w2 / 2, ly + h2 / 2), int(16 * sc), fill=TAG_RED + (int(A * k3),))
            d.text((lx, ly + 2), txt, font=fs, fill=(255, 255, 255, int(A * k3)), anchor="mm")
    soft_shadow(im, lay, 14, 0.4)
    return np.array(im.convert("RGB"))


# ---------- contador "8" ----------
def draw_count(layer, t, ph):
    out = ease((ph["e"] - t) / 0.15)
    k = ease((t - ph["s"]) / 0.25)
    n = 1 + int(round(7 * ease((t - 19.25) / 0.6))) if t > 19.25 else 1
    fA = ImageFont.truetype(F + "Anton-Regular.ttf", 420)
    fS = ImageFont.truetype(F + "Poppins-Light.ttf", 46)
    fT = ImageFont.truetype(F + "Poppins-Italic.ttf", 40)
    x, y = 120, 250
    A = int(255 * out * k)
    tmp = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    dt = ImageDraw.Draw(tmp)
    dt.text((x, y + (1 - k) * 40), "CAIXA AUTOMÁTICA", font=fT, fill=(255, 255, 255, A))
    dt.text((x - 12, y + 40), str(n), font=fA, fill=(255, 255, 255, A))
    lw = int(560 * ease((t - 19.3) / 0.6))
    dt.line((x, y + 560, x + lw, y + 560), fill=(255, 255, 255, int(A * 0.8)), width=3)
    for i in range(n):
        dt.rectangle((x + i * 70, y + 580, x + i * 70 + 50, y + 592), fill=TAG_RED + (A,))
    dt.text((x, y + 615), "V E L O C I D A D E S", font=fS, fill=(255, 255, 255, A))
    soft_shadow(layer, tmp, 22, 0.55)


# ---------- texto no céu preso à cena + céu dia->fim de tarde ----------
def draw_sky(frame, t, ph):
    track("sky", 36.56, 39.45, 38.0, region=(0, 300, W, 1500))
    Hm = H_at("sky", t)
    out = ease((ph["e"] - t) / 0.2)
    txt = "PLUG-IN HYBRID"
    f = ImageFont.truetype(F + "Poppins-ExtraBold.ttf", 64)
    tw = int(f.getlength(txt) + 13 * 6 + 40)
    plate = Image.new("RGBA", (tw, 170), (0, 0, 0, 0))
    d = ImageDraw.Draw(plate)
    x = 20
    for i, c in enumerate(txt):
        kc = ease((t - ph["s"] - i * 0.035) / 0.3)
        d.text((x, 20 + (1 - kc) * 30), c, font=f, fill=(255, 255, 255, int(250 * kc * out)))
        x += f.getlength(c) + 6
    cx, cy = 540, 640
    src = np.float32([[0, 0], [tw, 0], [tw, 170], [0, 170]])
    dst = np.float32([[cx - tw / 2, cy - 85], [cx + tw / 2, cy - 85], [cx + tw / 2, cy + 85], [cx - tw / 2, cy + 85]])
    M = Hm @ cv2.getPerspectiveTransform(src, dst)
    arr = cv2.warpPerspective(np.array(plate), M, (W, H), flags=cv2.INTER_LINEAR)
    g = ease((t - 37.0) / 1.6)
    fr = frame.astype(np.float32)
    fr = fr * (1 - g) + fr * np.array([0.78, 0.82, 1.05], np.float32) * 0.82 * g
    a = arr[..., 3:4].astype(np.float32) / 255
    sh = cv2.GaussianBlur(a[..., 0], (0, 0), 14)[..., None] * 0.35
    fr = fr * (1 - sh)
    fr = fr * (1 - a) + arr[..., :3].astype(np.float32) * a
    return np.clip(fr, 0, 255).astype(np.uint8)


# ---------- logótipo (marca + nome) ----------
def draw_logo(layer, t, t0, out, cy, scale=1.0, sub="B M W   3 3 0 e"):
    tmp = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(tmp)
    km = ease((t - t0) / 0.45)
    S = int(120 * scale * (0.8 + 0.2 * km))
    mx, my = W / 2, cy - 160 * scale
    A = int(255 * out)
    d.rounded_rectangle((mx - S / 2, my - S / 2, mx + S / 2, my + S / 2), int(22 * scale), outline=(255, 255, 255, int(A * km)), width=max(3, int(6 * scale)))
    fm = ImageFont.truetype(F + "Poppins-ExtraBold.ttf", max(10, int(58 * scale)))
    d.text((mx, my + 3), "FA", font=fm, fill=(255, 255, 255, int(A * km)), anchor="mm")
    f = ImageFont.truetype(F + "Poppins-ExtraBold.ttf", int(88 * scale))
    name, tr = "FERNANDES AUTO", int(12 * scale)
    total = sum(f.getlength(c) for c in name) + tr * (len(name) - 1)
    x = (W - total) / 2
    for i, c in enumerate(name):
        k = ease((t - t0 - 0.3 - i * 0.025) / 0.22)
        if k > 0:
            d.text((x, cy - 50 * scale + (1 - k) * 30), c, font=f, fill=(255, 255, 255, int(A * k)))
        x += f.getlength(c) + tr
    k2 = ease((t - t0 - 0.75) / 0.4)
    lw = 140 * scale * k2
    d.line(((W - lw) / 2, cy + 78 * scale, (W + lw) / 2, cy + 78 * scale), fill=(255, 255, 255, int(A * 0.8)), width=2)
    fs = ImageFont.truetype(F + "Poppins-Light.ttf", int(38 * scale))
    k3 = ease((t - t0 - 0.85) / 0.35)
    d.text((W / 2, cy + 120 * scale + (1 - k3) * 14), sub, font=fs, fill=(255, 255, 255, int(A * 0.9 * k3)), anchor="mm")
    soft_shadow(layer, tmp, 36, 1.0)


def draw_brand(layer, t, ph, out):
    if ph["k"] == "brand":
        draw_logo(layer, t, ph["s"], out, 520)
    else:
        k = ease((t - ph["s"]) / 0.6)
        layer.alpha_composite(Image.new("RGBA", (W, H), (8, 10, 14, int(150 * k))))
        draw_logo(layer, t, ph["s"] + 0.05, 1.0, 900, 1.1)


# ---------- uma palavra de cada vez (ref2, sentado) ----------
def one_word(i, ph, t):
    if i not in _layouts:
        words = ph["W"]
        imgs = [word_img(w, "l", 74) for _, w, st in words]
        bw = max(im.width for im in imgs)
        bh = max(im.height for im in imgs)
        mask, anc = union_mask(i, ph)
        ii = cv2.integral(mask)
        hx, ht = (anc[0], anc[1]) if anc else (W // 2, 900)
        best = None
        for oy in range(230, 1480 - bh, 12):
            for ox in range(70, 1000 - bw, 12):
                ov = ii[oy + bh, ox + bw] - ii[oy, ox + bw] - ii[oy + bh, ox] + ii[oy, ox]
                sc = ov * 1e6 + (ox + bw / 2 - hx) ** 2 + (oy + bh - (ht - 60)) ** 2
                if best is None or sc < best[0]:
                    best = (sc, ox + bw // 2, oy)
        _layouts[i] = (best[1], best[2], words, imgs)
    cx, y, words, imgs = _layouts[i]
    cur = None
    for k, (wt, w, st) in enumerate(words):
        if t >= wt:
            cur = k
    if cur is None:
        return None
    im = imgs[cur]
    a = ease((t - words[cur][0]) / 0.08) * ease((ph["e"] - t) / 0.1)
    if a < 1:
        im = im.copy()
        im.putalpha(im.split()[3].point(lambda v: int(v * a)))
    return im, int(cx - im.width / 2), y


def text_layer(t, frame, fidx):
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    for i, ph in enumerate(P):
        if not (ph["s"] <= t < ph["e"]):
            continue
        out = ease((ph["e"] - t) / 0.12)
        k = ph["k"]
        if k in ("brand", "end"):
            draw_brand(layer, t, ph, out)
            continue
        if k == "count":
            draw_count(layer, t, ph)
            continue
        if k in ("tags", "sky"):
            continue
        if k == "one":
            r = one_word(i, ph, t)
            if r:
                layer.alpha_composite(r[0], (r[1], r[2]))
            continue
        if i not in _layouts:
            _layouts[i] = place(i, ph) if k == "talk" else layout(ph, None)
            if k == "talk":
                _layouts[i] = [(wt, fit_colour(im, x, y, frame), x, y) for wt, im, x, y in _layouts[i]]
        for wt, im, x, y in _layouts[i]:
            if t < wt:
                continue
            kk = ease((t - wt) / 0.18)
            a = kk * out
            dy = int((1 - kk) * 26 - (1 - out) * 12)
            img = im
            if a < 1:
                img = img.copy()
                img.putalpha(img.split()[3].point(lambda v: int(v * a)))
            layer.alpha_composite(img, (max(x, 0), max(y + dy, 0)))
    return layer, False



def fit_colour(im, x, y, frame):
    """Palavra azul só se o fundo for claro e não azulado; senão fica branca (legível)."""
    arr = np.array(im)
    blue = (arr[..., 2].astype(int) - arr[..., 0] > 60) & (arr[..., 3] > 100)
    if blue.sum() < 50:
        return im
    h, w = arr.shape[:2]
    reg = frame[max(y, 0):min(y + h, H), max(x, 0):min(x + w, W)].reshape(-1, 3).astype(float)
    r, g, b = reg.mean(0)
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    if lum >= 150 and b - r < 25:
        return im
    arr = arr.copy()
    arr[blue, :3] = 255
    return Image.fromarray(arr)


_rng = np.random.default_rng(7)


def grain(fr):
    n = _rng.normal(0, 5.5, (H // 2, W // 2)).astype(np.float32)
    n = cv2.resize(n, (W, H), interpolation=cv2.INTER_LINEAR)[..., None]
    return np.clip(fr.astype(np.float32) + n, 0, 255).astype(np.uint8)


def process(frame, fidx):
    t = fidx / FPS
    for ph in P:
        if ph["s"] <= t < ph["e"]:
            if ph["k"] == "tags":
                frame = draw_tags(frame, t)
            elif ph["k"] == "sky":
                frame = draw_sky(frame, t, ph)
    frame = camera(frame, t, fidx)
    layer, _ = text_layer(t, frame, fidx)
    if layer.getbbox() is not None:
        if fidx % 3 == 0 and any(p["k"] in ("talk", "one") and p["s"] <= t < p["e"] for p in P):
            m = person_mask(frame, fidx) > 0.5
            a = np.array(layer.split()[3]) > 60
            ov = int((m & a).sum())
            if ov > 0:
                OVERLAP.append((round(t, 2), ov))
        base = Image.fromarray(frame).convert("RGBA")
        base.alpha_composite(layer)
        frame = np.array(base.convert("RGB"))
    return grain(frame)


def stills(times):
    os.makedirs("stills", exist_ok=True)
    for t in times:
        fr = grab(t)
        Image.fromarray(process(fr, int(round(t * FPS)))).resize((540, 960)).save(f"stills/s_{t:05.2f}.png")
    print("stills ok")



# ================= v5: logótipo real F. Fernandes Automóveis =================
LOGO_W = Image.open("logo/logo_branco.png").crop(Image.open("logo/logo_branco.png").getbbox())
LOGO_C = Image.open("logo/logo_cor.png").crop(Image.open("logo/logo_cor.png").getbbox())


def logo_scaled(img, width):
    h = int(img.height * width / img.width)
    return img.resize((width, h), Image.LANCZOS)


_WM = logo_scaled(LOGO_W, 280)
_WM_A = _WM.split()[3].point(lambda v: int(v * 0.42))
_WM = _WM.copy()
_WM.putalpha(_WM_A)


def watermark(layer, t):
    for p in P:
        if p["k"] in ("brand", "end") and p["s"] - 0.2 <= t < p["e"]:
            return
    a = ease(t / 0.4)
    wm = _WM
    if a < 1:
        wm = _WM.copy()
        wm.putalpha(_WM_A.point(lambda v: int(v * a)))
    layer.alpha_composite(wm, ((W - wm.width) // 2, 120))


def wipe(img, k):
    """revela da esquerda para a direita com borda suave"""
    if k >= 1:
        return img
    w = img.width
    ramp = np.clip((np.arange(w) - (k * (w + 80) - 80)) / 80, 0, 1)
    a = np.array(img.split()[3]).astype(np.float32) * (1 - ramp)[None, :]
    out = img.copy()
    out.putalpha(Image.fromarray(a.astype(np.uint8)))
    return out


def draw_logo(layer, t, t0, out, cy, scale=1.0, sub="B M W   3 3 0 e", card=False):
    tmp = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    lw = int(760 * scale)
    src = LOGO_C if card else LOGO_W
    lg = logo_scaled(src, lw)
    car_h = int(lg.height * 0.47)                        # metade de cima = silhueta do carro
    car, txt = lg.crop((0, 0, lw, car_h)), lg.crop((0, car_h, lw, lg.height))
    k1 = ease((t - t0) / 0.7)
    k2 = ease((t - t0 - 0.45) / 0.4)
    x = (W - lw) // 2
    top = int(cy - lg.height / 2)
    if card:
        kc = ease((t - t0 + 0.2) / 0.4)
        pad = 60
        d0 = ImageDraw.Draw(tmp)
        d0.rounded_rectangle((x - pad, top - pad, x + lw + pad, top + lg.height + pad + 150), 36, fill=(255, 255, 255, int(245 * kc * out)))
    c = wipe(car, k1)
    if out < 1:
        c = c.copy(); c.putalpha(c.split()[3].point(lambda v: int(v * out)))
    tmp.alpha_composite(c, (x, top))
    if k2 > 0:
        tt = txt.copy()
        tt.putalpha(tt.split()[3].point(lambda v: int(v * k2 * out)))
        tmp.alpha_composite(tt, (x, top + car_h + int((1 - k2) * 24)))
    d = ImageDraw.Draw(tmp)
    col = (40, 40, 48) if card else (255, 255, 255)
    k3 = ease((t - t0 - 0.85) / 0.35)
    fs = ImageFont.truetype(F + "Poppins-Light.ttf", int(36 * scale))
    yb = top + lg.height + int(52 * scale)
    d.text((W / 2, yb + (1 - k3) * 12), "A U T O M Ó V E I S", font=fs, fill=col + (int(255 * out * k3),), anchor="mm")
    k4 = ease((t - t0 - 1.05) / 0.35)
    L = 140 * scale * k4
    d.line(((W - L) / 2, yb + 40 * scale, (W + L) / 2, yb + 40 * scale), fill=col + (int(200 * out),), width=2)
    fs2 = ImageFont.truetype(F + "Poppins-ExtraBold.ttf", int(34 * scale))
    d.text((W / 2, yb + 82 * scale + (1 - k4) * 12), sub, font=fs2, fill=(214, 40, 40, int(255 * out * k4)) if card else col + (int(240 * out * k4),), anchor="mm")
    if card:
        soft_shadow(layer, tmp, 40, 0.5, dy=10)
    else:
        soft_shadow(layer, tmp, 30, 0.9)


LOC_T0 = 33.85   # 2.º plano do condutor (parque), antes do arranque do carro às 36.5


def draw_pin(d, cx, cy, r, col):
    """alfinete de mapa 📍 em vetor: cabeça redonda + bico, furo branco"""
    d.polygon([(cx - r * 0.86, cy + r * 0.5), (cx + r * 0.86, cy + r * 0.5), (cx, cy + r * 2.1)], fill=col)
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=col)
    h = r * 0.38
    d.ellipse((cx - h, cy - h, cx + h, cy + h), fill=(255, 255, 255, col[3]))


def draw_location(layer, t, out):
    k1 = ease((t - LOC_T0) / 0.35)
    if k1 <= 0:
        return
    k2 = ease((t - LOC_T0 - 0.25) / 0.35)
    tmp = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(tmp)
    f1 = ImageFont.truetype(F + "Poppins-ExtraBold.ttf", 62)
    f2 = ImageFont.truetype(F + "Poppins-Medium.ttf", 36)
    t1, t2 = "Vem visitar-nos", "IC2 · Km 80,9 · Venda das Raparigas, Benedita"
    r, gap = 22, 22
    w1 = f1.getlength(t1) + 2 * r + gap
    x0, y1 = (W - w1) / 2, 960 + (1 - k1) * 26
    draw_pin(d, x0 + r, y1 - 12, r, (214, 40, 40, int(255 * k1 * out)))
    d.text((x0 + 2 * r + gap, y1), t1, font=f1, fill=(255, 255, 255, int(255 * k1 * out)), anchor="lm")
    d.text((W / 2, y1 + 72 + (1 - k2) * 14), t2, font=f2, fill=(255, 255, 255, int(235 * k2 * out)), anchor="mm")
    soft_shadow(layer, tmp, 22, 1.6)


def draw_brand(layer, t, ph, out):
    if ph["k"] == "brand":
        draw_logo(layer, t, ph["s"], out, 560)
        draw_location(layer, t, out)
    else:
        k = ease((t - ph["s"]) / 0.6)
        layer.alpha_composite(Image.new("RGBA", (W, H), (8, 10, 14, int(160 * k))))
        draw_logo(layer, t, ph["s"] + 0.05, 1.0, 860, 0.95, sub="BMW 330e", card=True)
        fh = ImageFont.truetype(F + "Poppins-Light.ttf", 40)
        kh = ease((t - ph["s"] - 1.2) / 0.4)
        ImageDraw.Draw(layer).text((W / 2, 1230 + (1 - kh) * 14), "@ffernandesautomoveis", font=fh, fill=(255, 255, 255, int(235 * kh)), anchor="mm")


_text_layer_v4 = text_layer


def text_layer(t, frame, fidx):
    layer, b = _text_layer_v4(t, frame, fidx)
    wm = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    watermark(wm, t)
    wm.alpha_composite(layer)
    return wm, b


def check():
    bad = 0
    for i, ph in enumerate(P):
        if not [n for n, (a, b) in enumerate(SEGS, 1) if a <= ph["s"] and ph["e"] <= b + 0.01]:
            print(f"FRASE {i} atravessa um corte de fragmento"); bad += 1
        if ph["k"] not in ("talk", "cap"):
            continue
        pos = place(i, ph) if ph["k"] == "talk" else layout(ph, None)
        for X0, Y0, X1, Y1 in ink_rects(pos):
            right = 930 if Y1 > 1150 else 1000
            if X0 < 60 or Y0 < 220 or X1 > right or Y1 > 1480:
                print(f"FORA frase {i}: box=({X0},{Y0},{X1},{Y1})"); bad += 1
    print("PROBLEMAS:", bad)


if __name__ == "__main__":
    if sys.argv[1:2] == ["check"]:
        check()
    elif len(sys.argv) > 1:
        stills([float(a) for a in sys.argv[1:]])
    else:
        main()
        print("SOBREPOSICOES texto/pessoa:", len(OVERLAP), OVERLAP[:40])
