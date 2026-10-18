"""Company library: read-only/editable views over folders that already exist on the server.

A company is a folder `library/companies/<id>/company.json` that lists sections.
Each section points at one or more *sources* (named folders mapped in
`library/sources.json`), so big media never has to be copied or put in Git.
"""
import json
import os
import re
import shutil
import time
from pathlib import Path

from .config import settings

TRASH = ".lixo"  # "deleting" in the gallery moves files here; nothing is ever erased
SKIP_DIRS = {"node_modules", ".git", "__pycache__", ".venv", ".next", "dist", TRASH}
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
                for section in data.get("sections", []):
                    section["_company"] = folder.name   # the plugins' trash is kept per company
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
        return {"items": static_items(section | {"_company": company_id}), "missing": []}

    items, missing = [], []
    for index, entry in enumerate(section.get("sources", [])):
        base = entry_base(entry)
        if base is None:
            missing.append(entry.get("label") or entry.get("path") or entry.get("source"))
            continue
        if kind == "sites":
            items += site_items(index, entry, base)
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


# ---- sites: a folder with an index.html (a test of the shop, a proposal for a client) that opens inside the Hub ----
SITE_POSTERS = ("img/poster.webp", "img/poster.jpg", "poster.webp", "poster.jpg", "img/og.jpg", "og.jpg", "frames/desk/0001.webp")
SITE_TYPES = {".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json",
              ".webp": "image/webp", ".avif": "image/avif", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
              ".svg": "image/svg+xml", ".gif": "image/gif", ".woff2": "font/woff2", ".woff": "font/woff", ".mp4": "video/mp4",
              ".webm": "video/webm", ".glb": "model/gltf-binary", ".txt": "text/plain", ".md": "text/plain"}


def _site_about(folder: Path) -> tuple[str, str]:
    """The site's title and what it is: the first heading and paragraph of its README.md, else the page's own."""
    readme = folder / "README.md"
    if readme.is_file():
        text = readme.read_text(encoding="utf-8", errors="replace")
        title = next((line.lstrip("# ").strip() for line in text.splitlines() if line.startswith("# ")), "")
        for block in text.split("\n\n"):
            para = " ".join(line.strip() for line in block.splitlines() if not line.lstrip().startswith(("#", "|", "-", "`")))
            if para.strip():
                return title, re.sub(r"[*`]", "", para).strip()[:420]
        return title, ""
    page = (folder / "index.html").read_text(encoding="utf-8", errors="replace")[:8000]
    title = re.search(r"<title>([^<]*)</title>", page, re.I)
    about = re.search(r'<meta\s+name="description"\s+content="([^"]*)"', page, re.I)
    return (title.group(1).strip() if title else ""), (about.group(1) if about else "")


def site_items(index: int, entry: dict, base: Path) -> list[dict]:
    """The entry's folder when it has an index.html, else each folder right under it that has one."""
    if not base.is_dir():
        return []
    folders = [base] if (base / "index.html").is_file() else sorted(
        p for p in base.iterdir() if p.is_dir() and p.name not in SKIP_DIRS and (p / "index.html").is_file())
    out = []
    for folder in folders:
        size = files = 0
        newest = 0.0
        for dirpath, dirnames, filenames in os.walk(folder):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            for name in filenames:
                stat = (Path(dirpath) / name).stat()
                size, files, newest = size + stat.st_size, files + 1, max(newest, stat.st_mtime)
        title, about = _site_about(folder)
        rel = "" if folder == base else folder.name
        out.append({"id": f"{index}:{rel}", "sid": f"{index}~{rel}" if rel else str(index),
                    "name": (entry.get("label") if folder == base else "") or title or folder.name, "title": title,
                    "about": about, "poster": next((p for p in SITE_POSTERS if (folder / p).is_file()), ""),
                    "size": size, "files": files, "mtime": int(newest), "group": entry.get("label", "")})
    return out


