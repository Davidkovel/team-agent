from .base import STR, Tool, ToolResult, schema


class RequestApproval(Tool):
    name = "request_approval"
    description = ("Ask the owner to approve an action BEFORE doing it. Required for anything with outside effect: "
                   "production deploys, production database or configuration changes, publishing ads or content, "
                   "deleting important files, spending money. Blocks until the owner decides.")
    schema = schema(action=STR, detail=STR)

    def summary(self, args):
        return f"approval: {args['action']}"

    async def run(self, args, ctx):
        approved = await ctx.bridge.request_approval(args["action"], args["detail"])
        if approved:
            return ToolResult("APPROVED by the owner. You may proceed with exactly this action.")
        return ToolResult("REJECTED. Do not perform this action; finish what you can without it.", True)
