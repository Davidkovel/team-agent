"""The team's Claude Code between the PCs: which plugins travel, which get installed, and personal skills packed and
unpacked safely."""
import io
import json
import zipfile

import pytest

from app import claude_kit as kit


def test_only_marketplaces_on_github_travel():
    assert kit.github_repo({"source": "github", "repo": "anthropics/skills"}) == "anthropics/skills"
    assert kit.github_repo({"source": "git", "url": "https://github.com/anthropics/claude-plugins-official.git"}) == "anthropics/claude-plugins-official"
    assert kit.github_repo({"source": "git", "url": "https://gitlab.com/a/b.git"}) is None
    assert kit.github_repo({"source": "directory", "path": "C:\\x"}) is None
    assert kit.github_repo("anthropics/skills") is None


def test_my_plugins_are_the_installed_ones_from_github_minus_the_ones_kept_out(tmp_path, monkeypatch):
    plugins = tmp_path / "plugins"
    plugins.mkdir()
    (plugins / "installed_plugins.json").write_text(json.dumps({"version": 2, "plugins": {
        "superpowers@claude-plugins-official": [{}], "activecampaign@claude-plugins-official": [{}], "mine@local-folder": [{}]}}))
    (plugins / "known_marketplaces.json").write_text(json.dumps({
        "claude-plugins-official": {"source": {"source": "git", "url": "https://github.com/anthropics/claude-plugins-official.git"}},
        "local-folder": {"source": {"source": "directory", "path": "C:\\plugins"}}}))
    monkeypatch.setattr(kit, "CLAUDE", tmp_path)
    assert kit.my_plugins() == {"superpowers@claude-plugins-official": "anthropics/claude-plugins-official"}


def test_what_gets_installed_and_what_the_person_removed_stays_removed():
    wanted = {"a@m": "o/r", "b@m": "o/r", "c@m": "o/r", "d@m": "o/r", "activecampaign@claude-plugins-official": "o/r"}
    now = 100_000.0
    state = {"installed": ["b@m"], "failed": {"c@m": {"at": now - 60}, "d@m": {"at": now - kit.RETRY - 1}}}
    kit.notice_removals(state, have={"a@m"})   # b was installed by the Hub and is gone now
    assert state["removed"] == ["b@m"] and state["installed"] == []
    assert kit.to_install(wanted, state, have={"a@m"}, now=now) == ["d@m"]   # c failed a minute ago, d long ago


def test_a_personal_skill_packs_and_unpacks_into_place(tmp_path):
    src = tmp_path / "src"
    (src / "scripts").mkdir(parents=True)
    (src / "SKILL.md").write_text("---\nname: reel\n---\n", encoding="utf-8")
    (src / "scripts" / "render.mjs").write_text("// x", encoding="utf-8")
    (src / "node_modules").mkdir()
    (src / "node_modules" / "big.js").write_text("x", encoding="utf-8")
    dest = tmp_path / "skills" / "reel"
    kit.unpack(kit.pack(src), dest)
    assert sorted(p.relative_to(dest).as_posix() for p in dest.rglob("*") if p.is_file()) == ["SKILL.md", "scripts/render.mjs"]
    assert kit._skill_hash(dest) == kit._skill_hash(src.__class__(dest))


def _zip(files: dict) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, text in files.items():
            z.writestr(name, text)
    return buf.getvalue()


def test_a_zip_that_leaves_its_folder_or_is_not_a_skill_is_refused(tmp_path):
    dest = tmp_path / "skills" / "x"
    with pytest.raises(ValueError):
        kit.unpack(_zip({"SKILL.md": "x", "../../fora.txt": "x"}), dest)
    with pytest.raises(ValueError):
        kit.unpack(_zip({"README.md": "x"}), dest)
    assert not dest.exists() and not (tmp_path / "fora.txt").exists()
    assert [p.name for p in (tmp_path / "skills").iterdir()] == []   # no half-written folder left behind


def test_my_skills_leave_out_private_ones_the_library_and_copies_from_others(tmp_path, monkeypatch):
    skills = tmp_path / "claude" / "skills"
    for name in ("motion-reel-codigo", "segredo", "site-empresa-local", "veio-do-david"):
        (skills / name).mkdir(parents=True)
        (skills / name / "SKILL.md").write_text("x", encoding="utf-8")
    (skills / "segredo" / ".privada").write_text("", encoding="utf-8")
    (tmp_path / "lib" / "site-empresa-local").mkdir(parents=True)
    state = tmp_path / "kit.json"
    state.write_text(json.dumps({"skills": {"veio-do-david": ["h", "h"]}}), encoding="utf-8")
    monkeypatch.setattr(kit, "CLAUDE", tmp_path / "claude")
    monkeypatch.setattr(kit, "LIBRARY", tmp_path / "lib")
    monkeypatch.setattr(kit, "STATE", state)
    assert list(kit.my_skills()) == ["motion-reel-codigo"]
