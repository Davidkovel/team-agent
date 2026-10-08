"""Agent core end-to-end with a scripted AI provider and an in-memory backend."""
import asyncio

from team_agent.core.agent import TeamAgent
from team_agent.core.config import Config
from team_agent.providers import AIProvider, RunResult
from team_agent.storage import LocalStore
from team_agent.tasks import RemoteTaskProvider


class FakeBackend:
    def __init__(self, tasks=(), unfinished=None, decision="APPROVED"):
        self.tasks, self._unfinished, self.decision = list(tasks), unfinished, decision
        self.updates, self.events, self.approvals, self.usage, self.heartbeats = [], [], [], [], []

    async def whoami(self):
        return {"username": "mark", "display_name": "Mark"}

    async def heartbeat(self, state):
        self.heartbeats.append(dict(state))
        return {"commands": [], "team": []}

    async def next_tasks(self):
        tasks, self.tasks = self.tasks, []
        return tasks

    async def recovery(self):
        return self._unfinished or {"task": None}

    async def update_task(self, task_id, **fields):
        self.updates.append(fields)
        return fields

    async def add_event(self, task_id, kind, message):
        self.events.append((kind, message))

    async def create_approval(self, task_id, action, detail):
        self.approvals.append(action)
        return {"id": len(self.approvals), "status": "PENDING"}

    async def get_approval(self, approval_id):
        return {"id": approval_id, "status": self.decision}

    async def report_usage(self, **usage):
        self.usage.append(usage)

    async def help(self, task_id, message):
        pass


class ScriptedAI(AIProvider):
    """Stands in for Claude: performs a fixed list of tool calls through the registry."""

    def __init__(self, script):
        self.script, self.results, self.calls = script, [], 0

    def unavailable_reason(self):
        return None

    async def run(self, prompt, system_prompt, registry, workspace, resume_session, on_session):
        self.calls += 1
        self.prompt, self.resumed = prompt, resume_session
        await on_session("sess-1")
        for name, args in self.script:
            self.results.append(await registry.execute(name, args))
        return RunResult(ok=True, session_id="sess-1", usage={"input_tokens": 10, "output_tokens": 5},
                         session_cost_usd=0.5)

    async def interrupt(self):
        pass


TASK = {"id": 142, "title": "Create Meta Ads", "description": "", "goal": "Prepare campaign",
        "requirements": ["3 texts"], "project": "", "status": "ASSIGNED", "progress": 0,
        "last_action": "", "next_action": "", "session_id": None}


def make_agent(tmp_path, backend, ai, **cfg):
    config = Config(server_url="http://x", agent_token="agt_x", workspace=tmp_path / "ws",
                    data_dir=tmp_path / "data", heartbeat_interval=0.02, approval_poll=0.01, **cfg)
    return TeamAgent(config, backend, RemoteTaskProvider(backend), ai, LocalStore(config.data_dir))


async def run_until(agent, condition, timeout=5):
    runner = asyncio.create_task(agent.run())
    try:
        async with asyncio.timeout(timeout):
            while not condition():
                await asyncio.sleep(0.01)
    finally:
        runner.cancel()


def test_task_runs_through_tools_approval_and_completion(tmp_path):
    backend = FakeBackend(tasks=[dict(TASK)])
    ai = ScriptedAI([
        ("write_file", {"path": "ads/copy.md", "content": "Ad copy"}),
        ("update_progress", {"progress": 45, "current_action": "Writing", "last_action": "Created ad copy",
                             "next_action": "Create creatives"}),
        ("write_file", {"path": "../escape.txt", "content": "x"}),
        ("run_command", {"command": "rm -rf /"}),
        ("request_approval", {"action": "Publish campaign", "detail": "Budget $100"}),
        ("complete_task", {"result": "Campaign drafted"}),
    ])
    agent = make_agent(tmp_path, backend, ai)
    asyncio.run(run_until(agent, lambda: {"status": "COMPLETED", "result": "Campaign drafted"} in backend.updates))

    assert (tmp_path / "data" / "missoes" / "task-142" / "ads" / "copy.md").read_text() == "Ad copy"
    assert not (tmp_path / "escape.txt").exists()
    assert [r.is_error for r in ai.results] == [False, False, True, True, False, False]
    assert "BLOCKED" in ai.results[2].text and "BLOCKED" in ai.results[3].text
    assert backend.approvals == ["Publish campaign"]
    statuses = [u["status"] for u in backend.updates if "status" in u]
    assert statuses == ["IN_PROGRESS", "WAITING_APPROVAL", "IN_PROGRESS", "COMPLETED"]
    assert {"session_id": "sess-1"} in backend.updates
    # The scripted AI only yields while waiting for approval, so that is the heartbeat we can observe.
    assert any(h["status"] == "WAITING" and h["task_id"] == 142 for h in backend.heartbeats)
    assert backend.usage == [{"task_id": 142, "cost_usd": 0.5, "input_tokens": 10, "output_tokens": 5}]
    assert agent.state.status == "IDLE" and agent.state.task_id is None


def test_sensitive_tool_call_is_not_run_when_owner_rejects(tmp_path):
    backend = FakeBackend(tasks=[dict(TASK)], decision="REJECTED")
    ai = ScriptedAI([("delete_file", {"path": "keep.txt"}), ("complete_task", {"result": "done"})])
    agent = make_agent(tmp_path, backend, ai)
    workspace = tmp_path / "data" / "missoes" / "task-142"
    workspace.mkdir(parents=True)
    (workspace / "keep.txt").write_text("important")
    asyncio.run(run_until(agent, lambda: ai.calls and agent.state.status == "IDLE"))

    assert (workspace / "keep.txt").exists()
    assert ai.results[0].is_error and "REJECTED" in ai.results[0].text


def test_recovery_restores_context_and_does_not_restart_in_ask_mode(tmp_path):
    saved = {"task": {**TASK, "status": "IN_PROGRESS", "progress": 45, "last_action": "Created ad copy",
                      "session_id": "sess-0"},
             "events": [{"kind": "action", "message": "Created ad copy"}], "pending_approvals": []}
    backend = FakeBackend(unfinished=saved)
    ai = ScriptedAI([("complete_task", {"result": "done"})])
    agent = make_agent(tmp_path, backend, ai, recovery_mode="ask")

    async def scenario():
        runner = asyncio.create_task(agent.run())
        await asyncio.sleep(0.2)
        paused = (agent.state.status, agent.state.progress, agent.state.last_action, ai.calls)
        await agent.handle_command({"action": "resume"})
        async with asyncio.timeout(5):
            while agent.state.status != "IDLE":
                await asyncio.sleep(0.01)
        runner.cancel()
        return paused

    assert asyncio.run(scenario()) == ("PAUSED", 45, "Created ad copy", 0)
    assert ai.resumed == "sess-0"
    assert "RESUMED" in ai.prompt and "Created ad copy" in ai.prompt
    assert backend.tasks == []  # never polled for new work while holding a task
