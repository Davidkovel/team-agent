"""How much a Claude window or one of its subagents used, from its transcript on this PC
(~/.claude/projects/<folder>/<session>.jsonl; a subagent's in <session>/subagents/agent-<id>.jsonl).

Only the usage numbers and the model name of each reply are read: the text of the conversation is never kept, sent or
shown. Each file is read from where the last look stopped (a 23 MB transcript is not read again), and each message is
counted once, with its last numbers: Claude Code writes a reply several times while it streams, the first copies with
the output only partly counted. Tokens = input + output + writing to the cache; reading from the cache is kept apart,
since it is cheap and would drown the rest.
"""
import json
from dataclasses import dataclass, field
from pathlib import Path

MAX_FILES = 300  # files followed at once; the oldest is forgotten first (and read whole again if it comes back)


@dataclass
class _File:
    offset: int = 0
    messages: dict = field(default_factory=dict)  # message id -> (tokens, cache read)
    model: str = ""


_files: dict[str, _File] = {}


def usage(path: str) -> dict | None:
    """{"tokens", "cache_read", "model"} of a transcript so far, or None when there is no such file."""
    if not path:
        return None
    try:
        size = Path(path).stat().st_size
    except OSError:
        return None
    state = _files.get(path)
    if state is None or size < state.offset:  # new here, or the file was rewritten
        state = _files[path] = _File()
        while len(_files) > MAX_FILES:
            del _files[next(iter(_files))]
    if size > state.offset:
        with open(path, "rb") as f:
            f.seek(state.offset)
            chunk = f.read(size - state.offset)
        end = chunk.rfind(b"\n")  # a last line still being written waits for the next look
        for raw in chunk[:end].split(b"\n") if end >= 0 else []:
            if b'"usage"' not in raw:
                continue
            try:
                message = json.loads(raw).get("message") or {}
            except (ValueError, AttributeError):
                continue
            use, key = message.get("usage") or {}, message.get("id")
            if not key or not isinstance(use, dict):
                continue
            tokens = sum(int(use.get(k) or 0) for k in ("input_tokens", "output_tokens", "cache_creation_input_tokens"))
            state.messages[key] = (tokens, int(use.get("cache_read_input_tokens") or 0))
            model = str(message.get("model") or "")
            if model and not model.startswith("<"):  # "<synthetic>" marks Claude Code's own notes, not a model
                state.model = model
        if end >= 0:
            state.offset += end + 1
    return {"tokens": sum(t for t, _ in state.messages.values()), "cache_read": sum(c for _, c in state.messages.values()), "model": state.model}
