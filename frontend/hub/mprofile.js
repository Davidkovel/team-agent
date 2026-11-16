// Market Profile (#/mprofile, a tab of the Sala de Trading): the research of the market-profile-bot (FDAX and NQ,
// Market Profile + VWAP), read from its clone on this PC (backend/app/routers/mprofile.py). Only backtest and paper:
// the bot trades nothing live. The figures, the setups with their result before and after the cut, the walk-forward,
// the charts of the reports and the full report, in English as the bot writes it.
(function () {
  let S = null, market = "NQ";
  const loc = (v, d = 2) => (v == null ? "—" : Number(v).toLocaleString("pt-PT", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const sr = (v) => (v == null ? `<span class="mp-dim">—</span>` : `<span class="${v > 0 ? "mp-up" : v < 0 ? "mp-dn" : ""}">${v > 0 ? "+" : ""}${loc(v)} R</span>`);
  const img = (n) => `/api/mprofile/img/${encodeURIComponent(n)}?token=${encodeURIComponent(token)}`;
  const IMG = { "equity.png": "Curva de capital", "setups.png": "Setups", "walkforward.png": "Walk-forward", "chosen.png": "Os escolhidos",
    "H_stats.png": "Hipóteses dos livros", "ib_equity.png": "Rompimento do IB", "context_map_FDAX.png": "Mapa de contexto · FDAX", "context_map_NQ.png": "Mapa de contexto · NQ" };

  HUB_VIEWS.mprofile = async function () {
    page(`<div class="mp" id="mp">
      ${ui.head("Trading", t("Market Profile"), t("A pesquisa do bot de Market Profile + VWAP no DAX (FDAX) e no Nasdaq (NQ): que setups têm vantagem a sério. Só backtest e papel."),
        `<div class="mp-ctl" id="mp-ctl"><button type="button" class="btn primary" data-act="pull">${esc(t("Atualizar"))}</button></div>`)}
      <div class="mp-msg" id="mp-msg" hidden></div>
      <div id="mp-body">${ui.skeleton(4)}</div>
    </div>`);
    $("mp").addEventListener("click", async (e) => {
      const m = e.target.closest("[data-mk]");
      if (m) { market = m.dataset.mk; return draw(); }
      const b = e.target.closest("[data-act=pull]");
      if (!b) return;
      b.disabled = true;
      try { S = await api("/api/mprofile/pull", { method: "POST" }); draw(); msg(t("Atualizado com o GitHub.")); }
      catch (err) { msg(err.message); } finally { b.disabled = false; }
    });
    try { S = await api("/api/mprofile"); draw(); } catch (e) { paint($("mp-body"), ui.error(e.message)); }
  };

  function msg(text) {
    const el = $("mp-msg"); if (!el) return;
    el.hidden = false; el.textContent = text; clearTimeout(msg.t); msg.t = setTimeout(() => { el.hidden = true; }, 6000);
  }

  function draw() {
    if (!S.ok) return paint($("mp-body"), ui.empty("link", "O bot ainda não está neste PC", t("Carrega em «Atualizar» para o trazer do GitHub (o repositório é privado: o PC precisa de acesso)."),
      `<button type="button" class="btn primary" data-act="pull">${esc(t("Trazer do GitHub"))}</button>`));
    const set = S.setups.filter((x) => x.market === market).sort((a, b) => (b.r_oos ?? -9) - (a.r_oos ?? -9));
    const both = S.setups.filter((x) => x.r > 0 && x.r_oos > 0);
    const best = S.setups.filter((x) => x.n_oos >= 20).sort((a, b) => (b.r_oos ?? -9) - (a.r_oos ?? -9))[0];   // a handful of trades proves nothing
    const wfBest = S.walkforward.slice().sort((a, b) => b.sum_r - a.sum_r)[0];
    paint($("mp-body"), `${ui.kpis([
        ui.kpi({ label: t("Trades no diário"), value: S.trades ? loc(S.trades, 0) : null, sub: S.from ? t("de {a} a {b}", { a: S.from, b: S.to }) : "" }),
        ui.kpi({ label: t("Setups em plus antes e depois"), value: `${both.length}<small>/${S.setups.length}</small>`, viz: S.setups.length ? ui.ring(Math.round(both.length / S.setups.length * 100)) : "", sub: t("no treino e nos meses que ele nunca viu") }),
        ui.kpi({ label: t("Melhor depois do corte (20+ trades)"), value: best ? `${best.market} ${esc(best.id)}` : null, sub: best ? `${esc(best.name)} · ${loc(best.r_oos)} R ${t("por trade")} (${best.n_oos})` : t("nenhum com 20 trades ou mais") }),
        ui.kpi({ label: t("Melhor walk-forward"), value: wfBest ? `${wfBest.sum_r > 0 ? "+" : ""}${loc(wfBest.sum_r, 1)}<small> R</small>` : null, sub: wfBest ? `${wfBest.market} · ${esc(wfBest.pick)} · PF ${loc(wfBest.pf)}` : "" }),
      ])}
      <div class="panel pad mp-verdict"><b>${esc(t("O que a pesquisa diz"))}</b>
        <p>${esc(t("Nas velas de 1 minuto em CFD (sem volume real) nenhuma estratégia chegou a uma vantagem fiável depois de contar com o número de testes. A única candidata a papel é o Open Drive (B4) no NQ. Nada está a negociar a sério: dinheiro real só depois do «ok» do David."))}</p>
        ${S.commit ? `<small>${esc(t("Última mudança no bot: {d} · {m}", { d: new Date(S.commit.at).toLocaleDateString("pt-PT", { day: "2-digit", month: "short" }), m: S.commit.msg }))}</small>` : ""}
      </div>
      ${ui.sec("Setups", `<div class="segx">${["NQ", "FDAX"].map((m) => `<button type="button" data-mk="${m}" class="${m === market ? "on" : ""}">${m}</button>`).join("")}</div>`)}
      <section class="panel mp-tw"><table class="mp-t"><thead><tr><th>${esc(t("Setup"))}</th><th class="r">${esc(t("Trades"))}</th><th class="r">${esc(t("Ganhas"))}</th><th class="r">${esc(t("Média"))}</th><th class="r">PF</th><th class="r">${esc(t("Depois do corte"))}</th><th class="r">n</th><th>${esc(t("Veredicto"))}</th></tr></thead>
        <tbody>${set.map((x) => `<tr><td><b>${esc(x.id)}</b> <span class="mp-dim">${esc(x.name)}</span></td><td class="r mp-num">${x.n}</td><td class="r mp-num">${loc(x.win, 0)}%</td><td class="r mp-num">${sr(x.r)}</td><td class="r mp-num">${loc(x.pf)}</td><td class="r mp-num">${sr(x.r_oos)}</td><td class="r mp-num">${x.n_oos}</td>
          <td>${x.r > 0 && x.r_oos > 0 ? ui.tag(t("plus nos dois"), "ok") : x.r < 0 && x.r_oos < 0 ? ui.tag(t("perde"), "bad") : ui.tag(t("ruído"), "")}</td></tr>`).join("")}</tbody></table>
        <p class="mp-foot">${esc(t("R = o risco de uma trade (1 R = perder o stop). «Depois do corte» são os meses que o bot nunca viu ao escolher as regras: é aí que se vê se a vantagem é verdadeira."))}</p></section>
      ${ui.sec("Walk-forward")}
      <section class="panel mp-tw"><table class="mp-t"><thead><tr><th>${esc(t("Mercado"))}</th><th>${esc(t("Escolha"))}</th><th class="r">${esc(t("Trades"))}</th><th class="r">${esc(t("Ganhas"))}</th><th class="r">${esc(t("Total"))}</th><th class="r">PF</th><th class="r">${esc(t("Pior queda"))}</th></tr></thead>
        <tbody>${S.walkforward.map((x) => `<tr><td>${esc(x.market)}</td><td>${esc(x.pick)}</td><td class="r mp-num">${x.n}</td><td class="r mp-num">${loc(x.win, 0)}%</td><td class="r mp-num">${sr(x.sum_r)}</td><td class="r mp-num">${loc(x.pf)}</td><td class="r mp-num">${loc(x.dd, 1)} R</td></tr>`).join("")}</tbody></table></section>
      ${ui.sec("Gráficos")}
      <div class="mp-imgs">${S.images.map((n) => `<a class="panel" href="${img(n)}" target="_blank" rel="noopener"><img src="${img(n)}" alt="" loading="lazy"><span>${esc(t(IMG[n] || n))}</span></a>`).join("")}</div>
      ${S.report ? `${ui.sec("Relatório completo", `<small class="mp-dim">${esc(t("em inglês, como o bot o escreve"))}</small>`)}<details class="panel pad mp-rep"><summary>${esc(t("Abrir o relatório"))}</summary><pre>${esc(S.report)}</pre></details>` : ""}`);
  }
})();
