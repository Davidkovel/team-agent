from ..permissions import Decision
from .base import STR, Tool, ToolContext, ToolResult, schema

MAX_READ = 100_000


class ReadFile(Tool):
    name = "read_file"
    description = "Read a text file from the task workspace. Path is relative to the workspace root."
    schema = schema(path=STR)

    def check(self, args, ctx: ToolContext) -> Decision:
        return ctx.policy.check_path(args["path"], "read")

    def summary(self, args):
        return f"read {args['path']}"

    async def run(self, args, ctx):
        path = ctx.policy.resolve(args["path"])
        if not path.is_file():
            return ToolResult(f"File not found: {args['path']}", True)
        text = path.read_text(encoding="utf-8", errors="replace")
        return ToolResult(text[:MAX_READ] + ("\n...[truncated]" if len(text) > MAX_READ else ""))


class WriteFile(Tool):
    name = "write_file"
    description = "Create or overwrite a text file in the task workspace. Parent folders are created."
    schema = schema(path=STR, content=STR)

    def check(self, args, ctx):
        return ctx.policy.check_path(args["path"], "write")

    def summary(self, args):
        return f"write {args['path']}"

    async def run(self, args, ctx):
        path = ctx.policy.resolve(args["path"])
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(args["content"], encoding="utf-8")
        return ToolResult(f"Wrote {len(args['content'])} chars to {args['path']}")


class ListFiles(Tool):
    name = "list_files"
    description = "List files and folders in a workspace directory ('.' for the root)."
    schema = schema(path=STR)

    def check(self, args, ctx):
        return ctx.policy.check_path(args["path"], "read")

    def summary(self, args):
        return f"list {args['path']}"

    async def run(self, args, ctx):
        path = ctx.policy.resolve(args["path"])
        if not path.is_dir():
            return ToolResult(f"Not a directory: {args['path']}", True)
        entries = sorted(p.name + ("/" if p.is_dir() else "") for p in path.iterdir() if p.name != ".git")
        return ToolResult("\n".join(entries) or "(empty)")


class DeleteFile(Tool):
    name = "delete_file"
    description = "Delete a file from the task workspace. Always requires owner approval."
    schema = schema(path=STR)

    def check(self, args, ctx):
        return ctx.policy.check_path(args["path"], "delete")

    def summary(self, args):
        return f"delete {args['path']}"

    async def run(self, args, ctx):
        path = ctx.policy.resolve(args["path"])
        if not path.is_file():
            return ToolResult(f"File not found: {args['path']}", True)
        path.unlink()
        return ToolResult(f"Deleted {args['path']}")


FILE_TOOLS = [ReadFile, WriteFile, ListFiles, DeleteFile]
