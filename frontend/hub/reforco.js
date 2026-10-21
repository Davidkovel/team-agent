// Reforço na notícia (#/reforco, a tab of the Sala de Trading): on a US release the trader opens the main position by hand
// in MT5 (1.5% of the allocation), switches the reforço on here first, and the Hub adds to it: a ladder of limit orders
// towards the VWAP band on the far side, the same risk on each step (bigger lots closer to the stop), 0.5% in all, TP from
// the release's history (backend/app/tradingroom/newsadd.py). Runs on the PC where the MT5 account is (the Robôs' accounts).
// The page says in one panel, right under the head, which state it is in, why, and what to do next (Marco, 21 Oct: the
// grey «Start» did not say if it was off, broken or waiting).
(function () {
  let S = null, timer = 0, sure = false;
  const STATUS = { pending: "à espera", filled: "cheia", closed: "fechada", cancelled: "cancelada", error: "erro" };
  const SUR = { BELOW: "abaixo da previsão", ABOVE: "acima da previsão", INLINE: "igual à previsão" };
  const num = (v, d = 2) => (v == null ? "—" : Number(v).toLocaleString("pt-PT", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const usd = (v) => (v == null ? "—" : `${v < 0 ? "−" : ""}$${num(Math.abs(v))}`);
  const pct = (v) => (v == null ? "—" : `${v > 0 ? "+" : ""}${num(v, 2)}%`);
  const hm = (ts) => new Date(ts * 1000).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
  const on = () => S && S.run && S.run.phase !== "done";
  const sec = (title, hint = "") => `<div class="sec"><span>${esc(t(title))}</span>${hint ? `<small class="rf-sr">${hint}</small>` : ""}</div>`;
  const cell = (label, value, sub = "", cls = "") => `<div><span class="bd-l">${esc(t(label))}</span><b class="${cls}">${value}</b>${sub ? `<small>${sub}</small>` : ""}</div>`;

  HUB_VIEWS.reforco = async function () {
    page(`<div class="rf" id="rf">
      ${ui.head("Trading", t("Reforço na notícia"), t("Numa notícia dos EUA tu abres a posição no MT5 e o Hub junta-lhe ordens limite até ao stop na banda da VWAP, com o TP da estatística."),
        `<div class="rf-ctl" id="rf-ctl"></div>`)}
      <div class="rf-msg" id="rf-msg" hidden></div>
      <section class="panel rf-state" id="rf-state"></section>
      <div class="rf-grid">
        <div>${sec("Notícia", esc(t("a próxima forte dos EUA em 2 horas")))}<section class="panel pad rf-card" id="rf-news"></section></div>
        <div>${sec("Conta e bandas da VWAP")}<section class="panel pad rf-card" id="rf-market"></section></div>
      </div>
      ${sec("Ordens de reforço")}
      <section class="panel pad rf-card" id="rf-run"></section>
      <div class="rf-grid">
        <div>${sec("Definições", esc(t("guardam-se sozinhas")))}<section class="panel pad rf-card" id="rf-cfg"></section></div>
        <div>${sec("Diário")}<section class="panel pad rf-card" id="rf-log"></section></div>
      </div>
    </div>`);
    bind();
    await load().catch((e) => msg(e.message));
    clearInterval(timer);
    timer = setInterval(() => { if (!$("rf")) { clearInterval(timer); return; } if (!document.hidden) load().catch(() => {}); }, 3000);
  };

  async function load() {
    S = await api("/api/reforco");
    paintCtl(); paintNews(); paintMarket(); paintRun(); paintLog();
    if (!$("rf-cfg")._html) paintCfg();
  }

  function msg(text) {
    const el = $("rf-msg");
    if (!el) return;
    el.hidden = false; el.textContent = text;
    clearTimeout(msg.t); msg.t = setTimeout(() => { el.hidden = true; }, 5000);
  }

  // Which state the reforço is in, in plain words: why, the next thing to do, and which of the three steps it is at.
  function stage() {
    const r = S.run, c = S.cfg, n = S.news, sym = c.symbol;
    if (!S.accounts.length) return { tone: "off", chip: "Não corre neste PC", step: 0, title: "O reforço corre no PC com a conta MT5",
      text: t("Neste PC não há conta MT5. A conta FundedNext está no PC do Marco: abre o Hub dele e liga lá o reforço antes da notícia. Se a conta for ligada aqui, em Robôs › Contas, o reforço passa a correr neste PC.") };
    if (on() && r.phase === "waiting") return { tone: "wait", chip: "À espera da tua posição", step: 2, title: "Ligado: abre agora a tua posição no MT5",
      text: t("O Hub está a vigiar a conta. Abre a posição principal à mão em {s}, como sempre: em segundos aparecem aqui as ordens de reforço. Parar desliga sem mexer em nada.", { s: sym }) };
    if (on() && r.phase === "placed") return { tone: "ok", chip: "Reforço colocado", step: 3, title: "Reforço colocado na conta",
      text: t("As ordens limite estão na conta até ao stop na banda {b}σ. A tua posição nunca é tocada; o que não encher é cancelado quando ela fechar, quando carregares em Parar ou ao fim de {w} min.", { b: r.band || c.band, w: c.window }) };
    if (!c.account) return { tone: "wait", chip: "Falta escolher a conta", step: 0, title: "Escolhe a conta MT5",
      text: t("Em Definições, escolhe a conta onde vais abrir a posição. Depois liga o reforço antes da notícia.") };
    const when = n ? t("Liga antes de {n} ({h}).", { n: n.name, h: hm(new Date(n.t) / 1000) }) : t("Liga antes da próxima notícia forte dos EUA.");
    return { tone: "off", chip: "Desligado", step: 1, title: r && r.phase === "done" ? "O último reforço terminou" : "Pronto a ligar",
      text: `${when} ${t("Depois abre a tua posição no MT5 como sempre: o Hub vê-a e põe as ordens de reforço.")}` };
  }

  function paintCtl() {
    const st = stage(), r = S.run;
    let btns;
    if (!S.accounts.length) btns = `${S.marco ? `<a class="btn primary" href="${esc(S.marco)}" target="_blank" rel="noopener">${esc(t("Abrir o Hub do Marco"))}</a>` : ""}
      <a class="btn quiet" href="#/robos">${esc(t("Ligar uma conta aqui"))}</a>`;
    else if (on()) btns = `<button type="button" class="btn" data-act="stop">${icon("stop")}${esc(t("Parar"))}</button>
      ${r.phase === "placed" ? `<button type="button" class="btn danger" data-act="close">${esc(sure ? t("Tens a certeza? Carrega outra vez") : t("Parar e fechar reforços"))}</button>` : ""}`;
    else if (!S.cfg.account) btns = `<button type="button" class="btn primary" data-act="pick">${esc(t("Escolher a conta"))}</button>`;
    else btns = `<button type="button" class="btn primary" data-act="start">${icon("play")}${esc(t("Ligar o reforço"))}</button>`;
    paint($("rf-ctl"), `<span class="st ${st.tone}"><i></i>${esc(t(st.chip))}</span>${btns}`);
    const steps = ["Ligar antes da notícia", "Abrir a tua posição no MT5", "O Hub põe o reforço"];
    paint($("rf-state"), `<div class="rf-state-t"><b>${esc(t(st.title))}</b><p>${esc(st.text)}</p></div>
      <ol class="rf-steps">${steps.map((x, i) => `<li class="${st.step > i + 1 ? "done" : st.step === i + 1 ? "now" : ""}"><i>${st.step > i + 1 ? icon("tick") : i + 1}</i><span>${esc(t(x))}</span></li>`).join("")}</ol>`);
    $("rf-state").className = `panel rf-state ${st.tone}`;
  }

  function paintNews() {
    const n = S.news;
    if (!n) return paint($("rf-news"), ui.empty("news", "Sem notícia forte em 2 horas", "Quando faltar pouco para uma notícia dos EUA de alto impacto, aparece aqui com a previsão e o que o ouro fez nas vezes anteriores.",
      `<a class="btn sm" href="#/trading">${esc(t("Ver o calendário na Sala"))}</a>`));
    const dt = (new Date(n.t) - Date.now()) / 1000;
    const when = dt > 0 ? t("daqui a {m} min", { m: Math.ceil(dt / 60) }) : t("saiu há {m} min", { m: Math.floor(-dt / 60) });
    const row = (s) => { const g = (n.table[s] || {}).GOLD; return g ? `<tr><td>${esc(t(SUR[s]))}</td><td class="${g.avg < 0 ? "down" : "up"}">${pct(g.avg)}</td><td>${g.up}/${g.n} ${esc(t("a subir"))}</td></tr>` : ""; };
    paint($("rf-news"), `<div class="rf-title"><b>${esc(n.name)}</b><span>${hm(new Date(n.t) / 1000)} · ${esc(when)}</span></div>
      <div class="bd-stats rf-figs">${cell("Previsão", `${esc(n.forecast ?? "—")}${esc(n.unit || "")}`)}
        ${cell("Saiu", `${esc(n.actual ?? "—")}${n.actual != null ? esc(n.unit || "") : ""}`)}
        ${cell("Anterior", `${esc(n.previous ?? "—")}${esc(n.unit || "")}`)}
        ${cell("Resultado", esc(n.surprise ? t(SUR[n.surprise]) : "—"), "", n.surprise === "ABOVE" ? "down" : n.surprise === "BELOW" ? "up" : "")}</div>
      <h4>${esc(t("Ouro nos primeiros 5 min, desde {y}", { y: n.since || "" }))}</h4>
      <table class="rf-t">${row("BELOW")}${row("ABOVE")}${row("INLINE")}</table>`);
  }

  function paintMarket() {
    const m = S.market || {}, c = S.cfg;
    if (!S.accounts.length) {
      return paint($("rf-market"), ui.empty("link", "Sem conta MT5 neste PC", "As bandas e o teu lote leem-se da conta FundedNext, no PC onde ela está (o do Marco).",
        S.marco ? `<a class="btn sm" href="${esc(S.marco)}" target="_blank" rel="noopener">${esc(t("Abrir o Hub do Marco"))}</a>` : ""));
    }
    if (!m.ok) return paint($("rf-market"), `<div class="rf-title"><b>${esc(c.symbol)}</b></div><p class="rf-none">${esc(m.error || t("A ler a conta…"))}</p>`);
    const d = m.digits, lv = (k) => num(m.vwap + k * m.sd, d);
    const main = (dir, label) => { const x = m.main[dir]; return x ? cell(label, `${num(x.volume)} <small>${esc(t("lotes"))}</small>`, `${esc(t("stop"))} ${num(x.stop, d)} (${x.band}σ) · ${usd(x.risk)}`) : ""; };
    paint($("rf-market"), `<div class="rf-title"><b>${esc(m.symbol)}</b><span>${num(m.bid, d)} / ${num(m.ask, d)}</span></div>
      <div class="rf-bands"><span>−2σ <b>${lv(-2)}</b></span><span class="g">−1σ <b>${lv(-1)}</b></span><span class="v">VWAP <b>${num(m.vwap, d)}</b></span><span class="g">+1σ <b>${lv(1)}</b></span><span>+2σ <b>${lv(2)}</b></span></div>
      <h4>${esc(t("O teu lote principal ({p}% = {m})", { p: num(c.main_pct, 1), m: usd(c.alloc * c.main_pct / 100) }))}</h4>
      <div class="bd-stats rf-main">${main("sell", "Venda")}${main("buy", "Compra")}</div>`);
  }

  function paintRun() {
    const r = S.run;
    if (!r) return paint($("rf-run"), ui.empty("target", "Ainda sem reforço", "Liga o reforço antes da notícia e abre a tua posição no MT5: a escada de ordens limite aparece aqui, com o stop, o TP e o risco de cada uma."));
    const d = (S.market && S.market.digits) || 2, m = r.main;
    const PH = { waiting: "À espera da tua posição no MT5", placed: "Reforço colocado", done: "Terminado" };
    const head = m ? `<div class="bd-stats rf-figs">
        ${cell("A tua posição", `${esc(t(m.dir === "sell" ? "Venda" : "Compra"))} ${num(m.volume)}`, `${esc(t("a"))} ${num(m.price, d)}`, m.dir === "sell" ? "down" : "up")}
        ${cell("Stop dos reforços", num(r.stop, d), r.band ? `${esc(t("banda"))} ${r.band}σ` : "")}
        ${cell("Take-profit", num(r.tp, d), r.tp_pct != null ? `${num(r.tp_pct)}%` : "")}
        ${cell("Risco do reforço", usd(r.levels.filter((l) => l.status !== "error" && l.status !== "cancelled").reduce((a, l) => a + l.risk, 0)), `${num(r.cfg.add_pct, 1)}% ${esc(t("de"))} ${usd(r.cfg.alloc)}`)}</div>` : "";
    const rows = r.levels.map((l) => `<tr class="rf-s-${l.status}"><td>${l.n}</td><td>${num(l.price, d)}</td><td>${num(l.volume)}</td><td>${usd(l.risk)}</td><td>${esc(t(STATUS[l.status] || l.status))}${l.error ? ` · ${esc(l.error)}` : ""}</td><td class="${(l.pnl || 0) < 0 ? "down" : (l.pnl || 0) > 0 ? "up" : ""}">${l.pnl != null ? usd(l.pnl) : ""}</td></tr>`).join("");
    paint($("rf-run"), `<div class="rf-title"><b>${esc(t(PH[r.phase] || r.phase))}</b>${r.news ? `<span>${esc(r.news.name || r.news.key)}</span>` : ""}</div>${head}
      ${rows ? `<table class="rf-t rf-lad"><thead><tr><th>#</th><th>${esc(t("Preço"))}</th><th>${esc(t("Lotes"))}</th><th>${esc(t("Risco"))}</th><th>${esc(t("Estado"))}</th><th>${esc(t("Resultado"))}</th></tr></thead><tbody>${rows}</tbody></table>`
        : `<p class="rf-none">${esc(t(r.phase === "waiting" ? "Abre a tua posição no MT5 (ordem manual): o Hub junta-lhe o reforço em segundos." : "Sem ordens de reforço."))}</p>`}`);
  }

  function paintCfg() {
    const c = S.cfg;
    const opt = (v, label, cur) => `<option value="${esc(v)}" ${String(v) === String(cur) ? "selected" : ""}>${esc(label)}</option>`;
    const hint = (h) => (h ? `<em>${esc(t(h))}</em>` : "");
    const field = (k, label, step, h = "") => `<label class="field">${esc(t(label))}<input type="number" name="${k}" value="${c[k]}" step="${step}">${hint(h)}</label>`;
    paint($("rf-cfg"), `<form class="rf-form" id="rf-form">
      <label class="field">${esc(t("Conta MT5"))}<select name="account" id="rf-account">${opt("", t("— escolhe —"), c.account)}${S.accounts.map((a) => opt(a.id, a.name, c.account)).join("")}</select>${S.accounts.length ? "" : hint("Nenhuma conta neste PC")}</label>
      <label class="field">${esc(t("Instrumento"))}<select name="symbol">${S.symbols.map((s) => opt(s, s, c.symbol)).join("")}</select></label>
      ${field("alloc", "Alocação ($)", "1000")}
      ${field("main_pct", "Risco da tua posição (%)", "0.1", "Só para o cálculo do teu lote")}
      ${field("add_pct", "Risco do reforço (%)", "0.1")}
      ${field("levels", "Ordens no reforço", "1")}
      <label class="field">${esc(t("Stop na banda"))}<select name="band">${opt(1, t("1σ (verde)"), c.band)}${opt(2, "2σ", c.band)}</select>${hint("Se o preço já passou a banda, usa a seguinte")}</label>
      ${field("buffer_pct", "Folga além da banda (%)", "0.01")}
      <label class="field">${esc(t("Bandas como no TradingView"))}<select name="tf">${opt(15, "15m", c.tf)}${opt(5, "5m", c.tf)}${opt(1, "1m", c.tf)}</select>${hint("O tempo gráfico onde vês a VWAP")}</label>
      <label class="rf-check"><input type="checkbox" name="tp_auto" ${c.tp_auto ? "checked" : ""}><span>${esc(t("TP pela estatística da notícia"))}</span></label>
      ${field("tp_pct", "TP fixo (%)", "0.05", "Quando não há estatística")}
      ${field("window", "Ordens válidas (min)", "5")}
    </form>`);
  }

  function paintLog() {
    paint($("rf-log"), S.log.length ? `<ul class="rf-logl">${S.log.map((l) => `<li class="${l.kind}"><time>${hm(l.t)}</time>${esc(l.text)}</li>`).join("")}</ul>`
      : ui.empty("doc", "Nada ainda", "Aqui fica o que o reforço fez: quando ligou, as ordens que pôs e as que a conta recusou."));
  }

  function bind() {
    $("rf").addEventListener("click", async (e) => {
      const b = e.target.closest("[data-act]");
      if (!b) return;
      const act = b.dataset.act;
      if (act === "pick") { const sel = $("rf-account"); sel.scrollIntoView({ behavior: "smooth", block: "center" }); sel.focus(); return; }
      if (act === "close" && !sure) { sure = true; paintCtl(); setTimeout(() => { sure = false; if ($("rf")) paintCtl(); }, 4000); return; }
      b.disabled = true;
      try {
        S = await api(`/api/reforco/${act === "start" ? "start" : "stop"}`, { method: "POST", body: act === "close" ? { close: true } : {} });
        msg(act === "start" ? t("Ligado. Abre a tua posição no MT5.") : t("Parado."));
      } catch (err) { msg(err.message); }
      sure = false;
      paintCtl(); paintRun(); paintLog();
    });
    $("rf").addEventListener("change", async (e) => {
      const f = e.target.closest("#rf-form");
      if (!f) return;
      const el = e.target, body = { [el.name]: el.type === "checkbox" ? el.checked : el.value };
      try { S = await api("/api/reforco/cfg", { method: "POST", body }); paintMarket(); paintCtl(); } catch (err) { msg(err.message); $("rf-cfg")._html = ""; paintCfg(); }
    });
  }
})();
