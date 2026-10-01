import ctypes
import math
import threading
import time
import tkinter as tk
import webbrowser
from pathlib import Path
from tkinter import messagebox

from PIL import Image, ImageDraw, ImageFont, ImageTk

from .. import hub
from ..api.agent_client import AgentClient
from ..state.store import StateStore

BG, CARD, CARD2, TEXT, MUTED = "#121216", "#1b1b22", "#2b2b36", "#f0eff7", "#9a97ad"
PURPLE, PURPLE2 = "#8b5cf6", "#c084fc"
COLORS = {"WORKING": "#4ade80", "ONLINE": "#4ade80", "IDLE": "#60a5fa", "WAITING": "#fbbf24",
          "PAUSED": "#fbbf24", "ERROR": "#f87171", "OFFLINE": "#6b6880"}
LABELS = {"WORKING": "A trabalhar", "ONLINE": "Online", "IDLE": "Livre", "WAITING": "À espera",
          "PAUSED": "Em pausa", "ERROR": "Erro", "OFFLINE": "Agente desligado"}
WIDTH = 340
LOGO = Path(__file__).resolve().parents[1] / "assets" / "logo.png"
FONT = "Segoe UI"


def elapsed(started_at) -> str:
    if not started_at:
        return ""
    seconds = int(time.time() - started_at)
    return f"{seconds // 3600}h {seconds % 3600 // 60:02d}m" if seconds >= 3600 else f"{seconds // 60}m {seconds % 60:02d}s"


class Bar(tk.Canvas):
    """Thin rounded progress bar."""

    def __init__(self, parent, bg=CARD, height=10):
        super().__init__(parent, height=height, bg=bg, highlightthickness=0, bd=0)
        self._pct, self._color = 0, PURPLE
        self.bind("<Configure>", lambda e: self._draw())

    def set(self, pct, color=PURPLE):
        self._pct, self._color = max(0, min(100, pct or 0)), color
        self._draw()

    def _draw(self):
        self.delete("all")
        w, h = self.winfo_width(), int(self["height"])
        r = h // 2
        if w < 2 * r + 2:
            return
        self.create_line(r, r, w - r, r, width=h - 2, capstyle="round", fill=CARD2)
        end = r + (w - 2 * r) * self._pct / 100
        if self._pct > 0:
            self.create_line(r, r, max(end, r + 1), r, width=h - 2, capstyle="round", fill=self._color)


def _font(px: int):
    for name in ("segoeuib.ttf", "arialbd.ttf", "DejaVuSans-Bold.ttf"):
        try:
            return ImageFont.truetype(name, px)
        except OSError:
            continue
    return ImageFont.load_default()


