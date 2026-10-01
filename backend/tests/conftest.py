import os

# The role tests exercise the strict (owner-gated) mode; team mode has its own test.
os.environ.setdefault("TEAM_MODE", "false")
