"""Entry point: python -m team_agent [--env path/to/.env]"""
import argparse
import asyncio
import sys
from pathlib import Path

from .core.agent import TeamAgent
from .core.config import Config, load_env_file
from .core.logs import setup_logging
from .providers.claude_sdk import ClaudeAgentProvider
from .storage import LocalStore
from .tasks import RemoteTaskProvider
from .transport.backend import BackendClient
from .transport.local_api import LocalAPI, local_token


async def main(cfg: Config):
    backend = BackendClient(cfg.server_url, cfg.agent_token)
    agent = TeamAgent(
        cfg, backend,
        tasks=RemoteTaskProvider(backend),
        ai=ClaudeAgentProvider(cfg.model, cfg.max_turns, cfg.max_budget_usd),
        store=LocalStore(cfg.data_dir),
    )
    local_api = LocalAPI(cfg.local_port, local_token(cfg.data_dir), agent.state.to_dict, agent.handle_command)
    agent.on_change = local_api.broadcast
    await asyncio.gather(agent.run(), local_api.serve(), backend.listen(agent.wake))


def cli():
    parser = argparse.ArgumentParser(prog="team_agent", description="Local Team Agent")
    parser.add_argument("--env", default=".env", help="path to the agent .env file")
    args = parser.parse_args()
    load_env_file(Path(args.env))
    cfg = Config.from_env()
    if not cfg.agent_token:
        sys.exit("TEAM_AGENT_TOKEN is not set. Issue one in the dashboard (Agent token) and put it in .env")
    logger = setup_logging(cfg.data_dir)
    if reason := ClaudeAgentProvider(cfg.model, cfg.max_turns, cfg.max_budget_usd).unavailable_reason():
        logger.info("Warning: %s - tasks will fail until this is fixed", reason)
    try:
        asyncio.run(main(cfg))
    except KeyboardInterrupt:
        logger.info("Agent stopped")


if __name__ == "__main__":
    cli()