def resolve_site_file(section: dict, sid: str, path: str) -> Path | None:
    """A file of one site (`sid` = "<entry>" or "<entry>~<folder>"), never outside that site's folder."""
    index_text, _, rel = sid.partition("~")
    try:
        entry = section["sources"][int(index_text)]
    except (ValueError, IndexError, KeyError):
        return None
    base = entry_base(entry)
    if base is None or not base.is_dir() or "/" in rel or "\\" in rel or rel in (".", ".."):
        return None
    folder = (base / rel).resolve() if rel else base
    if not folder.is_relative_to(base) or not (folder / "index.html").is_file():
        return None
    target = (folder / (path or "index.html")).resolve()
    if target.is_dir():
        target = target / "index.html"
    if not target.is_file() or not target.is_relative_to(folder) or any(part in SKIP_DIRS for part in target.relative_to(folder).parts):
        return None
    return target


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


# ---- library management: rename / move / trash / restore / delete for good, in every section ----
# Videos and photos keep their trash next to them (`<folder>/.lixo`), as before. Everything else (theme, skills,
# documents) goes to ~/.team-agent/lixo/<folder hash>, so a Shopify theme or the Claude skills folder never gets a
# stray `.lixo` that a push or Claude would pick up. Ids of trashed items are `<entry>:.lixo/<path>` either way.
# Plugins are a list in git (plugins.json): trashing one hides it on this computer (~/.team-agent/lixo/static.json).
BAD_NAME = re.compile(r'[\\/:*?"<>|\x00-\x1f]')
TRASH_DIR = Path.home() / ".team-agent" / "lixo"


class ManageError(ValueError):
    """A request the library refuses; the message is shown to the person."""


def manageable(section: dict) -> bool:
    return section["kind"] in ("videos", "photos", "files", "cards", "static")


def clean_name(name: str) -> str:
    name = (name or "").strip()
    if not name or len(name) > 120 or BAD_NAME.search(name) or name.startswith(".") or name.endswith("."):
        raise ManageError("Nome inválido: sem barras nem os símbolos : * ? \" < > |, sem ponto no início, até 120 letras.")
    return name


def trash_root(section: dict, base: Path) -> Path:
    if section["kind"] in ("videos", "photos"):
        return base / TRASH
    import hashlib
    return TRASH_DIR / hashlib.sha1(str(base.resolve()).lower().encode()).hexdigest()[:16]


def _locate(section: dict, item_id: str) -> tuple[int, dict, Path, Path, bool]:
    """(entry index, entry, base folder, file, is in the trash) for an item; never outside the entry's folders."""
    try:
        index_text, rel = item_id.split(":", 1)
        index = int(index_text)
        entry = section["sources"][index]
    except (ValueError, IndexError, KeyError):
        raise ManageError("Ficheiro não encontrado.")
    base = entry_base(entry)
    if base is None:
        raise ManageError("Ficheiro não encontrado.")
    if not base.is_dir():
        raise ManageError("Este ficheiro é fixo nesta secção: não se mexe por aqui.")
    base = base.resolve()
    path, in_trash = None, rel.startswith(TRASH + "/")
    if in_trash:
        root = trash_root(section, base).resolve()
        target = (root / rel[len(TRASH) + 1:]).resolve()
        path = target if target.is_file() and target.is_relative_to(root) else None
    else:
        path = resolve_item(section, item_id)
    if path is None:
        raise ManageError("Ficheiro não encontrado.")
    return index, entry, base, path, in_trash


def _skill(entry: dict) -> bool:
    return entry.get("cards") == "skills"


def rename_item(section: dict, item_id: str, new_name: str) -> str:
    index, entry, base, path, in_trash = _locate(section, item_id)
    if _skill(entry) or in_trash:
        raise ManageError("Isto não se renomeia aqui.")
    new = clean_name(new_name)
    if Path(new).suffix.lower() != path.suffix.lower():
        raise ManageError(f"Mantém a extensão {path.suffix}.")
    target = path.with_name(new)
    if target.exists():
        raise ManageError("Já existe um ficheiro com esse nome.")
    path.rename(target)
    return f"{index}:{target.relative_to(base).as_posix()}"


