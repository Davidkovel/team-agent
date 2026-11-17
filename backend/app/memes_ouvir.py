"""The Leitor's ears: what is said in a video or a voice note, as text. Runs as its own process (`python -m app.memes_ouvir
<file>`), niced, so a long transcription never slows the Hub; prints one JSON line {text, lang, dur}.

Local and free: faster-whisper (the `small` model, ~460 MB, downloaded once to ~/.team-agent/memes/whisper). It decodes
mp4/ogg with its own PyAV, no ffmpeg needed. When it is not installed the Leitor reads only the text and the images.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

MODEL = os.environ.get("MEMES_WHISPER", "small")
ROOT = Path.home() / ".team-agent" / "memes" / "whisper"


def available() -> bool:
    try:
        import faster_whisper  # noqa: F401
        return True
    except ImportError:
        return False


def main(path: str):
    from faster_whisper import WhisperModel
    try:
        os.nice(10)
    except (AttributeError, OSError):
        pass
    m = WhisperModel(MODEL, device="cpu", compute_type="int8", download_root=str(ROOT), cpu_threads=4)
    segs, info = m.transcribe(path, vad_filter=True, beam_size=1)
    text = " ".join(s.text.strip() for s in segs if s.end <= 900)   # 15 min is plenty for a call
    print(json.dumps({"text": text.strip(), "lang": info.language, "dur": round(info.duration)}))


if __name__ == "__main__":
    main(sys.argv[1])
