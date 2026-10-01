import json
import os
import subprocess
import tempfile
import time

os.environ.setdefault("DATABASE_URL", f"sqlite+aiosqlite:///{tempfile.mkdtemp()}/test.db")
os.environ.setdefault("REDIS_URL", "")

import pytest

from app import commits, worktree
from app.config import settings


@pytest.fixture()
def repo(tmp_path):
    """A library with one repo that has a commit, so anything after it is uncommitted work."""
    project = tmp_path / "project"
    (project / "sections").mkdir(parents=True)
    (project / "sections" / "header.liquid").write_text("one\n", encoding="utf-8")
    git = ["git", "-C", str(project), "-c", "user.name=Marco", "-c", "user.email=m@x.io"]
    subprocess.run(["git", "-C", str(project), "init", "-q"], check=True)
    subprocess.run([*git, "add", "-A"], check=True)
    subprocess.run([*git, "commit", "-q", "-m", "base"], check=True)
    subprocess.run(["git", "-C", str(project), "config", "user.name", "Marco"], check=True)
    (tmp_path / "sources.json").write_text(json.dumps({"proj": str(project)}), encoding="utf-8")
    (tmp_path / "repos.json").write_text(json.dumps([{"name": "Proj", "github": "", "source": "proj"}]), encoding="utf-8")
    old = settings.library_dir
    settings.library_dir = str(tmp_path)
    worktree._cache.clear()
    yield project
    settings.library_dir = old
    worktree._cache.clear()


def test_clean_repo_has_nothing_pending(repo):
    assert worktree.pending() == []


def test_uncommitted_edits_show_up_with_where_how_much_and_when(repo):
    (repo / "sections" / "header.liquid").write_text("one\ntwo\nthree\n", encoding="utf-8")   # edited, not committed
    (repo / "sections" / "footer.liquid").write_text("new\n", encoding="utf-8")                # brand new file
    (repo / "__pycache__").mkdir()
    (repo / "__pycache__" / "x.pyc").write_bytes(b"0")                                         # noise must be ignored

    [row] = worktree.pending()
    by_path = {f["path"]: f for f in row["files"]}
    assert row["repo"] == "Proj" and row["user"] == "Marco" and row["count"] == 2
    assert by_path["sections/header.liquid"]["status"] == "alterado" and by_path["sections/header.liquid"]["added"] == 2
    assert by_path["sections/footer.liquid"]["status"] == "novo"
    assert not any("pyc" in p for p in by_path)
    assert time.time() - row["newest"] < 60 and row["added"] >= 2


def test_deleted_file_is_listed(repo):
    (repo / "sections" / "header.liquid").unlink()
    [row] = worktree.pending()
    assert row["files"][0]["status"] == "apagado" and row["files"][0]["mtime"] is None
