# Entrega: reel_novo.mp4 + novos/*.mp4 -> enviar/ com a marca TEN FOLD discreta.
# Marca: branca monocromática, ~32% opacidade, 38 px de largura (60% dos 64 px antigos),
# canto superior direito com 40 px de margem (longe das legendas e do logo F. Fernandes).
# Uso: python entregar.py   (depois de python render.py)
import glob
import os
import shutil
import subprocess

MARK = r"C:\Users\David\amg-site\img\tf-mark.png"
FLT = ("[1:v]scale=38:-1,format=rgba,lutrgb=r=255:g=255:b=255,colorchannelmixer=aa=0.32[m];"
       "[0:v][m]overlay=W-w-40:40,format=yuv420p")
ENC = ["-c:v", "libx264", "-b:v", "3000k", "-maxrate", "3500k", "-bufsize", "6000k", "-preset", "slow",
       "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart"]


# extras só no reel completo: escape aos 3.3 s (carro entra)
FLT_FULL = ("[1:v]scale=38:-1,format=rgba,lutrgb=r=255:g=255:b=255,colorchannelmixer=aa=0.32[m];"
            "[0:v][m]overlay=W-w-40:40,format=yuv420p[v];"
            "[2:a]volume='if(lt(t,0.55),1,0.55)':eval=frame,adelay=3300|3300,volume=0.85[ex];[0:a][ex]amix=inputs=2:duration=first:normalize=0[a]")


def mark_full(src, dst):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-i", MARK, "-i", "exhaust_real.wav", "-filter_complex", FLT_FULL, "-map", "[v]", "-map", "[a]"] + ENC + [dst],
                   check=True)


def mark(src, dst):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-i", MARK, "-filter_complex", FLT] + ENC + [dst],
                   check=True)


if __name__ == "__main__":
    if not os.path.exists("enviar/reel_BMW_330e_antes.mp4"):
        shutil.copy2("enviar/reel_BMW_330e.mp4", "enviar/reel_BMW_330e_antes.mp4")
    mark_full("reel_novo.mp4", "enviar/reel_BMW_330e.mp4")
    os.makedirs("enviar/fragmentos", exist_ok=True)
    for f in sorted(glob.glob("novos/*.mp4")):
        mark(f, os.path.join("enviar/fragmentos", os.path.basename(f)))
    print("ok enviar/reel_BMW_330e.mp4 + fragmentos")
