import time
import tkinter as tk
import webbrowser
from tkinter import simpledialog, ttk

from ..api.agent_client import AgentClient
from ..state.store import StateStore

BG, CARD, TEXT, MUTED = "#0f1218", "#1a1f29", "#e6e9ef", "#8b94a5"
COLORS = {"WORKING": "#3ecf8e", "ONLINE": "#3ecf8e", "IDLE": "#5b8def", "WAITING": "#f5c04a",
          "PAUSED": "#f5c04a", "ERROR": "#f26d6d", "OFFLINE": "#5c6473"}
WIDTH = 300


def elapsed(started_at) -> str:
    if not started_at:
        return "-"
    seconds = int(time.time() - started_at)
    return f"{seconds // 3600}h {seconds % 3600 // 60:02d}m" if seconds >= 3600 else f"{seconds // 60}m {seconds % 60:02d}s"


class WidgetWindow:
    def __init__(self, store: StateStore, client: AgentClient):
        self.store, self.client = store, client
        self.on_status = lambda status: None  # tray hook
        self._version = -1

        root = self.root = tk.Tk()
        root.title("Team Agent")
        root.configure(bg=BG, padx=12, pady=10)
        root.attributes("-topmost", True)
        root.resizable(False, False)
        root.protocol("WM_DELETE_WINDOW", self.hide)  # closing hides to tray; the agent keeps running
        ttk.Style().theme_use("clam")
        ttk.Style().configure("TProgressbar", troughcolor=CARD, background="#5b8def", bordercolor=CARD)

        self.status = self._label("", size=12, bold=True)
        self.alert = self._label("", color=COLORS["WAITING"])
        self._label("Task", MUTED)
        self.task = self._label("")
        self.progress_text = self._label("", MUTED)
        self.bar = ttk.Progressbar(root, length=WIDTH - 24, maximum=100)
        self.bar.pack(fill="x", pady=(2, 6))
        self.fields = {}
        for key, title in (("current_action", "Now"), ("last_action", "Last action"), ("next_action", "Next")):
            self._label(title, MUTED)
            self.fields[key] = self._label("")
        self.meta = self._label("", MUTED)
        self._label("Team", MUTED)
        self.team = self._label("")

        buttons = tk.Frame(root, bg=BG)
        buttons.pack(fill="x", pady=(8, 0))
        self.toggle = self._button(buttons, "Pause", self._toggle, 0, 0)
        self._button(buttons, "Stop", lambda: self.client.send("stop"), 0, 1)
        self._button(buttons, "Help", self._help, 0, 2)
        self._button(buttons, "Open Task", self._open_task, 1, 0)
        self._button(buttons, "Dashboard", self._open_dashboard, 1, 1, span=2)

        root.update_idletasks()
        x = root.winfo_screenwidth() - WIDTH - 24
        root.geometry(f"{WIDTH}x{root.winfo_reqheight()}+{x}+60")
        self._tick()

    def _label(self, text, color=TEXT, size=9, bold=False):
        label = tk.Label(self.root, text=text, bg=BG, fg=color, anchor="w", justify="left",
                         wraplength=WIDTH - 24, font=("Segoe UI", size, "bold" if bold else "normal"))
        label.pack(fill="x")
        return label

    def _button(self, parent, text, command, row, col, span=1):
        button = tk.Button(parent, text=text, command=command, bg=CARD, fg=TEXT, relief="flat",
                           activebackground="#2a313f", activeforeground=TEXT, font=("Segoe UI", 9))
        button.grid(row=row, column=col, columnspan=span, sticky="ew", padx=2, pady=2)
        parent.grid_columnconfigure(col, weight=1)
        return button

    # ------------------------------------------------------------ actions

    def show(self):
        self.root.deiconify()
        self.root.lift()

    def hide(self):
        self.root.withdraw()

    def _toggle(self):
        self.client.send("resume" if self.toggle["text"] == "Resume" else "pause")

    def _help(self):
        message = simpledialog.askstring("Request help", "What do you need help with?", parent=self.root)
        if message:
            self.client.send("help", message=message)

    def _open_dashboard(self):
        if url := self.store.get().get("dashboard_url"):
            webbrowser.open(url)

    def _open_task(self):
        state = self.store.get()
        if state.get("dashboard_url") and state.get("task_id"):
            webbrowser.open(f"{state['dashboard_url']}/#task-{state['task_id']}")

    # ------------------------------------------------------------ rendering

    def _tick(self):
        state = self.store.get()
        if self.store.version != self._version:
            self._version = self.store.version
            self._render(state)
        if state.get("started_at"):
            self.meta["text"] = self._meta(state)
        self.root.after(500, self._tick)

    def _meta(self, state: dict) -> str:
        parts = [f"Elapsed {elapsed(state.get('started_at'))}"]
        usage = state.get("usage") or {}
        if usage.get("budget_pct") is not None:
            parts.append(f"Claude budget {usage['budget_pct']}% (${usage.get('cost_usd', 0):.2f})")
        return "  ·  ".join(parts)

    def _render(self, state: dict):
        status = state.get("status", "OFFLINE")
        self.on_status(status)
        name = state.get("display_name") or "Team Agent"
        self.root.title(f"{name} - {status}")
        self.status.config(text=f"● {status}", fg=COLORS.get(status, MUTED))

        if status == "OFFLINE":
            alert = "Local agent is not running."
        elif state.get("pending_approval"):
            alert = f"Waiting for approval: {state['pending_approval']}"
        elif state.get("error"):
            alert = f"Error: {state['error']}"
        elif not state.get("connected"):
            alert = "Server unreachable - working offline."
        else:
            notes = state.get("notifications") or []
            alert = notes[-1]["message"] if notes else ""
        self.alert.config(text=alert, fg=COLORS["ERROR"] if state.get("error") or status == "OFFLINE" else COLORS["WAITING"])

        self.task["text"] = state.get("task") or "No active task"
        progress = state.get("progress") or 0
        self.progress_text["text"] = f"Progress {progress}%"
        self.bar["value"] = progress
        for key, label in self.fields.items():
            label["text"] = state.get(key) or "-"
        self.meta["text"] = self._meta(state) if state.get("task_id") else ""
        me = state.get("user")
        self.team["text"] = "\n".join(
            f"{m['display_name']}: {m['status']}" + (f" - {m['task']} {m['progress']}%" if m.get("task") else "")
            for m in state.get("team") or [] if m["user"] != me) or "-"
        self.toggle["text"] = "Resume" if status in ("PAUSED", "ERROR") or (status == "WAITING" and not state.get("pending_approval")) else "Pause"
        self.root.geometry(f"{WIDTH}x{self.root.winfo_reqheight()}")
