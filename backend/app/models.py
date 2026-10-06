from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def now() -> datetime:
    return datetime.now(timezone.utc)


TASK_STATUSES = {
    "ASSIGNED", "IN_PROGRESS", "WAITING_APPROVAL", "PAUSED",
    "NEEDS_HELP", "COMPLETED", "FAILED", "STOPPED",
    "TODO", "BLOCKED", "REVIEW",  # set by people in the Hub; an agent only takes ASSIGNED tasks
}
# The board column of each status: what people see, whatever the agent protocol calls it.
TASK_STAGE = {"TODO": "todo", "ASSIGNED": "todo", "IN_PROGRESS": "in_progress", "PAUSED": "in_progress",
              "NEEDS_HELP": "blocked", "FAILED": "blocked", "BLOCKED": "blocked", "REVIEW": "review",
              "WAITING_APPROVAL": "approval", "COMPLETED": "done", "STOPPED": "done"}
PRIORITIES = ("low", "normal", "high", "urgent")
AGENT_ROLES = ("developer", "research", "marketing", "testing", "custom")
# Tasks an agent may still be holding after a restart.
UNFINISHED = ("IN_PROGRESS", "WAITING_APPROVAL", "PAUSED", "NEEDS_HELP")
AGENT_STATUSES = {"ONLINE", "WORKING", "IDLE", "WAITING", "PAUSED", "ERROR", "OFFLINE"}


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True)
    display_name: Mapped[str] = mapped_column(String(100))
    role: Mapped[str] = mapped_column(String(20))  # owner | member
    password_hash: Mapped[str] = mapped_column(String(200))
    agent_token_hash: Mapped[str | None] = mapped_column(String(64), index=True)
    # the ntfy topic this person's phone follows (push.py); None = no phone
    phone_topic: Mapped[str | None] = mapped_column(String(80))


class Task(Base):
    __tablename__ = "tasks"
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    goal: Mapped[str] = mapped_column(Text, default="")
    requirements: Mapped[list] = mapped_column(JSON, default=list)
    project: Mapped[str] = mapped_column(String(100), default="")
    assignee_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(String(30), default="ASSIGNED")
    progress: Mapped[int] = mapped_column(Integer, default=0)
    current_action: Mapped[str] = mapped_column(Text, default="")
    last_action: Mapped[str] = mapped_column(Text, default="")
    next_action: Mapped[str] = mapped_column(Text, default="")
    result: Mapped[str] = mapped_column(Text, default="")
    session_id: Mapped[str | None] = mapped_column(String(100))
    priority: Mapped[str] = mapped_column(String(10), default="normal")
    deadline: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    company: Mapped[str | None] = mapped_column(String(50))  # library company id
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id"))
    agent_role: Mapped[str] = mapped_column(String(30), default="")  # which kind of agent it was given to (AGENT_ROLES)
    agent_instructions: Mapped[str] = mapped_column(Text, default="")
    git_branch: Mapped[str] = mapped_column(String(120), default="")
    blocked_reason: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # The bin: trashed_at is None for a task on the board. "done" keeps it COMPLETED, "mistake" hides it everywhere.
    # What it was before is kept so that restoring puts it back where it was.
    trashed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    trash_reason: Mapped[str | None] = mapped_column(String(10))  # done | mistake
    trash_prev_status: Mapped[str | None] = mapped_column(String(30))
    trash_prev_progress: Mapped[int | None] = mapped_column(Integer)

    assignee: Mapped[User] = relationship(foreign_keys=[assignee_id], lazy="joined")
    creator: Mapped[User] = relationship(foreign_keys=[created_by], lazy="joined")
    project_ref: Mapped["Project | None"] = relationship(lazy="joined")


class TaskEvent(Base):
    """Task context / agent memory: actions, decisions, errors, results."""
    __tablename__ = "task_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id"), index=True)
    kind: Mapped[str] = mapped_column(String(20))  # action | decision | error | result | note
    message: Mapped[str] = mapped_column(Text)
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Approval(Base):
    __tablename__ = "approvals"
    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int | None] = mapped_column(ForeignKey("tasks.id"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String(200))
    detail: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="PENDING")  # PENDING | APPROVED | REJECTED
    risk: Mapped[str] = mapped_column(String(10), default="")  # low | medium | high; empty = the agent did not say
    kind: Mapped[str] = mapped_column(String(30), default="")  # file | command | git | external
    files: Mapped[list | None] = mapped_column(JSON)
    diff: Mapped[str] = mapped_column(Text, default="")
    decided_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    user: Mapped[User] = relationship(foreign_keys=[user_id], lazy="joined")


class Activity(Base):
    __tablename__ = "activity"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    task_id: Mapped[int | None] = mapped_column(ForeignKey("tasks.id"))
    kind: Mapped[str] = mapped_column(String(30))
    message: Mapped[str] = mapped_column(Text)
    company: Mapped[str | None] = mapped_column(String(50), index=True)  # library company id the work was for
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

    user: Mapped[User] = relationship(foreign_keys=[user_id], lazy="joined")


