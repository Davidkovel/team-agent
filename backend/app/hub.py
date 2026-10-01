"""Company library: read-only/editable views over folders that already exist on the server.

A company is a folder `library/companies/<id>/company.json` that lists sections.
Each section points at one or more *sources* (named folders mapped in
`library/sources.json`), so big media never has to be copied or put in Git.
"""
import json
import os
import re
from pathlib import Path

from .config import settings

SKIP_DIRS = {"node_modules", ".git", "__pycache__", ".venv", ".next", "dist"}
MAX_ITEMS = 1500
MAX_TEXT_BYTES = 1_000_000
ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,40}$")

VIDEO_EXTS = (".mp4", ".mov", ".webm")
IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg")


def library_dir() -> Path:
    return Path(settings.library_dir)


def _load_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def sources() -> dict[str, Path]:
    raw = _load_json(library_dir() / "sources.json", {})
    return {name: Path(p) for name, p in raw.items() if isinstance(p, str)}


def companies() -> dict[str, dict]:
    out = {}
    root = library_dir() / "companies"
    if root.is_dir():
        for folder in sorted(root.iterdir()):
            data = _load_json(folder / "company.json", None)
            if data and ID_RE.match(folder.name):
                data["id"] = folder.name
                out[folder.name] = data
    return out


def get_section(company_id: str, section_id: str) -> tuple[dict, dict] | None:
    company = companies().get(company_id)
    if not company:
        return None
    for section in company.get("sections", []):
        if section["id"] == section_id:
            return company, section
    return None


def entry_base(entry: dict) -> Path | None:
    root = sources().get(entry.get("source", ""))
    if not root or not root.exists():
        return None
    base = (root / entry.get("path", "")).resolve()
    return base if base.exists() and base.is_relative_to(root.resolve()) else None


def exts_of(section: dict, entry: dict) -> tuple[str, ...]:
    if "exts" in entry:
        return tuple(entry["exts"])
    kind = section["kind"]
    return VIDEO_EXTS if kind == "videos" else IMAGE_EXTS if kind == "photos" else ()


def _item(entry_index: int, base: Path, file: Path, section: dict) -> dict:
    stat = file.stat()
    rel = "" if file == base else file.relative_to(base).as_posix()
    folder = "" if file == base else file.relative_to(base).parent.as_posix()
    return {"id": f"{entry_index}:{rel}", "name": file.name, "folder": "" if folder == "." else folder,
            "size": stat.st_size, "mtime": int(stat.st_mtime), "group": section_entry_label(section, entry_index)}


def section_entry_label(section: dict, index: int) -> str:
    entry = section["sources"][index]
    return entry.get("label") or entry.get("path") or entry.get("source", "")


def _frontmatter(text: str) -> dict:
    meta = {}
    if text.startswith("---"):
        head = text.split("---", 2)
        if len(head) >= 3:
            for line in head[1].splitlines():
                if ":" in line:
                    key, value = line.split(":", 1)
                    meta[key.strip()] = value.strip().strip("\"'")
    return meta


def list_section(company_id: str, section: dict) -> dict:
    kind = section["kind"]
    if kind == "static":
        file = library_dir() / "companies" / company_id / section["file"]
        return {"items": _load_json(file, []), "missing": []}

    items, missing = [], []
    for index, entry in enumerate(section.get("sources", [])):
        base = entry_base(entry)
        if base is None:
            missing.append(entry.get("label") or entry.get("path") or entry.get("source"))
            continue
        if entry.get("cards") == "skills":
            for sub in sorted(p for p in base.iterdir() if p.is_dir()):
                if entry.get("only") and sub.name not in entry["only"]:
                    continue
                skill = sub / "SKILL.md"
                if skill.is_file():
                    text = skill.read_text(encoding="utf-8", errors="replace")
                    meta = _frontmatter(text)
                    items.append({"id": f"{index}:{skill.relative_to(base).as_posix()}",
                                  "name": meta.get("name", sub.name), "description": meta.get("description", ""),
                                  "tag": entry.get("label", "")})
            continue
        exts = exts_of(section, entry)
        if base.is_file():
            items.append(_item(index, base, base, section))
            continue
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS)
            for name in sorted(filenames):
                if exts and not name.lower().endswith(exts):
                    continue
                items.append(_item(index, base, Path(dirpath) / name, section))
                if len(items) >= MAX_ITEMS:
                    return {"items": items, "missing": missing, "truncated": True}
            if not entry.get("recursive", True):
                break
    return {"items": items, "missing": missing}


def resolve_item(section: dict, item_id: str) -> Path | None:
    """Maps an item id back to a real file, never leaving the entry's folder."""
    try:
        index_text, rel = item_id.split(":", 1)
        entry = section["sources"][int(index_text)]
    except (ValueError, IndexError, KeyError):
        return None
    base = entry_base(entry)
    if base is None:
        return None
    target = base if (base.is_file() and rel == "") else (base / rel).resolve()
    if not target.is_file() or not (target == base or target.is_relative_to(base)):
        return None
    return target
