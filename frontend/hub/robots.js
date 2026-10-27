// Escritório de Robôs (#/robos, a tab of the Sala de Trading): the room's traders as robots at desks in an isometric
// office, in the Hub's black-and-chrome finish. Each robot is a strategy of the room's book on its instruments (the SMC
// model per instrument, the Pinguim, the Duas-Caras); with no account it trades on paper, with one it can send the trades to
// the team's FundedNext account by API (backend/app/tradingroom/robots.py). Click a robot: its day, curve, drawdown, trades
// and settings. «Contas» connects the accounts (MT5 API on this PC or MetaApi) and shows the prop firm's limits.
// Robots out of hours, or off, go to the lounge. The canvas only draws while the page is open, at ~20 frames a second.
(function () {
  const UP = "#5fcf8c", DOWN = "#ef6f5e", AI = "#8fb4ff", CHROME = "#e8ebef", INK = "#07080a";
  const STATE_PT = { trade: "Em operação", wait: "Ordem à espera", watch: "A vigiar o mercado", rest: "Descanso (fora de horas)", off: "Desligado" };
  const SES = ["Ásia", "Londres", "Pré-NY", "Nova Iorque", "Tarde NY"];
  const COLS = 16, ROWS = 11;
  // desk slots: pods of four (two facing two), the lounge on the right
  const PODS = [[1.8, 2.4], [7.6, 2.4], [1.8, 7.2], [7.6, 7.2], [12.4, 2.4]];
  const SLOTS = PODS.flatMap(([x, y]) => [[x, y], [x + 2.5, y], [x, y + 2.9], [x + 2.5, y + 2.9]]);
  // only the pods with robots, plus the free desks in them (one more pod when they are all taken: room to move)
  const podsUsed = () => { const top = Math.max(0, ...S.robots.map((r) => r.seat)); const n = Math.floor(top / 4) + 1; return Math.min(PODS.length, n + (S.robots.length >= n * 4 ? 1 : 0)); };
  const LOUNGE = [[12.4, 6.6], [13.6, 6.6], [12.4, 9.4], [13.6, 9.4], [11.6, 8], [14.8, 8], [13, 10.4], [11.8, 10.2]];

  let S = null, sel = null, tab = "pnl", placing = false, hover = null, raf = 0, last = 0, timer = 0, sheet = null, editAcc = null, confirmAuto = null;
  let cam = { z: 1, x: 0, y: 0 }, drag = null, hits = [], slotHits = [];
  const money = (v, cur) => (v == null ? "—" : `${v < 0 ? "−" : ""}${cur === "EUR" ? "€" : "$"}${Math.abs(v).toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  const signed = (v, cur) => (v == null ? "—" : `${v > 0 ? "+" : ""}${money(v, cur)}`);
  const cls = (v) => (v > 0 ? "up" : v < 0 ? "down" : "");
  const hm = (ts) => new Date(ts * 1000).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
  const svg = (p, c = "") => `<svg class="i ${c}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  const IC = {
    bot: '<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9 16.5h6"/>',
    plug: '<path d="M9 7V3M15 7V3M7 7h10v4a5 5 0 01-10 0zM12 16v5"/>',
    tune: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>', move: '<path d="M12 3v18M3 12h18M7 7l-4 5 4 5M17 7l4 5-4 5"/>',
    paint: '<circle cx="12" cy="12" r="8"/><circle cx="9" cy="9.5" r="1"/><circle cx="14.5" cy="8.5" r="1"/><circle cx="16" cy="13" r="1"/>',
    shield: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/>', stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    calc: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h2M12 12h2M16 12h0M8 16h2M12 16h2"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>', plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>', fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  };

  // ================================================================ the page
  HUB_VIEWS.robos = async function () {
    // the standard anatomy (docs/hub-paginas.md): the head with the accounts' state as the chip, the day's figures,
    // then the accounts, the office and the tuning and log
    const sec = (title, hint = "", id = "") => `<div class="sec"><span>${esc(t(title))}</span>${hint || id ? `<small class="rb-sr"${id ? ` id="${id}"` : ""}>${hint}</small>` : ""}</div>`;
    page(`<div class="rb" id="rb">
      ${ui.head("Trading", t("Robôs"), t("Cada robô é uma estratégia da sala nos seus instrumentos: negoceia em papel ou, com a conta ligada, na FundedNext."),
        `<span id="rb-state"></span>
        <button type="button" class="btn quiet" id="rb-tune">${svg(IC.tune)}${esc(t("Afinação"))}</button>
        <button type="button" class="btn primary" id="rb-accs">${svg(IC.plug)}${esc(t("Contas"))}</button>`)}
      <div class="bd-kpis rb-kpis" id="rb-kpis"></div>
      ${sec("Contas", esc(t("a prop vê cada ordem como se fosse tua · a guarda da prop pára os robôs antes dos limites")))}
      <div class="rb-accline" id="rb-accline"></div>
      ${sec("Escritório", esc(t("toca num robô para ver o dia dele e mudar as definições · arrasta para mexer a sala")))}
      <section class="rb-stage" id="rb-stage">
        <canvas id="rb-cv"></canvas>
        <div class="rb-tape" id="rb-tape"></div>
        <div class="rb-zoom"><button type="button" data-z="1" title="${esc(t("Aproximar"))}">${svg(IC.plus)}</button><button type="button" data-z="-1" title="${esc(t("Afastar"))}">${svg(IC.minus)}</button><button type="button" data-z="0" title="${esc(t("Ver tudo"))}">${svg(IC.fit)}</button></div>
        <div class="rb-place" id="rb-place" hidden></div>
        <aside class="rb-side" id="rb-side" hidden></aside>
      </section>
      <div class="rb-low">
        <div id="rb-tuning">${sec("Afinação dos setups", "", "rb-tune-src")}<section class="panel pad rb-card"><div id="rb-tune-body" class="rb-none">${esc(t("A ler as trades…"))}</div></section></div>
        <div id="rb-logbox">${sec("Diário dos robôs", esc(t("o que fazem nas contas")))}<section class="panel pad rb-card"><div id="rb-log"></div></section></div>
      </div>
      <div class="rb-sheet" id="rb-sheet" hidden></div>
    </div>`);
    bind();
    await load();
    loadTuning();
    clearInterval(timer);
    timer = setInterval(() => { if (!$("rb")) { clearInterval(timer); return; } if (!document.hidden) load().catch(() => {}); }, 15000);
    start();
  };
  onLive(["trading"], async () => { if ($("rb")) await load().catch(() => {}); });

  async function load() {
    S = await api("/api/robots");
    if (sel && !S.robots.find((r) => r.id === sel)) sel = null;
    paintHead(); paintTape(); paintSide(); paintLog();
    if (sheet) paintSheet();
  }
  async function loadTuning() {
    try { paintTuning(await api("/api/robots/tuning")); } catch (e) { $("rb-tune-body").textContent = e.message; }
  }
  const robot = (id) => S && S.robots.find((r) => r.id === id);
  const account = (id) => S && S.accounts.find((a) => a.id === id);
  async function saveRobot(id, body) {
    try { S = await api(`/api/robots/robot/${encodeURIComponent(id)}`, { method: "POST", body }); } catch (e) { flash(e.message); }
    paintHead(); paintSide();
  }
  function flash(text) {
    const el = $("rb-place");
    if (!el) return;
    el.hidden = false; el.className = "rb-place msg"; el.textContent = text;
    clearTimeout(flash.t); flash.t = setTimeout(() => { if (!placing) el.hidden = true; }, 4200);
  }

  // ---------------------------------------------------------------- head, tape, accounts line
  function paintHead() {
    const T = S.totals, cur = T.currency;
    // the state beside the actions: paper, an account only watched, or orders going to the account
    const auto = S.accounts.some((a) => a.mode === "auto"), live = S.accounts.some((a) => a.snap && a.snap.ok);
    paint($("rb-state"), !S.accounts.length ? `<span class="st off"><i></i>${esc(t("Em papel · sem conta"))}</span>`
      : auto ? `<span class="st ok"><i></i>${esc(t("Automático: envia ordens"))}</span>`
      : `<span class="st ${live ? "ok" : "wait"}"><i></i>${esc(live ? t("Conta a observar") : t("Conta sem ligação"))}</span>`);
    // the Painel's figures (hub/painel.css): today's result lit, each robot's day in small columns, the share that won
    const wins = S.robots.reduce((n, r) => n + (r.wins || 0), 0), losses = S.robots.reduce((n, r) => n + (r.losses || 0), 0);
    // the day of all the robots as one line: each robot's curve is its own running total, so join the steps in time
    const steps = S.robots.flatMap((r) => (r.curve || []).map((pt, i, c) => [pt[0], pt[1] - (i ? c[i - 1][1] : 0)])).sort((p, q) => p[0] - q[0]);
    let run = 0; const dayLine = [0, ...steps.map((x) => (run += x[1]))];
    const dayChip = T.day ? `<span class="pn-delta ${T.day > 0 ? "up" : "dn"}">${esc(T.day > 0 ? t("a ganhar") : t("a perder"))}</span>` : "";
    paint($("rb-kpis"), [
      ui.kpi({ label: "Resultado hoje", value: `<span class="${cls(T.day)}">${signed(T.day, cur)}</span>`, delta: dayChip,
        viz: steps.length ? ui.spark(dayLine) : "", sub: T.paper ? t("Em papel, a 100 000 $ por robô") : t("todos os robôs") }),
      ui.kpi({ label: T.paper ? "Saldo da conta" : "Saldo total", value: T.paper ? null : money(T.balance, cur), sub: T.paper ? t("Sem conta ligada: os robôs negoceiam em papel.") : "" }),
      ui.kpi({ label: "Operações hoje", value: String(T.ops), sub: t("{n} robôs com trades abertas", { n: S.robots.filter((r) => r.open).length }) }),
      ui.kpi({ label: "Robôs a operar", value: `${T.working}<small>/${T.on}</small>`, viz: ui.ring(T.on ? (T.working / T.on) * 100 : null), sub: t("{n} ligados de {m}", { n: T.on, m: T.n }) }),
      ui.kpi({ label: "Acerto hoje", value: wins + losses ? `${Math.round((wins / (wins + losses)) * 100)}%` : null, viz: wins + losses ? ui.ring((wins / (wins + losses)) * 100, { text: String(wins + losses) }) : "",
        sub: wins + losses ? t("{w} ganhas · {l} perdidas", { w: wins, l: losses }) : t("Ainda sem trades fechadas hoje") }),
    ].map((h) => h.replace('class="panel pn-kpi', 'class="panel pn-kpi rb-kpi')).join(""));
    paint($("rb-accline"), S.accounts.length ? S.accounts.map((a) => {
      const ok = a.snap && a.snap.ok, g = a.guard || {};
      return `<button type="button" class="panel rb-acc ${ok ? "ok" : "bad"} ${a.mode === "auto" ? "auto" : ""}" data-acc="${esc(a.id)}">
        <i></i><b>${esc(a.name)}</b><span>${ok ? `${money(a.snap.equity, a.snap.currency)} · ${t("hoje")} <em class="${cls(g.day_pnl)}">${signed(g.day_pnl, a.snap.currency)}</em>` : esc(t("sem ligação"))}</span>
        <u>${a.mode === "auto" ? esc(t("AUTOMÁTICO")) : esc(t("a observar"))}</u>
        ${ok && g.ok ? `<span class="rb-gauge" title="${esc(t("Perda diária usada"))}"><span style="width:${Math.min(100, g.daily_pct)}%"></span></span>` : ""}</button>`;
    }).join("") : `<div class="panel rb-acc-empty">${svg(IC.plug)}<div><b>${esc(t("Nenhuma conta ligada"))}</b><span>${esc(t("Liga a conta FundedNext pela API do MetaTrader 5 neste PC (o teu IP) ou pela MetaApi. Até lá os robôs negoceiam em papel."))}</span></div>
      <button type="button" class="btn" data-acc="">${svg(IC.plus)}${esc(t("Ligar a conta"))}</button></div>`);
  }
  function paintTape() {
    paint($("rb-tape"), (S.tape || []).map((s) => `<div class="rb-tk"><b>${esc(s.id)}</b><span>${Number(s.price).toLocaleString("pt-PT", { minimumFractionDigits: s.dp, maximumFractionDigits: s.dp })}</span><em class="${cls(s.chg)}">${s.chg == null ? "" : `${s.chg >= 0 ? "+" : ""}${s.chg.toFixed(2).replace(".", ",")}%`}</em></div>`).join(""));
  }
  function paintLog() {
    const rows = (S.log || []).slice(0, 18);
    paint($("rb-log"), rows.length ? rows.map((l) => `<div class="rb-log ${esc(l.kind)}"><time>${hm(l.t)}</time><span>${esc(l.text)}</span></div>`).join("")
      : `<p class="rb-none">${esc(t("Ainda nada. Aqui fica o que os robôs fazem nas contas: ordens enviadas, recusadas, fechos de fim de dia e o guarda da prop."))}</p>`);
  }

  // ---------------------------------------------------------------- the robot's panel (right)
  function paintSide() {
    const el = $("rb-side");
    const r = sel && robot(sel);
    if (!r) { el.hidden = true; el._html = ""; return; }
    el.hidden = false;
    const cur = S.totals.currency, accs = S.accounts;
    const day = r.day_pnl + r.live_pnl;
    paint(el, `<div class="rb-sh">
        <div><small style="color:${esc(r.look)}">● ${esc(r.squad)}</small><h3>${esc(r.name)}</h3>
        <p>${esc(r.mode === "papel" ? t("Conta papel") : `${r.account_name} · ${r.mode === "auto" ? t("automático") : t("a observar")}`)} · <b class="st-${r.state}">${esc(t(STATE_PT[r.state]))}</b></p></div>
        <button type="button" class="rb-x" data-act="close" title="${esc(t("Fechar"))}">${svg(IC.x)}</button></div>
      <div class="rb-two"><div><small>${esc(r.real ? t("Equity da conta") : t("Conta papel"))}</small><b>${money(r.equity, cur)}</b></div>
        <div><small>${esc(t("Resultado hoje"))}</small><b class="${cls(day)}">${signed(day, cur)}</b></div></div>
      <div class="rb-btns"><button type="button" class="btn" data-act="move">${svg(IC.move)}${esc(t("Mudar de lugar"))}</button>
        <button type="button" class="btn" data-act="look">${svg(IC.paint)}${esc(t("Personalizar"))}</button></div>
      <div class="rb-look" id="rb-look" hidden>
        <label>${esc(t("Nome"))}<input id="rb-name" value="${esc(r.name)}" maxlength="24"></label>
        <label>${esc(t("Equipa"))}<input id="rb-squad" value="${esc(r.squad)}" maxlength="24"></label>
        <div class="rb-swatches">${["#d9dde3", "#8fb4ff", "#5fcf8c", "#e2b55c", "#c49bff", "#5fd3d3", "#ef8f6e", "#f2f4f7"].map((c) => `<button type="button" data-look="${c}" style="--c:${c}" class="${c === r.look ? "on" : ""}"></button>`).join("")}</div>
        <button type="button" class="btn primary" data-act="savelook">${esc(t("Guardar"))}</button></div>
      <div class="rb-tabs"><button type="button" data-tab="pnl" class="${tab === "pnl" ? "on" : ""}">${esc(t("Resultado"))}</button><button type="button" data-tab="dd" class="${tab === "dd" ? "on" : ""}">${esc(t("Drawdown"))}</button></div>
      <div class="rb-chart"><small>${esc(tab === "pnl" ? t("Realizado hoje") : t("Maior queda hoje"))}</small><b class="${tab === "pnl" ? cls(r.day_pnl) : r.dd ? "down" : ""}">${tab === "pnl" ? signed(r.day_pnl, cur) : r.dd ? `−${money(r.dd, cur)}` : money(0, cur)}</b>
        <canvas id="rb-curve" height="120"></canvas></div>
      <div class="rb-three"><div><small>${esc(t("Melhor"))}</small><b class="${cls(r.best)}">${r.best == null ? "—" : signed(r.best, cur)}</b></div>
        <div><small>${esc(t("Pior"))}</small><b class="${cls(r.worst)}">${r.worst == null ? "—" : signed(r.worst, cur)}</b></div>
        <div><small>${esc(t("Operações"))}</small><b>${r.ops}</b></div></div>
      <p class="rb-meta">${esc(t("Estratégia"))}: <b>${esc(r.agent_name)}</b> · ${esc(r.symbols.join(", "))} · ${esc(t("histórico"))} ${r.all.n ? `${r.all.n} trades, ${r.all.winrate}% ${esc(t("de acerto"))}, ${r.all.r >= 0 ? "+" : ""}${String(r.all.r).replace(".", ",")}R` : esc(t("ainda sem trades fechadas"))}</p>
      ${r.bt ? `<p class="rb-meta">${esc(t("Backtest"))} (${String(r.bt.days || "—").replace(".", ",")} ${esc(t("dias de M5"))}): ${r.bt.n ? `<b>${r.bt.n} trades, ${r.bt.winrate}% ${esc(t("de acerto"))}, <em class="${r.bt.r >= 0 ? "up" : "down"}">${r.bt.r >= 0 ? "+" : ""}${String(r.bt.r).replace(".", ",")}R</em>${r.bt.pf ? ` · PF ${String(r.bt.pf).replace(".", ",")}` : ""}</b>` : esc(t("nenhum setup A/A+ neste período"))}</p>` : ""}
      ${r.needs_claude ? `<p class="rb-meta">${esc(t("Só negoceia nas reuniões com o Claude ligado (Sala de Trading › Claude). Neste PC está desligado, por isso não tem trades. Para ter histórico já, muda a Estratégia para EMA 125/200, VWAP + EMA ou Combinado."))}</p>` : ""}
      ${r.note ? `<p class="rb-note">${esc(r.note)}</p>` : ""}
      <h4>${esc(t("Últimas trades"))}</h4>
      <div class="rb-trades">${r.last.length ? r.last.map((x) => `<div class="rb-tr"><b class="${x.dir === "buy" ? "up" : "down"}">${x.dir === "buy" ? "▲" : "▼"} ${esc(x.symbol)}</b>
        <span>${esc({ pending: t("à espera"), open: t("aberta"), won: t("ganha"), lost: t("perdida"), be: t("a zero"), expired: t("expirou"), refused: t("recusada"), invalidated: t("invalidada") }[x.status] || x.status)}${x.grade ? ` · ${esc(x.grade)}` : ""}</span>
        <em class="${cls(x.r)}">${x.r == null ? "" : `${x.r > 0 ? "+" : ""}${x.r.toFixed(2).replace(".", ",")}R`}</em>
        ${x.sent ? `<i class="${x.sent.status === "error" ? "down" : ""}" title="${esc(x.sent.error || "")}">${x.sent.status === "error" ? esc(t("conta recusou")) : `${esc(t("na conta"))} ${x.sent.volume ?? ""}`}</i>` : ""}</div>`).join("") : `<p class="rb-none">${esc(t("Sem trades ainda."))}</p>`}</div>
      <h4>${esc(t("Definições do robô"))}</h4>
      <div class="rb-form">
        <label class="rb-switch"><input type="checkbox" data-set="on" ${r.on ? "checked" : ""}><i></i>${esc(t("Ligado"))}</label>
        <label>${esc(t("Conta"))}<select data-set="account"><option value="">${esc(t("Papel (sem conta)"))}</option>${accs.map((a) => `<option value="${esc(a.id)}" ${a.id === r.account ? "selected" : ""}>${esc(a.name)}${a.mode === "auto" ? " · auto" : ""}</option>`).join("")}</select></label>
        <label>${esc(t("Risco por trade (%)"))}<input type="number" step="0.05" min="0.05" max="3" data-set="risk" value="${r.risk}"></label>
        <label>${esc(t("Máx. trades por dia"))}<input type="number" min="1" max="20" data-set="max_day" value="${r.max_day}"></label>
        <label>${esc(t("Das"))}<input type="time" data-set="from" value="${esc(r.from)}"></label>
        <label>${esc(t("Às"))}<input type="time" data-set="to" value="${esc(r.to)}"></label>
        <label>${esc(t("Fecha tudo às"))}<input type="time" data-set="flat" value="${esc(r.flat)}"></label>
        <label>${esc(t("Estratégia"))}<select data-set="agent">${S.agents.map((a) => `<option value="${a.id}" ${a.id === r.agent ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select></label>
      </div>
      <div class="rb-syms">${S.focus.map((s) => `<button type="button" data-sym="${s}" class="${r.symbols.includes(s) ? "on" : ""}">${s}</button>`).join("")}</div>
      <p class="rb-hint">${esc(t("Horas de Lisboa. Day trading: fora do horário o robô não abre nada e, na conta, à hora do fecho cancela as ordens e fecha as posições dele (e sempre antes do fim de semana)."))}</p>
      <a class="btn quiet rb-link" href="#/trading">${esc(t("Ver na Sala de Trading"))} ${svg(IC.arrow)}</a>`);
    drawCurve(r);
  }
  function drawCurve(r) {
    const cv = $("rb-curve");
    if (!cv) return;
    const w = cv.clientWidth || 300, h = 120, k = devicePixelRatio || 1;
    cv.width = w * k; cv.height = h * k;
    const g = cv.getContext("2d");
    g.scale(k, k);
    const pts = (tab === "pnl" ? r.curve : r.dd_curve).slice();
    const day0 = Date.parse(S.day_start) / 1000, now = Date.now() / 1000;
    pts.unshift([day0, 0]);
    if (tab === "pnl") pts.push([now, r.day_pnl]); else pts.push([now, pts[pts.length - 1][1]]);
    const vs = pts.map((p) => p[1]), lo = Math.min(0, ...vs), hi = Math.max(0, ...vs), span = hi - lo || 1;
    const X = (ts) => 4 + (ts - day0) / Math.max(1, now - day0) * (w - 8), Y = (v) => 10 + (1 - (v - lo) / span) * (h - 30);
    g.strokeStyle = "rgba(255,255,255,.08)"; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, Y(0)); g.lineTo(w, Y(0)); g.stroke();
    const up = tab === "pnl" ? r.day_pnl >= 0 : false, col = up ? UP : tab === "dd" ? DOWN : r.day_pnl < 0 ? DOWN : CHROME;
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, col + "55"); grad.addColorStop(1, col + "00");
    g.beginPath();
    pts.forEach((p, i) => { const x = X(p[0]), y = Y(p[1]); if (i) { g.lineTo(x, Y(pts[i - 1][1])); g.lineTo(x, y); } else g.moveTo(x, y); });
    g.strokeStyle = col; g.lineWidth = 2; g.stroke();
    g.lineTo(X(now), Y(0)); g.lineTo(X(day0), Y(0)); g.closePath(); g.fillStyle = grad; g.fill();
    g.fillStyle = "rgba(255,255,255,.35)"; g.font = "10px Inter, system-ui";
    [[day0, "left"], [(day0 + now) / 2, "center"], [now, "right"]].forEach(([ts, al]) => { g.textAlign = al; g.fillText(hm(ts), al === "left" ? 2 : al === "right" ? w - 2 : X(ts), h - 4); });
  }

  // ---------------------------------------------------------------- tuning and the accounts sheet
  function paintTuning(T) {
    $("rb-tune-src").textContent = `${T.source.live} ${t("trades da sala")}${T.source.backtest ? ` · ${T.source.backtest} ${t("do backtest")}` : ""}`;
    const cell = (s, ss) => T.cells.find((c) => c.symbol === s && c.session === ss);
    const focus = (S && S.focus) || ["XAUUSD", "EURUSD", "GBPUSD", "GER40"];
    $("rb-tune-body").innerHTML = `<div class="rb-heat"><div></div>${SES.map((s) => `<div class="rb-hh">${esc(s)}</div>`).join("")}
      ${focus.map((s) => `<div class="rb-hs">${esc(s)}</div>${SES.map((ss) => { const c = cell(s, ss); if (!c) return `<div class="rb-hc none">—</div>`;
        const v = Math.max(-1, Math.min(1, c.avg / .8));
        return `<div class="rb-hc" style="--h:${v > 0 ? `rgba(95,207,140,${.06 + v * .26})` : `rgba(239,111,94,${.06 - v * .26})`}" title="${c.n} trades · ${c.winrate}% · PF ${c.pf ?? "—"}"><b class="${cls(c.avg)}">${c.avg > 0 ? "+" : ""}${String(c.avg).replace(".", ",")}R</b><small>${c.n} · ${c.winrate}%</small></div>`; }).join("")}`).join("")}</div>
      <div class="rb-tips">${T.tips.map((x) => `<p class="${x.kind}">${esc(x.text)}</p>`).join("")}</div>
      ${T.grades.length ? `<div class="rb-grades">${T.grades.map((g) => `<span>${esc(t("Setup"))} <b>${esc(g.grade)}</b> ${g.n} · ${g.winrate}% · <em class="${cls(g.avg)}">${g.avg > 0 ? "+" : ""}${String(g.avg).replace(".", ",")}R</em></span>`).join("")}${T.agents.map((a) => `<span>${esc(a.name)} ${a.n} · ${a.winrate}% · <em class="${cls(a.avg)}">${a.avg > 0 ? "+" : ""}${String(a.avg).replace(".", ",")}R</em></span>`).join("")}</div>` : ""}`;
  }

  function openSheet(kind, accId) { sheet = kind; editAcc = accId ?? null; confirmAuto = null; paintSheet(); }
  function closeSheet() { sheet = null; const el = $("rb-sheet"); el.hidden = true; el._html = ""; el.innerHTML = ""; }
  function paintSheet() {
    const el = $("rb-sheet");
    el.hidden = false;
    if (sheet === "tune") { closeSheet(); $("rb-tuning").scrollIntoView({ behavior: "smooth" }); return; }
    const mt5 = S.mt5 || {};
    const accCards = S.accounts.map((a) => {
      const s = a.snap || {}, g = a.guard || {}, cur = s.currency;
      return `<div class="rb-ac ${a.mode === "auto" ? "auto" : ""}">
        <div class="rb-ac-h"><div><b>${esc(a.name)}</b><small>${esc(a.link_name)} · ${esc(a.preset_name)}${a.login ? ` · ${esc(a.login)}` : ""}${a.server ? ` · ${esc(a.server)}` : ""}</small></div>
          <div class="rb-mode"><button type="button" data-mode="observar" data-id="${esc(a.id)}" class="${a.mode !== "auto" ? "on" : ""}">${esc(t("Observar"))}</button><button type="button" data-mode="auto" data-id="${esc(a.id)}" class="${a.mode === "auto" ? "on auto" : ""}">${esc(t("Automático"))}</button></div></div>
        ${confirmAuto === a.id ? `<div class="rb-warn"><b>${esc(t("Os robôs ligados a esta conta vão enviar ordens reais."))}</b> ${esc(t("Cada ordem leva stop e alvo, o risco de cada robô, o horário de day trading e o guarda da prop (sem ordens novas a"))} ${a.stop_at}% ${esc(t("do limite, fecha tudo a"))} ${a.panic_at}%).
          <div><button type="button" class="btn danger" data-confirm="${esc(a.id)}">${esc(t("Ligar o automático"))}</button><button type="button" class="btn quiet" data-confirm="">${esc(t("Cancelar"))}</button></div></div>` : ""}
        ${s.ok ? `<div class="rb-ac-n"><div><small>${esc(t("Saldo"))}</small><b>${money(s.balance, cur)}</b></div><div><small>${esc(t("Equity"))}</small><b>${money(s.equity, cur)}</b></div>
          <div><small>${esc(t("Hoje"))}</small><b class="${cls(g.day_pnl)}">${signed(g.day_pnl, cur)}</b></div><div><small>${esc(t("Posições"))}</small><b>${(s.positions || []).length}</b></div></div>
          ${g.ok ? `<div class="rb-bars">
            ${bar(t("Perda diária"), g.daily_pct, `${money(g.daily_used, cur)} ${t("de")} ${money(g.daily_limit, cur)} · ${t("chão hoje")} ${money(g.floor_day, cur)}`, a)}
            ${bar(t("Perda máxima"), g.max_pct, `${money(g.max_used, cur)} ${t("de")} ${money(g.max_limit, cur)} · ${t("chão")} ${money(g.floor_max, cur)}`, a)}
            ${g.target ? `<div class="rb-bar goal"><span>${esc(t("Objetivo"))}</span><i><u style="width:${Math.max(0, Math.min(100, g.target_pct || 0))}%"></u></i><small>${signed(g.profit, cur)} ${t("de")} ${money(g.target, cur)}</small></div>` : ""}
          </div>${g.why ? `<p class="rb-note">${esc(g.why)}</p>` : ""}` : ""}`
        : `<p class="rb-note bad">${esc(s.error || t("Ainda sem ligação. Carrega em «Testar ligação»."))}</p>`}
        <div class="rb-ac-b"><button type="button" class="btn" data-test="${esc(a.id)}">${esc(t("Testar ligação"))}</button><button type="button" class="btn" data-edit="${esc(a.id)}">${esc(t("Editar"))}</button>
          <button type="button" class="btn danger" data-flat="${esc(a.id)}" title="${esc(t("Cancela as ordens e fecha as posições dos robôs nesta conta, e volta a Observar"))}">${svg(IC.stop)}${esc(t("Fechar tudo dos robôs"))}</button>
          <button type="button" class="btn quiet" data-del="${esc(a.id)}">${esc(t("Apagar"))}</button></div></div>`;
    }).join("");
    const a0 = editAcc !== null ? account(editAcc) || {} : null;
    const pre = (id) => S.presets.find((p) => p.id === id) || S.presets[0];
    const a = a0 && { ...a0, daily: a0.daily ?? pre(a0.preset || "fn-stellar-2").daily, max: a0.max ?? pre(a0.preset || "fn-stellar-2").max, target: a0.target ?? pre(a0.preset || "fn-stellar-2").target };
    const form = a ? `<form class="rb-af" id="rb-af"><h4>${esc(a.id ? t("Editar conta") : t("Nova conta"))}</h4>
      <div class="rb-form">
        <label>${esc(t("Nome"))}<input name="name" value="${esc(a.name || "FundedNext")}" required></label>
        <label>${esc(t("Ligação"))}<select name="link">${S.links.map((l) => `<option value="${l.id}" ${l.id === (a.link || "mt5") ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select></label>
        <label>${esc(t("Tipo de conta"))}<select name="preset">${S.presets.map((p) => `<option value="${p.id}" ${p.id === (a.preset || "fn-stellar-2") ? "selected" : ""}>${esc(p.name)} (${p.daily}% / ${p.max}%)</option>`).join("")}</select></label>
        <label>${esc(t("Tamanho da conta"))}<input name="size" type="number" step="1" value="${a.size || ""}" placeholder="100000"></label>
        <label data-for="mt5">${esc(t("Login MT5 (número)"))}<input name="login" value="${esc(a.login || "")}" inputmode="numeric"></label>
        <label data-for="mt5">${esc(t("Password"))}<input name="password" type="password" autocomplete="new-password" placeholder="${a.has && a.has.password ? esc(t("guardada — deixa vazio para manter")) : ""}"></label>
        <label data-for="mt5">${esc(t("Servidor"))}<input name="server" value="${esc(a.server || "")}" placeholder="FundedNext-Server"></label>
        <label data-for="mt5">${esc(t("Terminal (opcional)"))}<input name="path" value="${esc(a.path || "")}" placeholder="${esc(mt5.terminal || "C:\\Program Files\\MetaTrader 5\\terminal64.exe")}"></label>
        <label data-for="metaapi">${esc(t("Token da MetaApi"))}<input name="token" type="password" autocomplete="off" placeholder="${a.has && a.has.token ? esc(t("guardado — deixa vazio para manter")) : ""}"></label>
        <label data-for="metaapi">${esc(t("Id da conta na MetaApi"))}<input name="account_id" value="${esc(a.account_id || "")}"></label>
        <label data-for="metaapi">${esc(t("Região"))}<select name="region">${["london", "new-york", "singapore", "vint-hill"].map((x) => `<option ${x === (a.region || "london") ? "selected" : ""}>${x}</option>`).join("")}</select></label>
        <label>${esc(t("Perda diária (%)"))}<input name="daily" type="number" step="0.1" value="${a.daily ?? ""}"></label>
        <label>${esc(t("Perda máxima (%)"))}<input name="max" type="number" step="0.1" value="${a.max ?? ""}"></label>
        <label>${esc(t("Objetivo (%)"))}<input name="target" type="number" step="0.1" value="${a.target ?? ""}"></label>
        <label>${esc(t("Sem ordens novas a (% do limite)"))}<input name="stop_at" type="number" value="${a.stop_at ?? 70}"></label>
        <label>${esc(t("Fecha tudo a (% do limite)"))}<input name="panic_at" type="number" value="${a.panic_at ?? 90}"></label>
        ${S.focus.map((s) => `<label>${esc(t("Nome na corretora:"))} ${s}<input name="sym_${s}" value="${esc((a.symbols || {})[s] || "")}" placeholder="${esc(t("automático"))}"></label>`).join("")}
      </div>
      <p class="rb-hint">${esc(t("A password e o token ficam só neste PC, cifrados para o teu utilizador do Windows (nunca na base de dados nem no sync). A API do MetaTrader 5 entra com o IP deste PC, como tu; a MetaApi entra dos servidores dela. A conta começa em «Observar»: nada é enviado até ligares o automático."))}</p>
      <div class="rb-ac-b"><button type="submit" class="btn primary">${esc(t("Guardar e ligar"))}</button><button type="button" class="btn quiet" data-cancel="1">${esc(t("Cancelar"))}</button></div></form>` : "";
    const calc = S.accounts.length ? `<div class="rb-calc"><h4>${svg(IC.calc)}${esc(t("Calculadora de lote"))}</h4><div class="rb-form">
      <label>${esc(t("Conta"))}<select id="rb-c-acc">${S.accounts.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join("")}</select></label>
      <label>${esc(t("Símbolo"))}<select id="rb-c-sym">${S.focus.map((s) => `<option>${s}</option>`).join("")}</select></label>
      <label>${esc(t("Entrada"))}<input id="rb-c-e" type="number" step="any"></label><label>${esc(t("Stop"))}<input id="rb-c-s" type="number" step="any"></label>
      <label>${esc(t("Risco (%)"))}<input id="rb-c-r" type="number" step="0.05" value="0.5"></label>
      <button type="button" class="btn" id="rb-c-go">${esc(t("Calcular"))}</button></div><p id="rb-c-out" class="rb-hint"></p></div>` : "";
    paint(el, `<div class="rb-sheet-in"><div class="rb-sh"><div><small>${esc(t("Contas de trading"))}</small><h3>${esc(t("Contas e regras da prop"))}</h3>
      <p>${esc(t("MetaTrader 5 neste PC"))}: <b class="${mt5.terminal ? "up" : "down"}">${esc(mt5.terminal ? t("instalado") : t("não encontrado"))}</b>${mt5.package ? "" : ` · ${esc(t("falta o pacote Python MetaTrader5"))}`}</p></div>
      <button type="button" class="rb-x" data-sheet-close="1">${svg(IC.x)}</button></div>
      ${accCards || `<p class="rb-none">${esc(t("Nenhuma conta ainda."))}</p>`}
      ${form || `<button type="button" class="btn" data-edit="">${svg(IC.plus)}${esc(t("Juntar conta"))}</button>`}
      ${calc}</div>`);
    const f = $("rb-af");
    if (f) {
      const sync = () => f.querySelectorAll("[data-for]").forEach((l) => { l.hidden = l.dataset.for !== f.link.value; });
      f.link.onchange = sync; sync();
      f.preset.onchange = () => { const p = pre(f.preset.value); if (p.id !== "custom") { f.daily.value = p.daily; f.max.value = p.max; f.target.value = p.target; } };
    }
  }
  function bar(label, pct, text, a) {
    const p = Math.max(0, Math.min(100, pct || 0));
    return `<div class="rb-bar ${p >= a.panic_at ? "panic" : p >= a.stop_at ? "warn" : ""}"><span>${esc(label)}</span><i><u style="width:${p}%"></u><b style="left:${a.stop_at}%"></b><b style="left:${a.panic_at}%" class="p"></b></i><small>${esc(text)}</small></div>`;
  }

  // ---------------------------------------------------------------- events
  function bind() {
    const root = $("rb");
    root.addEventListener("click", async (e) => {
      const b = e.target.closest("button, a");
      if (!b) return;
      const d = b.dataset;
      if (b.id === "rb-accs") return openSheet("accounts", S.accounts.length ? null : "");
      if (b.id === "rb-tune") return $("rb-tuning").scrollIntoView({ behavior: "smooth" });
      if (d.acc !== undefined) return openSheet("accounts", d.acc ? null : "");
      if (d.z !== undefined) { const z = +d.z; cam = z ? { ...cam, z: Math.max(.6, Math.min(2.6, cam.z * (z > 0 ? 1.25 : .8))) } : { z: 1, x: 0, y: 0 }; return; }
      if (d.act === "close") { sel = null; placing = false; $("rb-place").hidden = true; return paintSide(); }
      if (d.act === "move") { placing = true; const p = $("rb-place"); p.hidden = false; p.className = "rb-place"; p.innerHTML = `${esc(t("Escolhe uma secretária livre (ou a de outro robô para trocarem)."))} <button type="button" class="btn quiet" data-act="noplace">${esc(t("Cancelar"))}</button>`; return; }
      if (d.act === "noplace") { placing = false; $("rb-place").hidden = true; return; }
      if (d.act === "look") { const l = $("rb-look"); l.hidden = !l.hidden; return; }
      if (d.look) { root.querySelectorAll("[data-look]").forEach((x) => x.classList.toggle("on", x === b)); return; }
      if (d.act === "savelook") { const on = root.querySelector("[data-look].on"); return saveRobot(sel, { name: $("rb-name").value, squad: $("rb-squad").value, look: on ? on.dataset.look : undefined }); }
      if (d.tab) { tab = d.tab; return paintSide(); }
      if (d.sym) { const r = robot(sel); const syms = r.symbols.includes(d.sym) ? r.symbols.filter((s) => s !== d.sym) : [...r.symbols, d.sym]; if (!syms.length) return; return saveRobot(sel, { symbols: syms }); }
      if (d.sheetClose) return closeSheet();
      if (d.edit !== undefined) { editAcc = d.edit; return paintSheet(); }
      if (d.cancel) { editAcc = null; return paintSheet(); }
      if (d.test) { b.disabled = true; b.textContent = t("A ligar…"); try { S = await api(`/api/robots/account/${d.test}/test`, { method: "POST" }); } catch (err) { flash(err.message); } paintHead(); return paintSheet(); }
      if (d.mode) {
        if (d.mode === "auto" && account(d.id).mode !== "auto") { confirmAuto = d.id; return paintSheet(); }
        return setMode(d.id, d.mode);
      }
      if (d.confirm !== undefined) { const id = d.confirm; confirmAuto = null; if (id) return setMode(id, "auto"); return paintSheet(); }
      if (d.flat) { b.disabled = true; try { S = await api(`/api/robots/account/${d.flat}/flatten`, { method: "POST" }); flash(typeof S.flatten.result === "string" ? S.flatten.result : t("Fechei {n} ordens/posições dos robôs.", { n: S.flatten.result })); } catch (err) { flash(err.message); } paintHead(); paintLog(); return paintSheet(); }
      if (d.del) { if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = t("Tens a certeza? Carrega outra vez"); return; } S = await api(`/api/robots/account/${d.del}`, { method: "DELETE" }); paintHead(); return paintSheet(); }
      if (b.id === "rb-c-go") {
        const q = new URLSearchParams({ account: $("rb-c-acc").value, symbol: $("rb-c-sym").value, entry: $("rb-c-e").value, stop: $("rb-c-s").value, risk: $("rb-c-r").value });
        const out = $("rb-c-out");
        out.textContent = t("A calcular…");
        try { const r = await api(`/api/robots/size?${q}`); out.innerHTML = r.ok ? `<b>${r.volume} ${esc(t("lotes"))}</b> ${esc(t("de"))} ${esc(r.symbol)} · ${esc(t("risco"))} ${r.risk} · ${r.per_lot} ${esc(t("por lote"))}` : esc(r.error); } catch (err) { out.textContent = err.message; }
      }
    });
    root.addEventListener("change", (e) => {
      const x = e.target;
      if (x.dataset.set && sel) saveRobot(sel, { [x.dataset.set]: x.type === "checkbox" ? x.checked : x.value });
    });
    root.addEventListener("submit", async (e) => {
      if (e.target.id !== "rb-af") return;
      e.preventDefault();
      const f = e.target, body = { id: editAcc || "", symbols: {} };
      new FormData(f).forEach((v, k) => { if (k.startsWith("sym_")) body.symbols[k.slice(4)] = v; else body[k] = v; });
      const btn = f.querySelector("[type=submit]");
      btn.disabled = true; btn.textContent = t("A guardar e a ligar…");
      try { S = await api("/api/robots/account", { method: "POST", body }); editAcc = null; } catch (err) { flash(err.message); btn.disabled = false; btn.textContent = t("Guardar e ligar"); return; }
      paintHead(); paintSheet();
    });
    const cv = $("rb-cv");
    cv.addEventListener("pointermove", (e) => {
      if (drag) { cam.x = drag.cx + (e.clientX - drag.x); cam.y = drag.cy + (e.clientY - drag.y); drag.moved = drag.moved || Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 4; return; }
      const h = hitAt(e);
      hover = h ? h.id : null;
      cv.style.cursor = h || (placing && slotAt(e) != null) ? "pointer" : "grab";
    });
    cv.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moved: false }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener("pointerup", (e) => {
      const moved = drag && drag.moved;
      drag = null;
      if (moved) return;
      if (placing) {
        const s = slotAt(e);
        if (s != null) { placing = false; $("rb-place").hidden = true; saveRobot(sel, { seat: s }); }
        return;
      }
      const h = hitAt(e);
      sel = h ? h.id : null; tab = "pnl";
      paintSide();
    });
    cv.addEventListener("pointerleave", () => { hover = null; });
    cv.addEventListener("wheel", (e) => { e.preventDefault(); cam.z = Math.max(.6, Math.min(2.6, cam.z * (e.deltaY < 0 ? 1.1 : .9))); }, { passive: false });
  }
  async function setMode(id, mode) {
    try { S = await api(`/api/robots/account/${id}/mode`, { method: "POST", body: { mode } }); } catch (err) { flash(err.message); }
    paintHead(); paintLog(); paintSheet();
  }
  function hitAt(e) {
    const r = $("rb-cv").getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    for (let i = hits.length - 1; i >= 0; i--) { const h = hits[i]; if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h; }
    return null;
  }
  function slotAt(e) {
    const r = $("rb-cv").getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    let best = null, bd = 1e9;
    slotHits.forEach((s) => { const d = Math.hypot(s.x - x, s.y - y); if (d < bd && d < s.r) { bd = d; best = s.i; } });
    return best;
  }

  // ================================================================ the office (isometric canvas)
  function start() {
    cancelAnimationFrame(raf);
    const frame = (now) => {
      if (!$("rb-cv")) return;   // left the page: stop
      raf = requestAnimationFrame(frame);
      if (document.hidden || now - last < 48) return;   // ~20 fps
      last = now;
      draw(now / 1000);
    };
    raf = requestAnimationFrame(frame);
  }

  let V = null;   // the view: tile size and origin for the current canvas size and zoom
  function project(gx, gy, gz = 0) { return [V.ox + (gx - gy) * V.tw / 2, V.oy + (gx + gy) * V.th / 2 - gz * V.th]; }

  function draw(time) {
    const cv = $("rb-cv"), stage = $("rb-stage");
    if (!cv || !S) return;
    const k = Math.min(2, devicePixelRatio || 1), W = stage.clientWidth, H = stage.clientHeight;
    if (cv.width !== Math.round(W * k) || cv.height !== Math.round(H * k)) { cv.width = Math.round(W * k); cv.height = Math.round(H * k); cv.style.width = W + "px"; cv.style.height = H + "px"; }
    const g = cv.getContext("2d");
    g.setTransform(k, 0, 0, k, 0, 0);
    g.clearRect(0, 0, W, H);
    const side = !$("rb-side").hidden && W > 760 ? 380 : 0;
    // the room is (COLS + ROWS) half-tiles wide and (COLS + ROWS) / 4 + the walls and tags tall, in tile widths
    const fit = Math.min((W - side - 30) / ((COLS + ROWS) / 2), (H - 40) / ((COLS + ROWS) / 4 + 2.6));
    const tw = fit * cam.z, th = tw / 2;
    V = { tw, th, ox: (W - side) / 2 + (ROWS - COLS) * tw / 4 + cam.x, oy: H / 2 - ((COLS + ROWS) / 2 - 4.2) * th / 2 + cam.y };
    hits = []; slotHits = [];
    floor(g, time);
    walls(g, time);
    // what stands on the floor, back to front
    const items = [];
    const seated = new Set();
    S.robots.forEach((r) => {
      const away = r.state === "rest" || r.state === "off";
      if (!away && SLOTS[r.seat]) seated.add(r.seat);
    });
    const nSlots = podsUsed() * 4;
    SLOTS.slice(0, nSlots).forEach(([x, y], i) => items.push({ d: x + y + .4, f: () => desk(g, x, y, i, time) }));
    lounge(g, items);
    let li = 0;
    S.robots.forEach((r) => {
      const away = r.state === "rest" || r.state === "off" || !SLOTS[r.seat];
      const [x, y] = away ? LOUNGE[li++ % LOUNGE.length] : [SLOTS[r.seat][0] + .55, SLOTS[r.seat][1] - .35];
      items.push({ d: x + y + (away ? .2 : .1), f: () => bot(g, r, x, y, away, time) });
    });
    items.sort((a, b) => a.d - b.d).forEach((it) => it.f());
    squadsTags(g);
    if (placing) SLOTS.slice(0, Math.min(SLOTS.length, nSlots + 4)).forEach(([x, y], i) => {
      const [sx, sy] = project(x + 1, y + .5, .2);
      g.beginPath(); g.arc(sx, sy, V.tw * .28, 0, Math.PI * 2);
      g.fillStyle = seated.has(i) ? "rgba(143,180,255,.12)" : "rgba(236,238,241,.14)"; g.fill();
      g.strokeStyle = "rgba(236,238,241,.7)"; g.setLineDash([4, 4]); g.lineWidth = 1.2; g.stroke(); g.setLineDash([]);
      slotHits.push({ i, x: sx, y: sy, r: V.tw * .5 });
    });
  }

  function poly(g, pts, fill, stroke, lw = 1) {
    g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath();
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); }
  }
  // an isometric box from (x, y) of size (w, d), from z0 up to z1
  function box(g, x, y, w, d, z0, z1, top, left, right, edge) {
    const P = (a, b, c) => project(a, b, c);
    poly(g, [P(x, y + d, z0), P(x + w, y + d, z0), P(x + w, y + d, z1), P(x, y + d, z1)], left, edge, .8);
    poly(g, [P(x + w, y, z0), P(x + w, y + d, z0), P(x + w, y + d, z1), P(x + w, y, z1)], right, edge, .8);
    poly(g, [P(x, y, z1), P(x + w, y, z1), P(x + w, y + d, z1), P(x, y + d, z1)], top, edge, .8);
  }

  function floor(g, time) {
    const c = [project(0, 0), project(COLS, 0), project(COLS, ROWS), project(0, ROWS)];
    const grad = g.createLinearGradient(c[0][0], c[0][1], c[2][0], c[2][1]);
    grad.addColorStop(0, "#15181d"); grad.addColorStop(1, "#0b0d10");
    poly(g, c, grad);
    g.strokeStyle = "rgba(255,255,255,.035)"; g.lineWidth = 1;
    for (let x = 1; x < COLS; x++) { const [a, b] = [project(x, 0), project(x, ROWS)]; g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.stroke(); }
    for (let y = 1; y < ROWS; y++) { const [a, b] = [project(0, y), project(COLS, y)]; g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.stroke(); }
    // the lounge carpet
    poly(g, [project(11, 5.8), project(15.6, 5.8), project(15.6, 10.8), project(11, 10.8)], "rgba(143,180,255,.035)", "rgba(143,180,255,.18)", 1);
    // the chrome rim along the front edges (a slow light runs along it)
    g.save();
    g.shadowColor = "rgba(236,238,241,.55)"; g.shadowBlur = 14;
    g.strokeStyle = "rgba(236,238,241,.55)"; g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(...c[1]); g.lineTo(...c[2]); g.lineTo(...c[3]); g.stroke();
    g.restore();
    // a short bright stretch runs slowly along the rim
    const run = (time * .05) % 1, L = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    const at = (f) => (f < .5 ? L(c[3], c[2], f * 2) : L(c[2], c[1], (f - .5) * 2));
    g.save(); g.shadowColor = "#fff"; g.shadowBlur = 12; g.strokeStyle = "rgba(255,255,255,.95)"; g.lineWidth = 2; g.lineCap = "round";
    g.beginPath(); for (let i = 0; i <= 8; i++) { const q = at(Math.min(.999, run + i * .006)); i ? g.lineTo(...q) : g.moveTo(...q); } g.stroke(); g.restore();
  }

  function walls(g, time) {
    const Hh = 3.4;
    // back walls: graphite panels with a chrome top edge
    poly(g, [project(0, 0), project(COLS, 0), project(COLS, 0, Hh), project(0, 0, Hh)], "#101317", "rgba(255,255,255,.06)");
    poly(g, [project(0, 0), project(0, ROWS), project(0, ROWS, Hh), project(0, 0, Hh)], "#0d1014", "rgba(255,255,255,.06)");
    for (let x = 2; x < COLS; x += 2) { g.strokeStyle = "rgba(255,255,255,.03)"; g.beginPath(); g.moveTo(...project(x, 0)); g.lineTo(...project(x, 0, Hh)); g.stroke(); }
    g.save(); g.shadowColor = "rgba(236,238,241,.6)"; g.shadowBlur = 10; g.strokeStyle = "rgba(236,238,241,.7)"; g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(...project(0, ROWS, Hh)); g.lineTo(...project(0, 0, Hh)); g.lineTo(...project(COLS, 0, Hh)); g.stroke(); g.restore();
    // the big screen on the back wall: the totals and the four instruments
    const T = S.totals;
    wallScreen(g, 1.2, 9.6, .7, 2.9, (c, w, h) => {
      c.fillStyle = "rgba(255,255,255,.5)"; c.font = `600 ${h * .085}px Inter, system-ui`; c.textAlign = "left";
      c.fillText(T.paper ? t("RESULTADO HOJE (PAPEL)") : t("SALDO TOTAL"), w * .05, h * .17);
      c.font = `700 ${h * .22}px "Space Grotesk", Inter, system-ui`;
      c.fillStyle = T.paper ? (T.day >= 0 ? UP : DOWN) : "#fff";
      c.fillText(T.paper ? signed(T.day, T.currency) : money(T.balance, T.currency), w * .05, h * .44);
      c.font = `600 ${h * .075}px Inter, system-ui`; c.fillStyle = "rgba(255,255,255,.55)";
      c.fillText(`${t("OPERAÇÕES HOJE")} ${T.ops}   ·   ${t("ROBÔS EM OPERAÇÃO")} ${T.working}/${T.on}`, w * .05, h * .6);
      // sparklines of the instruments
      const tp = S.tape || [], cw = w * .9 / Math.max(1, tp.length);
      tp.forEach((s, i) => {
        const x0 = w * .05 + i * cw, y0 = h * .68, ch = h * .26;
        c.fillStyle = "rgba(255,255,255,.6)"; c.font = `600 ${h * .06}px Inter, system-ui`; c.fillText(s.id, x0, y0 + h * .05);
        const v = s.spark || [];
        if (v.length > 2) {
          const lo = Math.min(...v), hi = Math.max(...v), sp = hi - lo || 1;
          c.beginPath(); v.forEach((p, j) => { const x = x0 + j / (v.length - 1) * (cw - 12), y = y0 + ch - (p - lo) / sp * (ch - h * .08); j ? c.lineTo(x, y) : c.moveTo(x, y); });
          c.strokeStyle = (s.chg || 0) >= 0 ? UP : DOWN; c.lineWidth = Math.max(1, h * .012); c.stroke();
        }
      });
    });
    // left wall: the AMG plate and the squads' board
    const sq = S.squads || [];
    sideScreen(g, 1.4, 5.2, .9, 2.5, (c, w, h) => {
      c.fillStyle = "rgba(255,255,255,.85)"; c.font = `800 ${h * .2}px "Space Grotesk", Inter, system-ui`; c.textAlign = "center";
      c.fillText("AMG", w / 2, h * .3);
      c.font = `600 ${h * .07}px Inter, system-ui`; c.fillStyle = "rgba(255,255,255,.45)"; c.fillText(t("CAPITAL · ROBÔS"), w / 2, h * .42);
      sq.slice(0, 4).forEach((q, i) => {
        c.textAlign = "left"; c.fillStyle = "rgba(255,255,255,.7)"; c.font = `600 ${h * .075}px Inter, system-ui`;
        c.fillText(q.name.toUpperCase(), w * .08, h * (.58 + i * .12));
        c.textAlign = "right"; c.fillStyle = q.pnl > 0 ? UP : q.pnl < 0 ? DOWN : "rgba(255,255,255,.6)";
        c.fillText(signed(q.pnl, T.currency), w * .92, h * (.58 + i * .12));
      });
    });
  }
  // a screen drawn into an offscreen canvas, then mapped on the back wall (x from a to b, z from z0 to z1)
  const scr = {};
  function screenCanvas(key, w, h, paintFn) {
    const c = scr[key] ||= document.createElement("canvas");
    const sig = `${w}x${h}:${S.now}:${S.totals.day}:${S.totals.balance}`;
    if (c._sig !== sig) {
      c.width = w; c.height = h; c._sig = sig;
      const x = c.getContext("2d");
      const gr = x.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, "#0d1116"); gr.addColorStop(1, "#06080a");
      x.fillStyle = gr; x.fillRect(0, 0, w, h);
      x.strokeStyle = "rgba(255,255,255,.18)"; x.lineWidth = 2; x.strokeRect(1, 1, w - 2, h - 2);
      paintFn(x, w, h);
    }
    return c;
  }
  function wallScreen(g, a, b, z0, z1, paintFn) {
    const p0 = project(a, 0, z1), p1 = project(b, 0, z1), p3 = project(a, 0, z0);
    const w = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), h = Math.abs(p3[1] - p0[1]);
    const c = screenCanvas("back", 640, Math.round(640 * h / w * (w / Math.max(1, p1[0] - p0[0]))), paintFn);
    g.save(); g.setTransform(g.getTransform().multiply(new DOMMatrix([(p1[0] - p0[0]) / c.width, (p1[1] - p0[1]) / c.width, 0, (p3[1] - p0[1]) / c.height, p0[0], p0[1]])));
    g.drawImage(c, 0, 0); g.restore();
    g.save(); g.shadowColor = "rgba(236,238,241,.35)"; g.shadowBlur = 16;
    poly(g, [p0, p1, project(b, 0, z0), p3], null, "rgba(236,238,241,.35)", 1.2); g.restore();
  }
  function sideScreen(g, a, b, z0, z1, paintFn) {
    const p0 = project(0, b, z1), p1 = project(0, a, z1), p3 = project(0, b, z0);
    const c = screenCanvas("side", 420, 400, paintFn);
    g.save(); g.setTransform(g.getTransform().multiply(new DOMMatrix([(p1[0] - p0[0]) / c.width, (p1[1] - p0[1]) / c.width, 0, (p3[1] - p0[1]) / c.height, p0[0], p0[1]])));
    g.drawImage(c, 0, 0); g.restore();
    poly(g, [p0, p1, project(0, a, z0), p3], null, "rgba(236,238,241,.3)", 1);
  }

  function desk(g, x, y, i, time) {
    const r = S.robots.find((q) => q.seat === i && q.state !== "rest" && q.state !== "off");
    const lit = r ? (r.state === "trade" ? (r.live_pnl >= 0 ? UP : DOWN) : r.state === "wait" ? AI : CHROME) : null;
    // the desk: a dark slab on two chrome legs
    box(g, x + .05, y + .05, 1.9, .05, 0, .42, null, "#0b0d10", "#0b0d10", "rgba(255,255,255,.05)");
    box(g, x, y, 2, .9, .42, .5, "#1f242b", "#14181d", "#181c22", "rgba(255,255,255,.12)");
    // the desk's light strip
    const [a, b] = [project(x, y + .9, .46), project(x + 2, y + .9, .46)];
    g.save(); if (lit) { g.shadowColor = lit; g.shadowBlur = 10; }
    g.strokeStyle = lit ? lit : "rgba(255,255,255,.12)"; g.lineWidth = lit ? 1.6 : 1;
    g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.stroke(); g.restore();
    // two monitors
    [.25, 1.1].forEach((mx, j) => {
      const z0 = .55, z1 = 1.2;
      const q = [project(x + mx, y + .2, z0), project(x + mx + .7, y + .2, z0), project(x + mx + .7, y + .2, z1), project(x + mx, y + .2, z1)];
      poly(g, q, "#07090c", "rgba(255,255,255,.22)", 1);
      if (r) {   // the robot's chart on the screen
        const s = (S.tape || []).find((t0) => t0.id === r.symbols[j % r.symbols.length]);
        const v = s && s.spark ? s.spark.slice(-30) : [];
        if (v.length > 2) {
          const lo = Math.min(...v), hi = Math.max(...v), sp = hi - lo || 1;
          g.beginPath();
          v.forEach((p, n) => {
            const f = n / (v.length - 1), zz = z0 + .1 + (p - lo) / sp * (z1 - z0 - .2);
            const [px, py] = project(x + mx + .06 + f * .58, y + .2, zz);
            n ? g.lineTo(px, py) : g.moveTo(px, py);
          });
          g.strokeStyle = (s.chg || 0) >= 0 ? UP : DOWN; g.lineWidth = 1.1; g.stroke();
        }
        g.save(); g.globalAlpha = .1 + .05 * Math.sin(time * 2 + i); poly(g, q, lit); g.restore();
      }
      box(g, x + mx + .32, y + .2, .06, .06, .5, z0, "#2a2f36", "#22262c", "#1a1d22", null);
    });
    // the chair, behind the desk (the robot sits on it)
    box(g, x + .55, y - .75, .75, .55, .25, .32, "#1a1e24", "#121519", "#16191e", "rgba(255,255,255,.08)");
    box(g, x + .55, y - .8, .75, .08, .32, .9, "#1d2228", "#14171c", "#191c21", "rgba(255,255,255,.08)");
  }

  function lounge(g, items) {
    // the snooker table, the sofa and the coffee machine: where robots out of hours wait for the next session
    items.push({ d: 12.3 + 7.6, f: () => {
      box(g, 11.9, 7.2, 2.6, 1.4, 0, .5, "#0f3b2a", "#0b0d10", "#0e1013", "rgba(255,255,255,.14)");
      poly(g, [project(12.05, 7.35, .51), project(14.35, 7.35, .51), project(14.35, 8.45, .51), project(12.05, 8.45, .51)], "#12513a", "rgba(255,255,255,.08)");
      [[12.4, 7.7, "#f2f4f7"], [12.9, 8, "#ef6f5e"], [13.1, 7.8, "#e2b55c"], [13.7, 8.1, "#8fb4ff"]].forEach(([bx, by, c]) => { const [px, py] = project(bx, by, .53); g.beginPath(); g.arc(px, py, V.tw * .045, 0, 7); g.fillStyle = c; g.fill(); });
    } });
    items.push({ d: 11.5 + 10, f: () => {
      box(g, 11.4, 9.7, 3.4, .9, 0, .38, "#20252c", "#171a1f", "#1b1f25", "rgba(255,255,255,.1)");
      box(g, 11.4, 10.4, 3.4, .25, .38, .85, "#262b33", "#1b1f25", "#20242b", "rgba(255,255,255,.1)");
    } });
    items.push({ d: 15 + 6, f: () => {
      box(g, 14.8, 6, .7, .6, 0, 1.25, "#2a2f36", "#1a1d22", "#22262c", "rgba(255,255,255,.12)");
      const [px, py] = project(15.15, 6.6, .9); g.fillStyle = "rgba(143,180,255,.8)"; g.fillRect(px - 2, py - 2, 4, 4);
    } });
  }

  function bot(g, r, x, y, away, time) {
    const st = r.state, col = st === "trade" ? (r.live_pnl >= 0 ? UP : DOWN) : st === "wait" ? AI : st === "watch" ? CHROME : "#59606a";
    const bob = away ? 0 : Math.sin(time * 2.2 + r.seat) * .02;
    const [px, py] = project(x, y, away ? .0 : .3);
    const s = V.tw * .5;   // the robot's size
    const sel0 = sel === r.id, hov = hover === r.id;
    g.save();
    // shadow
    g.fillStyle = "rgba(0,0,0,.45)"; g.beginPath(); g.ellipse(px, py + s * .05, s * .38, s * .14, 0, 0, 7); g.fill();
    if (sel0 || hov) { g.strokeStyle = sel0 ? "rgba(236,238,241,.9)" : "rgba(236,238,241,.45)"; g.lineWidth = 1.5; g.beginPath(); g.ellipse(px, py + s * .05, s * .55, s * .2, 0, 0, 7); g.stroke(); }
    const by = py - s * (away ? .55 : .5) - bob * V.th * 4;
    // body: a chrome capsule with the robot's colour as a band
    const body = g.createLinearGradient(px - s * .3, 0, px + s * .3, 0);
    body.addColorStop(0, "#8e959e"); body.addColorStop(.45, "#f4f6f8"); body.addColorStop(1, "#5c636c");
    rr(g, px - s * .27, by - s * .05, s * .54, s * .6, s * .16); g.fillStyle = body; g.fill();
    g.fillStyle = r.look; g.globalAlpha = .9; g.fillRect(px - s * .27, by + s * .22, s * .54, s * .07); g.globalAlpha = 1;
    // arms to the keyboard (at the desk) or down (lounge)
    g.strokeStyle = "#b9bfc7"; g.lineWidth = s * .07; g.lineCap = "round";
    const arm = away ? s * .32 : s * .22, sw = away ? 0 : Math.sin(time * 6 + r.seat) * s * .02;
    g.beginPath(); g.moveTo(px - s * .26, by + s * .1); g.lineTo(px - s * .36, by + arm + sw); g.moveTo(px + s * .26, by + s * .1); g.lineTo(px + s * .36, by + arm - sw); g.stroke();
    // head with the visor
    const hy = by - s * .42;
    const head = g.createLinearGradient(px - s * .3, hy, px + s * .3, hy + s * .4);
    head.addColorStop(0, "#ffffff"); head.addColorStop(.5, "#cfd4da"); head.addColorStop(1, "#6d747d");
    rr(g, px - s * .3, hy, s * .6, s * .4, s * .14); g.fillStyle = head; g.fill();
    rr(g, px - s * .23, hy + s * .1, s * .46, s * .17, s * .08); g.fillStyle = INK; g.fill();
    g.shadowColor = col; g.shadowBlur = st === "rest" || st === "off" ? 0 : 10;
    const blink = (Math.sin(time * 1.3 + r.seat * 1.7) > .97) ? .2 : 1;
    g.fillStyle = col; g.globalAlpha = blink;
    if (st === "rest" || st === "off") { g.fillRect(px - s * .15, hy + s * .19, s * .1, s * .02); g.fillRect(px + s * .05, hy + s * .19, s * .1, s * .02); }
    else { g.beginPath(); g.arc(px - s * .09, hy + s * .185, s * .04, 0, 7); g.arc(px + s * .09, hy + s * .185, s * .04, 0, 7); g.fill(); }
    g.globalAlpha = 1; g.shadowBlur = 0;
    // antenna
    g.strokeStyle = "#9aa1aa"; g.lineWidth = 1.2; g.beginPath(); g.moveTo(px, hy); g.lineTo(px, hy - s * .14); g.stroke();
    g.beginPath(); g.arc(px, hy - s * .16, s * .045, 0, 7); g.fillStyle = col; g.shadowColor = col; g.shadowBlur = 8; g.fill(); g.shadowBlur = 0;
    if (st === "rest" || st === "off") { g.fillStyle = "rgba(255,255,255,.4)"; g.font = `600 ${s * .22}px Inter`; g.fillText("z", px + s * .32, hy - s * .05 - (time * 6 % 6)); }
    // the name tag with today's money
    const day = r.day_pnl + r.live_pnl;
    const tag = `${r.name}${day ? `  ${day > 0 ? "+" : "−"}${Math.abs(day).toLocaleString("pt-PT", { maximumFractionDigits: 0 })}` : ""}`;
    g.font = `600 ${Math.max(9, Math.min(13, s * .2))}px Inter, system-ui`;
    const tw0 = g.measureText(tag).width + 12, th0 = Math.max(15, Math.min(22, s * .32)), tx = px - tw0 / 2, ty = hy - s * .3 - th0;
    rr(g, tx, ty, tw0, th0, th0 / 2); g.fillStyle = "rgba(10,12,15,.88)"; g.fill();
    g.strokeStyle = sel0 ? "rgba(236,238,241,.9)" : day > 0 ? "rgba(95,207,140,.55)" : day < 0 ? "rgba(239,111,94,.55)" : "rgba(255,255,255,.18)"; g.lineWidth = 1; g.stroke();
    g.fillStyle = "#eceef1"; g.textAlign = "left";
    const nw = g.measureText(r.name).width;
    g.fillText(r.name, tx + 6, ty + th0 * .68);
    if (day) { g.fillStyle = day > 0 ? UP : DOWN; g.fillText(tag.slice(r.name.length), tx + 6 + nw, ty + th0 * .68); }
    g.restore();
    hits.push({ id: r.id, x: px - s * .5, y: ty, w: s, h: py - ty + s * .1 });
  }
  function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); }

  function squadsTags(g) {
    // a tag over each pod: the squad of its robots and their money today
    PODS.slice(0, podsUsed()).forEach(([x, y], p) => {
      const rs = S.robots.filter((r) => r.seat >= p * 4 && r.seat < p * 4 + 4);
      if (!rs.length) return;
      const name = rs[0].squad, pnl = rs.reduce((a, r) => a + r.day_pnl + r.live_pnl, 0);
      const [px, py] = project(x + 2.6, y + 4.5, .05);   // a sign on the floor in front of the pod
      const txt = name.toUpperCase(), val = pnl ? `${pnl > 0 ? "+" : "−"}${Math.abs(pnl).toLocaleString("pt-PT", { maximumFractionDigits: 0 })}` : "0";
      g.font = `700 ${Math.max(10, V.tw * .2)}px "Space Grotesk", Inter`;
      const w1 = g.measureText(txt).width, w2 = g.measureText(val).width, h = Math.max(18, V.tw * .34), w = w1 + w2 + 34;
      rr(g, px - w / 2, py - h / 2, w, h, h / 2);
      g.fillStyle = "rgba(9,11,14,.9)"; g.fill();
      g.save(); g.shadowColor = "rgba(236,238,241,.5)"; g.shadowBlur = 12; g.strokeStyle = "rgba(236,238,241,.55)"; g.lineWidth = 1.2; g.stroke(); g.restore();
      g.fillStyle = "#f4f6f8"; g.textAlign = "left"; g.fillText(txt, px - w / 2 + 13, py + h * .27);
      g.fillStyle = pnl > 0 ? UP : pnl < 0 ? DOWN : "rgba(255,255,255,.55)"; g.fillText(val, px - w / 2 + 21 + w1, py + h * .27);
    });
  }
})();