class UsageRecord(Base):
    __tablename__ = "usage"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    task_id: Mapped[int | None] = mapped_column(ForeignKey("tasks.id"))
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cache_read_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cache_creation_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0)  # SDK estimate, not billing
    session_id: Mapped[int | None] = mapped_column(ForeignKey("agent_sessions.id"))
    model: Mapped[str] = mapped_column(String(60), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Meter(Base):
    """Usage % of a service that has no API we can read (e.g. Higgsfield credits); set by hand."""
    __tablename__ = "meters"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    service: Mapped[str] = mapped_column(String(30), primary_key=True)
    pct: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class AgentState(Base):
    """Last known agent snapshot; live presence lives in Redis with a TTL."""
    __tablename__ = "agent_state"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    status: Mapped[str] = mapped_column(String(20), default="OFFLINE")
    last_seen: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Ponto(Base):
    """The daily clock-in ("bater o ponto"): one per person per day, by the server's local date."""
    __tablename__ = "ponto"
    __table_args__ = (UniqueConstraint("user_id", "day"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    day: Mapped[str] = mapped_column(String(10), index=True)  # YYYY-MM-DD
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    # The clock can be stopped and started again: what was worked before the last stop, whether it counts now, and since when.
    worked_s: Mapped[int | None] = mapped_column(Integer, default=0)
    running: Mapped[bool | None] = mapped_column(Boolean, default=True)
    since: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)  # None on a running row from before: it runs since `at`


class Project(Base):
    """A piece of work with its own tasks, apart from the company it belongs to (if any)."""
    __tablename__ = "projects"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    company: Mapped[str | None] = mapped_column(String(50))  # library company id
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | maintenance | paused | done
    description: Mapped[str] = mapped_column(Text, default="")
    repo: Mapped[str] = mapped_column(String(100), default="")  # a name from library/repos.json
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class AgentSession(Base):
    """One run of the AI by a person's Local Team Agent: a task, a question from the Hub, or a weekly report."""
    __tablename__ = "agent_sessions"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    task_id: Mapped[int | None] = mapped_column(ForeignKey("tasks.id"), index=True)
    kind: Mapped[str] = mapped_column(String(20), default="task")  # task | chat | weekly_report
    claude_session_id: Mapped[str | None] = mapped_column(String(100))
    model: Mapped[str] = mapped_column(String(60), default="")
    status: Mapped[str] = mapped_column(String(20), default="RUNNING")  # RUNNING | DONE | ERROR | INTERRUPTED
    current_action: Mapped[str] = mapped_column(Text, default="")
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cache_read_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cache_creation_tokens: Mapped[int] = mapped_column(Integer, default=0)
    tool_uses: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[float | None] = mapped_column(Float)  # SDK estimate; None until the run reports it
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    user: Mapped[User] = relationship(foreign_keys=[user_id], lazy="joined")


class Subagent(Base):
    """An agent the main session spawned (research, coding, testing, review). Not a person, not a session of its own."""
    __tablename__ = "subagents"
    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("agent_sessions.id"), index=True)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("subagents.id"))
    external_id: Mapped[str] = mapped_column(String(100), index=True)  # the id the AI runtime gave it
    name: Mapped[str] = mapped_column(String(100))
    role: Mapped[str] = mapped_column(String(60), default="")
    status: Mapped[str] = mapped_column(String(20), default="RUNNING")  # RUNNING | DONE | ERROR | STOPPED
    task: Mapped[str] = mapped_column(Text, default="")
    model: Mapped[str] = mapped_column(String(60), default="")
    tools: Mapped[list | None] = mapped_column(JSON)
    total_tokens: Mapped[int | None] = mapped_column(Integer)  # None: the runtime did not report it
    tool_uses: Mapped[int | None] = mapped_column(Integer)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Notification(Base):
    """Something one person should know about. Only events that matter are written here, never routine activity."""
    __tablename__ = "notifications"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    kind: Mapped[str] = mapped_column(String(30))  # task_new | approval_required | approval_decided | task | agent_failed | agent_waiting
    severity: Mapped[str] = mapped_column(String(10), default="low")  # high | medium | low
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text, default="")
    href: Mapped[str] = mapped_column(String(200), default="")
    # task_new only: True for the person the task was sent to (the widget rings for them), False for the others (it only shows)
    directed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Memory(Base):
    """What the AI should know before it starts: facts and decisions, kept per scope."""
    __tablename__ = "memory"
    id: Mapped[int] = mapped_column(primary_key=True)
    scope: Mapped[str] = mapped_column(String(20), index=True)  # global | team | company | project | agent | task
    scope_id: Mapped[str] = mapped_column(String(100), default="")  # company id, project id, username or task id
    category: Mapped[str] = mapped_column(String(40), default="")
    title: Mapped[str] = mapped_column(String(200))
    content: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class Expense(Base):
    """Money spent, written down by a person. AI cost is not stored here: it comes from the usage records."""
    __tablename__ = "expenses"
    id: Mapped[int] = mapped_column(primary_key=True)
    category: Mapped[str] = mapped_column(String(20))  # ai | software | ads | infrastructure | other
    title: Mapped[str] = mapped_column(String(200))
    amount: Mapped[float] = mapped_column(Float)
    currency: Mapped[str] = mapped_column(String(3), default="EUR")
    company: Mapped[str | None] = mapped_column(String(50))
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id"))
    spent_on: Mapped[str] = mapped_column(String(10))  # YYYY-MM-DD
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class AIRequest(Base):
    """A question asked in the Hub (or a weekly report). The asker's own Local Team Agent answers it with Claude."""
    __tablename__ = "ai_requests"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    kind: Mapped[str] = mapped_column(String(20), default="chat")  # chat | weekly_report
    question: Mapped[str] = mapped_column(Text)
    context: Mapped[dict | None] = mapped_column(JSON)  # the Hub data the answer must be based on
    status: Mapped[str] = mapped_column(String(20), default="PENDING")  # PENDING | RUNNING | DONE | ERROR
    answer: Mapped[str] = mapped_column(Text, default="")
    error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
