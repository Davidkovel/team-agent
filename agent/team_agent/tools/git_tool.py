from .base import Tool, schema
from .terminal_tool import run_process


class Git(Tool):
    name = "git"
    description = ("Run git in the task workspace. Local read/commit operations are safe; push, merge, reset and "
                   "other shared-state operations pause for owner approval; forced operations are blocked.")
    schema = schema(args={"type": "array", "items": {"type": "string"},
                          "description": "git arguments, e.g. ['commit', '-m', 'message']"})

    def check(self, args, ctx):
        return ctx.policy.check_git(args["args"])

    def summary(self, args):
        return "git " + " ".join(args["args"])

    async def run(self, args, ctx):
        return await run_process(["git", *args["args"]], ctx.workspace)