def move_item(section: dict, item_id: str, folder: str) -> str:
    index, entry, base, path, in_trash = _locate(section, item_id)
    if _skill(entry) or in_trash:
        raise ManageError("Isto não se move aqui.")
    parts = [clean_name(p) for p in folder.replace("\\", "/").split("/") if p.strip()]
    dest = base.joinpath(*parts).resolve()
    if not dest.is_relative_to(base) or (parts and parts[0] == TRASH):
        raise ManageError("Pasta inválida.")
    target = dest / path.name
    if target.exists():
        raise ManageError("Essa pasta já tem um ficheiro com o mesmo nome.")
    dest.mkdir(parents=True, exist_ok=True)
    shutil.move(str(path), str(target))
    return f"{index}:{target.relative_to(base).as_posix()}"


def trash_item(section: dict, item_id: str) -> str:
    if section["kind"] == "static":
        return _static_move(section, item_id, "trash")
    index, entry, base, path, in_trash = _locate(section, item_id)
    if in_trash:
        raise ManageError("Já está no lixo.")
    unit = path.parent if _skill(entry) else path      # a skill goes with its whole folder
    rel = unit.relative_to(base)
    root = trash_root(section, base)
    target = root / rel
    if target.exists():
        target = target.with_name(f"{int(time.time())}-{rel.name}")
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(unit), str(target))
    inside = target / path.name if _skill(entry) else target
    return f"{index}:{TRASH}/{inside.relative_to(root).as_posix()}"


def restore_item(section: dict, item_id: str) -> str:
    if section["kind"] == "static":
        return _static_move(section, item_id, "restore")
    index, entry, base, path, in_trash = _locate(section, item_id)
    if not in_trash:
        raise ManageError("Este ficheiro não está no lixo.")
    unit = path.parent if _skill(entry) else path
    root = trash_root(section, base).resolve()
    target = base / unit.relative_to(root)
    if target.exists():
        raise ManageError("Já existe um ficheiro com esse nome no sítio original.")
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(unit), str(target))
    inside = target / path.name if _skill(entry) else target
    return f"{index}:{inside.relative_to(base).as_posix()}"


def purgeable(section: dict) -> bool:
    """Only videos and photos can be deleted for good; the theme, skills, documents and plugins can only be restored."""
    return section["kind"] in ("videos", "photos")


def purge_item(section: dict, item_id: str) -> str:
    """Deletes for good a video or photo that is already in the trash."""
    if not purgeable(section):
        raise ManageError("Daqui só se restaura: apagar de vez é só nos vídeos e nas fotos.")
    index, entry, base, path, in_trash = _locate(section, item_id)
    if not in_trash:
        raise ManageError("Primeiro manda-o para o lixo; só do lixo se apaga de vez.")
    path.unlink()
    return ""


def empty_trash(section: dict) -> int:
    if not purgeable(section):
        raise ManageError("Daqui só se restaura: apagar de vez é só nos vídeos e nas fotos.")
    gone = 0
    for item in list_trash(section):
        try:
            purge_item(section, item["id"])
            gone += 1
        except (ManageError, OSError):
            pass
    return gone


