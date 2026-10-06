"""Saúde: how much the Agente AMG itself costs on this PC (docs/empresa-amg.md, regras de peso), written once a minute
into this person's row of `pc_health`, which sync carries to the other PCs, so everyone sees every PC.

Three parts are measured, with Windows' own calls (no extra package, next to no cost): this Hub, the widget that started
it (walking up the process tree: the widget starts the Hub) and the widget's big window (its QtWebEngineProcess
children). CPU is a share of the whole PC over the last minute; memory is what each part holds now. Not Windows, or a
Hub that was not started by a widget: only what can be measured is written, the rest stays empty, never zero.
"""
import asyncio
import ctypes
import logging
import os
import sys
import time
from ctypes import wintypes
from datetime import datetime, timezone

from sqlalchemy import select

from . import sync
from .db import SessionLocal
from .models import PcHealth, User

log = logging.getLogger("health")
EVERY = 60
LIMITS = {"widget": 1.0, "hub": 1.0, "web": 3.0}  # % of the PC, idle (the web window's limit is for the big window open)
_before: dict[int, tuple[float, float]] = {}  # pid -> (cpu seconds, wall clock) at the last look

if sys.platform == "win32":
    _k32 = ctypes.WinDLL("kernel32", use_last_error=True)

    class _Entry(ctypes.Structure):
        _fields_ = [("size", wintypes.DWORD), ("usage", wintypes.DWORD), ("pid", wintypes.DWORD), ("heap", ctypes.c_size_t),
                    ("module", wintypes.DWORD), ("threads", wintypes.DWORD), ("parent", wintypes.DWORD), ("priority", ctypes.c_long),
                    ("flags", wintypes.DWORD), ("exe", ctypes.c_wchar * 260)]

    class _Counters(ctypes.Structure):
        _fields_ = [("cb", wintypes.DWORD), ("faults", wintypes.DWORD), ("peak_ws", ctypes.c_size_t), ("ws", ctypes.c_size_t),
                    ("a", ctypes.c_size_t), ("b", ctypes.c_size_t), ("c", ctypes.c_size_t), ("d", ctypes.c_size_t),
                    ("pagefile", ctypes.c_size_t), ("peak_pagefile", ctypes.c_size_t)]

    _k32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    _k32.OpenProcess.restype = wintypes.HANDLE
    _psapi = ctypes.WinDLL("psapi", use_last_error=True)


def processes() -> dict[int, tuple[int, str]]:
    """pid -> (parent pid, exe name) of every process, from one Toolhelp snapshot."""
    if sys.platform != "win32":
        return {}
    snap = _k32.CreateToolhelp32Snapshot(0x2, 0)  # TH32CS_SNAPPROCESS
    if not snap or snap == wintypes.HANDLE(-1).value:
        return {}
    out, entry = {}, _Entry()
    entry.size = ctypes.sizeof(_Entry)
    try:
        ok = _k32.Process32FirstW(snap, ctypes.byref(entry))
        while ok:
            out[entry.pid] = (entry.parent, entry.exe.lower())
            ok = _k32.Process32NextW(snap, ctypes.byref(entry))
    finally:
        _k32.CloseHandle(snap)
    return out


def usage(pid: int) -> tuple[float, int] | None:
    """(CPU seconds used so far, memory in MB) of a process of this user."""
    if sys.platform != "win32":
        return None
    handle = _k32.OpenProcess(0x1000 | 0x0010, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ
    if not handle:
        return None
    try:
        created, exited, kernel, user = (wintypes.FILETIME() for _ in range(4))
        if not _k32.GetProcessTimes(handle, ctypes.byref(created), ctypes.byref(exited), ctypes.byref(kernel), ctypes.byref(user)):
            return None
        seconds = sum((t.dwHighDateTime << 32 | t.dwLowDateTime) for t in (kernel, user)) / 1e7
        counters = _Counters()
        counters.cb = ctypes.sizeof(_Counters)
        memory = counters.ws if _psapi.GetProcessMemoryInfo(handle, ctypes.byref(counters), counters.cb) else 0
        return seconds, round(memory / 2**20)
    finally:
        _k32.CloseHandle(handle)


def parts(table: dict[int, tuple[int, str]], me: int) -> dict[str, list[int]]:
    """Which processes are this Hub, the widget above it and the widget's web window (pids), from the process table."""
    hub, widget = [me], []
    pid, seen = table.get(me, (0, ""))[0], {me}
    while pid and pid not in seen and pid in table:  # up the tree: the venv's launcher, then the widget
        seen.add(pid)
        parent, exe = table[pid]
        if exe == "pythonw.exe":
            widget = [pid]
            break
        if exe == "python.exe":
            hub.append(pid)
        pid = parent
    web = []
    if widget:
        family = {widget[0]}
        for _ in range(4):  # the web engine runs a few levels down: its own helpers are children of its first process
            family |= {p for p, (parent, _) in table.items() if parent in family}
        web = [p for p in family if table[p][1] == "qtwebengineprocess.exe"]
    return {"hub": hub, "widget": widget, "web": web}


def measure() -> dict:
    """{hub_cpu, hub_ram, widget_cpu, ...}: CPU as % of the whole PC since the last look (None the first time), RAM in MB."""
    cores = os.cpu_count() or 1
    now = time.monotonic()
    out = {"cores": cores}
    for name, pids in parts(processes(), os.getpid()).items():
        found = [(pid, usage(pid)) for pid in pids]
        found = [(pid, u) for pid, u in found if u]
        if not found:
            out[f"{name}_cpu"] = out[f"{name}_ram"] = None
            continue
        share, known = 0.0, True
        for pid, (seconds, _) in found:
            then = _before.get(pid)
            _before[pid] = (seconds, now)
            if then is None or now <= then[1]:
                known = False
            else:
                share += (seconds - then[0]) / (now - then[1]) / cores * 100
        out[f"{name}_cpu"] = round(share, 2) if known else None
        out[f"{name}_ram"] = sum(memory for _, (_, memory) in found)
    return out


async def write_mine():
    me = sync.whoami()
    login = me[1] if me else None
    if not login:
        from .routers.auth import ip_map  # the PC's person when the VPN is down
        login = ip_map().get("127.0.0.1")
    if not login:
        return
    values = await asyncio.to_thread(measure)
    async with SessionLocal() as db:
        user = (await db.execute(select(User).where(User.username == login))).scalar_one_or_none()
        if not user:
            return
        row = await db.get(PcHealth, user.id) or PcHealth(user_id=user.id)
        for key, value in values.items():
            setattr(row, key, value)
        row.updated_at = datetime.now(timezone.utc)
        db.add(row)
        await db.commit()


async def loop():
    await asyncio.to_thread(measure)  # the first look only sets the starting point
    while True:
        await asyncio.sleep(EVERY)
        try:
            await write_mine()
        except Exception:
            log.exception("health")  # a missed minute is fine; the next one tries again
