// Sinal na notícia (#/sinal, a tab of the Sala de Trading; pedido do David a 21 out): the second a US figure is out, the Hub
// says BUY or SELL in big letters, so nobody refreshes Forex Factory during the news. The Hub's server checks TradingView
// ~5 times a second and Forex Factory once a second (backend/app/tradingroom/sinal.py); this page asks it 4 times a second
// while the figure is due. The direction is what the asset did in the first 5 minutes after past releases with the same
// outcome; under 60% of them the page says NO TRADE. Also draws the big alert over any page (sinal-alert.js calls showAlert).
(function () {
  const NAMES = { GOLD: "Ouro", EURUSD: "EUR/USD", GER40: "GER40", GBPUSD: "GBP/USD" };
  const OF = { GOLD: "o ouro", EURUSD: "o EUR/USD", GER40: "o GER40", GBPUSD: "o GBP/USD" };
  const OUT = { ABOVE: "acima da previsão", BELOW: "abaixo da previsão", INLINE: "igual à previsão" };
  const WORD = { buy: "BUY", sell: "SELL", flat: "NO TRADE" };
  let S = null, at = 0, timer = 0, ticker = 0, heard = null;

  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { /* private window */ } return null; };
  const sym = () => (NAMES[store("sn-sym")] ? store("sn-sym") : "GOLD");
  const pt = (v, d = 2) => Number(v).toLocaleString("pt-PT", { minimumFractionDigits: d, maximumFractionDigits: d });
  const ff = (s) => (s ? String(s).replace(".", ",") : "—");
  const side = (v) => (!v || !v.side || !v.strong ? "flat" : v.side > 0 ? "buy" : "sell");
  const when = (ts) => new Date(ts * 1000).toLocaleString("pt-PT", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(",", " ·");
  const day = (ts) => new Date(ts * 1000).toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit" });
  const left = () => (S && S.watch ? S.watch.left - (Date.now() - at) / 1000 : 0);

  function clock(s) {
    s = Math.max(0, Math.ceil(s));
    const d = Math.floor(s / 86400), h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60, x = s % 60, two = (n) => String(n).padStart(2, "0");
    if (d) return `${d} d ${h} h`;
    return h ? `${h}:${two(m)}:${two(x)}` : `${two(m)}:${two(x)}`;
  }

  function usd(v, s) {
    const g = S && S.gold;
    return s === "GOLD" && v && v.med != null && g ? ` ≈ $${pt(v.med * g / 100, 0)}` : "";
  }

  // What history says, in one sentence a trader reads in two seconds.
  function why(v, s, o) {
    if (!v || !v.side) return o === "INLINE" ? t("Saiu igual à previsão: sem surpresa, sem sinal.") : t("Não há previsão no Forex Factory: não há com que comparar.");
    if (v.rule) return t("Sem histórico desta notícia: vai pela regra do dólar ({o}).", { o: t(OUT[o]) });
    const base = t("Das {n} vezes que saiu {o}, {a} {d} nos primeiros 5 minutos em {k} ({p}%), em média {m}%{u}.",
      { n: v.n, o: t(OUT[o]), a: t(OF[s]), d: t(v.side > 0 ? "subiu" : "desceu"), k: v.k, p: Math.round(v.k * 100 / v.n), m: pt(v.med), u: usd(v, s) });
    return v.strong ? base : `${base} ${t("É moeda ao ar: não entrar.")}`;
  }

  function scen(o, v, s) {
    const c = side(v);
    const sub = !v.side ? "" : v.rule ? t("pela regra do dólar") : `${v.k} ${t("de")} ${v.n} · ~${pt(v.med)}%${usd(v, s)}${c === "flat" ? ` · ${t("moeda ao ar")}` : ""}`;
    return `<div class="sn-sc ${c}"><small>${esc(t(o === "ABOVE" ? "Se sair acima da previsão" : "Se sair abaixo da previsão"))}</small><b>${WORD[c]}</b><span>${esc(sub)}</span></div>`;
  }

  function figs(m, cls) {
    return `<div class="sn-figs">
      <div class="${cls ? `hit ${cls}` : ""}"><small>${esc(t("Saiu"))}</small><b>${esc(ff(m.actual))}</b></div>
      <div><small>${esc(t("Previsão"))}</small><b>${esc(ff(m.forecast))}</b></div>
      <div><small>${esc(t("Anterior"))}</small><b>${esc(ff(m.previous))}</b></div>
      ${m.outcome ? `<div><small>${esc(t("Resultado"))}</small><b>${esc(t(OUT[m.outcome]))}</b></div>` : ""}</div>`;
  }

  function meta(W) {
    return `<div class="sn-meta"><span class="sn-imp ${W.impact}"><i></i>${esc(t(W.impact === "high" ? "impacto alto" : "impacto médio"))}</span>
      <span>${esc(when(W.t))}</span>${W.test ? `<span class="sn-ens">${esc(t("ENSAIO · repetição de {d}", { d: day(W.t) }))}</span>` : ""}</div>
      <h2 class="sn-name">${esc(W.items[0].label)}</h2>`;
  }

  // The result for one asset: the big word and everything that backs it. Shared by the page and the alert over the Hub.
  function result(W, s) {
    const m = W.items[0], v = W.verdict[s], c = side(v);
    const what = c === "flat" ? t("não entrar") : `${c === "buy" ? "LONG" : "SHORT"} ${t(NAMES[s]).toUpperCase()}`;
    const chips = Object.keys(NAMES).filter((x) => x !== s && W.verdict[x]).map((x) => {
      const w = W.verdict[x];
      return `<span class="sn-chip ${side(w)}">${esc(t(NAMES[x]))} <b>${WORD[side(w)]}</b>${w.n ? ` ${w.k}/${w.n}` : w.rule ? ` · ${esc(t("regra"))}` : ""}</span>`;
    }).join("");
    const others = W.items.slice(1).map((i) => {
      const against = (i.outcome === "ABOVE" && m.outcome === "BELOW") || (i.outcome === "BELOW" && m.outcome === "ABOVE");
      return `<li><span>${esc(i.label)}</span><b>${esc(i.actual ? ff(i.actual) : "…")}</b><em>${esc(t("prev."))} ${esc(ff(i.forecast))}</em>
        ${i.outcome ? `<i class="${i.outcome.toLowerCase()}">${esc(t(OUT[i.outcome]))}</i>` : ""}${against ? `<i class="warn">${esc(t("contra a principal"))}</i>` : ""}</li>`;
    }).join("");
    return `${meta(W)}<div class="sn-word">${WORD[c]}</div><div class="sn-what">${esc(what)}</div>${figs(m, c)}
      <p class="sn-why">${esc(why(v, s, m.outcome))}</p>${chips ? `<div class="sn-chips">${chips}</div>` : ""}
      ${others ? `<ul class="sn-others">${others}</ul>` : ""}`;
  }

  HUB_VIEWS.sinal = async function () {
    page(`<div class="sn" id="sn">
      <header class="sn-head">
        <div><small>${esc(t("Sala de Trading · notícias dos EUA"))}</small><h1>${esc(t("Sinal na notícia"))}</h1>
          <p class="sn-sub">${esc(t("No segundo em que o número sai, BUY ou SELL em grande. O Hub lê a TradingView 5 vezes por segundo e o Forex Factory a cada segundo, compara com a previsão do Forex Factory e diz o que o mercado fez nas saídas iguais."))}</p></div>
        <div class="sn-ctl" id="sn-ctl"></div>
      </header>
      <div class="sn-msg" id="sn-msg" hidden></div>
      <section class="sn-stage" id="sn-stage"></section>
      <div class="sn-grid">
        <section class="sn-card" id="sn-next"></section>
        <section class="sn-card" id="sn-diary"></section>
      </div>
    </div>`);
    bind();
    heard = null;
    paintCtl();
    await load().catch((e) => msg(e.message));
    clearInterval(ticker);
    ticker = setInterval(() => { if (!$("sn")) { clearInterval(ticker); return; } tick(); }, 200);
  };

  // Faster while the figure is due: the server already checks 5 times a second, the page asks it 4.
  function cadence() {
    const W = S && S.watch;
    if (!W) return 5000;
    if (W.state === "poll" || (W.state === "wait" && left() < 20)) return 250;
    if (W.state === "done" && W.ago < 330) return 1000;
    return document.hidden ? 15000 : 3000;
  }

  async function load() {
    clearTimeout(timer);
    try {
      S = await request("/api/sinal");   // not api(): its 3 s read cache would hide the figure
      at = Date.now();
      paintStage(); paintNext(); paintDiary();
    } finally {
      if ($("sn")) timer = setTimeout(() => load().catch(() => {}), cadence());
    }
  }

  function msg(text) {
    const el = $("sn-msg");
    if (!el) return;
    el.hidden = false; el.textContent = text;
    clearTimeout(msg.t); msg.t = setTimeout(() => { el.hidden = true; }, 6000);
  }

  function paintCtl() {
    const s = sym(), on = (k) => store(k) !== "0";
    paint($("sn-ctl"), `<div class="sn-seg" role="group" aria-label="${esc(t("Instrumento"))}">${Object.keys(NAMES).map((x) =>
      `<button type="button" class="${x === s ? "on" : ""}" data-sym="${x}" aria-pressed="${x === s}">${esc(t(NAMES[x]))}</button>`).join("")}</div>
      <button type="button" class="btn sn-tog ${on("sn-som") ? "on" : ""}" data-act="som" aria-pressed="${on("sn-som")}"><i></i>${esc(t("Som"))}</button>
      <button type="button" class="btn sn-tog ${on("sn-aviso") ? "on" : ""}" data-act="aviso" aria-pressed="${on("sn-aviso")}" title="${esc(t("BUY/SELL por cima de qualquer página do Hub nas notícias de impacto alto"))}"><i></i>${esc(t("Aviso em todo o Hub"))}</button>
      <button type="button" class="btn primary" data-act="ensaio">${esc(t("Ensaio"))}</button>`);
  }

  function paintStage() {
    const el = $("sn-stage"), W = S.watch, s = sym();
    if (!W) {
      el.className = "sn-stage is-empty";
      return paint(el, `<p class="sn-none">${esc(S.error || t("Não há notícias dos EUA no calendário desta semana nem da próxima."))}</p>`);
    }
    const m = W.items[0], st = W.state === "done" ? side(W.verdict[s]) : W.state;
    el.className = `sn-stage is-${st}`;
    const scens = `<div class="sn-scen">${scen("ABOVE", W.scen.ABOVE[s], s)}${scen("BELOW", W.scen.BELOW[s], s)}</div>`;
    const also = W.items.length > 1 ? `<p class="sn-also">${esc(t("À mesma hora"))}: ${W.items.slice(1).map((i) => `${esc(i.label)} <em>${esc(t("prev."))} ${esc(ff(i.forecast))}</em>`).join(" · ")}</p>` : "";
    let html;
    if (W.state === "wait") {
      html = `${meta(W)}<div class="sn-count" id="sn-count"></div><p class="sn-cap">${esc(t("até ao número"))}</p>${figs(m)}${scens}${also}<p class="sn-foot" id="sn-stat"></p>`;
    } else if (W.state === "poll") {
      html = `${meta(W)}<div class="sn-scan"><div class="sn-radar"></div><div class="sn-scan-in"><b id="sn-el"></b><span>${esc(t("à espera do número"))}</span></div></div>
        <p class="sn-foot" id="sn-stat"></p>${figs(m)}${scens}`;
    } else if (W.state === "none") {
      html = `${meta(W)}<div class="sn-word">—</div><p class="sn-why">${esc(t("3 minutos sem número na TradingView nem no Forex Factory. Vê o Forex Factory à mão."))}</p>${figs(m)}`;
    } else {
      html = `${result(W, s)}<p class="sn-foot" id="sn-live"></p>`;
    }
    paint(el, html);
    if (W.state === "done" && heard !== W.id) {   // the moment it lands: a sound, once, not when the page opens on an old one
      if (heard !== null || W.ago < 5) beep(st);
      heard = W.id;
    } else if (heard === null) heard = W.state === "done" ? W.id : "";
    tick();
  }

  // The numbers that move between two answers: the countdown, the seconds since the minute, the live price.
  function tick() {
    const W = S && S.watch;
    if (!W) return;
    const l = left(), set = (id, text) => { const e = $(id); if (e && e.textContent !== text) e.textContent = text; };
    const speed = `TradingView ${W.ms.tv ?? "—"} ms · Forex Factory ${W.ms.ff ?? "—"} ms`;
    if (W.state === "wait") {
      set("sn-count", clock(l));
      set("sn-stat", l < 60 ? t("Começo a ler 2 s antes · ligação: {s}", { s: speed }) : t("Começo a ler 2 s antes do minuto: TradingView 5 vezes por segundo, Forex Factory a cada segundo."));
    } else if (W.state === "poll") {
      set("sn-el", `${l <= 0 ? "+" : "−"}${pt(Math.abs(l), 1)} s`);
      set("sn-stat", t("{c} verificações · {s}", { c: W.checks, s: speed }));
    } else if (W.state === "done") {
      const m = W.items[0], parts = [t("Número em {x} s · {src} · {c} verificações", { x: pt(m.sec, 1), src: m.src, c: W.checks })];
      if (W.px0 && W.px) {
        const ch = (W.px - W.px0) / W.px0 * 100, d = W.px - W.px0;
        parts.push(t("ouro desde o minuto {p}% ({u})", { p: `${ch > 0 ? "+" : ""}${pt(ch)}`, u: `${d < 0 ? "−" : "+"}$${pt(Math.abs(d))}` }));
      }
      parts.push(t("há {m} min", { m: Math.max(0, Math.floor(-l / 60)) }));
      set("sn-live", parts.join(" · "));
    }
  }

  function paintNext() {
    const s = sym(), rows = S.next.map((g) => {
      const mini = (o) => { const v = g.scen[o][s], c = side(v); return `<i class="${c}">${esc(t(o === "ABOVE" ? "acima" : "abaixo"))} → ${WORD[c]}</i>`; };
      return `<li><time>${esc(when(g.t))}</time><span class="sn-imp ${g.impact}" title="${esc(t(g.impact === "high" ? "impacto alto" : "impacto médio"))}"><i></i></span>
        <b>${esc(g.label)}${g.also.length ? `<small> +${g.also.length}</small>` : ""}</b><em>${g.forecast ? `${esc(t("prev."))} ${esc(ff(g.forecast))}` : esc(t("sem previsão ainda"))}</em>
        <span class="sn-mini">${mini("ABOVE")}${mini("BELOW")}</span></li>`;
    }).join("");
    paint($("sn-next"), `<h3>${esc(t("Próximas notícias"))}<small>${esc(t("{s}, pelo histórico", { s: t(NAMES[s]) }))}</small></h3>
      ${rows ? `<ul class="sn-list">${rows}</ul>` : `<p class="sn-none">${esc(S.error || t("Nada mais no calendário desta semana e da próxima."))}</p>`}`);
  }

  function paintDiary() {
    const s = sym(), rows = S.diary.map((d) => {
      const c = { BUY: "buy", SELL: "sell" }[d.sides[s]] || "flat", mv = d.move5;
      const ok = mv == null || c === "flat" || s !== "GOLD" ? "" : (c === "buy") === (mv > 0) ? `<i class="ok">${esc(t("certo"))}</i>` : `<i class="bad">${esc(t("errado"))}</i>`;
      return `<li><time>${esc(when(d.t))}</time><b>${esc(d.label)}</b><em>${esc(ff(d.actual))} vs ${esc(ff(d.forecast))}</em>
        <span class="sn-chip ${c}"><b>${WORD[c]}</b></span><span class="sn-mv">${mv == null ? "" : `${esc(t("ouro 5 min"))} ${mv > 0 ? "+" : ""}${pt(mv)}%`}${ok}</span></li>`;
    }).join("");
    paint($("sn-diary"), `<h3>${esc(t("Diário dos sinais"))}<small>${esc(t("o que o ouro fez 5 min depois"))}</small></h3>
      ${rows ? `<ul class="sn-list">${rows}</ul>` : `<p class="sn-none">${esc(t("Ainda nenhum sinal a sério neste PC. O primeiro fica aqui com o resultado aos 5 minutos."))}</p>`}`);
  }

  // A short sound when the figure lands: three high notes for BUY, three low for SELL, one for no trade.
  function beep(c) {
    if (store("sn-som") === "0") return;
    try {
      const A = (beep.ctx ||= new (window.AudioContext || window.webkitAudioContext)());
      if (A.resume) A.resume();
      (c === "flat" ? [0] : [0, 0.17, 0.34]).forEach((d) => {
        const o = A.createOscillator(), g = A.createGain(), at0 = A.currentTime + d;
        o.type = "sine"; o.frequency.value = c === "buy" ? 1320 : c === "sell" ? 520 : 820;
        g.gain.setValueAtTime(0.0001, at0); g.gain.exponentialRampToValueAtTime(0.3, at0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, at0 + 0.15);
        o.connect(g).connect(A.destination); o.start(at0); o.stop(at0 + 0.16);
      });
    } catch (e) { /* no sound on this browser */ }
  }

  function bind() {
    $("sn").addEventListener("click", async (e) => {
      const b = e.target.closest("[data-sym],[data-act]");
      if (!b) return;
      if (b.dataset.sym) { store("sn-sym", b.dataset.sym); paintCtl(); if (S) { paintStage(); paintNext(); paintDiary(); } return; }
      const act = b.dataset.act;
      if (act === "som" || act === "aviso") {
        const k = `sn-${act}`;
        store(k, store(k) === "0" ? "1" : "0"); paintCtl();
        if (act === "som" && store(k) !== "0") beep("buy");   // also unlocks the sound for this page
        return;
      }
      if (act === "ensaio") {
        b.disabled = true;
        beep.ctx ||= (() => { try { return new (window.AudioContext || window.webkitAudioContext)(); } catch (err) { return null; } })();
        try {
          S = await api("/api/sinal/ensaio", { method: "POST", body: {} }); at = Date.now(); heard = "";
          msg(t("Ensaio: o {n} de {d} sai daqui a 10 segundos, como se fosse agora.", { n: S.watch.items[0].label, d: day(S.watch.t) }));
          paintStage(); load().catch(() => {});
        } catch (err) { msg(err.message); }
        b.disabled = false;
      }
    });
  }

  // The big alert over any page of the Hub (sinal-alert.js), for the person's asset.
  function showAlert(a) {
    const s = sym(), c = side(a.verdict[s]);
    document.querySelector(".sn-ov")?.remove();
    const ov = document.createElement("div");
    ov.className = "sn-ov";
    ov.innerHTML = `<div class="sn-stage sn-ov-box is-${c}" role="alertdialog" aria-modal="true" aria-label="${esc(t("Sinal na notícia"))}">
      <button type="button" class="sn-x" data-x aria-label="${esc(t("Fechar"))}">×</button>${result({ ...a, impact: "high" }, s)}
      <div class="sn-ov-btns"><a class="btn primary" href="#/sinal" data-x>${esc(t("Abrir o Sinal na notícia"))}</a><button type="button" class="btn" data-x>${esc(t("Fechar"))}</button></div></div>`;
    const close = () => { ov.remove(); document.removeEventListener("keydown", onKey); clearTimeout(ov.t); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    ov.addEventListener("click", (e) => { if (e.target === ov || e.target.closest("[data-x]")) close(); });
    document.addEventListener("keydown", onKey);
    ov.t = setTimeout(close, 150000);
    document.body.append(ov);
    beep(c);
  }

  window.Sinal = { showAlert };
})();
