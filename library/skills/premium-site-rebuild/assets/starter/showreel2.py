"""Hero nítido: díptico 1080p com os vídeos originais do Instagram na resolução nativa (nada é ampliado).

    python -I _fonte/showreel2.py

Os originais são verticais 1080x1920. Um recorte 16:9 de um vertical tem 1080x607 e teria de ser ampliado 1,8x para
encher 1920x1080 — fica mole. Dois painéis verticais lado a lado (960x1080 cada, reduzidos do original) enchem o ecrã
largo com tudo nítido. Cada painel corta ao seu ritmo (1,6–2,6 s), por isso o olho tem sempre movimento novo.

Para cada montagem (hero, mkt, auto) escreve <nome>-1080/-720 (díptico) e <nome>-v1080/-v720 (um painel, telemóvel), com cartazes.
    python -I _fonte/showreel2.py hero    # só uma
"""
import subprocess
import sys
from pathlib import Path

from PIL import Image

FF = r"C:\Users\David\AppData\Local\Programs\Python\Python311\Lib\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe"
IG = Path(r"C:\Users\David\ferreras-extra\ig")
OUT = Path(__file__).resolve().parents[1] / "video"
L, G = "DWJdRoJiDJI.mp4", "DSDaaJDDa5a.mp4"            # estilo de vida + relógio · TN Autosport GT3 RS (os dois 1080x1920)
# (painel esquerdo, painel direito); planos escolhidos em folhas de fotogramas, sem legendas nem texto por cima
MONTAGENS = {
    "hero": ([(L, 0.0, 2.2), (L, 2.4, 4.2), (L, 22.4, 24.6), (L, 6.0, 7.6), (L, 12.0, 13.8), (L, 13.9, 15.5)],
             [(G, 0.3, 2.5), (G, 4.0, 5.8), (G, 29.4, 31.4), (G, 12.0, 13.6), (G, 18.0, 19.6), (G, 34.0, 36.0)]),
    "mkt": ([(G, 6.0, 7.8), (G, 8.0, 9.8), (G, 10.0, 11.6), (G, 14.0, 15.6), (G, 24.0, 25.8), (G, 38.0, 40.0)],
            [(L, 8.0, 10.0), (L, 10.0, 11.6), (L, 16.0, 17.8), (L, 18.0, 19.6), (L, 24.6, 26.4), (L, 27.6, 29.4)]),
    "auto": ([(G, 0.3, 2.5), (G, 4.0, 5.8), (G, 20.0, 22.0), (G, 24.0, 25.8), (G, 36.0, 37.8), (G, 16.0, 17.6)],
             [(G, 6.0, 7.8), (G, 12.0, 13.6), (G, 26.0, 27.8), (G, 30.0, 31.6), (G, 32.0, 33.6), (G, 34.0, 36.0)]),
}


def cadeia(cortes, pw, ph, rot, base):
    """Filtros de uma coluna de cortes: cada corte reduzido para pw de largura e recortado ao centro para ph."""
    partes, nomes = [], []
    for i, (f, a, b) in enumerate(cortes):
        n = f"{rot}{i}"
        partes.append(f"[{base[f]}:v]trim=start={a}:end={b},setpts=PTS-STARTPTS,fps=30,"
                      f"scale={pw}:-2:flags=lanczos,crop={pw}:{ph},setsar=1[{n}]")
        nomes.append(f"[{n}]")
    partes.append(f"{''.join(nomes)}concat=n={len(cortes)}:v=1:a=0[{rot}]")
    return partes


def corre(args):
    subprocess.run([FF, "-hide_banner", "-loglevel", "error", "-y"] + args, check=True)


def cartaz(nome):
    j = OUT / f"{nome}.jpg"
    corre(["-ss", "0.5", "-i", str(OUT / f"{nome}.mp4"), "-frames:v", "1", "-q:v", "2", str(j)])
    Image.open(j).save(OUT / f"{nome}-poster.webp", "WEBP", quality=86, method=6)
    j.unlink()


def diptico(nome, esq, dir_, w, h, crf):
    base = {L: 0, G: 1}
    pw = w // 2
    fc = cadeia(esq, pw, h, "e", base) + cadeia(dir_, pw, h, "d", base)
    fc.append(f"[e][d]hstack=inputs=2,drawbox=x={pw - 1}:y=0:w=2:h={h}:color=black@0.55:t=fill,"
              "eq=contrast=1.03:saturation=0.94,format=yuv420p[out]")
    corre(["-i", str(IG / L), "-i", str(IG / G), "-filter_complex", ";".join(fc), "-map", "[out]", "-an",
           "-c:v", "libx264", "-preset", "slow", "-crf", str(crf), "-profile:v", "high", "-pix_fmt", "yuv420p",
           "-movflags", "+faststart", str(OUT / f"{nome}.mp4")])
    cartaz(nome)


def vertical(nome, cortes, w, h, crf):
    base = {L: 0, G: 1}
    fc = cadeia(cortes, w, h, "v", base)
    fc.append("[v]eq=contrast=1.03:saturation=0.94,format=yuv420p[out]")
    corre(["-i", str(IG / L), "-i", str(IG / G), "-filter_complex", ";".join(fc), "-map", "[out]", "-an",
           "-c:v", "libx264", "-preset", "slow", "-crf", str(crf), "-profile:v", "high", "-pix_fmt", "yuv420p",
           "-movflags", "+faststart", str(OUT / f"{nome}.mp4")])
    cartaz(nome)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    so = sys.argv[1:] or list(MONTAGENS)
    for n in so:
        esq, dir_ = MONTAGENS[n]
        alt = [c for par in zip(esq, dir_) for c in par][:8]      # telemóvel: um painel, alternando as duas colunas
        diptico(f"{n}-1080", esq, dir_, 1920, 1080, 22 if n == "hero" else 23)
        diptico(f"{n}-720", esq, dir_, 1280, 720, 23)
        vertical(f"{n}-v1080", alt, 1080, 1920, 25)
        vertical(f"{n}-v720", alt, 720, 1280, 24)
        for k in ("1080", "720", "v1080", "v720"):
            print(f"{n}-{k}", round((OUT / f"{n}-{k}.mp4").stat().st_size / 1e6, 2), "MB")