def list_trash(section: dict) -> list[dict]:
    if section["kind"] == "static":
        hidden = _static_state(section)["trash"]
        return [it | {"id": f"s:{it.get('name', '')}"} for it in _static_all(section) if it.get("name") in hidden]
    items = []
    for index, entry in enumerate(section.get("sources", [])):
        base = entry_base(entry)
        if base is None or not base.is_dir():
            continue
        root = trash_root(section, base.resolve())
        if not root.is_dir():
            continue
        if _skill(entry):
            for skill in sorted(root.glob("*/SKILL.md")):
                meta = _frontmatter(skill.read_text(encoding="utf-8", errors="replace"))
                items.append({"id": f"{index}:{TRASH}/{skill.relative_to(root).as_posix()}", "name": meta.get("name", skill.parent.name),
                              "description": meta.get("description", ""), "tag": entry.get("label", "")})
            continue
        exts = exts_of(section, entry)
        for file in sorted(root.rglob("*")):
            if file.is_file() and (not exts or file.name.lower().endswith(exts)):
                stat, rel = file.stat(), file.relative_to(root)
                items.append({"id": f"{index}:{TRASH}/{rel.as_posix()}", "name": file.name,
                              "folder": "" if rel.parent == Path(".") else rel.parent.as_posix(),
                              "size": stat.st_size, "mtime": int(stat.st_mtime), "group": section_entry_label(section, index)})
    return items


# plugins: a list in git, hidden per computer
def _static_key(section: dict) -> str:
    return f"{section.get('_company', '')}/{section['id']}"


def _static_all(section: dict) -> list[dict]:
    return _load_json(library_dir() / "companies" / section.get("_company", "") / section["file"], [])


def _static_state(section: dict) -> dict:
    state = _load_json(TRASH_DIR / "static.json", {}).get(_static_key(section), {})
    return {"trash": list(state.get("trash", []))}


def _static_move(section: dict, item_id: str, op: str) -> str:
    name = item_id[2:] if item_id.startswith("s:") else ""
    if not name or name not in {it.get("name") for it in _static_all(section)}:
        raise ManageError("Não encontrado.")
    state = _static_state(section)
    if op == "trash":
        if name in state["trash"]:
            raise ManageError("Já está no lixo.")
        state["trash"].append(name)
    else:
        if name not in state["trash"]:
            raise ManageError("Não está no lixo.")
        state["trash"].remove(name)
    everything = _load_json(TRASH_DIR / "static.json", {})
    everything[_static_key(section)] = state
    TRASH_DIR.mkdir(parents=True, exist_ok=True)
    (TRASH_DIR / "static.json").write_text(json.dumps(everything, ensure_ascii=False, indent=1), encoding="utf-8")
    return item_id


def static_items(section: dict) -> list[dict]:
    off = set(_static_state(section)["trash"])
    return [it | {"id": f"s:{it.get('name', '')}"} for it in _static_all(section) if it.get("name") not in off]


# ---- video posters: one still frame per video, so a gallery never has to open dozens of videos at once ----

POSTER_DIR = Path.home() / ".team-agent" / "posters"
POSTER_WIDTH = 480


def ffmpeg() -> str | None:
    """ffmpeg on PATH, or where winget puts it (winget's PATH change only reaches programs started after it)."""
    found = shutil.which("ffmpeg")
    if found:
        return found
    winget = Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WinGet" / "Packages"
    return next((str(p) for p in winget.glob("*FFmpeg*/*/bin/ffmpeg.exe")), None) if winget.is_dir() else None


def poster(video: Path) -> Path | None:
    """A JPEG of the frame at 1 s (or the first one), made once per file version; None when ffmpeg is missing or fails."""
    import hashlib
    import subprocess

    st = video.stat()
    key = hashlib.sha1(f"{video.resolve()}|{st.st_size}|{st.st_mtime_ns}".encode()).hexdigest()[:20]
    out = POSTER_DIR / f"{key}.jpg"
    if out.exists():
        return out
    exe = ffmpeg()
    if not exe:
        return None
    POSTER_DIR.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".tmp.jpg")
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    for seek in ("1", "0"):   # videos shorter than a second have no frame at 1 s
        try:
            subprocess.run([exe, "-v", "error", "-y", "-ss", seek, "-i", str(video), "-frames:v", "1",
                            "-vf", f"scale={POSTER_WIDTH}:-2", "-q:v", "4", str(tmp)],
                           timeout=30, capture_output=True, creationflags=flags)
        except (OSError, subprocess.SubprocessError):
            return None
        if tmp.exists() and tmp.stat().st_size:
            tmp.replace(out)
            return out
    return None