class Ring(tk.Label):
    """Circular percentage meter. Drawn with Pillow at 4x and downsampled, so the arc is smooth."""

    SCALE = 4

    def __init__(self, parent, size, bg=CARD):
        super().__init__(parent, bg=bg, bd=0)
        self.size, self.stroke, self._bg, self._key = size, max(6, size // 9), bg, None
        self.set(None)

    def set(self, pct, color=PURPLE, text=None):
        key = (pct, color, text)
        if key == self._key:
            return
        self._key = key
        n, w = self.size * self.SCALE, self.stroke * self.SCALE
        img = Image.new("RGB", (n, n), self._bg)
        draw = ImageDraw.Draw(img)
        box = (self.SCALE, self.SCALE, n - self.SCALE, n - self.SCALE)
        draw.arc(box, 0, 360, fill=CARD2, width=w)
        value = max(0, min(100, pct or 0))
        if value > 0:
            draw.arc(box, -90, -90 + 360 * value / 100, fill=color, width=w)
            radius = n / 2 - self.SCALE - w / 2  # centre line of the stroke
            for angle in (-90, -90 + 360 * value / 100):  # rounded ends
                x = n / 2 + radius * math.cos(math.radians(angle))
                y = n / 2 + radius * math.sin(math.radians(angle))
                draw.ellipse((x - w / 2, y - w / 2, x + w / 2, y + w / 2), fill=color)
        label = text if text is not None else f"{value}%"
        draw.text((n / 2, n / 2), label, anchor="mm", fill=TEXT if pct is not None else MUTED, font=_font(int(n * 0.25)))
        self._image = ImageTk.PhotoImage(img.resize((self.size, self.size), Image.LANCZOS))
        self.config(image=self._image)


def meter_color(pct):
    return "#f87171" if pct >= 85 else "#fbbf24" if pct >= 60 else PURPLE


class WidgetWindow:
    def __init__(self, store: StateStore, client: AgentClient):
        self.store, self.client = store, client
        self.on_status = lambda status: None  # tray hook
        self._version = -1
        self._opening_hub = False
        self._hub_result = None

        root = self.root = tk.Tk()
        root.title("Agente AMG")
        root.configure(bg=BG, padx=14, pady=12)
        # Normal window with the usual minimize / maximize buttons. Maximizing it opens the Hub (see _on_configure).
        root.minsize(WIDTH, 120)
        root.bind("<Configure>", self._on_configure)
        root.protocol("WM_DELETE_WINDOW", self.hide)  # closing hides to tray; the agent keeps running
        self._logo = ImageTk.PhotoImage(Image.open(LOGO).resize((40, 40), Image.LANCZOS))
        root.iconphoto(True, ImageTk.PhotoImage(Image.open(LOGO).resize((64, 64), Image.LANCZOS)))
        self._dark_titlebar()

        # header: logo, name, status chip
        head = tk.Frame(root, bg=BG)
        head.pack(fill="x")
        tk.Label(head, image=self._logo, bg=BG).pack(side="left")
        names = tk.Frame(head, bg=BG)
        names.pack(side="left", padx=10)
        tk.Label(names, text="AGENTE AMG", bg=BG, fg=TEXT, font=(FONT, 11, "bold")).pack(anchor="w")
        self.user_label = tk.Label(names, text="", bg=BG, fg=MUTED, font=(FONT, 9))
        self.user_label.pack(anchor="w")
        self.chip = tk.Label(head, text="", bg=CARD, fg=MUTED, font=(FONT, 9, "bold"), padx=10, pady=4)
        self.chip.pack(side="right")

        self.alert = tk.Label(root, text="", bg=BG, fg=COLORS["WAITING"], font=(FONT, 9), anchor="w", justify="left", wraplength=WIDTH - 28)
        self.alert.pack(fill="x", pady=(8, 0))

        # task card
        task = self._card()
        self.ring = Ring(task, 88)
        self.ring.pack(side="left", padx=(0, 14))
        info = tk.Frame(task, bg=CARD)
        info.pack(side="left", fill="both", expand=True)
        self._caption(info, "TAREFA")
        self.task = tk.Label(info, text="", bg=CARD, fg=TEXT, font=(FONT, 11, "bold"), anchor="w", justify="left", wraplength=WIDTH - 162)
        self.task.pack(fill="x", pady=(2, 4))
        self.details = tk.Label(info, text="", bg=CARD, fg=MUTED, font=(FONT, 9), anchor="w", justify="left", wraplength=WIDTH - 162)
        self.details.pack(fill="x")

        # what the agent did (kept by the agent across restarts)
        done = self._card()
        self._caption(done, "O QUE FOI FEITO")
        self.history = tk.Frame(done, bg=CARD)
        self.history.pack(fill="x", pady=(4, 0))

        # usage card: one ring per service
        use = self._card()
        self._caption(use, "ESTA SEMANA")
        meters = tk.Frame(use, bg=CARD)
        meters.pack(fill="x", pady=(8, 0))
        self.week_ring, self.week_label = self._ring_meter(meters, 0, "Claude")
        self.higgs_ring, self.higgs_label = self._ring_meter(meters, 1, "Higgsfield")

        # team
        team = self._card()
        self._caption(team, "EQUIPA")
        self.team = tk.Frame(team, bg=CARD)
        self.team.pack(fill="x")

        # buttons
        self.open_hub = tk.Button(root, text="Abrir o Hub", command=self._open_hub, bg=PURPLE, fg="white", relief="flat",
                                  activebackground=PURPLE2, activeforeground="white", font=(FONT, 10, "bold"), cursor="hand2")
        self.open_hub.pack(fill="x", pady=(10, 0), ipady=5)

        root.update_idletasks()
        x = root.winfo_screenwidth() - WIDTH - 24
        root.geometry(f"{WIDTH}x{root.winfo_reqheight()}+{x}+60")
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

    def _card(self):
        card = tk.Frame(self.root, bg=CARD, padx=12, pady=10)
        card.pack(fill="x", pady=(10, 0))
        return card

    def _caption(self, parent, text):
        tk.Label(parent, text=text, bg=CARD, fg=MUTED, font=(FONT, 8, "bold"), anchor="w").pack(fill="x")

    def _ring_meter(self, parent, col, title):
        cell = tk.Frame(parent, bg=CARD)
        cell.grid(row=0, column=col, sticky="nsew")
        parent.grid_columnconfigure(col, weight=1, uniform="meters")
        ring = Ring(cell, 68)
        ring.pack()
        tk.Label(cell, text=title, bg=CARD, fg=TEXT, font=(FONT, 9, "bold")).pack(pady=(6, 0))
        hint = tk.Label(cell, text="", bg=CARD, fg=MUTED, font=(FONT, 8), wraplength=(WIDTH - 60) // 2, justify="center")
        hint.pack()
        return ring, hint

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
        self.open_hub.config(text="A abrir…", state="disabled")

        def work():
            self._hub_result = (hub.maximize(self.client.hub_session()),)  # opens already signed in  # picked up by _tick; Tk is not thread-safe

        self._hub_result = None
        threading.Thread(target=work, daemon=True).start()  # starting the server can take a few seconds

    def _hub_opened(self, error):
        self._opening_hub = False
        self.open_hub.config(text="Abrir o Hub", state="normal")
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
        state = self.store.get()
        if self.store.version != self._version:
            self._version = self.store.version
            self._render(state)
        elif state.get("started_at"):
            self.details["text"] = self._details(state)
        self.root.after(500, self._tick)

    def _details(self, state: dict) -> str:
        lines = [f"{label}: {state[key]}" for key, label in (("current_action", "Agora"), ("next_action", "A seguir")) if state.get(key)]
        if state.get("started_at"):
            lines.append(f"Há {elapsed(state['started_at'])}")
        return "\n".join(lines)

    @staticmethod
    def _meter(ring, label, pct, hint):
        label["text"] = hint
        if pct is None:
            ring.set(None, text="—")
        else:
            ring.set(pct, meter_color(pct))

    def _render(self, state: dict):
        status = state.get("status", "OFFLINE")
        self.on_status(status)
        name = state.get("display_name") or "Agente AMG"
        self.user_label["text"] = name if state.get("display_name") else "sem ligação"
        self.chip.config(text=f"●  {LABELS.get(status, status)}", fg=COLORS.get(status, MUTED))

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
        self.alert.config(text=alert, fg=COLORS["ERROR"] if state.get("error") else COLORS["WAITING"])

        progress = state.get("progress") or 0
        self.task["text"] = state.get("task") or ("Liga o agente para receber tarefas" if status == "OFFLINE" else "Sem tarefa agora")
        self.task["fg"] = TEXT if state.get("task") else MUTED
        if state.get("task"):
            self.ring.set(progress, COLORS["WORKING"] if progress >= 100 else PURPLE)
        else:
            self.ring.set(None, text="—")
        self.details["text"] = self._details(state)

        me = state.get("user")
        mine = next((m for m in state.get("team") or [] if m["user"] == me), {})
        spent = mine.get("week_cost_usd") or 0
        self._meter(self.week_ring, self.week_label, mine.get("week_pct") if spent else None,
                    f"${spent:.2f} de ${mine.get('week_budget_usd', 0):.0f}" if spent else "ainda sem uso" if mine else "liga o agente")

        for child in self.history.winfo_children():
            child.destroy()
        entries = (state.get("history") or [])[-5:][::-1]
        if not entries:
            tk.Label(self.history, text="Ainda nada. O que o agente fizer aparece aqui.", bg=CARD, fg=MUTED, font=(FONT, 9),
                     anchor="w", justify="left", wraplength=WIDTH - 60).pack(fill="x")
        for entry in entries:
            row = tk.Frame(self.history, bg=CARD)
            row.pack(fill="x", pady=1)
            tk.Label(row, text=time.strftime("%H:%M", time.localtime(entry["time"])), bg=CARD, fg=MUTED, font=(FONT, 8)).pack(side="left", anchor="n", pady=(1, 0))
            tk.Label(row, text=entry["text"], bg=CARD, fg=TEXT, font=(FONT, 9), anchor="w", justify="left",
                     wraplength=WIDTH - 100).pack(side="left", padx=(8, 0), fill="x")
        self._meter(self.higgs_ring, self.higgs_label, mine.get("higgsfield_pct"),
                    "créditos usados" if mine.get("higgsfield_pct") is not None else "define no Hub")

        for child in self.team.winfo_children():
            child.destroy()
        others = [m for m in state.get("team") or [] if m["user"] != me]
        if not others:
            tk.Label(self.team, text="—", bg=CARD, fg=MUTED, font=(FONT, 9)).pack(anchor="w")
        for m in others:
            row = tk.Frame(self.team, bg=CARD)
            row.pack(fill="x", pady=1)
            tk.Label(row, text="●", bg=CARD, fg=COLORS.get(m["status"], MUTED), font=(FONT, 9)).pack(side="left")
            tk.Label(row, text=m["display_name"], bg=CARD, fg=TEXT, font=(FONT, 9, "bold")).pack(side="left", padx=(6, 8))
            detail = f"{m['task']}  {m['progress']}%" if m.get("task") else LABELS.get(m["status"], m["status"])
            tk.Label(row, text=detail, bg=CARD, fg=MUTED, font=(FONT, 9), anchor="w").pack(side="left", fill="x")

        if self.root.state() == "normal" and self.root.winfo_width() in (1, WIDTH):  # don't fight a manual resize
            self.root.geometry(f"{WIDTH}x{self.root.winfo_reqheight()}")
