"""A task given to a member of the crew (the Hub's crew.py) runs as that character, in their own Claude conversation:
the next task of the same member resumes it, in their own folder, and every task starts with the Hub's briefing."""
import asyncio

from team_agent.providers import AIProvider, RunResult

from test_flow import TASK, FakeBackend, make_agent, run_until

BRIEF = {
    "crew": {"id": "batman", "name": "Batman", "role": "developer", "what": "Código", "persona": "You are Batman, the lead developer."},
    "team": [{"name": "Joker", "what": "Marketing"}, {"name": "Alfred", "what": "Revisão"}],
    "memory": [{"scope": "team", "category": "TAREFAS", "title": "Joker: anúncios", "content": "3 textos prontos"}],
    "companies": [{"id": "baredesk", "name": "BareDesk"}],
    "projects": [{"name": "Hub", "company": "", "status": "active", "description": "o Agente AMG"}],
    "open": [{"title": "Página da garagem", "status": "TODO", "for": "David", "crew": ""}],
    "finished": [{"title": "Anúncios", "by": "Joker", "result": "3 textos prontos"}],
    "mine": [{"title": "Corrigir o login", "result": "feito"}],
}


class CrewBackend(FakeBackend):
    async def task_briefing(self, task_id):
        return BRIEF


class RecordingAI(AIProvider):
    """Remembers how each run was started, and plays a session whose cost keeps growing, like a resumed one does."""

    def __init__(self):
        self.runs = []

    def unavailable_reason(self):
        return None

    async def run(self, prompt, system_prompt, registry, workspace, resume_session, on_session, home=None):
        self.runs.append({"prompt": prompt, "system": system_prompt, "resume": resume_session, "home": home, "workspace": workspace})
        await on_session("crew-sess")
        await registry.execute("complete_task", {"result": f"done {len(self.runs)}"})
        return RunResult(ok=True, session_id="crew-sess", usage={"input_tokens": 10, "output_tokens": 5},
                         session_cost_usd=0.4 * len(self.runs))

    async def interrupt(self):
        pass


def test_crew_member_keeps_one_conversation_across_tasks(tmp_path):
    first, second = dict(TASK, crew="batman"), dict(TASK, id=143, title="Second job", crew="batman")
    backend, ai = CrewBackend(tasks=[first]), RecordingAI()
    agent = make_agent(tmp_path, backend, ai)
    asyncio.run(run_until(agent, lambda: {"status": "COMPLETED", "result": "done 1"} in backend.updates))
    backend.tasks = [second]
    asyncio.run(run_until(agent, lambda: {"status": "COMPLETED", "result": "done 2"} in backend.updates))

    one, two = ai.runs
    # who they are, and what the Hub told them
    assert "You are Batman, the lead developer." in one["system"] and "Joker (Marketing)" in one["system"]
    for text in ("Joker: anúncios", "project Hub (active): o Agente AMG", "Página da garagem", "Anúncios (Joker)", "Corrigir o login"):
        assert text in one["prompt"]
    # the same conversation, kept in the member's own folder, while the tools work in each task's workspace
    assert one["resume"] is None and two["resume"] == "crew-sess"
    assert one["home"] == two["home"] == tmp_path / "data" / "crew" / "batman"
    assert one["workspace"] != two["workspace"]
    # each task pays only for what it added to the shared conversation
    assert [u["cost_usd"] for u in backend.usage] == [0.4, 0.4]
    assert agent.store.crew("batman")["tasks"] == 2


def test_task_without_crew_runs_as_before(tmp_path):
    backend, ai = FakeBackend(tasks=[dict(TASK)]), RecordingAI()
    agent = make_agent(tmp_path, backend, ai)
    asyncio.run(run_until(agent, lambda: {"status": "COMPLETED", "result": "done 1"} in backend.updates))
    assert ai.runs[0]["home"] is None and ai.runs[0]["resume"] is None
    assert "Who you are in this team" not in ai.runs[0]["system"]


def test_crew_conversation_starts_afresh_after_a_dozen_tasks(tmp_path):
    backend, ai = CrewBackend(tasks=[dict(TASK, crew="batman")]), RecordingAI()
    agent = make_agent(tmp_path, backend, ai)
    agent.store.save_crew("batman", "old-sess", 3.0, new_task=False)
    agent.store.data["crew"]["batman"]["tasks"] = agent.store.CREW_ROTATE
    asyncio.run(run_until(agent, lambda: {"status": "COMPLETED", "result": "done 1"} in backend.updates))
    assert ai.runs[0]["resume"] is None
