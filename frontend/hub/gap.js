// Gap da manhã (#/gap, a tab of the Sala de Trading): the morning gap of the DAX cash index (Xetra, from TradingView, on
// every PC) and of the FundedNext MT5 instruments where the account is. The Hub finds where a bar opens away from the
// close before it (the session break, or a jump), tells this PC's person once, and again when the price gets back to that
// close (backend/app/tradingroom/gap.py). The page follows docs/hub-paginas.md: the head with the state and the switch,
// the main instrument's record as the figures, today's gap, the others, the history and the settings.
(function () {
  let S = null, timer = 0;
  const loc = (v, d) => Number(v).toLocaleString("pt-PT", { minimumFractionDigits: d, maximumFractionDigits: d });
  const num = (v, d = 1) => (v == null ? "—" : loc(v, d));
  const sig = (v, d = 1) => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${loc(Math.abs(v), d)}`);
  const hm = (ts) => new Date(ts * 1000).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
  const day = (ts) => new Date(ts * 1000).toLocaleDateString("pt-PT", { weekday: "short", day: "2-digit", month: "2-digit" });
  const mins = (a, b) => Math.round((b - a) / 60);
  const done = (g) => (g.filled ? 1 : Math.max(0, Math.min(1, 1 - (g.left ?? Math.abs(g.pts)) / Math.abs(g.pts))));
  const sec = (title, hint = "") => `<div class="sec"><span>${esc(title)}</span>${hint ? `<small class="gp-sr">${hint}</small>` : ""}</div>`;

  HUB_VIEWS.gap = async function () {
    page(`<div class="gp" id="gp">
      ${ui.head("Trading", t("Gap da manhã"), t("O gap das 09:00 de Frankfurt (08:00 em Portugal), que o gráfico do Hub não mostra. Chega-te quando abre e outra vez quando o preço volta ao fecho anterior."),
        `<div class="gp-ctl" id="gp-ctl"></div>`)}
      <div class="gp-msg" id="gp-msg" hidden></div>
      <div class="gp-kpis" id="gp-kpis"></div>
      <div id="gp-hero-h"></div>
      <section class="panel gp-hero" id="gp-hero"></section>
      <div id="gp-others"></div>
      <div class="gp-grid">
        <div>${sec(t("Histórico"), esc(t("fechou = o preço voltou ao fecho anterior")))}<section class="panel gp-card" id="gp-hist"></section></div>
        <div>${sec(t("Definições"), esc(t("guardam-se sozinhas")))}<section class="panel pad gp-card" id="gp-cfg"></section></div>
      </div>
    </div>`);
    bind();
    await load().catch((e) => msg(e.message));
    clearInterval(timer);
    timer = setInterval(() => { if (!$("gp")) { clearInterval(timer); return; } if (!document.hidden) load().catch(() => {}); }, 15000);
  };

  async function load() {
    S = await api("/api/gap");
    paintCtl(); paintKpis(); paintHero(); paintOthers(); paintHist();
    if (!$("gp-cfg")._html) paintCfg();
  }

  function msg(text) {
    const el = $("gp-msg");
    if (!el) return;
    el.hidden = false; el.textContent = text;
    clearTimeout(msg.t); msg.t = setTimeout(() => { el.hidden = true; }, 5000);
  }

  // the state beside the actions: watching (and since when), the MT5 complaining, or off; one main action
  function paintCtl() {
    const c = S.cfg;
    const chip = !c.on ? `<span class="st off"><i></i>${esc(t("Desligado"))}</span>`
      : S.error ? `<span class="st wait" title="${esc(S.error)}"><i></i>${esc(t("A vigiar, com erro no MT5"))}</span>`
      : `<span class="st ok"><i></i>${esc(S.at ? t("A vigiar · {h}", { h: hm(S.at) }) : t("A vigiar"))}</span>`;
    paint($("gp-ctl"), `${chip}
      <button type="button" class="btn quiet" data-act="test">${icon("bell")}${esc(t("Testar a nota"))}</button>
      <button type="button" class="btn ${c.on ? "" : "primary"}" data-act="toggle">${esc(c.on ? t("Desligar") : t("Ligar"))}</button>`);
  }

  // the main instrument's record: how many gaps, how many closed and how fast, how big
  function paintKpis() {
    const main = S.cfg.main, st = S.stats[main] || {};
    const has = st.n > 0;
    // the Painel's figures (hub/painel.css): the gaps of the main instrument, oldest first, as the small charts
    const mine = (S.history || []).filter((g) => g.symbol === main).sort((p, q) => p.t - q.t).slice(-14);
    paint($("gp-kpis"), ui.kpis([
      ui.kpi({ label: t("Gaps de {s} guardados", { s: main }), value: has ? String(st.n) : null, viz: mine.length > 1 ? ui.cols(mine.map((g) => Math.abs(g.pct))) : "",
        sub: has ? t("o tamanho dos últimos {n}", { n: mine.length }) : t("O histórico enche-se dia a dia.") }),
      ui.kpi({ label: "Fecharam", value: has ? `${st.filled}<small>/${st.n}</small>` : null, viz: has ? ui.ring(st.rate) : "", sub: has ? t("o preço voltou ao fecho anterior") : "" }),
      ui.kpi({ label: "Tempo até fechar", value: st.mins != null ? `~${st.mins}<small> min</small>` : null, sub: st.mins != null ? t("mediana dos que fecharam") : "" }),
      ui.kpi({ label: "Gap médio", value: st.avg_pct != null ? `${num(st.avg_pct, 2)}<small>%</small>` : null,
        viz: mine.length > 1 ? ui.spark(mine.map((g) => g.pct)) : "", sub: mine.length > 1 ? t("para cima e para baixo, dia a dia") : "" }),
    ]).replace('class="pn-kpis"', 'class="pn-kpis gp-kpis-in"'));
  }

  // the main instrument: the last gap of today, big, with its chart
  function paintHero() {
    const c = S.cfg, main = c.main;
    const g = S.today.find((x) => x.symbol === main);
    const st = S.stats[main] || {};
    const lv = S.live[main] || {};
    const name = lv.symbol || main;
    paint($("gp-hero-h"), sec(t("Hoje · {s}", { s: name }), esc(lv.src || (main === "DAX" ? "Xetra" : "FundedNext"))));
    if (!g && !S.accounts.length && main !== "DAX") {
      return paint($("gp-hero"), ui.empty("link", "A conta MT5 está noutro PC", t("{s} lê-se da conta FundedNext, no PC onde ela está (o do Marco). Escolhe o DAX como instrumento principal para o ver aqui sem MT5.", { s: main }),
        S.marco ? `<a class="btn" href="${esc(S.marco)}" target="_blank" rel="noopener">${esc(t("Abrir o Hub do Marco"))}</a>` : ""));
    }
    if (!g) {
      return paint($("gp-hero"), ui.empty("clock", "Hoje ainda não houve gap",
        `${t("Quando a cotação abrir com um gap de {p}% ou mais, chega a nota a todos.", { p: num(c.min_pct, 2) })}${lv.ok ? " " + t("Agora: {p}.", { p: num(lv.price, lv.digits) }) : ""}`));
    }
    const up = g.dir === "up", f = done(g), d = g.digits;
    const status = g.filled
      ? ui.tag(t("Gap fechado às {h} · {m} min", { h: hm(g.filled), m: mins(g.t, g.filled) }), "ok")
      : ui.tag(t("Aberto · faltam {p}", { p: num(g.left ?? Math.abs(g.pts), d) }), "warn");
    paint($("gp-hero"), `<div class="gp-hero-in ${up ? "up" : "down"}">
      <div class="gp-figs">
        <span class="bd-l">${esc(t("Abriu às {h}", { h: hm(g.t) }))} · ${esc(g.src || "FundedNext")}</span>
        <div class="gp-big"><span class="gp-arrow">${up ? "▲" : "▼"}</span>${sig(g.pts, d)}<em>${esc(t("pts"))}</em></div>
        <div class="gp-pct">${sig(g.pct, 2)}% · ${esc(up ? t("gap para cima") : t("gap para baixo"))}${g.kind === "salto" ? ` · ${esc(t("salto"))}` : ""}</div>
        <div>${status}</div>
        <div class="bd-stats gp-dl">
          <div><span class="bd-l">${esc(t("Fecho anterior"))}</span><b>${num(g.prev, d)}</b></div>
          <div><span class="bd-l">${esc(t("Abertura"))}</span><b>${num(g.open, d)}</b></div>
          <div><span class="bd-l">${esc(t("Agora"))}</span><b>${lv.ok ? num(lv.price, d) : "—"}</b></div>
          <div><span class="bd-l">${esc(t("Afastou-se"))}</span><b>${num(g.away, d)}</b></div>
        </div>
        <div class="gp-meter" title="${esc(t("Quanto do gap o preço já fechou"))}"><i style="width:${Math.round(f * 100)}%"></i><span>${esc(t("{p}% do gap fechado", { p: Math.round(f * 100) }))}</span></div>
        ${statLine(st, main)}
      </div>
      <div class="gp-chart">${chart(g)}</div>
    </div>`);
  }

  function statLine(st, sym) {
    if (!st || st.n < 2) return `<p class="gp-stat">${esc(t("O histórico de {s} enche-se dia a dia.", { s: sym }))}</p>`;
    return `<p class="gp-stat">${esc(t("Últimos {n} gaps de {s}: fechou {f} ({r}%){m}; gap médio {a}%.", {
      n: st.n, s: sym, f: st.filled, r: st.rate, m: st.mins != null ? t(", em ~{m} min", { m: st.mins }) : "", a: num(st.avg_pct, 2) }))}</p>`;
  }

  // the price around the gap: the close it fills back to (dashed), the void of the gap from the open on, the fill point
  function chart(g) {
    const s = g.spark || [];
    if (s.length < 3) return `<p class="gp-none">${esc(t("Sem barras para o gráfico."))}</p>`;
    const W = 640, H = 300, P = { l: 8, r: 70, t: 16, b: 26 };
    const lo = Math.min(g.prev, g.open, ...s.map((x) => x[2])), hi = Math.max(g.prev, g.open, ...s.map((x) => x[1]));
    const pad = (hi - lo) * 0.08 || 1;
    const y = (v) => P.t + (hi + pad - v) / (hi - lo + 2 * pad) * (H - P.t - P.b);
    const x = (i) => P.l + i / (s.length - 1) * (W - P.l - P.r);
    const gi = Math.max(1, s.findIndex((p) => p[0] >= g.t));
    const fi = g.filled ? s.findIndex((p) => p[0] >= g.filled) : -1;
    const line = s.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[3]).toFixed(1)}`).join("");
    const wick = s.map((p, i) => `M${x(i).toFixed(1)},${y(p[1]).toFixed(1)}V${y(p[2]).toFixed(1)}`).join("");
    const x0 = (x(gi - 1) + x(gi)) / 2, xe = fi > 0 ? x(fi) : W - P.r;
    const top = Math.min(y(g.prev), y(g.open)), bh = Math.abs(y(g.prev) - y(g.open));
    const d = g.digits;
    const ticks = [0, Math.floor(s.length / 2), s.length - 1].map((i) => `<text x="${x(i)}" y="${H - 8}" text-anchor="${i ? (i === s.length - 1 ? "end" : "middle") : "start"}">${hm(s[i][0])}</text>`).join("");
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t("Gráfico do gap"))}">
      <rect class="gp-void" x="${x0}" y="${top}" width="${Math.max(2, xe - x0)}" height="${Math.max(2, bh)}"/>
      <line class="gp-ref" x1="${P.l}" x2="${W - P.r}" y1="${y(g.prev)}" y2="${y(g.prev)}"/>
      <line class="gp-at" x1="${x0}" x2="${x0}" y1="${P.t}" y2="${H - P.b}"/>
      <path class="gp-wick" d="${wick}"/>
      <path class="gp-line" d="${line}"/>
      ${fi > 0 ? `<circle class="gp-fill" cx="${x(fi)}" cy="${y(g.prev)}" r="5"/>` : ""}
      <text class="gp-lab" x="${W - P.r + 6}" y="${y(g.prev) + 4}">${num(g.prev, d)}</text>
      <text class="gp-lab o" x="${W - P.r + 6}" y="${y(g.open) + (Math.abs(y(g.open) - y(g.prev)) < 14 ? (g.dir === "up" ? -10 : 18) : 4)}">${num(g.open, d)}</text>
      <g class="gp-ax">${ticks}</g>
    </svg>`;
  }

  function paintOthers() {
    const rows = S.cfg.symbols.filter((s) => s !== S.cfg.main).map((sym) => {
      const g = S.today.find((x) => x.symbol === sym), lv = S.live[sym] || {};
      if (!lv.ok) return `<div class="panel gp-mini off"><b>${esc(sym)}</b><span>${esc(lv.error || (sym !== "DAX" && !S.accounts.length ? t("Precisa da conta MT5") : t("A ler…")))}</span></div>`;
      if (!g) return `<div class="panel gp-mini"><b>${esc(lv.symbol)}</b><span>${esc(t("Sem gap hoje"))}</span><em>${num(lv.price, lv.digits)}</em></div>`;
      return `<div class="panel gp-mini ${g.dir}"><b>${esc(g.name)}</b><span>${hm(g.t)} · ${g.filled ? esc(t("fechado em {m} min", { m: mins(g.t, g.filled) })) : esc(t("aberto"))}</span>
        <em>${g.dir === "up" ? "▲" : "▼"} ${sig(g.pts, g.digits)} <small>${sig(g.pct, 2)}%</small></em><i style="width:${Math.round(done(g) * 100)}%"></i></div>`;
    });
    const mt5 = S.cfg.symbols.some((s) => s !== "DAX" && !(S.live[s] || {}).ok) && !S.accounts.length;
    paint($("gp-others"), rows.length ? `${sec(t("Outros instrumentos hoje"), mt5 ? esc(t("os da FundedNext leem-se no PC com a conta MT5")) : "")}<div class="gp-minis">${rows.join("")}</div>` : "");
  }

  function paintHist() {
    const h = S.history || [];
    if (!h.length) return paint($("gp-hist"), ui.empty("clock", "Ainda nenhum gap guardado", "Cada gap fica aqui, com o tempo que levou a fechar."));
    const rows = h.slice(0, 40).map((g) => `<tr><td>${esc(day(g.t))}<small>${hm(g.t)}</small></td><td>${esc(g.name)}</td>
      <td class="${g.dir}">${g.dir === "up" ? "▲" : "▼"} ${sig(g.pts, g.digits)}<small>${sig(g.pct, 2)}%</small></td>
      <td>${g.filled ? `<span class="gp-yes">${esc(t("{m} min", { m: mins(g.t, g.filled) }))}</span>` : `<span class="gp-no">${esc(t("não"))}</span>`}</td></tr>`).join("");
    paint($("gp-hist"), `<div class="gp-scroll"><table class="tbl gp-table"><thead><tr><th>${esc(t("Dia"))}</th><th>${esc(t("Instrumento"))}</th><th>${esc(t("Gap"))}</th><th>${esc(t("Fechou"))}</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`);
  }

  function paintCfg() {
    const c = S.cfg, el = $("gp-cfg");
    el._html = "1";
    const accs = S.accounts.map((a) => `<option value="${esc(a.id)}" ${a.id === S.account ? "selected" : ""}>${esc(a.name)}</option>`).join("");
    const chips = S.symbols.map((s) => `<label class="who-opt"><input type="checkbox" name="sym" value="${esc(s)}" ${c.symbols.includes(s) ? "checked" : ""}><span>${esc(s === "DAX" ? t("DAX (Xetra, sem MT5)") : s)}</span></label>`).join("");
    const mains = S.symbols.map((s) => `<option ${s === c.main ? "selected" : ""}>${esc(s)}</option>`).join("");
    paint(el, `<form class="gp-form" id="gp-form">
        ${accs ? `<label class="field">${esc(t("Conta MT5"))}<select name="account">${accs}</select></label>` : ""}
        <div class="gp-two">
          <label class="field">${esc(t("Instrumento principal"))}<select name="main">${mains}</select></label>
          <label class="field">${esc(t("Gap mínimo (%)"))}<input name="min_pct" type="number" step="0.01" min="0.005" max="2" value="${esc(c.min_pct)}"></label>
        </div>
        <div class="field">${esc(t("Instrumentos a vigiar"))}<div class="who gp-chips">${chips}</div></div>
        <p class="gp-none">${esc(t("Gap = uma barra abre longe do fecho da anterior, depois da pausa da sessão ou num salto muito maior do que o normal. O DAX vem do TradingView (Xetra); os outros, da conta MT5 da FundedNext."))}</p>
      </form>`);
  }

  function bind() {
    $("gp").addEventListener("click", async (e) => {
      const b = e.target.closest("[data-act]");
      if (!b) return;
      b.disabled = true;
      try {
        if (b.dataset.act === "toggle") { S = await api("/api/gap/cfg", { method: "POST", body: { on: !S.cfg.on } }); paintCtl(); }
        if (b.dataset.act === "test") { await api("/api/gap/test", { method: "POST" }); msg(t("Nota de teste enviada.")); }
      } catch (err) { msg(err.message); } finally { b.disabled = false; }
    });
    $("gp").addEventListener("change", async (e) => {
      const f = e.target.closest("#gp-form");
      if (!f) return;
      const body = { min_pct: f.min_pct.value, main: f.main.value, symbols: [...f.querySelectorAll("[name=sym]:checked")].map((x) => x.value) };
      if (f.account) body.account = f.account.value;
      try { S = await api("/api/gap/cfg", { method: "POST", body }); paintCtl(); paintKpis(); paintHero(); paintOthers(); }
      catch (err) { msg(err.message); $("gp-cfg")._html = ""; paintCfg(); }
    });
  }
})();
