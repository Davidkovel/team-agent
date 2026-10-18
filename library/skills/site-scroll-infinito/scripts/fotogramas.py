"""Corta um filme (ou vários, encadeados) nas pastas de fotogramas que o canvas[data-fotogramas] do starter lê.

    python -I fotogramas.py filme.mp4 [filme2.mp4 ...] --saida site/frames [--n 120] [--largura 1600]
           [--tel filme-vertical.mp4 | --foco 0.5] [--n-tel 90] [--largura-tel 720] [--qualidade 62]

- Vários filmes = uma viagem só: são colados pela ordem dada. Se o último fotograma de um for igual ao primeiro do
  seguinte (é assim que se encadeiam clips de IA com primeiro/último fotograma), o repetido sai.
- PC: <saida>/desk/0001.webp ... com --n fotogramas espalhados por igual pelo filme todo, a --largura px.
- Telemóvel: <saida>/tel/0001.webp ... a 9:16. Do filme vertical dado em --tel, ou recortado do filme do PC à volta de
  --foco (0 = esquerda, 0.5 = meio, 1 = direita).
- Escreve <saida>/fotogramas.json e mostra os atributos para colar no HTML e o peso de cada pasta.
Precisa do ffmpeg (com libwebp; o build do gyan.dev tem). Sem libwebp, usa --ext jpg.
"""
import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
LIMITE_DESK_MB, LIMITE_TEL_MB = 9, 4


def ffmpeg(*args: str) -> None:
    r = subprocess.run(["ffmpeg", "-v", "error", "-y", *args], capture_output=True, text=True)
    if r.returncode:
        sys.exit("ffmpeg falhou:\n" + r.stderr[-2000:])


def duracao(f: Path) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(f)],
                       capture_output=True, text=True)
    return float(r.stdout.strip() or 0)


def cola(filmes: list, destino: Path) -> Path:
    """Um filme só, sem som, a 30 fps, com o 1.º fotograma de cada clip seguinte tirado (é o último do anterior)."""
    if len(filmes) == 1:
        ffmpeg("-i", str(filmes[0]), "-an", "-vf", "fps=30", "-c:v", "libx264", "-crf", "14", "-pix_fmt", "yuv420p", str(destino))
        return destino
    entradas = []
    for f in filmes:
        entradas += ["-i", str(f)]
    w, h = tamanho(filmes[0])   # todos ao tamanho do primeiro, para o concat aceitar
    partes = [f"[{i}:v]fps=30,scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},setsar=1"
              f"{',trim=start_frame=1,setpts=PTS-STARTPTS' if i else ''}[v{i}]" for i in range(len(filmes))]
    filtro = ";".join(partes) + ";" + "".join(f"[v{i}]" for i in range(len(filmes))) + f"concat=n={len(filmes)}:v=1:a=0[o]"
    ffmpeg(*entradas, "-filter_complex", filtro, "-map", "[o]", "-c:v", "libx264", "-crf", "14", "-pix_fmt", "yuv420p", str(destino))
    return destino


def tamanho(f: Path) -> tuple:
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                        "-of", "csv=p=0", str(f)], capture_output=True, text=True)
    w, h = r.stdout.strip().split(",")[:2]
    return int(w), int(h)


def corta(filme: Path, pasta: Path, n: int, filtro: str, ext: str, qualidade: int) -> float:
    if pasta.exists():
        shutil.rmtree(pasta)
    pasta.mkdir(parents=True)
    fps = n / max(0.1, duracao(filme))
    codec = ["-c:v", "libwebp", "-quality", str(qualidade), "-compression_level", "6"] if ext == "webp" else ["-q:v", "4"]
    ffmpeg("-i", str(filme), "-vf", f"fps={fps:.5f},{filtro}", "-frames:v", str(n), *codec, "-start_number", "1",
           str(pasta / f"%04d.{ext}"))
    return sum(f.stat().st_size for f in pasta.iterdir()) / 1e6


def main() -> None:
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument("filmes", nargs="+", type=Path)
    a.add_argument("--saida", type=Path, required=True)
    a.add_argument("--n", type=int, default=120)
    a.add_argument("--largura", type=int, default=1600)
    a.add_argument("--tel", type=Path, help="filme vertical próprio para o telemóvel")
    a.add_argument("--foco", type=float, default=0.5)
    a.add_argument("--n-tel", type=int, default=90)
    a.add_argument("--largura-tel", type=int, default=720)
    a.add_argument("--qualidade", type=int, default=62)
    a.add_argument("--ext", choices=["webp", "jpg"], default="webp")
    o = a.parse_args()
    if not shutil.which("ffmpeg"):
        sys.exit("Falta o ffmpeg (winget install Gyan.FFmpeg).")
    for f in o.filmes + ([o.tel] if o.tel else []):
        if not f.is_file():
            sys.exit(f"Não encontro {f}")
    with tempfile.TemporaryDirectory() as tmp:
        filme = cola(o.filmes, Path(tmp) / "viagem.mp4")
        desk = corta(filme, o.saida / "desk", o.n, f"scale={o.largura}:-2:flags=lanczos", o.ext, o.qualidade)
        wt = o.largura_tel - o.largura_tel % 2
        ht = round(wt * 16 / 9 / 2) * 2
        if o.tel:
            fonte, filtro = o.tel, f"scale={wt}:{ht}:force_original_aspect_ratio=increase:flags=lanczos,crop={wt}:{ht}"
        else:
            fonte = filme
            filtro = (f"scale=-2:{ht}:flags=lanczos,crop={wt}:{ht}:(iw-{wt})*{min(1, max(0, o.foco))}:0")
        tel = corta(fonte, o.saida / "tel", o.n_tel, filtro, o.ext, o.qualidade)
        w, h = tamanho(filme)
    info = {"n": o.n, "n_tel": o.n_tel, "ext": o.ext, "proporcao": round(w / h, 4), "desk_mb": round(desk, 2), "tel_mb": round(tel, 2)}
    (o.saida / "fotogramas.json").write_text(json.dumps(info, indent=1), encoding="utf-8")
    rel = o.saida.name
    print(f"PC: {o.n} fotogramas, {desk:.1f} MB" + ("  ← pesado: baixa --n, --largura ou --qualidade" if desk > LIMITE_DESK_MB else ""))
    print(f"Telemóvel: {o.n_tel} fotogramas, {tel:.1f} MB" + ("  ← pesado" if tel > LIMITE_TEL_MB else ""))
    print("\nNo HTML (dentro do .palco):")
    print(f'<canvas data-fotogramas data-dir="{rel}/desk/" data-n="{o.n}" data-dir-tel="{rel}/tel/" '
          f'data-n-tel="{o.n_tel}" data-ext="{o.ext}"></canvas>')


if __name__ == "__main__":
    main()
