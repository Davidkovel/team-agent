from .base import STR, Tool, ToolResult, schema


class UpdateProgress(Tool):
    name = "update_progress"
    description = ("Report task progress to the team. Call it after every meaningful step: progress 0-100, what you "
                   "are doing now, what you just finished, and what comes next.")
    schema = schema(progress={"type": "integer", "minimum": 0, "maximum": 100},
                    current_action=STR, last_action=STR, next_action=STR)

    async def run(self, args, ctx):
        await ctx.bridge.report_progress(args["progress"], args["current_action"], args["last_action"], args["next_action"])
        return ToolResult("Progress recorded")


class RecordDecision(Tool):
    name = "record_decision"
    description = "Save an important decision and its reason to the task context, so it survives restarts."
    schema = schema(decision=STR)

    async def run(self, args, ctx):
        await ctx.bridge.record("decision", args["decision"])
        return ToolResult("Decision recorded")


class CompleteTask(Tool):
    name = "complete_task"
    description = ("Mark the task as completed. Call exactly once, only when every requirement is met, with a "
                   "summary of the result and where the deliverables are.")
    schema = schema(result=STR)

    async def run(self, args, ctx):
        await ctx.bridge.complete(args["result"])
        return ToolResult("Task marked as completed. Stop working now.")


class RequestHelp(Tool):
    name = "request_help"
    description = "Ask a human for help when you are blocked or the task is ambiguous. Then stop and wait."
    schema = schema(message=STR)

    async def run(self, args, ctx):
        await ctx.bridge.ask_help(args["message"])
        return ToolResult("Help requested. Stop working until a human responds.")


TASK_TOOLS = [UpdateProgress, RecordDecision, CompleteTask, RequestHelp]
