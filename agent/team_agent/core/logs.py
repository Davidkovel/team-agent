import logging
import re
from pathlib import Path

# Anything that looks like a credential is masked before it reaches agent.log.
_SECRETS = [
    re.compile(r"sk-ant-[A-Za-z0-9_\-]+"),
    re.compile(r"agt_[A-Za-z0-9_\-]+"),
    re.compile(r"(?i)(bearer\s+)[A-Za-z0-9_\-\.=]+"),
    re.compile(r"(?i)((?:api[_-]?key|token|secret|password)\s*[=:]\s*)\S+"),
]


def redact(text: str) -> str:
    for pattern in _SECRETS:
        text = pattern.sub(lambda m: (m.group(1) if m.groups() else "") + "***", text)
    return text


class RedactFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.msg, record.args = redact(record.getMessage()), ()
        return True


def setup_logging(data_dir: Path) -> logging.Logger:
    data_dir.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("team_agent")
    logger.setLevel(logging.INFO)
    formatter = logging.Formatter("%(asctime)s %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
    for handler in (logging.FileHandler(data_dir / "agent.log", encoding="utf-8"), logging.StreamHandler()):
        handler.setFormatter(formatter)
        handler.addFilter(RedactFilter())
        logger.addHandler(handler)
    return logger


log = logging.getLogger("team_agent")
