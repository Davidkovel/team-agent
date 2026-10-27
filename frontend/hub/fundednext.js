// Painel FundedNext (#/fundednext, a tab of the Sala de Trading): the prop account as the firm's dashboard shows it, more
// organised and with more in it (backend/app/tradingroom/fundednext.py, /api/fundednext). The phase and its objectives,
// what can still be lost today, «Quanto queres arriscar?» (the person's risk, daily stop and goal, and what they mean),
// the balance and equity with the floors, positions and orders with their buttons, an order ticket sized by risk, the days
// as a calendar, the statistics, every closed trade, the robots on the account, the red news, the reward and the rules.
// The account is read by the MT5 API on this PC (the one the MT5 is logged in to: the Hub never needs the password).
// Laid out like every page of the Hub (docs/hub-paginas.md): ui.head, a row of figures, ui.sec sections over .panel.
(function () {
  const RISKS = [0.25, 0.5, 1];
  const RRS = [1, 1.5, 2, 3];
  const ORIGIN_PT = { "Manual (MT5)": "Tu, no MT5", "Manual (Hub)": "Tu, no painel", "Reforço": "Reforço na notícia" };
  let S = null, acc = null, timer = 0, qtimer = 0, Q = {}, range = "all", filt = { sym: "", res: "", more: 0 }, cfgOpen = false, busy = false, qbusy = false;
  const store = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(`fn.${k}`)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(`fn.${k}`, JSON.stringify(v)); } catch {} } };
  let risk = store.get("risk", 0.5);
  const plan = store.get("plan", { wr: null, rrr: null, perday: 2 });
  const tk = { sym: "XAUUSD", dir: "buy", kind: "market", entry: "", sl: "", tp: "", risk: null, lots: "", armed: 0 };

  const D = () => (S && S.dash) || null;
  const live = () => { const d = D(); return d && !d.error ? d : null; };
  const cur = () => ((D() && D().snap && D().snap.currency) || "USD");
  const loc = (v, d = 2) => Number(v).toLocaleString("pt-PT", { minimumFractionDigits: d, maximumFractionDigits: d });
  const money = (v, d = 2) => (v == null ? "—" : `${v < 0 ? "−" : ""}${cur() === "EUR" ? "€" : "$"}${loc(Math.abs(v), d)}`);
  const signed = (v, d = 2) => (v == null ? "—" : `${v > 0 ? "+" : ""}${money(v, d)}`);
  const pct = (v, d = 2) => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${loc(Math.abs(v), d)}%`);
  const cls = (v) => (v > 0 ? "up" : v < 0 ? "down" : "");
  const hm = (ts) => new Date(ts * 1000).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
  const dt = (ts) => new Date(ts * 1000).toLocaleString("pt-PT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const dday = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("pt-PT", { weekday: "short", day: "2-digit", month: "2-digit" });
  const px = (v, digits = 5) => (v == null || v === 0 ? "—" : Number(v).toFixed(digits));
  const dur = (m) => (m == null ? "—" : m < 60 ? `${Math.round(m)} min` : m < 1440 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)}` : `${Math.round(m / 1440)} d`);
  const until = (ts) => { const s = ts - Date.now() / 1000; if (s < 0) return t("saiu há {m} min", { m: Math.round(-s / 60) }); const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? t("daqui a {h} h {m}", { h, m }) : t("daqui a {m} min", { m }); };
  const who = (m) => (m === 0 ? t("Tu, no MT5") : m === 7701 ? t("Tu, no painel") : m === 7700 ? t("Reforço") : t("Robô"));
  const sideTag = (dir) => `<span class="fn-dir-t ${dir}">${esc(dir === "buy" ? t("Compra") : t("Venda"))}</span>`;
  const seg = (attr, items, on) => `<span class="fn-seg">${items.map(([k, l]) => `<button type="button" data-${attr}="${esc(k)}" class="${on === k ? "on" : ""}">${esc(t(l))}</button>`).join("")}</span>`;
  // a section: its ui.sec title (with what goes on the right) and its panel; no body = the whole section hidden
  function section(id, title, right, body) {
    paint($(`${id}-h`), body ? ui.sec(title, right ? `<div class="fn-sr">${right}</div>` : "") : "");
    paint($(id), body);
    $(id).hidden = !body;
  }
  // --o: the order on a narrow screen, where the two columns become one (positions, ticket and plan first)
  const box = (id, o, cls = "pad") => `<div class="fn-box" style="--o:${o}"><div id="${id}-h"></div><section class="panel ${cls}" id="${id}" hidden></section></div>`;

  // ================================================================ the page
  HUB_VIEWS.fundednext = async function () {
    acc = store.get("acc", null);
    page(`<div class="fn" id="fn">
      ${ui.head("Trading", "FundedNext", t("A tua conta da prop ao vivo pelo MT5: as regras da fase, quanto ainda podes perder hoje, as posições, o ticket e os números todos."),
        `<div class="fn-ctl" id="fn-ctl"></div>`)}
      <div class="fn-msg" id="fn-msg" hidden></div>
      <div class="fn-accs" id="fn-accs"></div>
      <section class="panel fn-start" id="fn-start">${ui.skeleton(4)}</section>
      <div class="fn-body" id="fn-body" hidden>
        <div class="bd-kpis fn-kpis" id="fn-kpis"></div>
        ${box("fn-obj", 0, "fn-objs")}
        <div class="fn-cols">
          <div class="fn-main">${box("fn-chart", 4)}${box("fn-pos", 1)}${box("fn-days", 7)}${box("fn-stats", 8)}${box("fn-trades", 9)}</div>
          <aside class="fn-side">${box("fn-ticket", 2)}${box("fn-plan", 3)}${box("fn-reward", 5)}${box("fn-news", 6)}${box("fn-bots", 10)}${box("fn-rules", 11)}${box("fn-log", 12)}</aside>
        </div>
      </div>
    </div>`);
    bind();
    await load().catch((e) => { paint($("fn-start"), ui.error(e.message)); const r = $("fn-start").querySelector("[data-retry]"); if (r) r.onclick = () => load().catch((x) => msg(x.message, "bad")); });
    clearInterval(timer);
    timer = setInterval(() => { if (!$("fn")) { clearInterval(timer); clearInterval(qtimer); return; } if (!document.hidden) load().catch(() => {}); }, 6000);
    clearInterval(qtimer);
    qtimer = setInterval(() => { if (!$("fn")) return clearInterval(qtimer); if (!document.hidden) loadQuotes().catch(() => {}); }, 2500);
  };

  async function load(fresh = false) {
    if (busy && !fresh) return;   // one read at a time: a slow MT5 must not pile requests up
    busy = true;
    try {
      S = await api(`/api/fundednext?acc=${encodeURIComponent(acc || "")}&risk=${risk}${fresh ? "&fresh=1" : ""}`);
    } finally { busy = false; }
    if (D()) { acc = D().id; store.set("acc", acc); }
    paintAll();
  }
  async function loadQuotes() {
    const d = live();
    if (!d || qbusy) return;
    qbusy = true;
    let r;
    try { r = await api(`/api/fundednext/${encodeURIComponent(d.id)}/quotes`); } finally { qbusy = false; }
    if (!r.ok || !$("fn-ticket")) return;
    const changed = Object.keys(r.quotes || {}).join() !== Object.keys(Q).join();
    Q = r.quotes || {};
    if (changed && !$("fn-ticket").contains(document.activeElement)) paintTicket(); else { paintQuote(); paintPreview(); }
    paintPos();
  }
  function msg(text, kind = "") {
    const el = $("fn-msg");
    if (!el) return;
    el.hidden = false; el.className = `fn-msg ${kind}`; el.textContent = text;
    clearTimeout(msg.t); msg.t = setTimeout(() => { el.hidden = true; }, 7000);
  }
  async function post(path, body = {}) {
    const r = await api(path, { method: "POST", body });
    if (r.accounts) { S = r; if (D()) acc = D().id; paintAll(); }
    return r;
  }

  function paintAll() {
    paintAccs(); paintCtl();
    const d = D();
    $("fn-start").hidden = !!d;
    $("fn-body").hidden = !d;
    if (!d) return paintStart();
    paintKpis(); paintObj(); paintChart(); paintPos(); paintDays(); paintStats(); paintTrades();
    if (!$("fn-ticket")._html) paintTicket(); else { paintQuote(); paintPreview(); }
    if (!$("fn-plan").contains(document.activeElement)) paintPlan();
    paintReward(); paintNews(); paintBots();
    if (!$("fn-rules").contains(document.activeElement)) paintRules();
    paintLog();
  }

  // ---------------------------------------------------------------- head: the state chip, the mode and the actions
  function paintAccs() {
    const a = S.accounts || [];
    paint($("fn-accs"), a.length > 1 ? seg("acc", a.map((x) => [x.id, x.name]), D() && D().id) : "");
  }
  function paintCtl() {
    const d = D(), a = d && d.account;
    const chip = !d ? `<span class="st off"><i></i>${esc(t("Sem conta ligada"))}</span>`
      : d.error ? `<span class="st bad" title="${esc(d.error)}"><i></i>${esc(t("Sem ligação à conta"))}</span>`
      : `<span class="st ok"><i></i>${esc(t("Ao vivo · {h}", { h: hm((d.snap && d.snap.at) || Date.now() / 1000) }))}</span>`;
    paint($("fn-ctl"), `${chip}
      ${a ? `<span class="fn-seg fn-mode" title="${esc(t("Observar: só lê. Automático: os robôs marcados nesta conta enviam ordens."))}"><button type="button" data-mode="observar" class="${a.mode !== "auto" ? "on" : ""}">${esc(t("Observar"))}</button><button type="button" data-mode="auto" class="${a.mode === "auto" ? "on auto" : ""}">${esc(t("Robôs em automático"))}</button></span>` : ""}
      ${d ? `<button type="button" class="btn quiet" data-act="refresh">${icon("clock")}${esc(t("Atualizar"))}</button>` : ""}
      <button type="button" class="btn ${d ? "" : "quiet"}" data-act="mt5">${icon("monitor")}${esc(t("Abrir o MT5"))}</button>
      ${d ? `<button type="button" class="btn" data-act="cfg">${icon("gear")}${esc(t("Conta e regras"))}</button>` : `<button type="button" class="btn primary" data-act="detect">${icon("link")}${esc(t("Apanhar a conta do MT5"))}</button>`}`);
  }

  // ---------------------------------------------------------------- no account yet
  function paintStart() {
    const m = S.mt5 || {}, f = paintStart.found;
    paint($("fn-start"), `${ui.empty("link", "Liga a tua conta FundedNext", "O Hub lê a conta pelo MetaTrader 5 deste PC, na conta em que o MT5 estiver. A password fica só no MT5: o Hub nunca a vê.")}
      <ol class="fn-steps">
        <li><b class="num sm">1</b><div><h4>${esc(t("Abre o MT5 e entra na conta"))}</h4><p>${esc(t("No painel da FundedNext, em Accounts › Credentials, estão o login (número), a password e o servidor. No MT5: Ficheiro › Entrar numa conta de trading, escreve «FundedNext» no servidor, mete o login e a password e marca «Guardar password»."))}</p>
          <button type="button" class="btn" data-act="mt5" ${m.terminal ? "" : "disabled"}>${icon("monitor")}${esc(m.terminal ? t("Abrir o MT5") : t("O MT5 não está instalado neste PC"))}</button></div></li>
        <li><b class="num sm">2</b><div><h4>${esc(t("Apanhar a conta"))}</h4><p>${esc(t("O Hub vê em que conta o MT5 está e junta-a aqui, com as regras da Stellar 2-Step (mudas depois em «Conta e regras»)."))}</p>
          <button type="button" class="btn primary" data-act="detect">${icon("link")}${esc(t("Apanhar a conta do MT5"))}</button></div></li>
      </ol>
      ${f ? `<div class="fn-found ${f.ok ? "" : "bad"}">${f.ok ? `${esc(t("O MT5 está na conta"))} <b>${esc(String(f.login))}</b> · ${esc(f.server)} · ${esc(f.company || "")} · ${money(f.balance)}.
        ${f.ask ? ` ${esc(t("Não parece da FundedNext."))} <button type="button" class="btn sm" data-act="force">${esc(t("Juntar mesmo assim"))}</button>` : ""}` : esc(f.error)}</div>` : ""}
      <p class="fn-hint">${esc(t("Também dá com o login e a password guardados no Hub (cifrados só neste PC): Robôs › Contas › Juntar conta."))} <a href="#/robos">${esc(t("Abrir os Robôs"))}</a></p>`);
  }

  // ---------------------------------------------------------------- the figures on top
  function paintKpis() {
    const d = D();
    if (d.error) {
      return paint($("fn-kpis"), `<div class="panel fn-err">${ui.empty("alert", "Não consegui ler a conta", d.error,
        `<div class="fn-btns"><button type="button" class="btn" data-act="mt5">${icon("monitor")}${esc(t("Abrir o MT5"))}</button><button type="button" class="btn" data-act="detect">${icon("link")}${esc(t("Apanhar a conta do MT5"))}</button><button type="button" class="btn quiet" data-act="refresh">${esc(t("Tentar outra vez"))}</button></div>`)}</div>`);
    }
    const a = d.account, s = d.snap || {}, g = d.guard || {}, o = d.objectives || {};
    const size = o.size || a.size, total = s.equity - size;
    // the Painel's figures (hub/painel.css): equity lit, a chip with the change, the curve of the account in small
    const chip = (v, text) => (v == null ? "" : `<span class="pn-delta ${v > 0 ? "up" : v < 0 ? "dn" : "eq"}">${esc(text)}</span>`);
    const eqLine = (d.equity || []).map((p) => p[1]).concat((d.today || []).map((p) => p[1])).slice(-60);
    const balLine = (d.curve || []).map((p) => p[1]).slice(-60);
    const days = (d.days || []).slice(-10);
    const daily = (o.items || []).find((i) => i.id === "daily");
    const tight = o.left_today != null && o.risk_money && o.left_today < o.risk_money;
    paint($("fn-kpis"), ui.kpi({ label: "Equity", value: money(s.equity), delta: chip(total, `${signed(total)} · ${pct(size ? total / size * 100 : null)}`),
        viz: ui.spark(eqLine.length > 1 ? eqLine : balLine), sub: t("desde o início") })
      + ui.kpi({ label: "Saldo", value: money(s.balance), viz: ui.spark(balLine), sub: `${t("conta de")} ${money(size, 0)} · 1:${s.leverage || "—"}` })
      + ui.kpi({ label: "Hoje", value: `<span class="${cls(g.day_pnl)}">${signed(g.day_pnl)}</span>`, delta: chip(g.day_pnl, pct(size ? (g.day_pnl || 0) / size * 100 : null)),
        viz: days.length > 1 ? ui.cols(days.map((x) => Math.abs(x.pnl))) : "", sub: days.length > 1 ? t("últimos {n} dias com trades", { n: days.length }) : "" })
      + ui.kpi({ label: "Em aberto", value: `<span class="${cls(s.open_pnl)}">${signed(s.open_pnl)}</span>`, sub: `${(s.positions || []).length} ${t("posições")} · ${(s.orders || []).length} ${t("ordens")}` })
      + ui.kpi({ label: "Hoje ainda podes perder", value: o.left_today != null ? money(o.left_today) : null, cls: `fn-room ${tight ? "bad" : ""}`,
        viz: daily && daily.have != null && daily.left != null && daily.have + daily.left > 0 ? ui.ring((daily.left / (daily.have + daily.left)) * 100) : "",
        sub: g.why ? g.why : o.trades_left != null ? t("{n} trades perdidas a {r}%", { n: o.trades_left, r: loc(risk, 2) }) : "" }));
  }

  // ---------------------------------------------------------------- objectives
  function paintObj() {
    const d = live(), o = d && d.objectives;
    if (!o || !o.items || !o.items.length) return section("fn-obj", "", "", "");
    const a = d.account, ph = o.phase || {};
    const state = { ok: t("Cumprido"), run: t("Em curso"), warn: t("Atenção"), fail: t("Passou o limite") };
    const right = `${ui.tag(ph.name || "", ph.id === "funded" ? "ok" : "")}<small>${esc(a.preset_name || "")} · ${esc(String((d.snap || {}).login || a.login || ""))} · ${esc((d.snap || {}).server || a.server || "")}</small>`;
    const body = o.items.map((i) => {
      const loss = i.id === "daily" || i.id === "max";
      const p = Math.max(0, Math.min(100, i.pct || 0));
      const st = loss && i.state === "ok" ? "safe" : i.state;
      return `<div class="panel pad fn-o ${st}">
        <div class="fn-o-h"><span>${esc(i.name)}</span>${ui.tag(loss && i.state === "ok" ? t("Dentro do limite") : state[i.state], { ok: "ok", warn: "warn", fail: "bad" }[st] || "")}</div>
        <div class="fn-ring" style="--p:${p}"><b class="num sm">${i.id === "days" ? `${i.have}/${i.need}` : `${loc(p, 0)}%`}</b><small>${esc(loss ? t("usado") : i.id === "days" ? t("dias") : t("feito"))}</small></div>
        <dl>${i.id === "days" ? `<div><dt>${esc(t("Faltam"))}</dt><dd>${i.left} ${esc(t("dias"))}</dd></div><div><dt>${esc(t("Conta"))}</dt><dd>${esc(t("dia com trade aberta"))}</dd></div>`
          : loss ? `<div><dt>${esc(t("Usado"))}</dt><dd>${money(i.have)}</dd></div><div><dt>${esc(t("Ainda tens"))}</dt><dd>${money(i.left)}</dd></div><div><dt>${esc(i.id === "daily" ? t("Chão de hoje") : t("Chão da conta"))}</dt><dd>${money(i.floor)}</dd></div>`
          : `<div><dt>${esc(t("Lucro"))}</dt><dd class="${cls(i.have)}">${signed(i.have)}</dd></div><div><dt>${esc(t("Falta"))}</dt><dd>${money(i.left)}</dd></div><div><dt>${esc(t("Meta"))}</dt><dd>${money(i.need)}</dd></div>`}</dl>
        ${i.hint ? `<p>${esc(i.hint)}</p>` : ""}
      </div>`;
    }).join("") + (o.passed ? `<div class="panel pad fn-o ok fn-pass"><b>${esc(t("Fase passada"))}</b><p>${esc(t("Objetivo e dias cumpridos. Pede a próxima fase no painel da FundedNext."))}</p></div>` : "");
    section("fn-obj", t("Objetivos da fase"), right, body);
  }

  // ---------------------------------------------------------------- chart
  function paintChart() {
    const d = live();
    if (!d) return section("fn-chart", "", "", "");
    const o = d.objectives || {}, a = d.account, g = d.guard || {}, s = d.snap || {};
    const size = o.size || a.size;
    const now = Date.now() / 1000;
    const from = range === "today" ? Date.parse(d.day_start) / 1000 : range === "7d" ? now - 7 * 86400 : 0;
    let bal = (d.curve || []).filter((p) => p[0] >= from);
    const eq = (d.equity || []).map((p) => [p[0], p[1]]).concat(d.today || []).filter((p) => p[0] >= from).sort((x, y) => x[0] - y[0]);
    eq.push([now, s.equity]);
    if (bal.length) bal.push([now, s.balance]);
    else bal = [[from || now - 3600, s.balance], [now, s.balance]];
    const W = Math.max(300, Math.round(($("fn-chart").clientWidth || $("fn-chart-h").clientWidth || 900) - 28)), H = W < 600 ? 230 : 300, L = 6, R = W < 560 ? 92 : 128, T = 14, B = 24;
    const x0 = Math.min(bal[0][0], eq[0][0]), x1 = now;
    const lines = [[size, t("Início"), "ref"], [g.floor_max, t("Perda máxima"), "floor"], [g.floor_day, t("Chão de hoje"), "floor"]];
    if (a.target) lines.push([size * (1 + a.target / 100), t("Objetivo"), "goal"]);
    if (a.my_stop && g.ok) lines.push([g.floor_day + g.daily_limit - size * a.my_stop / 100, t("O teu stop"), "mine"]);
    const vals = bal.map((p) => p[1]).concat(eq.map((p) => p[1]), lines.map((l) => l[0]).filter((v) => v != null));
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = (hi - lo) * .08 || 1; lo -= pad; hi += pad;
    const X = (ts) => L + (x1 > x0 ? (ts - x0) / (x1 - x0) : 1) * (W - L - R);
    const Y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const path = (pts, step) => pts.map((p, i) => (i ? (step ? `H${X(p[0]).toFixed(1)}V${Y(p[1]).toFixed(1)}` : `L${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`) : `M${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`)).join("");
    const balPath = path(bal, true);
    const span = x1 - x0, n = W < 560 ? 3 : 5;
    const ticks = Array.from({ length: n + 1 }, (_, i) => { const ts = x0 + span * i / n; return `<text x="${X(ts).toFixed(1)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : i === n ? "end" : "middle"}">${span < 2 * 86400 ? hm(ts) : new Date(ts * 1000).toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit" })}</text>`; });
    let lastY = -99;
    const lab = lines.filter((l) => l[0] != null && l[0] >= lo && l[0] <= hi).sort((p, q) => Y(p[0]) - Y(q[0])).map(([v, name, c]) => {
      let y = Y(v); if (y - lastY < 26) y = lastY + 26; lastY = y;
      return `<line class="fn-l ${c}" x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="fn-lt ${c}" x="${W - R + 8}" y="${(y + 4).toFixed(1)}">${esc(name)}</text><text class="fn-lv" x="${W - R + 8}" y="${(y + 17).toFixed(1)}">${money(v, 0)}</text>`;
    }).join("");
    section("fn-chart", t("Saldo e equity"), seg("range", [["today", "Hoje"], ["7d", "7 dias"], ["all", "Tudo"]], range),
      `<svg class="fn-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(t("Saldo e equity com os limites da prop"))}">
        <path class="fn-area" d="${balPath}V${H - B}H${X(bal[0][0]).toFixed(1)}Z"/>${lab}
        <path class="fn-eq" d="${path(eq)}"/><path class="fn-bal" d="${balPath}"/>
        <circle class="fn-dot" cx="${X(now).toFixed(1)}" cy="${Y(s.equity).toFixed(1)}" r="4"/>
        <g class="fn-ax">${ticks.join("")}</g>
      </svg>
      <p class="fn-legend"><span class="b"></span>${esc(t("Saldo (trades fechadas)"))} <span class="e"></span>${esc(t("Equity (com as abertas)"))} <span class="f"></span>${esc(t("Limites da prop"))} <span class="g"></span>${esc(t("Objetivo"))}</p>`);
  }

  // ---------------------------------------------------------------- positions and orders
  function liveR(p) {
    const q = Object.values(Q).find((x) => x.name === p.symbol);
    if (!q || !p.sl || !q.bid) return null;
    return ((p.dir === "buy" ? 1 : -1) * ((p.dir === "buy" ? q.bid : q.ask) - p.price)) / Math.abs(p.price - p.sl);
  }
  // the broker's decimals for a symbol (from its quote), else guessed from the price: 2 for gold and indices, 5 for FX
  function digitsOf(name, v) { const q = Q[name] || Object.values(Q).find((x) => x.name === name); return q ? q.digits : v >= 1000 ? 2 : v >= 50 ? 3 : 5; }
  function paintPos() {
    const d = live();
    if (!d) return section("fn-pos", "", "", "");
    const s = d.snap || {}, P = s.positions || [], O = s.orders || [];
    const right = `<small>${P.length} ${esc(t("abertas"))} · ${O.length} ${esc(t("à espera"))}</small>${P.length || O.length ? `<button type="button" class="btn sm danger" data-act="closeall">${icon("stop")}${esc(t("Fechar tudo"))}</button>` : ""}`;
    const body = !P.length && !O.length ? `<p class="fn-none">${esc(t("Nada aberto. Usa o ticket para entrar, ou abre no MT5: aparece aqui logo."))}</p>` : `<div class="fn-tw"><table class="fn-t">
      <thead><tr><th>${esc(t("Símbolo"))}</th><th>${esc(t("Lado"))}</th><th>${esc(t("Lotes"))}</th><th>${esc(t("Entrada"))}</th><th>${esc(t("Stop"))}</th><th>${esc(t("Alvo"))}</th><th>${esc(t("Agora"))}</th><th>${esc(t("Resultado"))}</th><th>${esc(t("De quem"))}</th><th></th></tr></thead>
      <tbody>${P.map((p) => { const r = liveR(p), dg = digitsOf(p.symbol, p.price); return `<tr>
        <td><b>${esc(p.symbol)}</b><small>${dt(p.at)}</small></td><td>${sideTag(p.dir)}</td><td>${loc(p.volume, 2)}</td>
        <td>${px(p.price, dg)}</td><td>${p.sl ? px(p.sl, dg) : `<span class="down">${esc(t("sem stop"))}</span>`}</td><td>${px(p.tp, dg)}</td><td>${r == null ? "—" : `<span class="${cls(r)}">${r > 0 ? "+" : ""}${loc(r, 2)}R</span>`}</td>
        <td class="${cls(p.pnl)}"><b>${signed(p.pnl)}</b></td><td><small>${esc(who(p.magic))}</small></td>
        <td class="fn-acts"><button type="button" class="btn sm" data-half="${p.ticket}" title="${esc(t("Fechar metade"))}">½</button><button type="button" class="btn sm" data-be="${p.ticket}" title="${esc(t("Stop para o preço de entrada"))}">${esc(t("Stop na entrada"))}</button><button type="button" class="btn sm danger" data-close="${p.ticket}">${esc(t("Fechar"))}</button></td></tr>`; }).join("")}
      ${O.map((o) => { const dg = digitsOf(o.symbol, o.price); return `<tr class="wait"><td><b>${esc(o.symbol)}</b><small>${dt(o.at)}</small></td><td>${sideTag(o.dir)}<small>${esc(t("à espera"))}</small></td><td>${loc(o.volume, 2)}</td>
        <td>${px(o.price, dg)}</td><td>${px(o.sl, dg)}</td><td>${px(o.tp, dg)}</td><td>—</td><td>—</td><td><small>${esc(who(o.magic))}</small></td>
        <td class="fn-acts"><button type="button" class="btn sm" data-cancel="${o.ticket}">${esc(t("Cancelar"))}</button></td></tr>`; }).join("")}</tbody></table></div>`;
    section("fn-pos", t("Posições e ordens"), right, body);
  }

  // ---------------------------------------------------------------- the ticket
  function spec() { return Q[tk.sym] || null; }
  function tkPrice() { const q = spec(); if (!q) return null; return tk.kind === "market" ? (tk.dir === "buy" ? q.ask : q.bid) : parseFloat(tk.entry) || null; }
  function preview() {
    const q = spec(), d = live(), e = tkPrice(), sl = parseFloat(tk.sl), tp = parseFloat(tk.tp);
    if (!q || !d || !e || !sl || !q.per_unit) return null;
    const dist = Math.abs(e - sl);
    if (!dist) return null;
    const r = tk.risk ?? risk;
    let lots = tk.lots ? parseFloat(tk.lots) : Math.floor(d.snap.balance * r / 100 / (dist * q.per_unit) / q.step + 1e-9) * q.step;
    lots = Math.min(q.max, Math.round(lots * 100) / 100);
    const riskM = lots * dist * q.per_unit, left = (d.objectives || {}).left_today;
    return { lots, riskM, rew: tp ? lots * Math.abs(tp - e) * q.per_unit : null, rr: tp ? Math.abs(tp - e) / dist : null, wrong: tk.dir === "buy" ? sl >= e : sl <= e,
             small: lots < q.min, over: left != null && riskM > left, left, pts: dist / q.point };
  }
  function paintTicket() {
    const d = live();
    if (!d) return section("fn-ticket", "", "", "");
    const syms = Object.keys(Q).length ? Object.keys(Q) : (S.focus || []);
    section("fn-ticket", t("Ticket"), `<small id="fn-q"></small>`, `
      <div class="fn-syms">${syms.map((s) => `<button type="button" data-sym="${s}" class="${s === tk.sym ? "on" : ""}">${s}</button>`).join("")}</div>
      <div class="fn-dir"><button type="button" data-dir="buy" class="buy ${tk.dir === "buy" ? "on" : ""}">${esc(t("Compra"))}<small id="fn-ask"></small></button><button type="button" data-dir="sell" class="sell ${tk.dir === "sell" ? "on" : ""}">${esc(t("Venda"))}<small id="fn-bid"></small></button></div>
      ${seg("kind", [["market", "Mercado"], ["limit", "Limite"], ["stop", "Stop"]], tk.kind)}
      <div class="fn-f">
        <label ${tk.kind === "market" ? "hidden" : ""}>${esc(t("Preço de entrada"))}<input data-tk="entry" type="number" step="any" value="${esc(tk.entry)}"></label>
        <label>${esc(t("Stop"))}<input data-tk="sl" type="number" step="any" value="${esc(tk.sl)}" placeholder="${esc(t("obrigatório"))}"></label>
        <label>${esc(t("Alvo"))}<input data-tk="tp" type="number" step="any" value="${esc(tk.tp)}"></label>
        <div class="fn-chips">${RRS.map((x) => `<button type="button" data-rr="${x}">${String(x).replace(".", ",")}R</button>`).join("")}</div>
        <label>${esc(t("Risco"))}<span class="fn-chips">${RISKS.map((x) => `<button type="button" data-risk="${x}" class="${(tk.risk ?? risk) === x && !tk.lots ? "on" : ""}">${String(x).replace(".", ",")}%</button>`).join("")}<input data-tk="risk" type="number" step="0.05" min="0.05" max="5" value="${tk.risk ?? risk}"></span></label>
        <label>${esc(t("ou lotes à mão"))}<input data-tk="lots" type="number" step="0.01" min="0" value="${esc(tk.lots)}" placeholder="${esc(t("pelo risco"))}"></label>
      </div>
      <div class="fn-pv" id="fn-pv"></div>
      <button type="button" class="fn-send ${tk.dir}" id="fn-send" data-act="send"></button>
      <p class="fn-hint">${esc(t("Cada ordem leva stop. O Hub recusa a que, se bater no stop, passe o que podes perder hoje. Aparece como «Tu, no painel»."))}</p>`);
    paintQuote(); paintPreview();
  }
  function paintQuote() {
    const q = spec(), a = $("fn-ask"), b = $("fn-bid"), h = $("fn-q");
    if (!a) return;
    a.textContent = q && q.ask ? px(q.ask, q.digits) : "—";
    b.textContent = q && q.bid ? px(q.bid, q.digits) : "—";
    h.textContent = q ? `${q.name} · spread ${loc((q.ask - q.bid) / q.point, 0)} pts` : t("à espera da cotação do MT5");
  }
  function paintPreview() {
    const el = $("fn-pv"), btn = $("fn-send");
    if (!el) return;
    const p = preview(), q = spec(), verb = tk.dir === "buy" ? t("Comprar") : t("Vender");
    if (!p) { el.innerHTML = `<p class="fn-none">${esc(q ? t("Põe o stop (e o preço, se não for a mercado) para ver o lote e o risco.") : t("À espera da cotação do MT5."))}</p>`; btn.disabled = true; btn.textContent = verb; btn.className = `fn-send ${tk.dir}`; return; }
    el.innerHTML = `<dl>
      <div><dt>${esc(t("Lote"))}</dt><dd>${loc(p.lots, 2)}</dd></div>
      <div><dt>${esc(t("Arriscas"))}</dt><dd class="down">${money(p.riskM)}</dd></div>
      <div><dt>${esc(t("Ganhas no alvo"))}</dt><dd class="up">${p.rew != null ? money(p.rew) : "—"}</dd></div>
      <div><dt>${esc(t("Stop a"))}</dt><dd>${loc(p.pts, 0)} pts${p.rr ? ` · ${loc(p.rr, 2)}R` : ""}</dd></div></dl>
      ${p.wrong ? `<p class="bad">${esc(t("O stop está do lado errado."))}</p>` : p.small ? `<p class="bad">${esc(t("Abaixo do lote mínimo ({m}).", { m: q.min }))}</p>` : p.over ? `<p class="bad">${esc(t("Passa o que podes perder hoje ({m}).", { m: money(p.left) }))}</p>` : p.left != null ? `<p>${esc(t("{p}% do que ainda podes perder hoje.", { p: loc(p.riskM / Math.max(1, p.left) * 100, 0) }))}</p>` : ""}`;
    const armed = tk.armed && Date.now() - tk.armed < 6000;
    btn.disabled = p.wrong || p.small || p.over;
    btn.className = `fn-send ${tk.dir} ${armed ? "armed" : ""}`;
    btn.textContent = armed ? t("Confirmar: {v} {l} {s} (risco {m})", { v: verb.toLowerCase(), l: loc(p.lots, 2), s: tk.sym, m: money(p.riskM) }) : `${verb} ${loc(p.lots, 2)} ${tk.sym}`;
  }

  // ---------------------------------------------------------------- «Quanto queres arriscar?»
  function paintPlan() {
    const d = live();
    if (!d) return section("fn-plan", "", "", "");
    const a = d.account, s = d.snap, g = d.guard || {}, o = d.objectives || {}, st = d.stats || {};
    const size = o.size || a.size;
    const wr = plan.wr ?? (st.n >= 10 ? st.winrate : 45), rrr = plan.rrr ?? (st.n >= 10 && st.rrr ? st.rrr : 2), per = plan.perday || 2;
    const rm = s.balance * risk / 100;
    const eTrade = (wr / 100 * rrr - (1 - wr / 100)) * rm;
    const tgt = (o.items || []).find((i) => i.id === "target"), days = (o.items || []).find((i) => i.id === "days");
    const trades = tgt && eTrade > 0 ? Math.ceil(tgt.left / eTrade) : null;
    const estDays = trades != null ? Math.max(Math.ceil(trades / per), days ? days.left : 0) : null;
    const dayL = g.daily_limit ? Math.floor(g.daily_limit / rm) : null, maxL = g.max_limit ? Math.floor((g.max_limit - g.max_used) / rm) : null;
    const ruin = maxL != null ? Math.pow(1 - wr / 100, maxL) : null;
    section("fn-plan", t("Quanto queres arriscar?"), "", `
      <label class="fn-slide"><span>${esc(t("Risco por trade"))}</span><b id="fn-rk">${loc(risk, 2)}% · ${money(rm)}</b><input type="range" min="0.1" max="2" step="0.05" value="${risk}" data-plan="risk"></label>
      <div class="fn-f two">
        <label>${esc(t("O teu stop do dia (%)"))}<input type="number" step="0.1" min="0" value="${a.my_stop ?? ""}" placeholder="${esc(t("só o da prop"))}" data-acc-set="my_stop"></label>
        <label>${esc(t("A tua meta do dia (%)"))}<input type="number" step="0.1" min="0" value="${a.my_goal ?? ""}" placeholder="${esc(t("sem meta"))}" data-acc-set="my_goal"></label>
        <label>${esc(t("Acerto (%)"))}<input type="number" step="1" min="1" max="99" value="${wr}" data-plan="wr"></label>
        <label>${esc(t("RR médio"))}<input type="number" step="0.1" min="0.2" value="${rrr}" data-plan="rrr"></label>
        <label>${esc(t("Trades por dia"))}<input type="number" step="1" min="1" max="20" value="${per}" data-plan="perday"></label>
      </div>
      <ul class="fn-out">
        <li><span>${esc(t("Perdas seguidas até ao limite diário"))}</span><b>${dayL ?? "—"}</b></li>
        <li><span>${esc(t("Perdas seguidas até à perda máxima"))}</span><b>${maxL ?? "—"}</b></li>
        ${a.my_stop ? `<li><span>${esc(t("Paras o dia ao perder"))}</span><b class="down">${money(size * a.my_stop / 100)}</b></li>` : ""}
        ${a.my_goal ? `<li><span>${esc(t("Paras o dia ao ganhar"))}</span><b class="up">${money(size * a.my_goal / 100)}</b></li>` : ""}
        <li><span>${esc(t("Ganho esperado por trade"))}</span><b class="${cls(eTrade)}">${signed(eTrade)}</b></li>
        ${tgt ? `<li><span>${esc(t("Trades até ao objetivo"))}</span><b>${trades ?? esc(t("não chega lá"))}</b></li><li><span>${esc(t("Dias até passar (estimativa)"))}</span><b>${estDays ?? "—"}</b></li>` : ""}
        ${ruin != null ? `<li><span>${esc(t("Hipótese de perder tudo seguido"))}</span><b>${ruin < .0001 ? "&lt;0,01%" : `${loc(ruin * 100, 2)}%`}</b></li>` : ""}
      </ul>
      <p class="fn-hint">${esc(st.n >= 10 ? t("O acerto e o RR começam nos teus números reais ({n} trades). Muda-os para testar.", { n: st.n }) : t("Com 10 trades fechadas, o acerto e o RR passam a vir dos teus números reais."))} ${esc(t("O teu stop e a tua meta do dia também param os robôs."))}</p>`);
  }

  // ---------------------------------------------------------------- days
  function paintDays() {
    const d = live();
    if (!d) return section("fn-days", "", "", "");
    const days = d.days || [], by = Object.fromEntries(days.map((x) => [x.day, x]));
    const maxAbs = Math.max(1, ...days.map((x) => Math.abs(x.pnl)));
    const today = new Date(), todayIso = today.toISOString().slice(0, 10);
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7) - 7 * 5);   // the Monday six weeks back
    let cal = "";
    for (let w = 0; w < 6; w++) {
      let tot = 0, n = 0;
      for (let i = 0; i < 5; i++) {
        const day = new Date(start); day.setUTCDate(start.getUTCDate() + w * 7 + i);
        const iso = day.toISOString().slice(0, 10), x = by[iso];
        if (x) { tot += x.pnl; n += x.trades; }
        cal += `<div class="fn-cell ${x ? cls(x.pnl) : "off"} ${iso === todayIso ? "today" : ""}" style="--v:${x ? Math.abs(x.pnl / maxAbs).toFixed(2) : 0}" title="${x ? `${x.trades} trades · ${loc(x.lots, 2)} ${t("lotes")}` : ""}"><small>${day.getUTCDate()}</small>${x ? `<b>${signed(x.pnl, 0)}</b><i>${x.trades} ${esc(t("tr."))}</i>` : ""}</div>`;
      }
      cal += `<div class="fn-cell wk ${cls(tot)}"><small>${esc(t("semana"))}</small>${n ? `<b>${signed(tot, 0)}</b>` : "—"}</div>`;
    }
    const rows = days.slice(-30).reverse();
    section("fn-days", t("Dia a dia"), `<small>${d.trading_days} ${esc(t("dias de trading · o dia muda às 22:00 de Lisboa"))}</small>`, `
      <div class="fn-calh">${["Seg", "Ter", "Qua", "Qui", "Sex", ""].map((x) => `<span>${esc(t(x))}</span>`).join("")}</div>
      <div class="fn-cal">${cal}</div>
      ${rows.length ? `<div class="fn-tw"><table class="fn-t"><thead><tr><th>${esc(t("Dia"))}</th><th>${esc(t("Trades"))}</th><th>${esc(t("Lotes"))}</th><th>${esc(t("Ganhas / perdidas"))}</th><th>${esc(t("Melhor"))}</th><th>${esc(t("Pior"))}</th><th>${esc(t("Resultado"))}</th><th>%</th><th>${esc(t("Saldo"))}</th></tr></thead>
        <tbody>${rows.map((x) => `<tr><td>${esc(dday(x.day))}</td><td>${x.trades}</td><td>${loc(x.lots, 2)}</td><td><span class="up">${x.wins}</span> / <span class="down">${x.losses}</span></td><td class="up">${x.best != null ? signed(x.best) : "—"}</td><td class="down">${x.worst != null ? signed(x.worst) : "—"}</td>
          <td class="${cls(x.pnl)}"><b>${signed(x.pnl)}</b></td><td class="${cls(x.pct)}">${pct(x.pct)}</td><td>${money(x.balance)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="fn-none">${esc(t("Ainda sem trades nesta conta."))}</p>`}`);
  }

  // ---------------------------------------------------------------- statistics
  function paintStats() {
    const d = live();
    if (!d) return section("fn-stats", "", "", "");
    const s = d.stats || {};
    if (!s.n) return section("fn-stats", t("Estatística"), "", ui.empty("chart", "Ainda sem estatística", "Aparece com a primeira trade fechada nesta conta."));
    const k = (label, v, c = "", sub = "") => `<div class="fn-k"><small>${esc(t(label))}</small><b class="${c}">${v}</b>${sub ? `<em>${sub}</em>` : ""}</div>`;
    const tbl = (title, rows, map = (x) => x) => `<div class="fn-g"><h4>${esc(t(title))}</h4>${rows.map((x) => `<div class="fn-gr"><span>${esc(map(x.key))}</span><i>${x.n} · ${x.winrate}%</i><em>${x.avg_r != null ? `${x.avg_r > 0 ? "+" : ""}${loc(x.avg_r, 2)}R` : ""}</em><b class="${cls(x.pnl)}">${signed(x.pnl, 0)}</b></div>`).join("")}</div>`;
    section("fn-stats", t("Estatística"), `<small>${s.n} ${esc(t("trades fechadas"))}</small>`, `
      <div class="fn-kg">
        ${k("Acerto", `${loc(s.winrate, 1)}%`, "", `${s.wins} / ${s.losses}`)}${k("Resultado", signed(s.net), cls(s.net))}${k("Profit factor", s.pf != null ? loc(s.pf, 2) : "—")}
        ${k("Expectativa", signed(s.expectancy), cls(s.expectancy), t("por trade"))}${k("RR médio", s.rrr != null ? loc(s.rrr, 2) : "—", "", t("ganho médio ÷ perda média"))}
        ${k("R médio", s.avg_r != null ? `${s.avg_r > 0 ? "+" : ""}${loc(s.avg_r, 2)}R` : "—", cls(s.avg_r), s.total_r != null ? `${loc(s.total_r, 1)}R ${t("no total")}` : t("sem stop"))}
        ${k("Ganho médio", money(s.avg_win), "up")}${k("Perda média", money(-s.avg_loss), "down")}${k("Melhor trade", signed(s.best), "up")}${k("Pior trade", signed(s.worst), "down")}
        ${k("Lotes", loc(s.lots, 2), "", `${loc(s.avg_lots, 2)} ${t("por trade")}`)}${k("Duração média", dur(s.avg_minutes))}
        ${k("Seguidas", `${s.max_wins} / ${s.max_losses}`, "", t("ganhas / perdidas"))}${k("Drawdown máx.", money(-s.max_dd), "down", pct(-s.max_dd_pct))}
      </div>
      <div class="fn-gs">${tbl("Por instrumento", s.symbols)}${tbl("Por sessão (hora de NY)", s.sessions)}${tbl("Compras e vendas", s.long)}${tbl("Por dia da semana", s.weekdays)}${tbl("Quem fez", s.origins, (x) => ORIGIN_PT[x] || x)}</div>`);
  }

  // ---------------------------------------------------------------- the journal
  function paintTrades() {
    const d = live();
    if (!d) return section("fn-trades", "", "", "");
    const all = d.trades || [], syms = [...new Set(all.map((x) => x.symbol))];
    const rows = all.filter((x) => (!filt.sym || x.symbol === filt.sym) && (!filt.res || (filt.res === "w" ? x.pnl > 0 : x.pnl < 0)));
    const shown = rows.slice(0, 40 + filt.more);
    section("fn-trades", t("Diário de trades"), `<small>${rows.length}</small>`, `
      <div class="fn-filt">${seg("res", [["", "Todas"], ["w", "Ganhas"], ["l", "Perdidas"]], filt.res)}${syms.length > 1 ? seg("fsym", [["", "Todos"], ...syms.map((x) => [x, x])], filt.sym) : ""}</div>
      ${shown.length ? `<div class="fn-tw"><table class="fn-t"><thead><tr><th>${esc(t("Abriu"))}</th><th>${esc(t("Símbolo"))}</th><th>${esc(t("Lado"))}</th><th>${esc(t("Lotes"))}</th><th>${esc(t("Entrada"))}</th><th>${esc(t("Saída"))}</th><th>${esc(t("Stop"))}</th><th>R</th><th>${esc(t("Resultado"))}</th><th>${esc(t("Durou"))}</th><th>${esc(t("Sessão"))}</th><th>${esc(t("Quem"))}</th></tr></thead>
        <tbody>${shown.map((x) => { const dg = digitsOf(x.symbol, x.open_price); return `<tr><td>${dt(x.open_at)}</td><td><b>${esc(x.symbol)}</b></td><td>${sideTag(x.dir)}</td><td>${loc(x.volume, 2)}</td>
          <td>${px(x.open_price, dg)}</td><td>${px(x.close_price, dg)}</td><td>${px(x.sl, dg)}</td><td class="${cls(x.r)}">${x.r != null ? `${x.r > 0 ? "+" : ""}${loc(x.r, 2)}` : "—"}</td>
          <td class="${cls(x.pnl)}"><b>${signed(x.pnl)}</b></td><td>${dur(x.minutes)}</td><td>${esc(x.session)}</td><td><small>${esc(who(x.magic))}</small></td></tr>`; }).join("")}</tbody></table></div>
        ${rows.length > shown.length ? `<button type="button" class="btn quiet" data-act="more">${esc(t("Mostrar mais"))}</button>` : ""}` : `<p class="fn-none">${esc(all.length ? t("Nenhuma trade com este filtro.") : t("Ainda sem trades fechadas."))}</p>`}
      ${d.history_error ? `<p class="fn-hint bad">${esc(d.history_error)}</p>` : ""}`);
  }

  // ---------------------------------------------------------------- side
  function paintReward() {
    const d = live(), r = d && d.reward;
    if (!r) return section("fn-reward", "", "", "");
    section("fn-reward", t("Recompensa"), "", `
      <div class="fn-rw"><div><small>${esc(t("Lucro na conta"))}</small><b class="${cls(r.profit)}">${signed(r.profit)}</b></div><div><small>${esc(t("A tua parte ({s}%)", { s: r.split }))}</small><b class="up">${money(r.reward)}</b></div>
        <div><small>${esc(t("Próximo pedido"))}</small><b>${r.next ? new Date(r.next * 1000).toLocaleDateString("pt-PT", { day: "2-digit", month: "short" }) : "—"}</b><em>${r.days != null ? esc(t("daqui a {d} dias", { d: loc(r.days, 0) })) : ""}</em></div></div>
      ${r.payouts.length ? `<ul class="fn-out">${r.payouts.map((p) => `<li><span>${new Date(p.at * 1000).toLocaleDateString("pt-PT")}</span><b>${money(p.money)}</b></li>`).join("")}</ul>` : ""}
      <p class="fn-hint">${esc(t("1.º pedido {f} dias depois da 1.ª trade, depois de {c} em {c} dias (muda em «Conta e regras»).", { f: r.first, c: r.cycle }))}</p>`);
  }
  function paintNews() {
    const d = live();
    if (!d) return section("fn-news", "", "", "");
    const n = d.news || [];
    section("fn-news", t("Notícias vermelhas"), `<small>USD · EUR · GBP</small>`, `
      ${n.length ? `<ul class="fn-news">${n.map((e) => `<li class="${e.t * 1000 < Date.now() ? "past" : e.t * 1000 - Date.now() < 3600e3 ? "soon" : ""}"><span class="fn-ccy">${esc(e.ccy)}</span><div><b>${esc(e.title)}</b><small>${new Date(e.t * 1000).toLocaleString("pt-PT", { weekday: "short", hour: "2-digit", minute: "2-digit" })} · ${esc(until(e.t))}${e.actual != null ? ` · ${esc(t("saiu"))} ${esc(String(e.actual))}${esc(e.unit)} / ${esc(t("prev."))} ${esc(String(e.forecast ?? "—"))}${esc(e.unit)}` : e.forecast != null ? ` · ${esc(t("prev."))} ${esc(String(e.forecast))}${esc(e.unit)}` : ""}</small></div></li>`).join("")}</ul>` : `<p class="fn-none">${esc(t("Nenhuma nas próximas 48 h."))}</p>`}
      <p class="fn-hint">${esc(t("Na avaliação da Stellar pode-se negociar na notícia. Numa conta financiada confirma a regra das notícias no painel da FundedNext."))} <a href="#/sinal">${esc(t("Sinal na notícia"))}</a></p>`);
  }
  function paintBots() {
    const d = D();
    if (!d) return section("fn-bots", "", "", "");
    const a = d.account, R = d.robots || [], mine = R.filter((r) => r.mine);
    if (!R.length) return section("fn-bots", "", "", "");
    section("fn-bots", t("Robôs nesta conta"), `<small>${mine.length} ${esc(t("de"))} ${R.length}</small>`, `
      <p class="fn-hint first">${esc(a.mode === "auto" ? t("Automático: os robôs marcados enviam as trades deles para esta conta, com o guarda da prop e os teus limites.") : t("Em «Observar» nada é enviado. Marca os robôs e liga «Robôs em automático» lá em cima."))}</p>
      <ul class="fn-bots">${R.map((r) => `<li class="${r.mine ? "on" : ""}"><label><input type="checkbox" data-bot="${esc(r.id)}" ${r.mine ? "checked" : ""}><span><b>${esc(r.name)}</b><small>${esc(r.squad)} · ${esc(r.symbols.join(", "))} · ${esc(r.from)}–${esc(r.to)}${r.on ? "" : ` · ${esc(t("desligado"))}`}</small></span></label>
        ${r.mine ? `<span class="fn-br"><input type="number" step="0.05" min="0.05" max="3" value="${r.risk}" data-bot-risk="${esc(r.id)}" title="${esc(t("Risco por trade (%)"))}">%</span>` : ""}</li>`).join("")}</ul>
      <a class="fn-link" href="#/robos">${esc(t("Ver os robôs no escritório"))} →</a>`);
  }
  function paintRules() {
    const d = D();
    if (!d) return section("fn-rules", "", "", "");
    const a = d.account, ph = (d.objectives || {}).phase || {};
    const phases = (d.phases || {})[a.preset] || [];
    const phName = ph.name || (phases.find((p) => p.id === a.phase) || {}).name || "—";
    section("fn-rules", t("Conta e regras"), `<button type="button" class="btn sm quiet" data-act="cfg">${esc(cfgOpen ? t("Fechar") : t("Mudar"))}</button>`, `
      <ul class="fn-out">
        <li><span>${esc(t("Programa"))}</span><b>${esc(a.preset_name)}</b></li><li><span>${esc(t("Fase"))}</span><b>${esc(phName)}</b></li>
        <li><span>${esc(t("Tamanho"))}</span><b>${money(a.size, 0)}</b></li>
        <li><span>${esc(t("Perda diária"))}</span><b>${a.daily}% · ${esc(t("do maior entre saldo e equity às 22:00 de Lisboa"))}</b></li>
        <li><span>${esc(t("Perda máxima"))}</span><b>${a.max}% · ${esc(t("fixa, do tamanho da conta"))}</b></li>
        <li><span>${esc(t("Objetivo"))}</span><b>${a.target ? `${a.target}%` : esc(t("sem objetivo (financiada)"))}</b></li>
        <li><span>${esc(t("Dias mínimos"))}</span><b>${a.min_days ?? ph.min_days ?? 0}</b></li>
        <li><span>${esc(t("Guarda dos robôs"))}</span><b>${esc(t("sem ordens a {s}% de um limite, fecha tudo a {p}%", { s: a.stop_at, p: a.panic_at }))}</b></li>
        <li><span>${esc(t("Login · servidor"))}</span><b>${esc(String(a.login || "—"))} · ${esc(a.server || "—")}${a.attach ? ` · ${esc(t("pelo MT5 aberto"))}` : ""}</b></li>
      </ul>
      ${cfgOpen ? `<form class="fn-f two fn-cfg" id="fn-cfg">
        <label>${esc(t("Nome"))}<input name="name" value="${esc(a.name)}"></label>
        <label>${esc(t("Programa"))}<select name="preset">${(d.programs || []).map((p) => `<option value="${p.id}" ${p.id === a.preset ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>
        <label>${esc(t("Fase"))}<select name="phase">${phases.map((p) => `<option value="${p.id}" ${p.id === (ph.id || a.phase) ? "selected" : ""}>${esc(p.name)}${p.target ? ` (${p.target}%)` : ""}</option>`).join("")}</select></label>
        <label>${esc(t("Tamanho da conta"))}<input name="size" type="number" step="1" value="${a.size || ""}"></label>
        <label>${esc(t("Perda diária (%)"))}<input name="daily" type="number" step="0.1" value="${a.daily}"></label>
        <label>${esc(t("Perda máxima (%)"))}<input name="max" type="number" step="0.1" value="${a.max}"></label>
        <label>${esc(t("Objetivo (%)"))}<input name="target" type="number" step="0.1" value="${a.target ?? ""}"></label>
        <label>${esc(t("Dias mínimos"))}<input name="min_days" type="number" step="1" value="${a.min_days ?? ""}"></label>
        <label>${esc(t("Começou a"))}<input name="start" type="date" value="${esc(a.start || "")}"></label>
        <label>${esc(t("A tua parte do lucro (%)"))}<input name="split" type="number" step="1" value="${a.split ?? 80}"></label>
        <label>${esc(t("1.º pedido (dias)"))}<input name="first_reward" type="number" step="1" value="${a.first_reward ?? 21}"></label>
        <label>${esc(t("Depois, de x em x dias"))}<input name="cycle" type="number" step="1" value="${a.cycle ?? 14}"></label>
        <label>${esc(t("Robôs param a (% do limite)"))}<input name="stop_at" type="number" value="${a.stop_at}"></label>
        <label>${esc(t("Robôs fecham tudo a (%)"))}<input name="panic_at" type="number" value="${a.panic_at}"></label>
        <div class="fn-btns"><button type="submit" class="btn primary">${esc(t("Guardar"))}</button><button type="button" class="btn" data-act="detect">${icon("link")}${esc(t("Apanhar outra vez do MT5"))}</button></div>
      </form>` : ""}
      <p class="fn-hint">${esc(t("Números da Stellar em 2026 (2-Step: 8% e 5%, diária 5%, máxima 10%, 5 dias; 1-Step: 10%, 3%, 6%; Lite: 8% e 4%, 4%, 8%). A FundedNext muda-os de vez em quando: confirma no painel deles."))}</p>`);
  }
  function paintLog() {
    const d = D(), L = (d && d.log) || [];
    if (!d || !L.length) return section("fn-log", "", "", "");
    section("fn-log", t("O que aconteceu"), "", `<ul class="fn-log">${L.slice(0, 14).map((x) => `<li class="${esc(x.kind)}"><small>${dt(x.t)}</small>${esc(x.text)}</li>`).join("")}</ul>`);
  }

  // ================================================================ events
  function bind() {
    const root = $("fn");
    root.addEventListener("click", async (e) => {
      const b = e.target.closest("button");
      if (!b || b.hasAttribute("data-retry")) return;
      const d = b.dataset, id = D() && D().id, base = id ? `/api/fundednext/${encodeURIComponent(id)}` : "";
      try {
        if (d.acc) { acc = d.acc; store.set("acc", acc); ticketReset(); Q = {}; $("fn-ticket")._html = ""; return load(true); }
        if (d.range) { range = d.range; return paintChart(); }
        if (d.res !== undefined) { filt.res = d.res; filt.more = 0; return paintTrades(); }
        if (d.fsym !== undefined) { filt.sym = d.fsym; filt.more = 0; return paintTrades(); }
        if (d.act === "more") { filt.more += 60; return paintTrades(); }
        if (d.act === "refresh") { b.disabled = true; await load(true); return; }
        if (d.act === "cfg") { cfgOpen = !cfgOpen; paintRules(); if (cfgOpen) $("fn-rules").scrollIntoView({ behavior: "smooth", block: "start" }); return; }
        if (d.act === "mt5") { await api("/api/fundednext/open-mt5", { method: "POST" }); return msg(t("O MT5 está a abrir. Entra na conta da FundedNext com «Guardar password» e carrega em «Apanhar a conta do MT5».")); }
        if (d.act === "detect" || d.act === "force") {
          b.disabled = true; b.textContent = t("A procurar no MT5…");
          const r = await post("/api/fundednext/detect", { force: d.act === "force" });
          paintStart.found = { ...r.found, ask: r.ask };
          if (!D()) paintStart();
          if (r.found && r.found.ok && !r.ask) msg(t("Conta {l} ligada.", { l: r.found.login }), "ok");
          else if (r.found && !r.found.ok) msg(r.found.error, "bad");
          return;
        }
        if (d.mode) {
          if (d.mode === "auto" && D().account.mode !== "auto" && b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = t("Ordens reais: carrega outra vez"); return; }
          await api(`/api/robots/account/${encodeURIComponent(id)}/mode`, { method: "POST", body: { mode: d.mode } });
          return load(true);
        }
        if (d.act === "closeall") {
          if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = t("Fecha TUDO (as tuas e as dos robôs): carrega outra vez"); return; }
          const r = await post(`${base}/close-all`); return msg(t("Fechar tudo: {r}.", { r: r.result }), "ok");
        }
        if (d.close) { b.disabled = true; await post(`${base}/close`, { ticket: +d.close }); return msg(t("Posição fechada."), "ok"); }
        if (d.half) { b.disabled = true; await post(`${base}/close`, { ticket: +d.half, half: true }); return msg(t("Fechei metade."), "ok"); }
        if (d.be) { b.disabled = true; await post(`${base}/modify`, { ticket: +d.be, be: true }); return msg(t("Stop no preço de entrada."), "ok"); }
        if (d.cancel) { b.disabled = true; await post(`${base}/cancel`, { ticket: +d.cancel }); return msg(t("Ordem cancelada."), "ok"); }
        // the ticket
        if (d.sym) { tk.sym = d.sym; tk.entry = tk.sl = tk.tp = ""; tk.armed = 0; return paintTicket(); }
        if (d.dir) { tk.dir = d.dir; tk.armed = 0; return paintTicket(); }
        if (d.kind) { tk.kind = d.kind; tk.armed = 0; if (d.kind !== "market" && !tk.entry && spec()) tk.entry = String(tk.dir === "buy" ? spec().ask : spec().bid); return paintTicket(); }
        if (d.risk) { tk.risk = +d.risk; tk.lots = ""; tk.armed = 0; return paintTicket(); }
        if (d.rr) {
          const p = tkPrice(), sl = parseFloat(tk.sl), q = spec();
          if (!p || !sl) return msg(t("Primeiro o stop."));
          tk.tp = (p + (tk.dir === "buy" ? 1 : -1) * +d.rr * Math.abs(p - sl)).toFixed(q ? q.digits : 5); tk.armed = 0; return paintTicket();
        }
        if (d.act === "send") {
          if (!tk.armed || Date.now() - tk.armed > 6000) { tk.armed = Date.now(); paintPreview(); setTimeout(paintPreview, 6100); return; }
          tk.armed = 0; b.disabled = true; b.textContent = t("A enviar…");
          const body = { symbol: tk.sym, dir: tk.dir, kind: tk.kind, entry: tk.entry, sl: tk.sl, tp: tk.tp };
          if (tk.lots) body.volume = tk.lots; else body.risk = tk.risk ?? risk;
          const r = await post(`${base}/order`, body);
          ticketReset(); paintTicket();
          return msg(t("Entrou: {l} {s} (risco {m}).", { l: r.result.volume, s: r.result.symbol, m: money(r.result.risk) }), "ok");
        }
      } catch (err) { msg(err.message, "bad"); if (D()) paintAll(); }
    });
    root.addEventListener("input", (e) => {
      const x = e.target, d = x.dataset;
      if (d.tk) { tk[d.tk] = d.tk === "risk" ? (parseFloat(x.value) || null) : x.value; if (d.tk === "risk") tk.lots = ""; tk.armed = 0; paintPreview(); return; }
      if (d.plan === "risk") { risk = +x.value; store.set("risk", risk); const l = $("fn-rk"); if (l && live()) l.textContent = `${loc(risk, 2)}% · ${money(live().snap.balance * risk / 100)}`; return; }
      if (d.plan) { plan[d.plan] = x.value === "" ? null : +x.value; store.set("plan", plan); }
    });
    root.addEventListener("change", async (e) => {
      const x = e.target, d = x.dataset, id = D() && D().id;
      try {
        if (d.plan === "risk") { tk.risk = null; x.blur(); await load(true); paintPlan(); paintTicket(); return; }
        if (d.plan) { x.blur(); paintPlan(); return; }
        if (d.accSet) { x.blur(); await post(`/api/fundednext/${encodeURIComponent(id)}/settings`, { [d.accSet]: x.value }); paintPlan(); return msg(t("Guardado."), "ok"); }
        if (d.bot) { await api(`/api/robots/robot/${encodeURIComponent(d.bot)}`, { method: "POST", body: { account: x.checked ? id : "" } }); return load(true); }
        if (d.botRisk) { await api(`/api/robots/robot/${encodeURIComponent(d.botRisk)}`, { method: "POST", body: { risk: x.value } }); return load(true); }
        if (x.form && x.form.id === "fn-cfg" && x.name === "preset") {
          const ph = (D().phases || {})[x.value] || [];
          x.form.phase.innerHTML = ph.map((p) => `<option value="${p.id}">${esc(p.name)}${p.target ? ` (${p.target}%)` : ""}</option>`).join("");
        }
      } catch (err) { msg(err.message, "bad"); }
    });
    root.addEventListener("submit", async (e) => {
      if (e.target.id !== "fn-cfg") return;
      e.preventDefault();
      const body = {};
      new FormData(e.target).forEach((v, k) => { body[k] = v; });
      const a = D().account;
      if (body.preset !== a.preset) { delete body.daily; delete body.max; delete body.target; delete body.min_days; }
      else if (body.phase !== a.phase && body.target === String(a.target ?? "")) { delete body.target; delete body.min_days; }   // a new phase brings its own target
      try { cfgOpen = false; await post(`/api/fundednext/${encodeURIComponent(D().id)}/settings`, body); paintRules(); msg(t("Conta guardada."), "ok"); } catch (err) { cfgOpen = true; msg(err.message, "bad"); }
    });
  }
  function ticketReset() { Object.assign(tk, { entry: "", sl: "", tp: "", lots: "", armed: 0, risk: null }); }
})();
