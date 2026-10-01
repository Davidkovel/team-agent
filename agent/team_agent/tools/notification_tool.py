from .base import STR, Tool, ToolResult, schema


class Notify(Tool):
    name = "notify"
    description = "Show a short notification to the user in their desktop widget."
    schema = schema(message=STR)

    async def run(self, args, ctx):
        await ctx.bridge.notify(args["message"])
        return ToolResult("User notified")
