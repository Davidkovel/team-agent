"""Monta o showreel do hero a partir dos vídeos originais do Instagram da Ferreras (pasta ferreras-extra/ig).

    python -I _fonte/showreel.py

Escreve video/showreel-h.mp4 (1280x720, faixa central dos verticais) e video/showreel-v.mp4 (720x1280),
com os cartazes .webp do primeiro fotograma. Cortes secos de 1,4–2,4 s: o olhar não tem tempo de sair.
Sem som (autoplay no iPhone), H.264 + faststart.
"""
import subprocess
import sys
from pathlib import Path

FF = r"C:\Users\David\AppData\Local\Programs\Python\Python311\Lib\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe"
IG = Path(r"C:\Users\David\ferreras-extra\ig")
OUT = Path(__file__).resolve().parents[1] / "video"
FONTES = {"L": "DWJdRoJiDJI.mp4", "G": "DSDaaJDDa5a.mp4", "C": "DJCPhAoIzRx.mp4"}   # estilo de vida · TN GT3 RS · CarDress
CORTES = [("L", 0.0, 2.0), ("G", 0.4, 2.4), ("L", 1.5, 3.3), ("G", 29.6, 31.4), ("L", 6.0, 7.4), ("C", 9.6, 11.3),
          ("L", 12.0, 13.5), ("G", 34.0, 36.0), ("L", 22.6, 25.0), ("G", 18.0, 19.6), ("L", 15.0, 16.9)]


def monta(nome, w, h, horizontal):
    ordem = list(FONTES)
    args = [FF, "-hide_banner", "-loglevel", "error", "-y"]
    for k in ordem:
        args += ["-i", str(IG / FONTES[k])]
    partes = []
    for i, (k, a, b) in enumerate(CORTES):
        s = ordem.index(k)
        if horizontal:   # a faixa central 16:9 do vertical
            geo = f"crop=iw:iw*9/16:0:(ih-iw*9/16)/2,scale={w}:{h}:flags=lanczos"
        else:
            geo = f"scale={w}:{h}:force_original_aspect_ratio=increase:flags=lanczos,crop={w}:{h}"
        partes.append(f"[{s}:v]trim=start={a}:end={b},setpts=PTS-STARTPTS,fps=30,{geo},setsar=1,format=yuv420p[v{i}]")
    cadeia = "".join(f"[v{i}]" for i in range(len(CORTES)))
    fc = ";".join(partes) + f";{cadeia}concat=n={len(CORTES)}:v=1:a=0,eq=contrast=1.04:saturation=0.92[out]"
    destino = OUT / f"{nome}.mp4"
    args += ["-filter_complex", fc, "-map", "[out]", "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "27" if horizontal else "28",
             "-profile:v", "high", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(destino)]
    subprocess.run(args, check=True)
    cartaz = OUT / f"{nome}-poster.jpg"
    subprocess.run([FF, "-hide_banner", "-loglevel", "error", "-y", "-ss", "0.3", "-i", str(destino), "-frames:v", "1", "-q:v", "3", str(cartaz)], check=True)
    from PIL import Image
    Image.open(cartaz).save(OUT / f"{nome}-poster.webp", "WEBP", quality=72, method=6)
    cartaz.unlink()
    print(nome, round(destino.stat().st_size / 1e6, 2), "MB", sum(b - a for _, a, b in CORTES), "s")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    monta("showreel-h", 1280, 720, True)
    monta("showreel-v", 720, 1280, False)
