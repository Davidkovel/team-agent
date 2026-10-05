"""The Claude plan limits the widget shows: only while they are recent enough to be true.

    cd widget && ../.venv/Scripts/python -m pytest tests -q
"""
import json
import time

from team_widget.limits import claude_plan_usage

NOW = 1_791_200_000.0
HOUR = 3600


def saved(tmp_path, age_hours, five=None, week=None):
    limits = {}
    if five is not None:
        limits["five_hour"] = five
    if week is not None:
        limits["seven_day"] = week
    path = tmp_path / "claude_usage.json"
    path.write_text(json.dumps({"saved_at": NOW - age_hours * HOUR, "rate_limits": limits}), encoding="utf-8")
    return path


def test_nothing_saved_is_nothing_to_show(tmp_path):
    assert claude_plan_usage(tmp_path / "missing.json", NOW) is None


def test_fresh_limits_are_shown_with_their_reset(tmp_path):
    path = saved(tmp_path, 0.1, five={"used_percentage": 26, "resets_at": NOW + 2 * HOUR},
                 week={"used_percentage": 11, "resets_at": NOW + 3 * 24 * HOUR})
    plan = claude_plan_usage(path, NOW)
    assert (plan["five"], plan["week"]) == (26, 11)
    assert (plan["five_reset"], plan["week_reset"]) == (NOW + 2 * HOUR, NOW + 3 * 24 * HOUR)


def test_days_old_numbers_are_not_shown_as_today(tmp_path):
    # what the widget showed on 5 Oct: 26 % and 11 % saved on 2 Oct, as if they were current
    path = saved(tmp_path, 65, five={"used_percentage": 26}, week={"used_percentage": 11})
    assert claude_plan_usage(path, NOW) is None


def test_the_session_expires_before_the_week(tmp_path):
    path = saved(tmp_path, 8, five={"used_percentage": 40}, week={"used_percentage": 30})
    plan = claude_plan_usage(path, NOW)
    assert plan["week"] == 30 and plan["five"] is None   # a 5-hour window read 8 hours ago says nothing about now


def test_a_window_past_its_reset_is_dropped(tmp_path):
    path = saved(tmp_path, 1, five={"used_percentage": 90, "resets_at": NOW - 60},
                 week={"used_percentage": 50, "resets_at": NOW + HOUR})
    plan = claude_plan_usage(path, NOW)
    assert plan["five"] is None and plan["week"] == 50
    path = saved(tmp_path, 1, week={"used_percentage": 50, "resets_at": NOW - 60})
    assert claude_plan_usage(path, NOW) is None          # the week started again: its old figure is gone


def test_reset_given_as_text(tmp_path):
    iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(NOW + HOUR))
    path = saved(tmp_path, 0.5, week={"used_percentage": 12, "resets_at": iso})
    assert claude_plan_usage(path, NOW)["week_reset"] == NOW + HOUR


def test_a_broken_file_is_nothing_to_show(tmp_path):
    path = tmp_path / "claude_usage.json"
    path.write_text("{not json", encoding="utf-8")
    assert claude_plan_usage(path, NOW) is None
