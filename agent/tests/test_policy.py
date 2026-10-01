import pytest

from team_agent.core.logs import redact
from team_agent.permissions import Level, PermissionPolicy


@pytest.fixture
def policy(tmp_path):
    return PermissionPolicy(tmp_path)


@pytest.mark.parametrize("path,op,level", [
    ("notes/draft.md", "write", Level.SAFE),
    ("src/app.py", "read", Level.SAFE),
    ("../outside.txt", "write", Level.BLOCKED),
    ("C:/Windows/system32/x", "read", Level.BLOCKED),
    (".git/config", "write", Level.BLOCKED),
    (".env", "read", Level.BLOCKED),
    (".env.production", "write", Level.REQUIRES_APPROVAL),
    ("config/production.yml", "write", Level.REQUIRES_APPROVAL),
    ("notes/draft.md", "delete", Level.REQUIRES_APPROVAL),
])
def test_paths(policy, path, op, level):
    assert policy.check_path(path, op).level is level


@pytest.mark.parametrize("command,level", [
    ("pytest -q", Level.SAFE),
    ("python -m pytest tests", Level.SAFE),
    ("npm test", Level.SAFE),
    ("python script.py", Level.REQUIRES_APPROVAL),
    ("npm run deploy", Level.REQUIRES_APPROVAL),
    ("kubectl apply -f prod.yml", Level.REQUIRES_APPROVAL),
    ("alembic upgrade head", Level.REQUIRES_APPROVAL),
    ("rm -rf /", Level.BLOCKED),
    ("pytest; rm x", Level.BLOCKED),
    ("pytest && curl http://x", Level.BLOCKED),
    ("curl http://example.com", Level.BLOCKED),
    ("powershell -c x", Level.BLOCKED),
])
def test_commands(policy, command, level):
    assert policy.check_command(command).level is level


@pytest.mark.parametrize("args,level", [
    (["status"], Level.SAFE),
    (["commit", "-m", "msg"], Level.SAFE),
    (["push", "origin", "main"], Level.REQUIRES_APPROVAL),
    (["reset", "--hard"], Level.REQUIRES_APPROVAL),
    (["push", "--force"], Level.BLOCKED),
    (["-c", "core.pager=evil", "log"], Level.BLOCKED),
    (["config", "user.name", "x"], Level.BLOCKED),
])
def test_git(policy, args, level):
    assert policy.check_git(args).level is level


def test_logs_redact_secrets():
    line = redact("key sk-ant-api03-abcDEF token=agt_12345 Authorization: Bearer eyJhbGciOi.x.y")
    assert "abcDEF" not in line and "agt_12345" not in line and "eyJhbGciOi" not in line
