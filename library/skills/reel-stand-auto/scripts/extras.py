# Gera m_pack.png (crachá "PACK M SPORT" com as riscas M) e exhaust.wav (ronco de escape sintético, 6 cilindros).
import numpy as np
import wave
from PIL import Image, ImageDraw, ImageFont, ImageFilter

F = "fonts/"
SR = 48000


def badge():
    W, H = 640, 230
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((20, 20, W - 20, H - 20), 28, fill=(0, 0, 0, 120))
    im.alpha_composite(sh.filter(ImageFilter.GaussianBlur(14)))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((20, 20, W - 20, H - 20), 28, fill=(14, 16, 20, 215), outline=(255, 255, 255, 40), width=2)
    # riscas M inclinadas: azul claro, azul escuro, vermelho
    cols = [(0, 156, 222), (28, 50, 140), (226, 35, 40)]
    x0, y0, y1, sw, sl = 58, 58, 172, 30, 26
    for i, c in enumerate(cols):
        x = x0 + i * (sw + 6)
        d.polygon([(x + sl, y0), (x + sl + sw, y0), (x + sw, y1), (x, y1)], fill=c + (255,))
    fM = ImageFont.truetype(F + "Poppins-ExtraBoldItalic.ttf" if __import__("os").path.exists(F + "Poppins-ExtraBoldItalic.ttf") else F + "Poppins-ExtraBold.ttf", 120)
    f1 = ImageFont.truetype(F + "Poppins-ExtraBold.ttf", 54)
    f2 = ImageFont.truetype(F + "Poppins-Medium.ttf", 30)
    d.text((200, 98), "PACK M SPORT", font=f1, fill=(255, 255, 255, 255), anchor="lm")
    d.text((202, 150), "de série neste 330e", font=f2, fill=(255, 255, 255, 190), anchor="lm")
    im.save("m_pack.png")


def exhaust(dur=2.6):
    n = int(SR * dur)
    t = np.arange(n) / SR
    # curva de rotação: ralenti -> blip forte -> desce
    rpm = 900 + 3300 * np.exp(-((t - 0.45) / 0.28) ** 2)
    f0 = rpm / 60 * 3  # 6 cilindros, 4 tempos
    ph = 2 * np.pi * np.cumsum(f0) / SR
    rng = np.random.default_rng(7)
    sig = np.zeros(n)
    for k, a in enumerate([1.0, 0.8, 0.45, 0.2, 0.08], 1):
        sig += a * np.sin(k * ph + rng.uniform(0, 6)) * (1 + 0.15 * np.sin(0.5 * ph))
    sig = np.tanh(sig * 1.6)
    noise = rng.standard_normal(n)
    noise = np.convolve(noise, np.ones(12) / 12, "same")
    sig += noise * 0.12 * (rpm / 4200)
    # estalidos (crackle) na desaceleração
    for _ in range(3):
        c = rng.uniform(1.15, 2.2)
        i = int(c * SR)
        L = int(SR * rng.uniform(0.008, 0.025))
        env = np.exp(-np.linspace(0, 7, L))
        sig[i:i + L] += rng.uniform(0.4, 0.7) * env * rng.standard_normal(L)
    amp = np.clip(t / 0.05, 0, 1) * np.clip((dur - t) / 0.5, 0, 1) * (0.55 + 0.45 * rpm / 4200)
    sig *= amp
    # graves: passa-baixo simples
    sig = np.convolve(sig, np.ones(16) / 16, "same")
    sig = sig / np.abs(sig).max() * 0.9
    st = np.stack([sig, np.roll(sig, 40)], 1)
    with wave.open("exhaust.wav", "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((st * 32767).astype(np.int16).tobytes())


if __name__ == "__main__":
    badge(); exhaust(); print("ok m_pack.png exhaust.wav")
