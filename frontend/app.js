// Team Workspace: REST for data, WebSocket events as "something changed" hints.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const time = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");
const money = (n) => (n < 0 ? "-$" : "$") + Math.abs(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ACTIVE = ["IN_PROGRESS", "WAITING_APPROVAL", "PAUSED", "NEEDS_HELP"];

let token = localStorage.getItem("token");
let me = null;
let current = null;   // active view key
let openTask = null;
const view = $("view");

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 401) { logout(); throw new Error("unauthorized"); }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || res.statusText);
  return res.json();
}

function logout() {
  localStorage.removeItem("token");
  token = null;
  $("app").hidden = true;
  $("login").hidden = false;
}

$("login-form").onsubmit = async (e) => {
  e.preventDefault();
  const res = await fetch("/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: $("username").value, password: $("password").value }),
  });
  if (!res.ok) { $("login-error").textContent = "Invalid username or password"; return; }
  token = (await res.json()).token;
  localStorage.setItem("token", token);
  start();
};
$("logout").onclick = logout;

$("agent-token").onclick = async () => {
  const { agent_token } = await api(`/api/users/${me.username}/agent-token`, { method: "POST" });
  $("token-box").hidden = false;
  $("token-box").innerHTML = `Agent token for <b>${esc(me.username)}</b> (shown once, replaces the previous one). Put it in the agent's <code>.env</code> as TEAM_AGENT_TOKEN:<br><code>${esc(agent_token)}</code>`;
};

// ---------------------------------------------------------------- shared pieces

function teamCards(team) {
  return team.map((m) => `
    <div class="card">
      <b>${esc(m.display_name)}</b> <span class="pill">${esc(m.role)}</span>
      <div class="status s-${esc(m.status)}">${esc(m.status)}</div>
      <div>${m.task ? esc(m.task) : '<span class="muted">No active task</span>'}</div>
      <div class="bar"><i style="width:${Number(m.progress) || 0}%"></i></div>
      <div class="muted">${Number(m.progress) || 0}%${m.last_seen ? " · seen " + time(m.last_seen) : ""}</div>
      ${m.current_action ? `<div class="muted">Now: ${esc(m.current_action)}</div>` : ""}
      ${m.last_action ? `<div class="muted">Last: ${esc(m.last_action)}</div>` : ""}
      ${m.next_action ? `<div class="muted">Next: ${esc(m.next_action)}</div>` : ""}
      ${m.error ? `<div class="error">${esc(m.error)}</div>` : ""}
    </div>`).join("");
}

function approvalCards(list) {
  const pending = list.filter((a) => a.status === "PENDING");
  return pending.length ? pending.map((a) => `
    <div class="card approval">
      <span><b>${esc(a.user)}</b>'s agent is waiting for approval: <b>${esc(a.action)}</b>
        ${a.task_id ? `(TASK-${a.task_id})` : ""}<br><span class="muted">${esc(a.detail)}</span></span>
      ${me.role === "owner"
        ? `<button data-ap="${a.id}" data-ok="1">Approve</button><button class="danger" data-ap="${a.id}">Reject</button>`
        : '<span class="muted">Waiting for owner</span>'}
    </div>`).join("") : '<p class="muted">No pending approvals.</p>';
}

const feed = (items) => items.map((a) => `<li><span class="muted">${time(a.created_at)}</span> ${esc(a.message)}</li>`).join("");
const kpi = (label, value, sub = "", cls = "") => `<div class="kpi"><span>${label}</span><b class="${cls}">${value}</b><small>${sub}</small></div>`;

view.addEventListener("click", async (e) => {
  if (e.target.dataset.ap) {
    await api(`/api/approvals/${e.target.dataset.ap}/decide`, { method: "POST", body: { approve: !!e.target.dataset.ok } });
  }
});

// ---------------------------------------------------------------- views

