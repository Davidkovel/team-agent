"""Market hours without tzdata (this PC's Python has no time zone database): summer time worked out by hand for
London and New York, the four sessions and the ICT killzones in New York time."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

UTC = timezone.utc


def _nth_sunday(year: int, month: int, n: int) -> datetime:
    d = datetime(year, month, 1, tzinfo=UTC)
    d += timedelta(days=(6 - d.weekday()) % 7)
    return d + timedelta(weeks=n - 1)


def _last_sunday(year: int, month: int) -> datetime:
    d = datetime(year + (month == 12), month % 12 + 1, 1, tzinfo=UTC) - timedelta(days=1)
    return d - timedelta(days=(d.weekday() + 1) % 7)


def london_offset(t: datetime) -> int:
    """Hours London is ahead of UTC: 1 from the last Sunday of March to the last Sunday of October (01:00 UTC)."""
    a = _last_sunday(t.year, 3).replace(hour=1)
    b = _last_sunday(t.year, 10).replace(hour=1)
    return 1 if a <= t < b else 0


def ny_offset(t: datetime) -> int:
    """Hours New York is behind UTC: 4 from the second Sunday of March to the first Sunday of November, else 5."""
    a = _nth_sunday(t.year, 3, 2).replace(hour=7)
    b = _nth_sunday(t.year, 11, 1).replace(hour=6)
    return 4 if a <= t < b else 5


def ny(t: datetime) -> datetime:
    return (t - timedelta(hours=ny_offset(t))).replace(tzinfo=None)


def london(t: datetime) -> datetime:
    return (t + timedelta(hours=london_offset(t))).replace(tzinfo=None)


# the ICT killzones, in New York hours (start, end)
KILLZONES = [("asia", "Ásia", 20, 24), ("london", "Londres", 2, 5), ("ny", "Nova Iorque AM", 7, 10),
             ("lclose", "Fecho de Londres", 10, 12), ("pm", "Nova Iorque PM", 13.5, 16)]
SILVER = [(3, 4), (10, 11), (14, 15)]   # the silver bullet hours, New York time


def _h(t: datetime) -> float:
    return t.hour + t.minute / 60


def killzone(t: datetime) -> dict | None:
    h = _h(ny(t))
    for key, name, a, b in KILLZONES:
        if a <= h < b:
            return {"key": key, "name": name, "silver": any(x <= h < y for x, y in SILVER)}
    return None


def killzones_local(t: datetime, tolocal) -> list[dict]:
    """Today's killzones (New York's day) as local hours: tolocal turns a UTC datetime into a naive local one."""
    day = ny(t).replace(hour=0, minute=0, second=0, microsecond=0)
    off = timedelta(hours=ny_offset(t))
    out = []
    for key, name, a, b in KILLZONES:
        start = (day + timedelta(hours=a) + off).replace(tzinfo=UTC)
        end = (day + timedelta(hours=b) + off).replace(tzinfo=UTC)
        out.append({"key": key, "name": name, "from": tolocal(start).strftime("%H:%M"), "to": tolocal(end).strftime("%H:%M"),
                    "start": start.isoformat(), "end": end.isoformat()})
    return out


def sessions(t: datetime) -> list[dict]:
    """The four sessions now: open or not, and the minutes to their next open or close."""
    out = []
    for key, name, start_utc, hours in _today_sessions(t):
        opens = start_utc
        while opens + timedelta(hours=hours) <= t:
            opens += timedelta(days=1)
        while opens - timedelta(days=1) + timedelta(hours=hours) > t:
            opens -= timedelta(days=1)
        closes = opens + timedelta(hours=hours)
        live = opens <= t < closes and market_open(t)
        out.append({"key": key, "name": name, "open": bool(live), "opens": opens.isoformat(), "closes": closes.isoformat(),
                    "mins": int(((closes if live else opens) - t).total_seconds() // 60)})
    return out


def _today_sessions(t: datetime):
    day = t.replace(hour=0, minute=0, second=0, microsecond=0)
    lo, no = london_offset(t), ny_offset(t)
    return [("sydney", "Sydney", day + timedelta(hours=21) - timedelta(days=1), 9),
            ("tokyo", "Tóquio", day, 9),
            ("london", "Londres", day + timedelta(hours=8 - lo), 8.5),
            ("newyork", "Nova Iorque", day + timedelta(hours=8 + no), 9)]


def market_open(t: datetime, crypto: bool = False) -> bool:
    """Forex and CFDs: from Sunday 17:00 to Friday 17:00 in New York. Crypto never closes."""
    if crypto:
        return True
    n = ny(t)
    if n.weekday() == 5:
        return False
    if n.weekday() == 4 and n.hour >= 17:
        return False
    if n.weekday() == 6 and n.hour < 17:
        return False
    return True


def asia_window(t: datetime) -> tuple[datetime, datetime]:
    """Today's Asian range: 20:00 to 00:00 in New York (the ICT Asian range), as UTC."""
    n = ny(t)
    end_ny = n.replace(hour=0, minute=0, second=0, microsecond=0)
    if n.hour >= 20:
        end_ny += timedelta(days=1)
    off = timedelta(hours=ny_offset(t))
    end = (end_ny + off).replace(tzinfo=UTC)
    return end - timedelta(hours=4), end


def london_window(t: datetime) -> tuple[datetime, datetime]:
    """Today's London session, 02:00 to 05:00 in New York (the killzone), as UTC."""
    n = ny(t)
    start_ny = n.replace(hour=2, minute=0, second=0, microsecond=0)
    off = timedelta(hours=ny_offset(t))
    start = (start_ny + off).replace(tzinfo=UTC)
    return start, start + timedelta(hours=3)
