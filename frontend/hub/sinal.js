// Sinal na notícia (#/sinal, a tab of the Sala de Trading; pedido do David a 21 out): the second a red (high-impact) figure of
// any currency is out, the Hub says BUY or SELL in big letters, so nobody refreshes Forex Factory during the news. The Hub's
// server keeps 4 connections to TradingView and 5 to Forex Factory asking at once while the figure is due
// (backend/app/tradingroom/sinal.py); this page asks the server 4 times a second then. One minute can bring several
// currencies (NFP and Canada's jobs at 8:30 New York): each is a part with its own pair and its own BUY or SELL.
// Also draws the big alert over any page (sinal-alert.js calls showAlert).
(function () {
  const NAMES = { GOLD: "Ouro", EURUSD: "EUR/USD", GER40: "GER40", GBPUSD: "GBP/USD", AUDUSD: "AUD/USD", NZDUSD: "NZD/USD", USDJPY: "USD/JPY", USDCAD: "USD/CAD", USDCHF: "USD/CHF" };
  const USD_PICK = ["GOLD", "EURUSD", "GER40", "GBPUSD"];   // what the person follows on US figures; other currencies go on their pair
  const OUT = { ABOVE: "acima da previsão", BELOW: "abaixo da previsão", INLINE: "igual à previsão" };
  const WORD = { buy: "BUY", sell: "SELL", flat: "NO TRADE" };
  let S = null, at = 0, timer = 0, ticker = 0, heard = null;

  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { /* private window */ } return null; };
  const sym = () => (USD_PICK.includes(store("sn-sym")) ? store("sn-sym") : "GOLD");
  const asset = (P) => (P.cur === "USD" ? sym() : P.assets[0]);
  const of = (s) => (s === "GOLD" ? t("o ouro") : `o ${NAMES[s] || s}`);
  const pt = (v, d = 2) => Number(v).toLocaleString("pt-PT", { minimumFractionDigits: d, maximumFractionDigits: d });
  const ff = (s) => (s ? String(s).replace(".", ",") : "—");
  const fnum = (s) => { const v = parseFloat(String(s || "").replace(/[^0-9.\-]/g, "")); return Number.isFinite(v) ? v : null; };
  const side = (v) => (!v || !v.side || !v.strong ? "flat" : v.side > 0 ? "buy" : "sell");
  const pside = (P) => (P.state === "done" ? side(P.verdict[asset(P)]) : P.state);
  const when = (ts) => new Date(ts * 1000).toLocaleString("pt-PT", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(",", " ·");
  const day = (ts) => new Date(ts * 1000).toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit" });
  const left = () => (S && S.watch ? S.watch.left - (Date.now() - at) / 1000 : 0);

  function clock(s) {
    s = Math.max(0, Math.ceil(s));
    const d = Math.floor(s / 86400), h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60, x = s % 60, two = (n) => String(n).padStart(2, "0");
    if (d) return `${d} d ${h} h`;
    return h ? `${h}:${two(m)}:${two(x)}` : `${two(m)}:${two(x)}`;
  }

  function usd(v, s, med) {
    const g = S && S.gold;
    return s === "GOLD" && v && med != null && g ? ` ≈ $${pt(med * g / 100, 0)}` : "";
  }

  // How far from the forecast, in the figure's own decimals: +0,3
  function surprise(m) {
    const a = fnum(m.actual), f = fnum(m.forecast);
    if (a == null || f == null) return "";
    const d = ((String(m.forecast).split(".")[1] || "").match(/^\d*/) || [""])[0].length, x = a - f;
    return `${x > 0 ? "+" : x < 0 ? "−" : ""}${pt(Math.abs(x), d)}`;
  }

  // What history says, in a sentence a trader reads in two seconds.
  function why(v, s, P) {
    const m = P.items[0], o = m.outcome;
    if (!v || !v.side) return o === "INLINE" ? t("Saiu igual à previsão: sem surpresa, sem sinal.") : t("Não há previsão no Forex Factory: não há com que comparar.");
    if (v.rule) {
      const up = P.cur === "USD" ? v.side < 0 : s.startsWith(P.cur) ? v.side > 0 : v.side < 0;
      return t("Sem histórico desta notícia: vai pela regra da moeda ({o} = {c} a {d}).", { o: t(OUT[o]), c: P.cur, d: t(up ? "subir" : "descer") });
    }
    let text = t("Das {n} vezes que saiu {o}, {a} {d} nos primeiros 5 minutos em {k} ({p}%), em média {m}%{u}.",
      { n: v.n, o: t(OUT[o]), a: of(s), d: t(v.side > 0 ? "subiu" : "desceu"), k: v.k, p: Math.round(v.k * 100 / v.n), m: pt(v.med), u: usd(v, s, v.med) });
    if (v.big) text += ` ${t("Com uma surpresa deste tamanho ou maior: {k} de {n}, em média {m}%{u}.", { k: v.big.k, n: v.big.n, m: pt(v.big.med), u: usd(v, s, v.big.med) })}`;
    return v.strong ? text : `${text} ${t("É moeda ao ar: não entrar.")}`;
  }

  function scen(o, v, s) {
    const c = side(v);
    const sub = !v.side ? "" : v.rule ? t("pela regra da moeda") : `${v.k} ${t("de")} ${v.n} · ~${pt(v.med)}%${usd(v, s, v.med)}${c === "flat" ? ` · ${t("moeda ao ar")}` : ""}`;
    return `<div class="sn-sc ${c}"><small>${esc(t(o === "ABOVE" ? "Se sair acima da previsão" : "Se sair abaixo da previsão"))}</small><b>${WORD[c]}</b><span>${esc(sub)}</span></div>`;
  }

  function figs(m, cls) {
    const sur = m.outcome && m.outcome !== "INLINE" ? ` (${surprise(m)})` : "";
    return `<div class="sn-figs">
      <div class="${cls ? `hit ${cls}` : ""}"><small>${esc(t("Saiu"))}</small><b>${esc(ff(m.actual))}</b></div>
      <div><small>${esc(t("Previsão"))}</small><b>${esc(ff(m.forecast))}</b></div>
      <div><small>${esc(t("Anterior"))}</small><b>${esc(ff(m.previous))}</b></div>
      ${m.outcome ? `<div><small>${esc(t("Resultado"))}</small><b>${esc(t(OUT[m.outcome]))}${esc(sur)}</b></div>` : ""}</div>`;
  }

  function meta(W) {
    return `<div class="sn-meta"><span class="sn-imp high"><i></i>${esc(t("impacto alto"))}</span><span>${esc(when(W.t))}</span>
      ${W.test ? `<span class="sn-ens">${esc(t("ENSAIO · repetição de {d}", { d: day(W.t) }))}</span>` : ""}</div>`;
  }

  const title = (P) => `<span class="sn-cur">${esc(P.cur)}</span> ${esc(P.items[0].label)}`;

  // The plan before the figure: what each outcome means for this part's asset.
  function plan(P) {
    const s = asset(P), m = P.items[0];
    const also = P.items.length > 1 ? `<p class="sn-also">${esc(t("À mesma hora"))}: ${P.items.slice(1).map((i) => `${esc(i.label)} <em>${esc(t("prev."))} ${esc(ff(i.forecast))}</em>`).join(" · ")}</p>` : "";
    return `${figs(m)}<div class="sn-scen">${scen("ABOVE", P.scen.ABOVE[s], s)}${scen("BELOW", P.scen.BELOW[s], s)}</div>
      <p class="sn-for">${esc(t("Sinal para {a}", { a: t(NAMES[s] || s) }))}</p>${also}`;
  }

  // The result of one part: the big word and everything that backs it. Shared by the page and the alert over the Hub.
  function result(P) {
    const s = asset(P), m = P.items[0], v = P.verdict[s], c = side(v);
    const what = c === "flat" ? t("não entrar") : `${c === "buy" ? "LONG" : "SHORT"} ${t(NAMES[s] || s).toUpperCase()}`;
    const chips = Object.keys(P.verdict).filter((x) => x !== s).map((x) => {
      const w = P.verdict[x];
      return `<span class="sn-chip ${side(w)}">${esc(t(NAMES[x] || x))} <b>${WORD[side(w)]}</b>${w.n ? ` ${w.k}/${w.n}` : w.rule ? ` · ${esc(t("regra"))}` : ""}</span>`;
    }).join("");
    const others = P.items.slice(1).map((i) => {
      const against = (i.outcome === "ABOVE" && m.outcome === "BELOW") || (i.outcome === "BELOW" && m.outcome === "ABOVE");
      return `<li><span>${esc(i.label)}</span><b>${esc(i.actual ? ff(i.actual) : "…")}</b><em>${esc(t("prev."))} ${esc(ff(i.forecast))}</em>
        ${i.outcome ? `<i>${esc(t(OUT[i.outcome]))}</i>` : ""}${against ? `<i class="warn">${esc(t("contra a principal"))}</i>` : ""}</li>`;
    }).join("");
    return `<div class="sn-word">${WORD[c]}</div><div class="sn-what">${esc(what)}</div>${figs(m, c)}
      <p class="sn-why">${esc(why(v, s, P))}</p>${chips ? `<div class="sn-chips">${chips}</div>` : ""}
      ${others ? `<ul class="sn-others">${others}</ul>` : ""}`;
  }

  HUB_VIEWS.sinal = async function () {
    page(`<div class="sn" id="sn">
      <header class="sn-head">
        <div><small>${esc(t("Sala de Trading · notícias vermelhas"))}</small><h1>${esc(t("Sinal na notícia"))}</h1>
          <p class="sn-sub">${esc(t("Todas as notícias de impacto alto, de qualquer moeda. No segundo em que o número sai, BUY ou SELL em grande: o Hub tem 4 ligações à TradingView e 5 ao Forex Factory a perguntar ao mesmo tempo, ~15 respostas por segundo (o máximo que os dois sites aceitam), e compara com a previsão do Forex Factory."))}</p></div>
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

  // Faster while the figure is due.
  function cadence() {
    const W = S && S.watch;
    if (!W) return 5000;
    if (W.state === "poll" || (W.state === "wait" && left() < 20)) return 250;
    if (W.state === "done" && W.parts.some((P) => P.ago < 330)) return 1000;
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
    paint($("sn-ctl"), `<span class="sn-lbl">${esc(t("Notícias dos EUA"))}</span><div class="sn-seg" role="group" aria-label="${esc(t("Instrumento nas notícias dos EUA"))}">${USD_PICK.map((x) =>
      `<button type="button" class="${x === s ? "on" : ""}" data-sym="${x}" aria-pressed="${x === s}">${esc(t(NAMES[x]))}</button>`).join("")}</div>
      <button type="button" class="btn sn-tog ${on("sn-som") ? "on" : ""}" data-act="som" aria-pressed="${on("sn-som")}"><i></i>${esc(t("Som"))}</button>
      <button type="button" class="btn sn-tog ${on("sn-aviso") ? "on" : ""}" data-act="aviso" aria-pressed="${on("sn-aviso")}" title="${esc(t("BUY/SELL por cima de qualquer página do Hub"))}"><i></i>${esc(t("Aviso em todo o Hub"))}</button>
      <button type="button" class="btn primary" data-act="ensaio">${esc(t("Ensaio"))}</button>`);
  }

  function paintStage() {
    const el = $("sn-stage"), W = S.watch;
    if (!W) {
      el.className = "sn-stage is-empty";
      return paint(el, `<p class="sn-none">${esc(S.error || t("Não há notícias vermelhas no calendário desta semana nem da próxima."))}</p>`);
    }
    const one = W.parts.length === 1, waiting = W.parts.every((P) => P.state !== "done");
    const st = W.state === "wait" ? "wait" : W.state === "poll" && waiting ? "poll" : one ? pside(W.parts[0]) : "multi";
    el.className = `sn-stage is-${st}`;
    const names = `<h2 class="sn-name">${W.parts.map(title).join(" <i class=\"sn-dot\">·</i> ")}</h2>`;
    let top = "";
    if (W.state === "wait") top = `<div class="sn-count" id="sn-count"></div><p class="sn-cap">${esc(t("até ao número"))}</p>`;
    else if (waiting && W.state === "poll") top = `<div class="sn-scan"><div class="sn-radar"></div><div class="sn-scan-in"><b id="sn-el"></b><span>${esc(t("à espera do número"))}</span></div></div>`;
    const body = (P) => {
      if (P.state === "done") return result(P);
      if (P.state === "none") return `<div class="sn-word">—</div><p class="sn-why">${esc(t("3 minutos sem número na TradingView nem no Forex Factory. Vê o Forex Factory à mão."))}</p>${figs(P.items[0])}`;
      if (P.state === "poll" && !waiting) return `<div class="sn-scan sm"><div class="sn-radar"></div><div class="sn-scan-in"><span>${esc(t("à espera do número"))}</span></div></div>${plan(P)}`;
      return plan(P);
    };
    const parts = one ? body(W.parts[0]) : `<div class="sn-parts">${W.parts.map((P) => `<div class="sn-part is-${pside(P)}"><h3 class="sn-ph">${title(P)}</h3>${body(P)}</div>`).join("")}</div>`;
    paint(el, `${meta(W)}${names}${top}${parts}<p class="sn-foot" id="sn-stat"></p>`);
    const done = W.parts.filter((P) => P.state === "done");   // the moment one lands: a sound, once, not when the page opens on an old one
    if (heard === null) heard = new Set(done.filter((P) => P.ago >= 5).map((P) => P.id));
    done.filter((P) => !heard.has(P.id)).forEach((P) => { heard.add(P.id); beep(pside(P)); });
    tick();
  }

  // The numbers that move between two answers: the countdown, the seconds since the minute, the speed, the live price.
  function tick() {
    const W = S && S.watch;
    if (!W) return;
    const l = left(), set = (id, text) => { const e = $(id); if (e && e.textContent !== text) e.textContent = text; };
    const speed = t("TradingView {a}/s ({n} ligações, {m} ms) · Forex Factory {b}/s", { a: W.rate.tv, n: W.lanes.tv, m: W.ms.tv ?? "—", b: W.rate.ff });
    if (W.state === "wait") {
      set("sn-count", clock(l));
      set("sn-stat", l < 40 ? t("Ligações abertas · começo a ler 2 s antes · última resposta TradingView {a} ms, Forex Factory {b} ms", { a: W.ms.tv ?? "—", b: W.ms.ff ?? "—" })
        : t("Começo a ler 2 s antes do minuto: {n} ligações à TradingView e {f} ao Forex Factory ao mesmo tempo.", { n: W.lanes.tv, f: W.lanes.ff }));
    } else if (W.state === "poll" && W.parts.every((P) => P.state !== "done")) {
      set("sn-el", `${l <= 0 ? "+" : "−"}${pt(Math.abs(l), 1)} s`);
      set("sn-stat", t("{c} respostas · {s}", { c: W.checks, s: speed }));
    } else {
      const P = W.parts.find((x) => x.state === "done");
      const parts = P ? [t("Número em {x} s · {src} · {c} respostas", { x: pt(P.items[0].sec, 1), src: P.items[0].src, c: W.checks })] : [];
      if (W.px0 && W.px) {
        const ch = (W.px - W.px0) / W.px0 * 100, d = W.px - W.px0;
        parts.push(t("ouro desde o minuto {p}% ({u})", { p: `${ch > 0 ? "+" : ""}${pt(ch)}`, u: `${d < 0 ? "−" : "+"}$${pt(Math.abs(d))}` }));
      }
      parts.push(t("há {m} min", { m: Math.max(0, Math.floor(-l / 60)) }));
      set("sn-stat", parts.join(" · "));
    }
  }

  function paintNext() {
    const rows = S.next.map((g) => {
      const s = asset(g), mini = (o) => { const c = side(g.scen[o][s]); return `<i class="${c}">${esc(t(o === "ABOVE" ? "acima" : "abaixo"))} → ${WORD[c]}</i>`; };
      return `<li><time>${esc(when(g.t))}</time><span class="sn-cur">${esc(g.cur)}</span>
        <b>${esc(g.label)}${g.also.length ? `<small> +${g.also.length}</small>` : ""}</b><em>${g.forecast ? `${esc(t("prev."))} ${esc(ff(g.forecast))}` : esc(t("sem previsão ainda"))} · ${esc(t(NAMES[s] || s))}</em>
        <span class="sn-mini">${mini("ABOVE")}${mini("BELOW")}</span></li>`;
    }).join("");
    paint($("sn-next"), `<h3>${esc(t("Próximas notícias vermelhas"))}<small>${esc(t("o sinal de cada uma"))}</small></h3>
      ${rows ? `<ul class="sn-list">${rows}</ul>` : `<p class="sn-none">${esc(S.error || t("Nada mais no calendário desta semana e da próxima."))}</p>`}`);
  }

  function paintDiary() {
    const rows = S.diary.map((d) => {
      const cur = d.cur || "USD", s = cur === "USD" ? sym() : Object.keys(d.sides)[0], c = { BUY: "buy", SELL: "sell" }[d.sides[s]] || "flat", mv = d.move5;
      const ok = mv == null || c === "flat" || s !== "GOLD" ? "" : (c === "buy") === (mv > 0) ? `<i class="ok">${esc(t("certo"))}</i>` : `<i class="bad">${esc(t("errado"))}</i>`;
      return `<li><time>${esc(when(d.t))}</time><b><span class="sn-cur">${esc(cur)}</span> ${esc(d.label)}</b><em>${esc(ff(d.actual))} vs ${esc(ff(d.forecast))} · ${esc(t(NAMES[s] || s))}</em>
        <span class="sn-chip ${c}"><b>${WORD[c]}</b></span><span class="sn-mv">${mv == null || s !== "GOLD" ? "" : `${esc(t("ouro 5 min"))} ${mv > 0 ? "+" : ""}${pt(mv)}%`}${ok}</span></li>`;
    }).join("");
    paint($("sn-diary"), `<h3>${esc(t("Diário dos sinais"))}<small>${esc(t("e o ouro 5 min depois"))}</small></h3>
      ${rows ? `<ul class="sn-list">${rows}</ul>` : `<p class="sn-none">${esc(t("Ainda nenhum sinal a sério neste PC. O primeiro fica aqui."))}</p>`}`);
  }

  // A short sound when a figure lands: three high notes for BUY, three low for SELL, one for no trade.
  function beep(c) {
    if (store("sn-som") === "0") return;
    try {
      const A = (beep.ctx ||= new (window.AudioContext || window.webkitAudioContext)());
      if (A.resume) A.resume();
      (c === "buy" || c === "sell" ? [0, 0.17, 0.34] : [0]).forEach((d) => {
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
          S = await api("/api/sinal/ensaio", { method: "POST", body: {} }); at = Date.now(); heard = new Set();
          msg(t("Ensaio: o {n} de {d} sai daqui a 15 segundos, como se fosse agora.", { n: S.watch.parts[0].items[0].label, d: day(S.watch.t) }));
          paintStage(); load().catch(() => {});
        } catch (err) { msg(err.message); }
        b.disabled = false;
      }
    });
  }

  // The big alert over any page of the Hub (sinal-alert.js): every part that just landed.
  function showAlert(a) {
    const cls = a.parts.length === 1 ? pside(a.parts[0]) : "multi";
    document.querySelector(".sn-ov")?.remove();
    const ov = document.createElement("div");
    ov.className = "sn-ov";
    const parts = a.parts.length === 1 ? `<h2 class="sn-name">${title(a.parts[0])}</h2>${result(a.parts[0])}`
      : `<div class="sn-parts">${a.parts.map((P) => `<div class="sn-part is-${pside(P)}"><h3 class="sn-ph">${title(P)}</h3>${result(P)}</div>`).join("")}</div>`;
    ov.innerHTML = `<div class="sn-stage sn-ov-box is-${cls}" role="alertdialog" aria-modal="true" aria-label="${esc(t("Sinal na notícia"))}">
      <button type="button" class="sn-x" data-x aria-label="${esc(t("Fechar"))}">×</button>${meta(a)}${parts}
      <div class="sn-ov-btns"><a class="btn primary" href="#/sinal" data-x>${esc(t("Abrir o Sinal na notícia"))}</a><button type="button" class="btn" data-x>${esc(t("Fechar"))}</button></div></div>`;
    const close = () => { ov.remove(); document.removeEventListener("keydown", onKey); clearTimeout(ov.t); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    ov.addEventListener("click", (e) => { if (e.target === ov || e.target.closest("[data-x]")) close(); });
    document.addEventListener("keydown", onKey);
    ov.t = setTimeout(close, 150000);
    document.body.append(ov);
    beep(cls === "multi" ? "flat" : cls);
  }

  window.Sinal = { showAlert };
})();
