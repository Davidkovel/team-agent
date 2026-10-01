import ctypes
import getpass
import json
import os
import threading
import time
import tkinter as tk
import urllib.error
import urllib.request
import webbrowser
from datetime import datetime
from pathlib import Path
from tkinter import messagebox

from PIL import Image, ImageTk

from .. import hub
from ..api.agent_client import AgentClient
from ..state.store import StateStore

BG, CARD, CARD2, TEXT, MUTED = "#000000", "#070707", "#161616", "#e6e6e6", "#8a8a8a"
ACCENT, ACCENT2 = "#e6e6e6", "#ffffff"
COLORS = {"WORKING": "#4ade80", "ONLINE": "#4ade80", "IDLE": "#c8ccce", "WAITING": "#fbbf24",
          "PAUSED": "#fbbf24", "ERROR": "#ff9f1c", "OFFLINE": "#6b6880"}
LABELS = {"WORKING": "A trabalhar", "ONLINE": "Online", "IDLE": "Livre", "WAITING": "À espera",
          "PAUSED": "Em pausa", "ERROR": "Erro", "OFFLINE": "Agente desligado"}
WIDTH = 372
ASSETS = Path(__file__).resolve().parents[1] / "assets"
LOGO, CAR = ASSETS / "logo.png", ASSETS / "car.png"
FONT = "Segoe UI"
MONO = "Consolas"
FAINT = "#4a4a4a"


def elapsed(started_at) -> str:
    if not started_at:
        return ""
    seconds = int(time.time() - started_at)
    return f"{seconds // 3600}h {seconds % 3600 // 60:02d}m" if seconds >= 3600 else f"{seconds // 60}m {seconds % 60:02d}s"


class Bar(tk.Canvas):
    """Flat progress bar (no rounding, no animation)."""

    def __init__(self, parent, bg=CARD, height=6):
        super().__init__(parent, height=height, bg=bg, highlightthickness=0, bd=0)
        self._pct, self._color = 0, ACCENT
        self.bind("<Configure>", lambda e: self._draw())

    def set(self, pct, color=ACCENT):
        self._pct, self._color = max(0, min(100, pct or 0)), color
        self._draw()

    def _draw(self):
        self.delete("all")
        w, h = self.winfo_width(), int(self["height"])
        self.create_rectangle(0, 0, w, h, fill=CARD2, width=0)
        if self._pct > 0:
            self.create_rectangle(0, 0, w * self._pct / 100, h, fill=self._color, width=0)


def meter_color(pct):
    return "#ff9f1c" if pct >= 85 else "#fbbf24" if pct >= 60 else ACCENT


def clip(text: str, n: int) -> str:
    return text if len(text) <= n else text[: n - 1] + "…"


