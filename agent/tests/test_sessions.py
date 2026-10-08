"""What the agent tells the Hub about a run (session, tokens, subagents), the Hub's memory in the prompt, the details of
an approval request, and questions asked in the Hub."""
import asyncio

from team_agent.providers import AIProvider, RunResult

from test_flow import TASK, FakeBackend, make_agent, run_until


class HubBackend(FakeBackend):
    """A Hub that keeps sessions, subagents, memory and questions."""
    approval_meta = True

    def __init__(self, *args, memory=(), question=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.memory, self.question = list(memory), question
        self.sessions, self.session_updates, self.subagents, self.answers, self.approval_details = [], [], [], [], []

    async def task_memory(self, task_id):
        return self.memory

    async def start_session(self, **fields):
        self.sessions.append(fields)
        return {"id": len(self.sessions)}

    async def update_session(self, session_id, **fields):
        self.session_updates.append((session_id, fields))

    async def report_subagent(self, session_id, **fields):
        self.subagents.append((session_id, fields))

    async def create_approval(self, task_id, action, detail, **meta):
        self.approval_details.append(meta)
        return await super().create_approval(task_id, action, detail)

    async def ai_take(self, request_id):
        return self.question

    async def ai_result(self, request_id, answer="", error=""):
        self.answers.append((request_id, answer, error))


class ReportingAI(AIProvider):
    """Stands in for Claude and reports what the real provider reports: model, tokens, tool calls, a subagent."""

    def __init__(self, script=()):
        self.script, self.asked = script, None

    def unavailable_reason(self):
        return None

    async def run(self, prompt, system_prompt, registry, workspace, resume_session, on_session):
        self.prompt = prompt
        await on_session("sess-9")
        await self.emit({"type": "model", "model": "claude-test-1"})
        await self.emit({"type": "usage", "input_tokens": 100, "output_tokens": 20, "cache_read_tokens": 0, "cache_creation_tokens": 0})
        await self.emit({"type": "subagent", "external_id": "toolu_1", "status": "RUNNING", "role": "research",
                         "task": "Find the checkout file", "parent_external_id": None})
        await self.emit({"type": "tool", "name": "read_file", "input": {"path": "a.txt"}, "subagent": "toolu_1"})
        await self.emit({"type": "subagent", "external_id": "toolu_1", "status": "DONE"})
        for name, args in self.script:
            await self.emit({"type": "tool", "name": name, "input": args, "subagent": None})
            await registry.execute(name, args)
        return RunResult(ok=True, session_id="sess-9", usage={"input_tokens": 150, "output_tokens": 40}, session_cost_usd=0.25)

    async def ask(self, prompt, system_prompt):
        self.asked = (prompt, system_prompt)
        await self.emit({"type": "model", "model": "claude-test-1"})
        return RunResult(ok=True, text="O Marco está a trabalhar no checkout.", session_id="sess-q",
                         usage={"input_tokens": 900, "output_tokens": 30}, session_cost_usd=0.02)

    async def interrupt(self):
        pass


def test_a_run_is_reported_as_a_session_with_its_subagents_and_real_totals(tmp_path):
    backend = HubBackend(tasks=[{**TASK, "agent_role": "testing"}],
                         memory=[{"scope": "team", "category": "DECISIONS", "title": "Pricing", "content": "x2.5 to x3"}])
    ai = ReportingAI([("write_file", {"path": "notes.md", "content": "hello"}), ("complete_task", {"result": "done"})])
    agent = make_agent(tmp_path, backend, ai)
    asyncio.run(run_until(agent, lambda: {"status": "COMPLETED", "result": "done"} in backend.updates))

    assert backend.sessions == [{"task_id": 142, "kind": "task", "model": "claude-opus-5-5"}]
    assert (1, {"claude_session_id": "sess-9"}) in backend.session_updates
    # the subagent is reported as its own thing, when it starts and when it ends
    assert [(s, f["external_id"], f["status"]) for s, f in backend.subagents] == [(1, "toolu_1", "RUNNING"), (1, "toolu_1", "DONE")]
    assert backend.subagents[0][1]["role"] == "research" and "parent_external_id" not in backend.subagents[0][1]
    # the last update closes the session with the run's own totals, the model the runtime named and the estimated cost
    session_id, last = backend.session_updates[-1]
    assert last["status"] == "DONE" and last["model"] == "claude-test-1" and last["cost_usd"] == 0.25
    assert (last["input_tokens"], last["output_tokens"], last["tool_uses"]) == (150, 40, 3)
    assert last["current_action"] == "complete_task"  # the main agent's own last action, not the subagent's
    assert backend.usage == [{"task_id": 142, "cost_usd": 0.25, "input_tokens": 150, "output_tokens": 40,
                              "session_id": 1, "model": "claude-test-1"}]
    # the prompt carries how to work (the kind of agent chosen in the Hub) and what the team already knows
    assert "as a tester" in ai.prompt and "[team/DECISIONS] Pricing: x2.5 to x3" in ai.prompt


def test_an_approval_request_says_how_risky_it_is_and_shows_the_change(tmp_path):
    backend = HubBackend(tasks=[dict(TASK)])
    ai = ReportingAI([("write_file", {"path": "config.production.json", "content": "{\n  \"debug\": false\n}"}),
                      ("write_file", {"path": ".env", "content": "TOKEN=supersecret"}),
                      ("complete_task", {"result": "done"})])
    agent = make_agent(tmp_path, backend, ai)
    workspace = tmp_path / "data" / "missoes" / "task-142"
    workspace.mkdir(parents=True)
    (workspace / "config.production.json").write_text("{\n  \"debug\": true\n}")
    asyncio.run(run_until(agent, lambda: {"status": "COMPLETED", "result": "done"} in backend.updates))

    config, secret = backend.approval_details
    assert (config["risk"], config["kind"], config["files"]) == ("high", "file", ["config.production.json"])
    assert '-  "debug": true' in config["diff"] and '+  "debug": false' in config["diff"]
    assert "diff" not in secret and "supersecret" not in str(secret)  # the content of a secrets file never leaves the computer


def test_a_question_from_the_hub_is_answered_from_the_hubs_own_data(tmp_path):
    question = {"id": 5, "kind": "chat", "question": "Quem está a trabalhar?",
                "context": {"team": [{"name": "Marco", "status": "WORKING", "task": "Checkout"}]}}
    backend = HubBackend(question=question)
    task_ai, ask_ai = ReportingAI(), ReportingAI()
    agent = make_agent(tmp_path, backend, task_ai)
    agent.ask_ai = lambda: ask_ai

    async def scenario():
        await agent.handle_command({"type": "ask", "request_id": 5})
        async with asyncio.timeout(5):
            while not backend.answers:
                await asyncio.sleep(0.01)

    asyncio.run(scenario())
    assert backend.answers == [(5, "O Marco está a trabalhar no checkout.", "")]
    prompt, system = ask_ai.asked
    assert "Quem está a trabalhar?" in prompt and '"name": "Marco"' in prompt and "Never guess" in system
    assert backend.sessions == [{"task_id": None, "kind": "chat", "model": "claude-opus-5-5"}]
    assert backend.session_updates[-1][1]["status"] == "DONE"
    assert backend.usage == [{"task_id": None, "cost_usd": 0.02, "input_tokens": 900, "output_tokens": 30,
                              "session_id": 1, "model": "claude-test-1"}]
    assert task_ai.asked is None  # the task's own provider was left alone


def test_a_provider_that_cannot_answer_says_so_instead_of_making_something_up(tmp_path):
    from test_flow import ScriptedAI

    backend = HubBackend(question={"id": 6, "kind": "chat", "question": "?", "context": {}})
    agent = make_agent(tmp_path, backend, ScriptedAI([]))

    async def scenario():
        await agent.handle_command({"type": "ask", "request_id": 6})
        async with asyncio.timeout(5):
            while not backend.answers:
                await asyncio.sleep(0.01)

    asyncio.run(scenario())
    assert backend.answers == [(6, "", "this AI provider cannot answer questions")]