const views = {
  overview: {
    title: "Overview", icon: "◧", events: ["presence", "task", "approval", "activity", "usage", "finance"],
    mount() {
      view.innerHTML = `<div id="kpis" class="kpis"></div>
        <h2>Team</h2><div id="team" class="grid"></div>
        <h2>Approvals</h2><div id="approvals"></div>
        <h2>Recent activity</h2><ul id="activity" class="feed"></ul>`;
    },
    async refresh() {
      const [o, team, approvals, activity] = await Promise.all([
        api("/api/overview"), api("/api/team"), api("/api/approvals"), api("/api/activity?limit=10")]);
      const f = o.finance;
      $("kpis").innerHTML =
        (f ? kpi("Profit (est.)", money(f.profit), `${money(f.income)} in · ${money(f.expenses)} out`, f.profit >= 0 ? "pos" : "neg") : "") +
        kpi("AI credits spent", money(o.ai_cost), me.role === "owner" ? "whole team, estimate" : "your agent, estimate") +
        kpi("Active tasks", o.tasks_active, `${o.tasks_completed} completed`) +
        kpi("Agents online", `${o.agents_online}/${o.agents_total}`) +
        kpi("Pending approvals", o.pending_approvals, "", o.pending_approvals ? "neg" : "");
      $("team").innerHTML = teamCards(team);
      $("approvals").innerHTML = approvalCards(approvals);
      $("activity").innerHTML = feed(activity);
      badge(o.pending_approvals);
    },
  },

  tasks: {
    title: "Tasks", icon: "☑", events: ["task", "approval"],
    mount() {
      view.innerHTML = `
        <form id="task-form" class="card row">
          <input id="t-title" placeholder="Title" required>
          <input id="t-goal" placeholder="Goal">
          <input id="t-project" placeholder="Project folder (optional)">
          <select id="t-assignee"></select>
          <textarea id="t-description" placeholder="Description"></textarea>
          <textarea id="t-requirements" placeholder="Requirements, one per line"></textarea>
          <button>Create task</button>
        </form>
        <h2>All tasks</h2>
        <div class="table-wrap"><table id="tasks"></table></div>
        <div id="task-detail" class="card" hidden></div>`;
      api("/api/users").then((users) => {
        $("t-assignee").innerHTML = users.filter((u) => me.role === "owner" || u.username === me.username)
          .map((u) => `<option value="${esc(u.username)}">${esc(u.display_name)}</option>`).join("");
      });
      $("task-form").onsubmit = async (e) => {
        e.preventDefault();
        await api("/api/tasks", { method: "POST", body: {
          title: $("t-title").value, goal: $("t-goal").value, project: $("t-project").value,
          description: $("t-description").value, assignee: $("t-assignee").value,
          requirements: $("t-requirements").value.split("\n").map((s) => s.trim()).filter(Boolean),
        } });
        e.target.reset();
      };
      $("tasks").onclick = async (e) => {
        if (e.target.dataset.act) {
          await api(`/api/tasks/${e.target.dataset.id}/control`, { method: "POST", body: { action: e.target.dataset.act } });
          return;
        }
        const row = e.target.closest("tr[data-id]");
        if (row) { openTask = Number(row.dataset.id); views.tasks.refresh(); }
      };
    },
    async refresh() {
      const tasks = await api("/api/tasks");
      $("tasks").innerHTML = "<tr><th>#</th><th>Title</th><th>Assignee</th><th>Status</th><th>Progress</th><th>Last action</th><th></th></tr>" +
        tasks.map((t) => `
          <tr class="clickable" data-id="${t.id}">
            <td>${t.id}</td><td>${esc(t.title)}</td><td>${esc(t.assignee)}</td><td>${esc(t.status)}</td>
            <td>${t.progress}%</td><td>${esc(t.last_action)}</td>
            <td>${["IN_PROGRESS", "WAITING_APPROVAL"].includes(t.status) ? `<button class="ghost" data-act="pause" data-id="${t.id}">Pause</button>` : ""}
                ${["PAUSED", "NEEDS_HELP"].includes(t.status) ? `<button class="ghost" data-act="resume" data-id="${t.id}">Resume</button>` : ""}
                ${ACTIVE.includes(t.status) ? `<button class="danger" data-act="stop" data-id="${t.id}">Stop</button>` : ""}</td>
          </tr>`).join("");
      if (!openTask) return;
      const t = await api(`/api/tasks/${openTask}`);
      $("task-detail").hidden = false;
      $("task-detail").innerHTML = `
        <b>TASK-${t.id}: ${esc(t.title)}</b> <span class="pill">${esc(t.status)}</span>
        <button class="ghost" id="close-task">Close</button>
        ${t.goal ? `<pre><b>Goal:</b> ${esc(t.goal)}</pre>` : ""}
        ${t.description ? `<pre>${esc(t.description)}</pre>` : ""}
        ${t.requirements.length ? `<pre><b>Requirements:</b>\n${t.requirements.map((r) => "• " + esc(r)).join("\n")}</pre>` : ""}
        ${t.result ? `<pre><b>Result:</b> ${esc(t.result)}</pre>` : ""}
        <ul class="feed">${t.events.map((ev) => `<li><span class="muted">${time(ev.created_at)} ${esc(ev.kind)}</span> ${esc(ev.message)}</li>`).join("")}</ul>`;
      $("close-task").onclick = () => { openTask = null; $("task-detail").hidden = true; };
    },
  },

  notes: docsView("notes", "Notes", "✎", "note", ""),
  skills: docsView("skills", "Skills", "◈", "skill", "# Skill name\n\n## When to use\n\n\n## Steps\n1. \n\n## Examples\n"),

  finance: {
    title: "Profit", icon: "$", ownerOnly: true, events: ["finance", "usage"],
    mount() {
      view.innerHTML = `<div id="f-kpis" class="kpis"></div>
        <h2>By month</h2>
        <div class="card"><div id="months" class="months"></div>
          <div class="legend"><span><i class="inc"></i>Income</span><span><i class="exp"></i>Expenses</span></div></div>
        <h2>Add entry</h2>
        <form id="f-form" class="card row">
          <select id="f-kind"><option value="income">Income</option><option value="expense">Expense</option></select>
          <input id="f-amount" type="number" step="0.01" min="0.01" placeholder="Amount" required>
          <input id="f-desc" placeholder="Description">
          <input id="f-cat" placeholder="Category">
          <input id="f-date" type="date" required>
          <button>Add</button>
        </form>
        <h2>Entries</h2><div class="table-wrap"><table id="f-table"></table></div>`;
      $("f-date").value = new Date().toISOString().slice(0, 10);
      $("f-form").onsubmit = async (e) => {
        e.preventDefault();
        await api("/api/finance", { method: "POST", body: {
          kind: $("f-kind").value, amount: Number($("f-amount").value), description: $("f-desc").value,
          category: $("f-cat").value, date: $("f-date").value } });
        $("f-amount").value = $("f-desc").value = "";
      };
      $("f-table").onclick = async (e) => {
        if (e.target.dataset.del) await api(`/api/finance/${e.target.dataset.del}`, { method: "DELETE" });
      };
    },
    async refresh() {
      const f = await api("/api/finance");
      $("f-kpis").innerHTML = kpi("Profit (est.)", money(f.profit), "income − expenses − AI credits", f.profit >= 0 ? "pos" : "neg") +
        kpi("Income", money(f.income)) + kpi("Expenses", money(f.expenses)) + kpi("AI credits", money(f.ai_cost), "SDK estimate");
      const max = Math.max(1, ...f.months.flatMap((m) => [m.income, m.expenses]));
      $("months").innerHTML = f.months.length ? f.months.map((m) => `
        <div class="month" title="${m.month}: ${money(m.income)} in, ${money(m.expenses)} out">
          <div class="pair"><i class="inc" style="height:${m.income / max * 100}%"></i><i class="exp" style="height:${m.expenses / max * 100}%"></i></div>
          <span>${esc(m.month.slice(2))}<br>${money(m.income - m.expenses)}</span>
        </div>`).join("") : '<span class="muted">No entries yet.</span>';
      $("f-table").innerHTML = '<tr><th>Date</th><th>Type</th><th>Description</th><th>Category</th><th class="num">Amount</th><th></th></tr>' +
        f.entries.map((x) => `<tr><td>${esc(x.date)}</td><td>${x.kind === "income" ? "Income" : "Expense"}</td><td>${esc(x.description)}</td>
          <td>${esc(x.category)}</td><td class="num ${x.kind === "income" ? "pos" : "neg"}">${x.kind === "income" ? "+" : "−"}${money(x.amount)}</td>
          <td><button class="danger" data-del="${x.id}">Delete</button></td></tr>`).join("");
    },
  },

  credits: {
    title: "AI credits", icon: "⚡", events: ["usage"],
    mount() {
      view.innerHTML = `<div id="c-kpis" class="kpis"></div><h2>By person</h2>
        <div class="table-wrap"><table id="usage"></table></div>
        <p class="hint">Tokens and cost are estimates reported by the Claude Agent SDK when a run ends, not billing data.</p>`;
    },
    async refresh() {
      const rows = await api("/api/usage");
      const total = rows.reduce((s, u) => s + u.cost_usd, 0);
      const max = Math.max(0.0001, ...rows.map((u) => u.cost_usd));
      $("c-kpis").innerHTML = kpi("Spent", money(total), "estimate") +
        kpi("Runs", rows.reduce((s, u) => s + u.runs, 0)) +
        kpi("Output tokens", rows.reduce((s, u) => s + u.output_tokens, 0).toLocaleString());
      $("usage").innerHTML = '<tr><th>Person</th><th style="width:40%">Share</th><th class="num">Runs</th><th class="num">Input</th><th class="num">Output</th><th class="num">Cost</th></tr>' +
        rows.map((u) => `<tr><td>${esc(u.user)}</td><td><div class="bar"><i style="width:${u.cost_usd / max * 100}%"></i></div></td>
          <td class="num">${u.runs}</td><td class="num">${u.input_tokens.toLocaleString()}</td><td class="num">${u.output_tokens.toLocaleString()}</td>
          <td class="num">${money(u.cost_usd)}</td></tr>`).join("") || '<tr><td colspan="6" class="muted">No usage yet.</td></tr>';
    },
  },

  activity: {
    title: "Activity", icon: "≡", events: ["activity"],
    mount() { view.innerHTML = '<ul id="activity" class="feed" style="max-height:none"></ul>'; },
    async refresh() { $("activity").innerHTML = feed(await api("/api/activity?limit=200")); },
  },
};