class WidgetWindow:
    def __init__(self, store: StateStore, client: AgentClient):
        self.store, self.client = store, client
        self.on_status = lambda status: None  # tray hook
        self._version = -1
        self._opening_hub = False
        self._hub_result = None
        self._week, self._week_seen = None, None  # what is being touched / just happened, from the Hub on this computer
        self._team, self._team_seen = [], False   # who is online, from the Hub on this computer (None = Hub not answering)

        root = self.root = tk.Tk()
        root.title("Agente AMG")
        root.configure(bg=BG, padx=14, pady=12)
        # Normal window with the usual minimize / maximize buttons. Maximizing it opens the Hub (see _on_configure).
        root.minsize(WIDTH, 120)
        root.bind("<Configure>", self._on_configure)
        root.protocol("WM_DELETE_WINDOW", self.hide)  # closing hides to tray; the agent keeps running
        root.iconphoto(True, ImageTk.PhotoImage(Image.open(LOGO).resize((64, 64), Image.LANCZOS)))
        self._dark_titlebar()

        # header: who is online (one icon per person), then this agent's status
        self.people = tk.Frame(root, bg=BG)
        self.people.pack(fill="x")
        head = tk.Frame(root, bg=BG)
        head.pack(fill="x", pady=(8, 0))
        self.user_label = tk.Label(head, text="CENTRAL DE COMANDO", bg=BG, fg=MUTED, font=(MONO, 8))
        self.user_label.pack(side="left")
        self.chip = tk.Label(head, text="", bg=CARD, fg=MUTED, font=(MONO, 8, "bold"), padx=8, pady=3)
        self.chip.pack(side="right")

        self._car = ImageTk.PhotoImage(Image.open(CAR))
        self.car_label = tk.Label(root, image=self._car, bg=BG, bd=0)
        self.car_label.pack(pady=(2, 0))
        self.alert = tk.Label(root, text="", bg=BG, fg=COLORS["WAITING"], font=(FONT, 9), anchor="w", justify="left", wraplength=WIDTH - 28)

        # what people are touching right now and what just happened (the weekly table and calendar live in the Hub)
        self.ledger = self._card(pady=(6, 0))
        tk.Label(self.ledger, text="A MEXER AGORA · SEM COMMIT", bg=CARD, fg="#ff9f1c", font=(MONO, 8, "bold"), anchor="w").pack(fill="x")
        self.pending = tk.Frame(self.ledger, bg=CARD)
        self.pending.pack(fill="x", pady=(3, 8))
        tk.Label(self.ledger, text="ÚLTIMOS MOVIMENTOS", bg=CARD, fg=MUTED, font=(MONO, 8, "bold"), anchor="w").pack(fill="x")
        self.feed = tk.Frame(self.ledger, bg=CARD)
        self.feed.pack(fill="x", pady=(3, 0))

        # the agent's current task, only while there is one
        self.task_card = self._card(pack=False)
        row = tk.Frame(self.task_card, bg=CARD)
        row.pack(fill="x")
        tk.Label(row, text="TAREFA", bg=CARD, fg=MUTED, font=(MONO, 8, "bold")).pack(side="left")
        self.progress_text = tk.Label(row, text="", bg=CARD, fg=TEXT, font=(MONO, 9, "bold"))
        self.progress_text.pack(side="right")
        self.task = tk.Label(self.task_card, text="", bg=CARD, fg=TEXT, font=(FONT, 10, "bold"), anchor="w", justify="left", wraplength=WIDTH - 54)
        self.task.pack(fill="x", pady=(3, 4))
        self.bar = Bar(self.task_card)
        self.bar.pack(fill="x")
        self.details = tk.Label(self.task_card, text="", bg=CARD, fg=MUTED, font=(MONO, 8), anchor="w", justify="left", wraplength=WIDTH - 54)
        self.details.pack(fill="x", pady=(4, 0))

        # usage, only when the agent reports it
        self.use_card = self._card(pack=False)
        tk.Label(self.use_card, text="CONSUMO DA SEMANA", bg=CARD, fg=MUTED, font=(MONO, 8, "bold"), anchor="w").pack(fill="x")
        self.week_label, self.week_bar = self._meter_row(self.use_card)
        self.higgs_label, self.higgs_bar = self._meter_row(self.use_card)

        self.open_hub = tk.Button(root, text="ABRIR O HUB", command=self._open_hub, bg=ACCENT, fg="black", relief="flat",
                                  activebackground=ACCENT2, activeforeground="black", font=(MONO, 10, "bold"), cursor="hand2")
        self.open_hub.pack(side="bottom", fill="x", pady=(10, 0), ipady=5)

        root.update_idletasks()
        x = root.winfo_screenwidth() - WIDTH - 24
        root.geometry(f"{WIDTH}x{root.winfo_reqheight()}+{x}+60")
        threading.Thread(target=self._poll_hub, daemon=True).start()
        self._tick()

    # ------------------------------------------------------------ building blocks

    def _dark_titlebar(self):
        try:  # Windows 10/11: dark title bar to match the widget
            self.root.update()
            hwnd = ctypes.windll.user32.GetParent(self.root.winfo_id())
            value = ctypes.c_int(1)
            ctypes.windll.dwmapi.DwmSetWindowAttribute(hwnd, 20, ctypes.byref(value), ctypes.sizeof(value))
        except Exception:
            pass

    def _card(self, pady=(8, 0), pack=True):
        card = tk.Frame(self.root, bg=CARD, padx=12, pady=10, highlightthickness=1, highlightbackground=CARD2)
        if pack:
            card.pack(fill="x", pady=pady)
        return card

    def _meter_row(self, parent):
        label = tk.Label(parent, text="", bg=CARD, fg=TEXT, font=(MONO, 9), anchor="w")
        label.pack(fill="x", pady=(6, 2))
        bar = Bar(parent)
        bar.pack(fill="x")
        return label, bar

    # ------------------------------------------------------------ the Hub on this computer: who is online, what is happening

    def _poll_hub(self):
        """Keeps the widget current. Starts the local Hub server if it is not running, and tells the Hub this person is here
        (that is what shows them online when no agent is running)."""
        tick = 0
        while True:
            url = hub.hub_url()
            try:
                if not hub.is_up(url) and hub.is_local(url):
                    hub.start_local_server(url)
                with urllib.request.urlopen(url + "/api/local/team", timeout=5) as res:
                    team = json.load(res)
                who = self._identity(team)
                if who:
                    hub.ping_presence(url, who)
                    with urllib.request.urlopen(url + "/api/local/team", timeout=5) as res:
                        team = json.load(res)  # again, so this person already shows as online
                self._team = team
                if tick % 2 == 0:
                    with urllib.request.urlopen(url + "/api/local/week", timeout=5) as res:
                        self._week = json.load(res)
            except (OSError, ValueError, urllib.error.URLError):
                self._team = None  # the Hub is not answering
            tick += 1
            time.sleep(4)

    def _identity(self, team):
        """Who sits at this computer: TEAM_WIDGET_USER, else the agent's user, else the Windows account name (marco -> Marco)."""
        wanted = (os.environ.get("TEAM_WIDGET_USER") or self.store.get().get("user") or getpass.getuser() or "").strip().lower()
        return next((p["user"] for p in team if wanted in (p["user"].lower(), p["name"].lower())), None)

    def _render_people(self, team):
        for child in self.people.winfo_children():
            child.destroy()
        if team is None:
            tk.Label(self.people, text="Hub desligado", bg=BG, fg=MUTED, font=(MONO, 8)).pack(anchor="w")
            return
        states = {"WORKING": "a trabalhar", "WAITING": "à espera", "PAUSED": "em pausa", "ERROR": "erro", "IDLE": "livre"}
        for person in team:
            on = person["online"]
            cell = tk.Frame(self.people, bg=BG)
            cell.pack(side="left", padx=(0, 16))
            icon = tk.Canvas(cell, width=52, height=52, bg=BG, highlightthickness=0, bd=0)
            icon.create_rectangle(2, 2, 50, 50, fill="#0f3d3a" if on else "#15181a", outline=COLORS["ONLINE"] if on else "#2a2f31", width=2)
            icon.create_text(26, 26, text=person["name"][:1].upper(), fill="#ffffff" if on else "#6b6880", font=(FONT, 20, "bold"))
            icon.create_oval(37, 37, 49, 49, fill=COLORS["ONLINE"] if on else COLORS["OFFLINE"], outline=BG, width=2)
            icon.pack()
            tk.Label(cell, text=clip(person["name"].upper(), 8), bg=BG, fg=TEXT if on else FAINT, font=(MONO, 8, "bold")).pack()
            tk.Label(cell, text=states.get(person["status"], "online") if on else "offline", bg=BG,
                     fg=COLORS["ONLINE"] if on else FAINT, font=(MONO, 7)).pack()
        self._fit()

    def _render_week(self, w: dict):
        for child in self.pending.winfo_children():
            child.destroy()
        for p in w.get("pending", [])[:3]:
            row = tk.Frame(self.pending, bg=CARD)
            row.pack(fill="x")
            ago = max(0, int(time.time() - (p["newest"] or time.time())) // 60)
            when = "agora" if ago < 1 else f"{ago} min" if ago < 60 else f"{ago // 60} h"
            tk.Label(row, text=clip(p["repo"].upper(), 12), bg=CARD, fg=TEXT, font=(MONO, 8, "bold"), width=12, anchor="w").pack(side="left")
            tk.Label(row, text=f"{p['count']} fich  +{p['added']} -{p['deleted']}  {when}", bg=CARD, fg=MUTED, font=(MONO, 8), anchor="w").pack(side="left")
        if not w.get("pending"):
            tk.Label(self.pending, text="Nada por guardar.", bg=CARD, fg=FAINT, font=(MONO, 8)).pack(anchor="w")

        for child in self.feed.winfo_children():
            child.destroy()
        feed = w.get("feed", [])[:5]
        for f in feed:
            when = datetime.fromisoformat(f["when"]).astimezone().strftime("%d/%m %H:%M")
            row = tk.Frame(self.feed, bg=CARD)
            row.pack(fill="x")
            tk.Label(row, text=when, bg=CARD, fg=FAINT, font=(MONO, 8)).pack(side="left")
            tk.Label(row, text=clip(f["who"].upper(), 8), bg=CARD, fg=TEXT, font=(MONO, 8, "bold"), width=8, anchor="w").pack(side="left", padx=(6, 0))
            tk.Label(row, text=clip(f["text"], 24), bg=CARD, fg=MUTED, font=(MONO, 8), anchor="w").pack(side="left")
        if not feed:
            tk.Label(self.feed, text="Sem movimentos esta semana.", bg=CARD, fg=MUTED, font=(MONO, 8)).pack(anchor="w")
        self._fit()

    def _fit(self):
        if self.root.state() == "normal" and self.root.winfo_width() in (1, WIDTH):  # don't fight a manual resize
            self.root.update_idletasks()
            self.root.geometry(f"{WIDTH}x{self.root.winfo_reqheight()}")

    # ------------------------------------------------------------ actions

    def show(self):
        self.root.deiconify()
        self.root.lift()

    def hide(self):
        self.root.withdraw()

    def _on_configure(self, event):
        if event.widget is self.root and self.root.state() == "zoomed":
            self.root.state("normal")  # the widget goes back to its small size; the Hub is its own window
            self._open_hub()

    def _open_hub(self):
        if self._opening_hub:
            return
        self._opening_hub = True
        self.open_hub.config(text="A ABRIR…", state="disabled")

        def work():
            self._hub_result = (hub.maximize(self.client.hub_session()),)  # opens already signed in; read by _tick (Tk is not thread-safe)

        self._hub_result = None
        threading.Thread(target=work, daemon=True).start()  # starting the server can take a few seconds

    def _hub_opened(self, error):
        self._opening_hub = False
        self.open_hub.config(text="ABRIR O HUB", state="normal")
        if error:
            messagebox.showerror("Hub", error, parent=self.root)

    def _open_dashboard(self):
        self._open_hub()

    def _open_task(self):
        state = self.store.get()
        if state.get("dashboard_url") and state.get("task_id"):
            webbrowser.open(f"{state['dashboard_url']}/#task-{state['task_id']}")

    # ------------------------------------------------------------ rendering

    def _tick(self):
        if self._hub_result is not None:
            (error,), self._hub_result = self._hub_result, None
            self._hub_opened(error)
        team = self._team
        if team is not self._team_seen:
            self._team_seen = team
            self._render_people(team)
        week = self._week
        if week is not None and week is not self._week_seen:
            self._week_seen = week
            self._render_week(week)
        state = self.store.get()
        if self.store.version != self._version:
            self._version = self.store.version
            self._render(state)
        elif state.get("started_at"):
            self.details["text"] = self._details(state)
        self.root.after(500, self._tick)

    def _details(self, state: dict) -> str:
        lines = [f"{label}: {state[key]}" for key, label in (("current_action", "agora"), ("next_action", "a seguir")) if state.get(key)]
        if state.get("started_at"):
            lines.append(f"há {elapsed(state['started_at'])}")
        return "\n".join(lines)

    @staticmethod
    def _meter(label, bar, title, pct, hint):
        value = "—" if pct is None else f"{pct}%"
        label["text"] = f"{title:<11}{value:>5}   {hint}"
        bar.set(pct, meter_color(pct or 0))

    def _render(self, state: dict):
        status = state.get("status", "OFFLINE")
        self.on_status(status)
        self.chip.config(text=f"●  {LABELS.get(status, status).upper()}", fg=COLORS.get(status, MUTED))
        name = state.get("display_name")
        self.user_label["text"] = f"{name.upper()}  ·  CENTRAL DE COMANDO" if name else "CENTRAL DE COMANDO"

        if status == "OFFLINE":
            alert = ""
        elif state.get("pending_approval"):
            alert = f"À espera de aprovação: {state['pending_approval']}"
        elif state.get("error"):
            alert = f"Erro: {state['error']}"
        elif not state.get("connected"):
            alert = "Servidor sem resposta, a trabalhar offline."
        else:
            notes = state.get("notifications") or []
            alert = notes[-1]["message"] if notes else ""
        if alert:
            self.alert.config(text=alert, fg=COLORS["ERROR"] if state.get("error") else COLORS["WAITING"])
            self.alert.pack(fill="x", pady=(6, 0), before=self.ledger)
        else:
            self.alert.pack_forget()

        if state.get("task"):
            progress = state.get("progress") or 0
            self.task["text"] = state["task"]
            self.progress_text["text"] = f"{progress}%"
            self.bar.set(progress, COLORS["WORKING"] if progress >= 100 else ACCENT)
            self.details["text"] = self._details(state)
            self.task_card.pack(fill="x", pady=(8, 0), before=self.open_hub)
        else:
            self.task_card.pack_forget()

        me = state.get("user")
        mine = next((m for m in state.get("team") or [] if m["user"] == me), {})
        if mine:
            spent = mine.get("week_cost_usd") or 0
            self._meter(self.week_label, self.week_bar, "CLAUDE", mine.get("week_pct") if spent else None,
                        f"${spent:.2f}/${mine.get('week_budget_usd', 0):.0f}")
            self._meter(self.higgs_label, self.higgs_bar, "HIGGSFIELD", mine.get("higgsfield_pct"), "créditos")
            self.use_card.pack(fill="x", pady=(8, 0), before=self.open_hub)
        else:
            self.use_card.pack_forget()
        self._fit()
