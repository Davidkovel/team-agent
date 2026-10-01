import asyncio
import os
import shlex
import shutil
from pathlib import Path

from .base import STR, Tool, ToolResult, schema

MAX_OUTPUT = 10_000
TIMEOUT = 300
# Credentials never reach processes started on behalf of the AI.
SECRET_ENV = ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "TEAM_AGENT_TOKEN")


async def run_process(argv: list[str], cwd: Path) -> ToolResult:
    """Runs one program without a shell, so no chaining or redirection is possible."""
    exe = shutil.which(argv[0])
    if not exe:
        return ToolResult(f"Program not found: {argv[0]}", True)
    env = {k: v for k, v in os.environ.items() if k not in SECRET_ENV}
    proc = await asyncio.create_subprocess_exec(
        exe, *argv[1:], cwd=cwd, env=env, stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
    try:
        output, _ = await asyncio.wait_for(proc.communicate(), TIMEOUT)
    except asyncio.TimeoutError:
        proc.kill()
        return ToolResult(f"Timed out after {TIMEOUT}s", True)
    text = output.decode("utf-8", errors="replace")[-MAX_OUTPUT:]
    return ToolResult(f"exit code {proc.returncode}\n{text}", proc.returncode != 0)


class RunCommand(Tool):
    name = "run_command"
    description = ("Run one program in the task workspace (no shell operators). Allowlisted test/lint commands "
                   "run immediately; anything else pauses for owner approval; destructive commands are blocked.")
    schema = schema(command=STR)

    def check(self, args, ctx):
        return ctx.policy.check_command(args["command"])

    def summary(self, args):
        return f"run `{args['command']}`"

    async def run(self, args, ctx):
        argv = shlex.split(args["command"], posix=os.name != "nt")
        if not argv:
            return ToolResult("Empty command", True)
        return await run_process(argv, ctx.workspace)
