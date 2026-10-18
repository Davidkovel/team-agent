// Reforço na notícia (#/reforco, a tab of the Sala de Trading): on a US release the trader opens the main position by hand
// in MT5 (1.5% of the allocation), presses Start here, and the Hub adds to it: a ladder of limit orders towards the VWAP band
// on the far side, the same risk on each step (bigger lots closer to the stop), 0.5% in all, TP from the release's history
// (backend/app/tradingroom/newsadd.py). Runs on the PC where the MT5 account is (the Escritório de Robôs' accounts).
(function () {
  let S = null, timer = 0, sure = false;
  const PHASE = { waiting: ["À espera da tua posição no MT5", "ai"], placed: ["Reforço colocado", "up"], done: ["Terminado", ""] };
  const STATUS = { pending: "à espera", filled: "cheia", closed: "fechada", cancelled: "cancelada", error: "erro" };
  const SUR = { BELOW: "abaixo da previsão", ABOVE: "acima da previsão", INLINE: "igual à previsão" };
  const num = (v, d = 2) => (v == null ? "—" : Number(v).toLocaleString("pt-PT", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const usd = (v) => (v == null ? "—" : `${v < 0 ? "−" : ""}$${num(Math.abs(v))}`);
  const pct = (v) => (v == null ? "—" : `${v > 0 ? "+" : ""}${num(v, 2)}%`);
  const hm = (ts) => new Date(ts * 1000).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
  const on = () => S && S.run && S.run.phase !== "done";

  HUB_VIEWS.reforco = async function () {
    page(`<div class="rf" id="rf">
      <header class="rf-head">
        <div><small>${esc(t("Sala de Trading · notícias dos EUA"))}</small><h1>${esc(t("Reforço na notícia"))}</h1>
          <p class="rf-sub">${esc(t("Tu abres a posição principal no MT5. O Hub junta-lhe ordens limite até ao stop na banda da VWAP, com lotes a crescer, e o TP da estatística."))}</p></div>
        <div class="rf-ctl" id="rf-ctl"></div>
      </header>
      <div class="rf-msg" id="rf-msg" hidden></div>
      <div class="rf-grid">
        <section class="rf-card" id="rf-news"></section>
        <section class="rf-card" id="rf-market"></section>
      </div>
      <section class="rf-card" id="rf-run"></section>
      <div class="rf-grid">
        <section class="rf-card" id="rf-cfg"></section>
        <section class="rf-card" id="rf-log"></section>
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

  function paintCtl() {
    const r = S.run, ph = r && PHASE[r.phase];
    const state = on() ? `<span class="rf-pill ${ph[1]}"><i></i>${esc(t(ph[0]))}</span>` : `<span class="rf-pill"><i></i>${esc(t("Desligado"))}</span>`;
    const btns = on()
      ? `<button type="button" class="btn" data-act="stop">${esc(t("Stop"))}</button>
         ${r.phase === "placed" ? `<button type="button" class="btn danger" data-act="close">${esc(sure ? t("Tens a certeza? Carrega outra vez") : t("Stop e fechar reforços"))}</button>` : ""}`
      : `<button type="button" class="btn primary rf-start" data-act="start" ${S.accounts.length ? "" : "disabled"}>${esc(t("Start"))}</button>`;
    paint($("rf-ctl"), `${state}<div class="rf-btns">${btns}</div>`);
  }

  function paintNews() {
    const n = S.news;
    if (!n) return paint($("rf-news"), `<h2>${esc(t("Notícia"))}</h2><p class="rf-none">${esc(t("Nenhuma notícia forte dos EUA nas próximas 2 horas. A tabela completa está na Sala de Trading."))}</p>`);
    const dt = (new Date(n.t) - Date.now()) / 1000;
    const when = dt > 0 ? t("daqui a {m} min", { m: Math.ceil(dt / 60) }) : t("saiu há {m} min", { m: Math.floor(-dt / 60) });
    const row = (s) => { const g = (n.table[s] || {}).GOLD; return g ? `<tr><td>${esc(t(SUR[s]))}</td><td class="${g.avg < 0 ? "down" : "up"}">${pct(g.avg)}</td><td>${g.up}/${g.n} ${esc(t("a subir"))}</td></tr>` : ""; };
    paint($("rf-news"), `<h2>${esc(n.name)}<small>${hm(new Date(n.t) / 1000)} · ${esc(when)}</small></h2>
      <div class="rf-figs"><div><small>${esc(t("Previsão"))}</small><b>${esc(n.forecast ?? "—")}${esc(n.unit || "")}</b></div>
        <div><small>${esc(t("Saiu"))}</small><b>${esc(n.actual ?? "—")}${n.actual != null ? esc(n.unit || "") : ""}</b></div>
        <div><small>${esc(t("Anterior"))}</small><b>${esc(n.previous ?? "—")}${esc(n.unit || "")}</b></div>
        <div><small>${esc(t("Resultado"))}</small><b class="${n.surprise === "ABOVE" ? "down" : n.surprise === "BELOW" ? "up" : ""}">${esc(n.surprise ? t(SUR[n.surprise]) : "—")}</b></div></div>
      <h4>${esc(t("Ouro nos primeiros 5 min, desde {y}", { y: n.since || "" }))}</h4>
      <table class="rf-t">${row("BELOW")}${row("ABOVE")}${row("INLINE")}</table>`);
  }

  function paintMarket() {
    const m = S.market || {}, c = S.cfg;
    if (!S.accounts.length) {
      return paint($("rf-market"), `<h2>${esc(t("Conta"))}</h2><p class="rf-none">${esc(t("Neste PC não há conta MT5. O reforço corre no PC onde está a conta (o do Marco): abre o Hub dele e carrega em Start lá."))}</p>
        ${S.marco ? `<a class="btn" href="${esc(S.marco)}" target="_blank" rel="noopener">${esc(t("Abrir o Hub do Marco"))}</a>` : ""}`);
    }
    if (!m.ok) return paint($("rf-market"), `<h2>${esc(c.symbol)}</h2><p class="rf-none">${esc(m.error || t("A ler a conta…"))}</p>`);
    const d = m.digits, lv = (k) => num(m.vwap + k * m.sd, d);
    const main = (dir, label) => { const x = m.main[dir]; return x ? `<div><small>${esc(t(label))}</small><b>${num(x.volume)} ${esc(t("lotes"))}</b><span>${esc(t("stop"))} ${num(x.stop, d)} (${x.band}σ) · ${usd(x.risk)}</span></div>` : ""; };
    paint($("rf-market"), `<h2>${esc(m.symbol)}<small>${num(m.bid, d)} / ${num(m.ask, d)}</small></h2>
      <div class="rf-bands"><span>−2σ <b>${lv(-2)}</b></span><span class="g">−1σ <b>${lv(-1)}</b></span><span class="v">VWAP <b>${num(m.vwap, d)}</b></span><span class="g">+1σ <b>${lv(1)}</b></span><span>+2σ <b>${lv(2)}</b></span></div>
      <h4>${esc(t("O teu lote principal ({p}% = {m})", { p: num(c.main_pct, 1), m: usd(c.alloc * c.main_pct / 100) }))}</h4>
      <div class="rf-main">${main("sell", "Venda")}${main("buy", "Compra")}</div>`);
  }

  function paintRun() {
    const r = S.run;
    if (!r) return paint($("rf-run"), `<h2>${esc(t("Reforço"))}</h2><p class="rf-none">${esc(t("Antes da notícia carrega em Start. Depois abre a tua posição no MT5 como sempre: o Hub vê-a e põe as ordens de reforço."))}</p>`);
    const d = (S.market && S.market.digits) || 2, m = r.main;
    const head = m ? `<div class="rf-figs">
        <div><small>${esc(t("A tua posição"))}</small><b class="${m.dir === "sell" ? "down" : "up"}">${esc(t(m.dir === "sell" ? "Venda" : "Compra"))} ${num(m.volume)}</b><span>${esc(t("a"))} ${num(m.price, d)}</span></div>
        <div><small>${esc(t("Stop dos reforços"))}</small><b>${num(r.stop, d)}</b><span>${r.band ? `${esc(t("banda"))} ${r.band}σ` : ""}</span></div>
        <div><small>${esc(t("Take-profit"))}</small><b>${num(r.tp, d)}</b><span>${r.tp_pct != null ? `${num(r.tp_pct)}%` : ""}</span></div>
        <div><small>${esc(t("Risco do reforço"))}</small><b>${usd(r.levels.filter((l) => l.status !== "error" && l.status !== "cancelled").reduce((a, l) => a + l.risk, 0))}</b><span>${num(r.cfg.add_pct, 1)}% ${esc(t("de"))} ${usd(r.cfg.alloc)}</span></div></div>` : "";
    const rows = r.levels.map((l) => `<tr class="${l.status}"><td>${l.n}</td><td>${num(l.price, d)}</td><td>${num(l.volume)}</td><td>${usd(l.risk)}</td><td>${esc(t(STATUS[l.status] || l.status))}${l.error ? ` · ${esc(l.error)}` : ""}</td><td class="${(l.pnl || 0) < 0 ? "down" : (l.pnl || 0) > 0 ? "up" : ""}">${l.pnl != null ? usd(l.pnl) : ""}</td></tr>`).join("");
    const ph = PHASE[r.phase] || ["", ""];
    paint($("rf-run"), `<h2>${esc(t("Reforço"))}<small>${esc(t(ph[0]))}${r.news ? ` · ${esc(r.news.name || r.news.key)}` : ""}</small></h2>${head}
      ${rows ? `<div class="rf-scroll"><table class="rf-t rf-lad"><thead><tr><th>#</th><th>${esc(t("Preço"))}</th><th>${esc(t("Lotes"))}</th><th>${esc(t("Risco"))}</th><th>${esc(t("Estado"))}</th><th>${esc(t("Resultado"))}</th></tr></thead><tbody>${rows}</tbody></table></div>`
        : `<p class="rf-none">${esc(t(r.phase === "waiting" ? "Abre a tua posição no MT5 (ordem manual): o Hub junta-lhe o reforço em segundos." : "Sem ordens de reforço."))}</p>`}`);
  }

  function paintCfg() {
    const c = S.cfg;
    const opt = (v, label, cur) => `<option value="${esc(v)}" ${String(v) === String(cur) ? "selected" : ""}>${esc(label)}</option>`;
    const field = (k, label, step, hint = "") => `<label><span>${esc(t(label))}</span><input type="number" name="${k}" value="${c[k]}" step="${step}">${hint ? `<em>${esc(t(hint))}</em>` : ""}</label>`;
    paint($("rf-cfg"), `<h2>${esc(t("Definições"))}</h2><form class="rf-form" id="rf-form">
      <label><span>${esc(t("Conta MT5"))}</span><select name="account">${opt("", t("— escolhe —"), c.account)}${S.accounts.map((a) => opt(a.id, a.name, c.account)).join("")}</select></label>
      <label><span>${esc(t("Instrumento"))}</span><select name="symbol">${S.symbols.map((s) => opt(s, s, c.symbol)).join("")}</select></label>
      ${field("alloc", "Alocação ($)", "1000")}
      ${field("main_pct", "Risco da tua posição (%)", "0.1", "Só para o cálculo do teu lote")}
      ${field("add_pct", "Risco do reforço (%)", "0.1")}
      ${field("levels", "Ordens no reforço", "1")}
      <label><span>${esc(t("Stop na banda"))}</span><select name="band">${opt(1, t("1σ (verde)"), c.band)}${opt(2, "2σ", c.band)}</select><em>${esc(t("Se o preço já passou a banda, usa a seguinte"))}</em></label>
      ${field("buffer_pct", "Folga além da banda (%)", "0.01")}
      <label class="rf-check"><input type="checkbox" name="tp_auto" ${c.tp_auto ? "checked" : ""}><span>${esc(t("TP pela estatística da notícia"))}</span></label>
      ${field("tp_pct", "TP fixo (%)", "0.05", "Quando não há estatística")}
      ${field("window", "Ordens válidas (min)", "5")}
    </form>`);
  }

  function paintLog() {
    paint($("rf-log"), `<h2>${esc(t("Diário"))}</h2>${S.log.length ? `<ul class="rf-logl">${S.log.map((l) => `<li class="${l.kind}"><time>${hm(l.t)}</time>${esc(l.text)}</li>`).join("")}</ul>` : `<p class="rf-none">${esc(t("Nada ainda."))}</p>`}`);
  }

  function bind() {
    $("rf").addEventListener("click", async (e) => {
      const b = e.target.closest("[data-act]");
      if (!b) return;
      const act = b.dataset.act;
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
