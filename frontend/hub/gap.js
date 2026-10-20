// Gap da manhã (#/gap, a tab of the Sala de Trading): the morning gap of the DAX cash index (Xetra, from TradingView, on
// every PC) and of the FundedNext MT5 instruments where the account is. The Hub finds where a bar opens away from the
// close before it (the session break, or a jump), tells this PC's person once, and again when the price gets back to that
// close (backend/app/tradingroom/gap.py).
(function () {
  let S = null, timer = 0;
  const loc = (v, d) => Number(v).toLocaleString("pt-PT", { minimumFractionDigits: d, maximumFractionDigits: d });
  const num = (v, d = 1) => (v == null ? "—" : loc(v, d));
  const sig = (v, d = 1) => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${loc(Math.abs(v), d)}`);
  const hm = (ts) => new Date(ts * 1000).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
  const day = (ts) => new Date(ts * 1000).toLocaleDateString("pt-PT", { weekday: "short", day: "2-digit", month: "2-digit" });
  const mins = (a, b) => Math.round((b - a) / 60);
  const done = (g) => (g.filled ? 1 : Math.max(0, Math.min(1, 1 - (g.left ?? Math.abs(g.pts)) / Math.abs(g.pts))));

  HUB_VIEWS.gap = async function () {
    page(`<div class="gp" id="gp">
      <header class="gp-head">
        <div><small>${esc(t("Sala de Trading · DAX da Xetra e cotações da FundedNext"))}</small><h1>${esc(t("Gap da manhã"))}</h1>
          <p class="gp-sub">${esc(t("O gap das 09:00 de Frankfurt (08:00 em Portugal), que o gráfico do Hub não mostra. Chega-te quando abre e outra vez quando o preço volta ao fecho anterior. Não precisa do MT5."))}</p></div>
        <div class="gp-ctl" id="gp-ctl"></div>
      </header>
      <div class="gp-msg" id="gp-msg" hidden></div>
      <section class="gp-hero" id="gp-hero"></section>
      <section class="gp-others" id="gp-others"></section>
      <div class="gp-grid">
        <section class="gp-card" id="gp-hist"></section>
        <section class="gp-card" id="gp-cfg"></section>
      </div>
    </div>`);
    bind();
    await load().catch((e) => msg(e.message));
    clearInterval(timer);
    timer = setInterval(() => { if (!$("gp")) { clearInterval(timer); return; } if (!document.hidden) load().catch(() => {}); }, 15000);
  };

  async function load() {
    S = await api("/api/gap");
    paintCtl(); paintHero(); paintOthers(); paintHist();
    if (!$("gp-cfg")._html) paintCfg();
  }

  function msg(text) {
    const el = $("gp-msg");
    if (!el) return;
    el.hidden = false; el.textContent = text;
    clearTimeout(msg.t); msg.t = setTimeout(() => { el.hidden = true; }, 5000);
  }

  function paintCtl() {
    const c = S.cfg;
    const state = !c.on ? t("Desligado") : S.error ? `MT5: ${S.error}` : t("A vigiar · {h}", { h: S.at ? hm(S.at) : "…" });
    paint($("gp-ctl"), `<span class="gp-pill ${c.on ? (S.error ? "warn" : "on") : ""}"><i></i>${esc(state)}</span>
      <div class="gp-btns">
        <button type="button" class="btn" data-act="toggle">${esc(c.on ? t("Desligar") : t("Ligar"))}</button>
        <button type="button" class="btn" data-act="test">${esc(t("Testar a nota"))}</button>
      </div>`);
  }

  // the main instrument: the last gap of today, big, with its chart
  function paintHero() {
    const c = S.cfg, main = c.main;
    const g = S.today.find((x) => x.symbol === main);
    const st = S.stats[main] || {};
    const lv = S.live[main] || {};
    const name = lv.symbol || main;
    if (!g && !S.accounts.length && main !== "DAX") {
      return paint($("gp-hero"), `<div class="gp-empty"><small>${esc(main)} · FundedNext</small><h2>${esc(t("A conta MT5 está noutro PC"))}</h2>
        <p>${esc(t("{s} lê-se da conta FundedNext, no PC onde ela está (o do Marco). Escolhe o DAX como instrumento principal para o ver aqui sem MT5.", { s: main }))}</p>
        ${S.marco ? `<a class="btn primary" href="${esc(S.marco)}" target="_blank" rel="noopener">${esc(t("Abrir o Hub do Marco"))}</a>` : ""}</div>`);
    }
    if (!g) {
      return paint($("gp-hero"), `<div class="gp-empty"><small>${esc(name)} · ${esc(lv.src || "")}</small><h2>${esc(t("Hoje ainda não houve gap"))}</h2>
        <p>${esc(t("Quando a cotação abrir com um gap de {p}% ou mais, chega a nota a todos.", { p: num(c.min_pct, 2) }))}
        ${lv.ok ? esc(t("Agora: {p}.", { p: num(lv.price, lv.digits) })) : ""}</p>${statLine(st, main)}</div>`);
    }
    const up = g.dir === "up", f = done(g), d = g.digits;
    const status = g.filled
      ? `<span class="gp-tag ok">${esc(t("Gap fechado às {h} · {m} min", { h: hm(g.filled), m: mins(g.t, g.filled) }))}</span>`
      : `<span class="gp-tag open">${esc(t("Aberto · faltam {p}", { p: num(g.left ?? Math.abs(g.pts), d) }))}</span>`;
    paint($("gp-hero"), `<div class="gp-hero-in ${up ? "up" : "down"}">
      <div class="gp-figs">
        <small>${esc(name)} · ${esc(g.src || "FundedNext")} · ${hm(g.t)}</small>
        <div class="gp-big"><span class="gp-arrow">${up ? "▲" : "▼"}</span>${sig(g.pts, d)}<em>${esc(t("pts"))}</em></div>
        <div class="gp-pct">${sig(g.pct, 2)}% · ${esc(up ? t("gap para cima") : t("gap para baixo"))}${g.kind === "salto" ? ` · ${esc(t("salto"))}` : ""}</div>
        ${status}
        <dl class="gp-dl">
          <div><dt>${esc(t("Fecho anterior"))}</dt><dd>${num(g.prev, d)}</dd></div>
          <div><dt>${esc(t("Abertura"))}</dt><dd>${num(g.open, d)}</dd></div>
          <div><dt>${esc(t("Agora"))}</dt><dd>${lv.ok ? num(lv.price, d) : "—"}</dd></div>
          <div><dt>${esc(t("Afastou-se"))}</dt><dd>${num(g.away, d)}</dd></div>
        </dl>
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
      if (!lv.ok) return `<div class="gp-mini off"><b>${esc(sym)}</b><span>${esc(lv.error || t("a ler…"))}</span></div>`;
      if (!g) return `<div class="gp-mini"><b>${esc(lv.symbol)}</b><span>${esc(t("sem gap hoje"))}</span><em>${num(lv.price, lv.digits)}</em></div>`;
      return `<div class="gp-mini ${g.dir}"><b>${esc(g.name)}</b><span>${hm(g.t)} · ${g.filled ? esc(t("fechado em {m} min", { m: mins(g.t, g.filled) })) : esc(t("aberto"))}</span>
        <em>${g.dir === "up" ? "▲" : "▼"} ${sig(g.pts, g.digits)} <small>${sig(g.pct, 2)}%</small></em><i style="width:${Math.round(done(g) * 100)}%"></i></div>`;
    });
    paint($("gp-others"), rows.length ? `<h4>${esc(t("Outros instrumentos hoje"))}</h4><div class="gp-minis">${rows.join("")}</div>` : "");
  }

  function paintHist() {
    const h = S.history || [];
    if (!h.length) return paint($("gp-hist"), `<h2>${esc(t("Histórico"))}</h2><p class="gp-none">${esc(t("Ainda nenhum gap guardado."))}</p>`);
    const rows = h.slice(0, 40).map((g) => `<tr><td>${esc(day(g.t))} <small>${hm(g.t)}</small></td><td>${esc(g.name)}</td>
      <td class="${g.dir}">${g.dir === "up" ? "▲" : "▼"} ${sig(g.pts, g.digits)}</td><td class="${g.dir}">${sig(g.pct, 2)}%</td>
      <td>${g.filled ? `<span class="gp-yes">${esc(t("{m} min", { m: mins(g.t, g.filled) }))}</span>` : `<span class="gp-no">${esc(t("não"))}</span>`}</td></tr>`).join("");
    paint($("gp-hist"), `<h2>${esc(t("Histórico"))}<small>${esc(t("fechou = o preço voltou ao fecho anterior"))}</small></h2>
      <div class="gp-scroll"><table class="gp-table"><thead><tr><th>${esc(t("Dia"))}</th><th>${esc(t("Instrumento"))}</th><th>${esc(t("Gap"))}</th><th>%</th><th>${esc(t("Fechou"))}</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`);
  }

  function paintCfg() {
    const c = S.cfg, el = $("gp-cfg");
    el._html = "1";
    const accs = S.accounts.map((a) => `<option value="${esc(a.id)}" ${a.id === S.account ? "selected" : ""}>${esc(a.name)}</option>`).join("");
    const chips = S.symbols.map((s) => `<label class="gp-chip"><input type="checkbox" name="sym" value="${esc(s)}" ${c.symbols.includes(s) ? "checked" : ""}><span>${esc(s === "DAX" ? t("DAX (Xetra, sem MT5)") : s)}</span></label>`).join("");
    const mains = S.symbols.map((s) => `<option ${s === c.main ? "selected" : ""}>${esc(s)}</option>`).join("");
    paint(el, `<h2>${esc(t("Definições"))}</h2>
      <form class="gp-form" id="gp-form">
        ${accs ? `<label>${esc(t("Conta MT5"))}<select name="account">${accs}</select></label>` : ""}
        <label>${esc(t("Instrumento principal"))}<select name="main">${mains}</select></label>
        <label>${esc(t("Gap mínimo (%)"))}<input name="min_pct" type="number" step="0.01" min="0.005" max="2" value="${esc(c.min_pct)}"></label>
        <div><span class="gp-flabel">${esc(t("Instrumentos a vigiar"))}</span><div class="gp-chips">${chips}</div></div>
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
      try { S = await api("/api/gap/cfg", { method: "POST", body }); paintCtl(); paintHero(); paintOthers(); }
      catch (err) { msg(err.message); $("gp-cfg")._html = ""; paintCfg(); }
    });
  }
})();
