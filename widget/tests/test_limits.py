"""The Claude plan limits the widget shows: only while they are recent enough to be true.

    cd widget && ../.venv/Scripts/python -m pytest tests -q
"""
import json
import time

from team_widget.limits import claude_plan_usage, rate_limits_from_account, save_rate_limits

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


def test_the_accounts_answer_becomes_the_same_limits(tmp_path):
    # the shape api.anthropic.com/api/oauth/usage answered on 5 Oct (other windows are null on a Pro plan)
    body = {"five_hour": {"utilization": 44.0, "resets_at": "2026-10-05T16:50:00.498424+00:00", "limit_dollars": None},
            "seven_day": {"utilization": 49.0, "resets_at": "2026-10-09T00:00:00.498441+00:00"}, "seven_day_opus": None}
    limits = rate_limits_from_account(body)
    assert limits == {"five_hour": {"used_percentage": 44.0, "resets_at": "2026-10-05T16:50:00.498424+00:00"},
                      "seven_day": {"used_percentage": 49.0, "resets_at": "2026-10-09T00:00:00.498441+00:00"}}
    path = tmp_path / "claude_usage.json"
    save_rate_limits(limits, path, NOW)
    plan = claude_plan_usage(path, NOW)
    assert (plan["five"], plan["week"]) == (44.0, 49.0) and plan["week_reset"] > NOW


def test_an_answer_without_figures_gives_nothing():
    assert rate_limits_from_account({"five_hour": None, "seven_day": {"utilization": None}}) == {}
    assert rate_limits_from_account("not a dict") == {}


def test_the_widget_restarts_only_when_a_new_commit_touched_it(monkeypatch):
    from team_widget import selfupdate
    touched = {"files": "widget/team_widget/ui/window.py"}
    monkeypatch.setattr(selfupdate, "git", lambda *args: touched["files"] if args[0] == "diff" else "")
    assert selfupdate.widget_changed("aaa", "bbb") is True
    assert selfupdate.widget_changed("aaa", "aaa") is False   # nothing was pulled
    assert selfupdate.widget_changed("", "bbb") is False      # git did not answer when the widget started
    touched["files"] = ""                                     # the pull only changed the Hub
    assert selfupdate.widget_changed("aaa", "bbb") is False


def test_the_hub_is_started_only_once_however_many_ask(monkeypatch, tmp_path):
    import threading
    from team_widget import hub
    started, up = [], {"is": False}
    monkeypatch.setattr(hub, "DATA_DIR", tmp_path)
    monkeypatch.setattr(hub, "REPO", tmp_path)
    (tmp_path / "backend" / "app").mkdir(parents=True)
    (tmp_path / "backend" / "app" / "main.py").write_text("")
    (tmp_path / ".venv" / "Scripts").mkdir(parents=True)
    (tmp_path / ".venv" / "Scripts" / "python.exe").write_text("")
    monkeypatch.setattr(hub, "is_up", lambda url: up["is"])
    monkeypatch.setattr(hub.time, "sleep", lambda s: None)

    def popen(*args, **kwargs):
        started.append(1)
        up["is"] = True   # the server answers from now on

    monkeypatch.setattr(hub.subprocess, "Popen", popen)
    asked = [threading.Thread(target=hub.start_local_server, args=("http://127.0.0.1:8000",)) for _ in range(5)]
    for a in asked:
        a.start()
    for a in asked:
        a.join()
    assert started == [1]

    up["is"] = False            # the Hub went down, and another widget process left its mark a moment ago
    started.clear()
    monkeypatch.setattr(hub, "STARTING_FOR", 1)
    assert hub.start_local_server("http://127.0.0.1:8000") is False and started == []   # it waits for that one, it does not start a second
