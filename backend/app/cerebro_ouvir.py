"""The Cérebro's ears (24 Nov, Marco: «um WhisperFlow lá, mas tudo de graça»): what was said into the microphone, as text.
Runs as its own process (`python -m app.cerebro_ouvir <file>`), prints one JSON line {text, lang, dur}. Local and free:
faster-whisper with the same `small` model the Memecoins' Leitor already downloaded (~/.team-agent/memes/whisper); PyAV
decodes the browser's webm/opus or mp4, no ffmpeg needed.
"""
import json
import os
import sys

from .memes_ouvir import MODEL, ROOT

# words the team says that Whisper would otherwise spell wrong
HINT = "Cérebro, AMG, Claude, ChatGPT, Higgsfield, Canva, Kovel, Marco, David, widget, Hub, reel, Etsy, memecoins, FundedNext."


def main(path: str):
    from faster_whisper import WhisperModel
    m = WhisperModel(os.environ.get("CEREBRO_WHISPER", MODEL), device="cpu", compute_type="int8", download_root=str(ROOT), cpu_threads=4)
    segs, info = m.transcribe(path, vad_filter=True, beam_size=1, initial_prompt=HINT)
    text = " ".join(s.text.strip() for s in segs)
    print(json.dumps({"text": text.strip(), "lang": info.language, "dur": round(info.duration, 1)}, ensure_ascii=False))


if __name__ == "__main__":
    main(sys.argv[1])