// Notes and Skills share one folder-tree + editor view.
function docsView(section, title, icon, noun, template) {
  const state = { list: [], id: null };
  const field = (id) => $(`d-${id}`);

  function tree() {
    const folders = {};
    state.list.forEach((d) => (folders[d.folder] ||= []).push(d));
    $("tree").innerHTML = Object.entries(folders).map(([name, docs]) => `
      <details open><summary>▸ ${esc(name)} <small>${docs.length}</small></summary>
        ${docs.map((d) => `<a data-id="${d.id}" class="${d.id === state.id ? "active" : ""}">${d.shared ? "" : "🔒 "}${esc(d.title)}</a>`).join("")}
      </details>`).join("") || `<p class="muted">No ${noun}s yet.</p>`;
    $("folders").innerHTML = Object.keys(folders).map((f) => `<option value="${esc(f)}">`).join("");
  }

  function open(doc) {
    state.id = doc.id ?? null;
    $("editor").hidden = false;
    field("title").value = doc.title; field("folder").value = doc.folder;
    field("content").value = doc.content; field("shared").checked = doc.shared;
    $("d-info").textContent = doc.id ? `by ${doc.author} · saved ${time(doc.updated_at)}` : "not saved yet";
    $("d-delete").hidden = !doc.id;
    $("d-delete").textContent = "Delete";
    tree();
  }

  return {
    title, icon, events: ["docs"],
    mount() {
      state.id = null;
      view.innerHTML = `<div class="docs">
        <div class="tree"><button id="d-new">+ New ${noun}</button><div id="tree" class="tree"></div></div>
        <form id="editor" class="card" hidden>
          <input id="d-title" placeholder="Title" required>
          <div class="meta">
            <label>Folder <input id="d-folder" list="folders" placeholder="General" required></label><datalist id="folders"></datalist>
            <label><input id="d-shared" type="checkbox"> Shared with the team</label>
          </div>
          <textarea id="d-content" placeholder="Write here…"></textarea>
          <div class="actions"><button>Save</button><button type="button" id="d-delete" class="danger">Delete</button>
            <span id="d-info" class="muted"></span><span id="d-error" class="error"></span></div>
        </form></div>`;
      $("d-new").onclick = () => open({ title: "", folder: field("folder").value || "General", content: template, shared: true });
      $("tree").onclick = (e) => {
        const doc = state.list.find((d) => d.id === Number(e.target.dataset.id));
        if (doc) open(doc);
      };
      $("editor").onsubmit = async (e) => {
        e.preventDefault();
        const body = { section, title: field("title").value, folder: field("folder").value.trim() || "General",
                       content: field("content").value, shared: field("shared").checked };
        try {
          const saved = state.id ? await api(`/api/docs/${state.id}`, { method: "PUT", body })
                                 : await api("/api/docs", { method: "POST", body });
          $("d-error").textContent = "";
          state.list = await api(`/api/docs?section=${section}`);
          open(saved);
        } catch (err) { $("d-error").textContent = err.message; }
      };
      $("d-delete").onclick = async () => {
        if ($("d-delete").textContent === "Delete") { $("d-delete").textContent = "Click again to delete"; return; }
        await api(`/api/docs/${state.id}`, { method: "DELETE" });
        state.id = null;
        $("editor").hidden = true;
      };
    },
    // Only the tree refreshes on remote changes, so text being typed is never overwritten.
    async refresh() { state.list = await api(`/api/docs?section=${section}`); tree(); },
  };
}

