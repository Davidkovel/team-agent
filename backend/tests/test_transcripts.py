"""How much each Claude window and each subagent used: tokens and model, from the end of its transcript, reading only what
is new each time, and counting each message once (Claude Code writes the same message several times as it streams)."""
import json

from app import transcripts


def line(msg_id, model, inp, out, cache_new=0, cache_read=0, kind="assistant"):
    return json.dumps({"type": kind, "message": {"id": msg_id, "model": model, "role": "assistant", "content": [{"type": "text", "text": "NUNCA LIDO"}],
                                                 "usage": {"input_tokens": inp, "output_tokens": out, "cache_creation_input_tokens": cache_new,
                                                           "cache_read_input_tokens": cache_read}}})


def test_each_message_counts_once_with_its_last_numbers(tmp_path):
    path = tmp_path / "s.jsonl"
    path.write_text("\n".join([
        json.dumps({"type": "user", "message": {"role": "user", "content": "olá"}}),
        line("m1", "claude-opus-5-5", 10, 1),       # streaming: the first copy has the output half counted
        line("m1", "claude-opus-5-5", 10, 50),      # the last copy is the real one
        line("m2", "claude-opus-5-5", 20, 30, cache_new=100, cache_read=900),
    ]) + "\n", encoding="utf-8")
    use = transcripts.usage(str(path))
    assert use == {"tokens": 10 + 50 + 20 + 30 + 100, "cache_read": 900, "model": "claude-opus-5-5"}


def test_only_what_is_new_is_read(tmp_path):
    path = tmp_path / "s.jsonl"
    path.write_text(line("m1", "claude-sonnet-5-5", 5, 5) + "\n", encoding="utf-8")
    assert transcripts.usage(str(path))["tokens"] == 10
    with open(path, "a", encoding="utf-8") as f:
        f.write(line("m2", "claude-opus-5-5", 1, 1) + "\n" + line("m1", "claude-sonnet-5-5", 5, 7) + "\n")
    use = transcripts.usage(str(path))
    assert use["tokens"] == 5 + 7 + 1 + 1 and use["model"] == "claude-sonnet-5-5"  # the model of the last line written
    assert transcripts._files[str(path)].offset == path.stat().st_size


def test_a_half_written_last_line_waits_for_the_next_look(tmp_path):
    path = tmp_path / "s.jsonl"
    whole = line("m1", "claude-opus-5-5", 3, 4)
    path.write_text(whole + "\n" + whole[:20], encoding="utf-8")
    assert transcripts.usage(str(path))["tokens"] == 7
    with open(path, "a", encoding="utf-8") as f:
        f.write(line("m9", "claude-opus-5-5", 1, 1)[20:] + "\n")
    assert transcripts.usage(str(path)) is not None


def test_a_missing_file_is_no_answer(tmp_path):
    assert transcripts.usage(str(tmp_path / "nada.jsonl")) is None
    assert transcripts.usage("") is None
