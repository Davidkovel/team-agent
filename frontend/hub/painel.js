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

// One window of somebody's plan in their row: how much is used, and on hover how much is left and when it starts again.
function panelLimit(label, pct, reset, week) {
  if (pct == null) return `<span class="pl none" title="${t("O computador desta pessoa ainda não disse.")}"><em>${esc(t(label))}</em><i></i><b>—</b></span>`;
  const when = reset ? ` · ${t("renova")} ${week ? `${panelDay(reset)} ` : ""}${t("às")} ${panelClock(reset)}` : "";
  return `<span class="pl ${panelTone(pct)}" title="${t("Restam")} ${100 - pct}%${when}"><em>${esc(t(label))}</em><i><u style="width:${Math.min(100, Math.max(2, pct))}%"></u></i><b>${pct}%</b></span>`;
}

function panelMate(m, lim) {
  const [label, tone] = PANEL_STATUS[m.status] || PANEL_STATUS.ONLINE;
  const line = m.status === "OFFLINE" ? (m.last_seen ? `${t("visto")} ${fmt.ago(m.last_seen)}` : t("Offline")) : m.task ? `${t(label)}: ${m.task}` : t(label);
  return `<div class="pmate ${tone}"><span class="pmate-av">${ui.avatar(m.display_name, "sm")}<i></i></span>
    <div><b>${esc(m.display_name)}</b><span title="${esc(line)}">${esc(line)}</span></div>
    <div class="pmate-lim">${panelLimit("5 horas", lim?.five, lim?.five_reset)}${panelLimit("Semana", lim?.week, lim?.week_reset, true)}${panelLimit("Higgsfield", m.higgsfield_pct)}</div></div>`;
}

async function drawPanel() {
  if (!panelOpen() || !me?.username || panelHiggs) return;
  const [limits, team, board] = await Promise.all([api("/api/limits").catch(() => null), api("/api/team"), api("/api/ponto").catch(() => null)]);
  const version = await fetch("/api/version", { cache: "no-store" }).then((r) => r.json()).catch(() => null);
  const teamLimits = await api("/api/limits/team").catch(() => ({}));
  const clock = board?.people.find((p) => p.user === me.username);
  const mine = team.find((m) => m.user === me.username) || {}, plan = limits?.claude;
  const claude = plan
    ? panelMeter("Sessão de 5 horas", plan.five, plan.five == null ? t("Sem sessão aberta agora.") : plan.five_reset ? `${t("Renova às")} ${panelClock(plan.five_reset)}` : "")
      + panelMeter("Semana", plan.week, plan.week_reset ? `${t("Renova")} ${panelDay(plan.week_reset)} ${t("às")} ${panelClock(plan.week_reset)}` : "")
    : `<p class="pnote">${t("Sem leitura recente dos limites do Claude neste computador. O widget lê-os de poucos em poucos minutos.")}</p>`
      + panelMeter("Semana (custo no Hub)", mine.week_pct, mine.week_pct == null ? "" : `$${mine.week_cost_usd} ${t("de")} $${mine.week_budget_usd}`);
  const higgs = mine.higgsfield_pct;
  $("hpanel-body").innerHTML = `
    ${clock ? `<section><h4>${icon("clock")}${t("Ponto")}<em>${t(clock.running ? "a contar" : clock.at ? "parado" : "por bater")}</em></h4>
      <div class="pclock ${clock.running ? "on" : ""}"><b>${pontoWorked(clock)}</b>
        <button class="btn sm ${clock.running ? "" : "primary"}" id="hpanel-ponto" data-stop="${clock.running ? 1 : ""}">${t(clock.running ? "Parar" : clock.at ? "Retomar" : "Bater o ponto")}</button></div>
      <small class="pclock-n">${clock.at ? `${t("Primeira entrada às")} ${time(clock.at)}` : t("Começa a contar quando bateres o ponto.")}</small></section>` : ""}
    <section><h4>${icon("spark")}Claude</h4>${claude}</section>
    <section><h4>${icon("videos")}Higgsfield</h4>${panelMeter("Créditos usados", higgs, higgs == null ? t("Por definir: arrasta para dizer quanto já gastaste.") : "")}
      <input id="hpanel-higgs" type="range" min="0" max="100" value="${higgs ?? 0}" aria-label="Higgsfield"></section>
    <section><h4>${icon("users")}${t("Equipa")}<em>${team.filter((m) => m.status !== "OFFLINE").length} ${t("de")} ${team.length} online</em></h4>
      <div class="pmates">${team.map((m) => panelMate(m, teamLimits[m.user])).join("")}</div>
      <small class="pclock-n">${t("Claude usado por cada um. Passa o rato para ver quanto resta.")}</small></section>
    ${version?.head ? `<p class="pver" title="${esc(version.subject || "")}"><span>${t("Versão")} <b>${esc(version.head.split("-")[0])}</b>${version.when ? ` · ${fmt.ago(version.when)}` : ""}</span>
      ${version.subject ? `<em>${esc(version.subject)}</em>` : ""}<small>${t("Atualiza-se sozinho quando alguém faz push.")}</small></p>` : ""}`;
  if ($("hpanel-ponto")) $("hpanel-ponto").onclick = async (e) => {
    const stop = !!e.currentTarget.dataset.stop;
    await api(stop ? "/api/ponto/stop" : "/api/ponto", { method: "POST" });
    flash(t(stop ? "Ponto parado: as horas deixaram de contar." : "Ponto a contar."));
    drawPanel().catch(() => {});
  };
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
    setPanel(localStorage.getItem(PANEL_KEY) !== "closed" || new URLSearchParams(location.search).has("painel")); // open until somebody closes it; ?painel=1 opens it again
  }, 400);
});
