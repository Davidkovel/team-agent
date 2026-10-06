// The side panel: what the desktop widget shows (the Claude limits, Higgsfield, who is here), inside the Hub.
// It opens and closes from the sidebar; the Hub remembers which. On the phone it does not exist.
const PANEL_KEY = "hub.panel";
const PANEL_STATUS = { WORKING: ["A trabalhar", "busy"], ONLINE: ["Online", "ok"], IDLE: ["Livre", "ok"], WAITING: ["À espera", "warn"],
  PAUSED: ["Em pausa", "warn"], ERROR: ["Erro", "bad"], OFFLINE: ["Offline", "off"] };
let panelTimer = null, panelHiggs = false; // panelHiggs: the slider is being dragged, so a redraw must not take it away

const panelOpen = () => $("app").classList.contains("paneled");
const panelTone = (pct) => (pct >= 90 ? "bad" : pct >= 70 ? "warn" : "");
const panelClock = (epoch) => new Date(epoch * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const panelDay = (epoch) => new Date(epoch * 1000).toLocaleDateString("pt-PT", { weekday: "long" });

function panelMeter(label, pct, note) {
  const known = pct != null;
  return `<div class="pm ${known ? panelTone(pct) : "none"}"><div class="pm-top"><span>${esc(t(label))}</span><b>${known ? `${Math.round(pct)}%` : "—"}</b></div>
    <div class="pm-bar"><i style="width:${known ? Math.min(100, Math.max(2, pct)) : 0}%"></i></div>${note ? `<small>${esc(note)}</small>` : ""}</div>`;
}

function panelMate(m) {
  const [label, tone] = PANEL_STATUS[m.status] || PANEL_STATUS.ONLINE;
  const line = m.status === "OFFLINE" ? (m.last_seen ? `${t("visto")} ${fmt.ago(m.last_seen)}` : t("Offline")) : m.task ? `${t(label)}: ${m.task}` : t(label);
  const small = (name, pct) => `<span class="pmate-n ${pct == null ? "none" : panelTone(pct)}" title="${esc(name)}">${esc(name)} <b>${pct == null ? "—" : `${pct}%`}</b></span>`;
  return `<div class="pmate ${tone}"><span class="pmate-av">${ui.avatar(m.display_name, "sm")}<i></i></span>
    <div><b>${esc(m.display_name)}</b><span title="${esc(line)}">${esc(line)}</span></div>
    <div class="pmate-nums">${small("Claude", m.week_pct)}${small("Higgsfield", m.higgsfield_pct)}</div></div>`;
}

async function drawPanel() {
  if (!panelOpen() || !me?.username || panelHiggs) return;
  const [limits, team] = await Promise.all([api("/api/limits").catch(() => null), api("/api/team")]);
  const mine = team.find((m) => m.user === me.username) || {}, plan = limits?.claude;
  const claude = plan
    ? panelMeter("Sessão de 5 horas", plan.five, plan.five == null ? t("Sem sessão aberta agora.") : plan.five_reset ? `${t("Renova às")} ${panelClock(plan.five_reset)}` : "")
      + panelMeter("Semana", plan.week, plan.week_reset ? `${t("Renova")} ${panelDay(plan.week_reset)} ${t("às")} ${panelClock(plan.week_reset)}` : "")
    : `<p class="pnote">${t("Sem leitura recente dos limites do Claude neste computador. O widget lê-os de poucos em poucos minutos.")}</p>`
      + panelMeter("Semana (custo no Hub)", mine.week_pct, mine.week_pct == null ? "" : `$${mine.week_cost_usd} ${t("de")} $${mine.week_budget_usd}`);
  const higgs = mine.higgsfield_pct;
  $("hpanel-body").innerHTML = `
    <section><h4>${icon("spark")}Claude</h4>${claude}</section>
    <section><h4>${icon("videos")}Higgsfield</h4>${panelMeter("Créditos usados", higgs, higgs == null ? t("Por definir: arrasta para dizer quanto já gastaste.") : "")}
      <input id="hpanel-higgs" type="range" min="0" max="100" value="${higgs ?? 0}" aria-label="Higgsfield"></section>
    <section><h4>${icon("users")}${t("Equipa")}<em>${team.filter((m) => m.status !== "OFFLINE").length} ${t("de")} ${team.length} online</em></h4>
      <div class="pmates">${team.map(panelMate).join("")}</div></section>`;
  const range = $("hpanel-higgs");
  range.oninput = () => { panelHiggs = true; range.previousElementSibling.querySelector("b").textContent = `${range.value}%`; };
  range.onchange = async () => {
    try { await api("/api/meters/higgsfield", { method: "PUT", body: { pct: Number(range.value) } }); flash(t("Guardado.")); }
    finally { panelHiggs = false; drawPanel().catch(() => {}); }
  };
}

function setPanel(open) {
  $("app").classList.toggle("paneled", open);
  localStorage.setItem(PANEL_KEY, open ? "open" : "closed");
  $("panel-toggle").classList.toggle("on", open);
  clearInterval(panelTimer);
  if (open) { drawPanel().catch(() => {}); panelTimer = setInterval(() => drawPanel().catch(() => {}), 20000); }
}

window.addEventListener("DOMContentLoaded", function startPanel() { // app.js, with $ and icon, loads after this file
  $("panel-toggle").innerHTML = icon("sliders");
  $("hpanel-close").innerHTML = icon("x");
  $("panel-toggle").onclick = () => setPanel(!panelOpen());
  $("hpanel-close").onclick = () => setPanel(false);
  if (document.documentElement.classList.contains("is-phone")) return;
  const wait = setInterval(() => { // the panel needs to know who is signed in, and that happens after this file loads
    if (!me?.username) return;
    clearInterval(wait);
    setPanel(localStorage.getItem(PANEL_KEY) === "open" || new URLSearchParams(location.search).has("painel")); // ?painel=1 opens it, to show somebody
  }, 400);
});
