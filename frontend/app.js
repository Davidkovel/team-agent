// Team Dashboard: REST for data, WebSocket events as "something changed" hints.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const time = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");

let token = sessionStorage.getItem("token");
let me = null;
let openTask = null;

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
  sessionStorage.removeItem("token");
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
  sessionStorage.setItem("token", token);
  start();
};
$("logout").onclick = logout;

$("agent-token").onclick = async () => {
  const { agent_token } = await api(`/api/users/${me.username}/agent-token`, { method: "POST" });
  $("token-box").hidden = false;
  $("token-box").innerHTML = `Agent token for <b>${esc(me.username)}</b> (shown once, replaces the previous one). Put it in the agent's <code>.env</code> as TEAM_AGENT_TOKEN:<br><code>${esc(agent_token)}</code>`;
};

async function loadTeam() {
  const team = await api("/api/team");
  $("team").innerHTML = team.map((m) => `
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

async function loadTasks() {
  const tasks = await api("/api/tasks");
  $("tasks").innerHTML = "<tr><th>#</th><th>Title</th><th>Assignee</th><th>Status</th><th>Progress</th><th>Last action</th><th></th></tr>" +
    tasks.map((t) => `
      <tr class="clickable" data-id="${t.id}">
        <td>${t.id}</td><td>${esc(t.title)}</td><td>${esc(t.assignee)}</td><td>${esc(t.status)}</td>
        <td>${t.progress}%</td><td>${esc(t.last_action)}</td>
        <td>${["IN_PROGRESS", "WAITING_APPROVAL"].includes(t.status) ? `<button class="ghost" data-act="pause" data-id="${t.id}">Pause</button>` : ""}
            ${["PAUSED", "NEEDS_HELP"].includes(t.status) ? `<button class="ghost" data-act="resume" data-id="${t.id}">Resume</button>` : ""}
            ${["IN_PROGRESS", "WAITING_APPROVAL", "PAUSED", "NEEDS_HELP"].includes(t.status) ? `<button class="danger" data-act="stop" data-id="${t.id}">Stop</button>` : ""}</td>
      </tr>`).join("");
  if (openTask) showTask(openTask);
}

$("tasks").onclick = async (e) => {
  const act = e.target.dataset.act;
  if (act) {
    await api(`/api/tasks/${e.target.dataset.id}/control`, { method: "POST", body: { action: act } });
    return;
  }
  const row = e.target.closest("tr[data-id]");
  if (row) showTask(Number(row.dataset.id));
};

async function showTask(id) {
  openTask = id;
  const t = await api(`/api/tasks/${id}`);
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
}

async function loadApprovals() {
  const pending = (await api("/api/approvals")).filter((a) => a.status === "PENDING");
  $("approvals").innerHTML = pending.length ? pending.map((a) => `
    <div class="card approval">
      <span>🟡 <b>${esc(a.user)}</b>'s agent is waiting for approval: <b>${esc(a.action)}</b>
        ${a.task_id ? `(TASK-${a.task_id})` : ""}<br><span class="muted">${esc(a.detail)}</span></span>
      ${me.role === "owner"
        ? `<button data-ap="${a.id}" data-ok="1">Approve</button><button class="danger" data-ap="${a.id}">Reject</button>`
        : '<span class="muted">Waiting for owner</span>'}
    </div>`).join("") : '<p class="muted">No pending approvals.</p>';
}

$("approvals").onclick = async (e) => {
  if (!e.target.dataset.ap) return;
  await api(`/api/approvals/${e.target.dataset.ap}/decide`, { method: "POST", body: { approve: !!e.target.dataset.ok } });
};

async function loadActivity() {
  const items = await api("/api/activity");
  $("activity").innerHTML = items.map((a) => `<li><span class="muted">${time(a.created_at)}</span> ${esc(a.message)}</li>`).join("");
}

async function loadUsage() {
  const rows = await api("/api/usage");
  $("usage").innerHTML = "<tr><th>User</th><th>Runs</th><th>Input</th><th>Output</th><th>Cache read</th><th>Est. cost</th></tr>" +
    rows.map((u) => `<tr><td>${esc(u.user)}</td><td>${u.runs}</td><td>${u.input_tokens}</td><td>${u.output_tokens}</td><td>${u.cache_read_tokens}</td><td>$${u.cost_usd.toFixed(4)}</td></tr>`).join("");
}

$("task-form").onsubmit = async (e) => {
  e.preventDefault();
  await api("/api/tasks", { method: "POST", body: {
    title: $("t-title").value, goal: $("t-goal").value, project: $("t-project").value,
    description: $("t-description").value, assignee: $("t-assignee").value,
    requirements: $("t-requirements").value.split("\n").map((s) => s.trim()).filter(Boolean),
  } });
  e.target.reset();
};

const loaders = { presence: [loadTeam], task: [loadTasks], approval: [loadApprovals], activity: [loadActivity], usage: [loadUsage] };
const pending = new Set();
function refresh(type) {
  // Heartbeats arrive every few seconds; coalesce bursts into one fetch per kind.
  if (pending.has(type)) return;
  pending.add(type);
  setTimeout(() => { pending.delete(type); (loaders[type] || []).forEach((fn) => fn().catch(() => {})); }, 300);
}

function connect() {
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?token=${token}`);
  ws.onopen = () => { $("live").textContent = "live"; };
  ws.onmessage = (e) => refresh(JSON.parse(e.data).type);
  ws.onclose = () => { $("live").textContent = "reconnecting"; if (token) setTimeout(connect, 3000); };
}

async function start() {
  try { me = await api("/api/me"); } catch { return; }
  $("login").hidden = true;
  $("app").hidden = false;
  $("whoami").textContent = `${me.display_name} (${me.role})`;
  const users = await api("/api/users");
  $("t-assignee").innerHTML = users.filter((u) => me.role === "owner" || u.username === me.username)
    .map((u) => `<option value="${esc(u.username)}">${esc(u.display_name)}</option>`).join("");
  const linked = location.hash.match(/^#task-(\d+)$/); // "Open Task" from the widget
  if (linked) openTask = Number(linked[1]);
  Object.keys(loaders).forEach(refresh);
  setInterval(loadTeam, 15000); // catches OFFLINE even if the socket dropped
  connect();
}

token ? start() : logout();