// ---------------------------------------------------------------- shell

function badge(count) {
  const link = document.querySelector('#nav a[data-view="overview"] .badge');
  if (link) { link.hidden = !count; link.textContent = count; }
}

function show(key) {
  if (!views[key] || (views[key].ownerOnly && me.role !== "owner")) key = "overview";
  current = key;
  $("title").textContent = views[key].title;
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.view === key));
  views[key].mount();
  views[key].refresh().catch(() => {});
}

function route() {
  const task = location.hash.match(/^#task-(\d+)$/); // "Open Task" from the widget
  if (task) { openTask = Number(task[1]); show("tasks"); return; }
  show(location.hash.slice(1) || "overview");
}

const pending = new Set();
function onEvent(type) {
  // Heartbeats arrive every few seconds; coalesce bursts into one refresh.
  if (!current || !views[current].events.includes(type) || pending.has(current)) return;
  const key = current;
  pending.add(key);
  setTimeout(() => { pending.delete(key); if (current === key) views[key].refresh().catch(() => {}); }, 300);
}

function connect() {
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?token=${token}`);
  ws.onopen = () => { $("live").textContent = "live"; };
  ws.onmessage = (e) => onEvent(JSON.parse(e.data).type);
  ws.onclose = () => { $("live").textContent = "reconnecting"; if (token) setTimeout(connect, 3000); };
}

// Inside the desktop widget shell: offer the way back to the compact widget.
function widgetShell() {
  $("to-widget").hidden = false;
  $("to-widget").onclick = () => window.pywebview.api.compact();
}
window.pywebview ? widgetShell() : window.addEventListener("pywebviewready", widgetShell);

async function start() {
  try { me = await api("/api/me"); } catch { return; }
  $("login").hidden = true;
  $("app").hidden = false;
  $("whoami").textContent = `${me.display_name} · ${me.role}`;
  $("nav").innerHTML = Object.entries(views).filter(([, v]) => !v.ownerOnly || me.role === "owner")
    .map(([key, v]) => `<a data-view="${key}" href="#${key}"><span>${v.icon}</span>${v.title}${key === "overview" ? '<span class="badge" hidden></span>' : ""}</a>`).join("");
  window.onhashchange = route;
  route();
  setInterval(() => current === "overview" && views.overview.refresh().catch(() => {}), 15000); // catches OFFLINE if the socket dropped
  connect();
}

token ? start() : logout();
