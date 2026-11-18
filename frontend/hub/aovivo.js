// Ao vivo: the gmgn-tracker's MemeIntel widget (desktop/, Windows only, in Russian) remade for the Hub, in Portuguese, as a
// floating window over any page (backend/app/memes_live.py, /api/memes/live). The same four tabs: Sinais, Rugs (the radar),
// X ao vivo (tweets and the pump.fun coins launched under them) and Novas (every launch).
//
// 17 nov, Marco, on the first version (a panel on top of «Quem acerta»): «não ficou nada confortável... um botão para abrir...
// vou precisar de arrastar isso para outras páginas... que combine ao máximo... economiza isso». So: the ⚡ button at the
// bottom of the side bar (and «Ao vivo» in the black hole) opens a glass window that is dragged by its top, resized by its
// corner, stays open from page to page, and shrinks to a small pill (live dot, signals, alarms). Where it was, its size, tab
// and state are kept on this browser. It asks the Hub every 3 s while open, every 15 s as a pill, never when closed.
//
// 18 Nov (GTA 6 comes out on the 19th, the GTA coins exploding), Marco: «mete tudo para o widget... um widget que a gente
// consegue também remover para estar no Google a utilizá-lo... uma nova janela em que eu consiga mexer». So: the first tab is
// the narrative (backend/app/memes_narr.py: the GTA coins, the new launches, the calls and posts, the lives), and ⧉ takes the
// window out of the Hub into a window of its own, over everything (the widget's own window, else Chrome's picture-in-picture,
// else a small browser window), on the page #/aovivo with ?lv=1: the window alone, the size of that window.
(function () {
  const SOLO = /[?&]lv=1(&|$)/.test(location.search);
  if (SOLO) document.documentElement.classList.add("lv-solo");
  const KEY = SOLO ? "lv-solo" : "lv-win";
  const loc = (v, d = 0) => Number(v).toLocaleString("pt-PT", { minimumFractionDigits: d, maximumFractionDigits: d });
  const usd = (v) => (!v ? "—" : v >= 1e9 ? `${loc(v / 1e9, 1)} mil M$` : v >= 1e6 ? `${loc(v / 1e6, 1)} M$` : v >= 1e3 ? `${loc(v / 1e3, 0)} mil $` : `${loc(v, 0)} $`);
  const pct = (v) => (v == null ? "" : `<span class="${v > 0 ? "lv-up" : v < 0 ? "lv-dn" : ""}">${v > 0 ? "+" : ""}${loc(v, Math.abs(v) < 10 ? 1 : 0)}%</span>`);
  const ago = (ts) => { const s = Date.now() / 1000 - ts; return s < 60 ? t("agora mesmo") : s < 3600 ? t("há {n} min", { n: Math.round(s / 60) }) : t("há {n} h", { n: Math.round(s / 3600) }); };
  const since = (s) => (s < 60 ? `${Math.round(s)} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`);
  const sym = (v) => String(v || "?").replace(/^\$+/, "");
  const TABS = [["narr", "GTA 6"], ["trend", "Tendências"], ["x", "X ao vivo"], ["sinais", "Sinais"], ["rugs", "Rugs"], ["novas", "Novas"]];
  const TSUB = [["words", "O que ganha"], ["coins", "Contratos"], ["chans", "Canais"]];
  const NSUB = [["hunt", "🎯 Caça"], ["coins", "Moedas"], ["new", "Novas"], ["calls", "Calls e posts"], ["lives", "Lives"]];
  const phone = () => document.documentElement.classList.contains("is-phone");

  let st = { state: "closed", tab: "narr", nsub: "coins", tsub: "words", x: null, y: null, w: 420, h: 620, watched: true, coins: false };
  try { st = { ...st, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch (e) { /* private window */ }
  if (!st.v18) { st.tab = "narr"; st.v18 = 1; }
  if (!st.v18b) { st.nsub = "hunt"; st.v18b = 1; }   // 18 Nov, 14h: the Dacity hunt first   // 18 Nov: the narrative tab comes first, once
  if (SOLO) st.state = "open";
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* private window */ } };
  let LV = null, timer = 0, q = "", seenBad = Number(st.seenBad || 0);

  /* ---------- the window and the pill ---------- */
  function build() {
    if (document.getElementById("lv-win")) return;
    const w = document.createElement("section");
    w.className = "lv-win"; w.id = "lv-win"; w.hidden = true;
    w.setAttribute("aria-label", t("Ao vivo"));
    w.innerHTML = `<header class="lv-h" id="lv-drag"><span class="lv-dot" id="lv-dot"></span><b>${esc(t("Ao vivo"))}</b><small id="lv-st">${esc(t("a ligar…"))}</small>
        ${SOLO ? "" : `<button type="button" class="lv-hb" data-lv="solo" title="${esc(t("Abrir numa janela própria, por cima de tudo (Google, outras apps)"))}" aria-label="${esc(t("Janela própria"))}">${icon("pip")}</button>
        <button type="button" class="lv-hb" data-lv="mini" title="${esc(t("Encolher"))}" aria-label="${esc(t("Encolher"))}"><i class="lv-min"></i></button>`}
        <button type="button" class="lv-hb" data-lv="close" title="${esc(t("Fechar"))}" aria-label="${esc(t("Fechar"))}">${icon("x")}</button></header>
      <nav class="lv-tabs" id="lv-tabs"></nav>
      <button type="button" class="lv-danger" id="lv-danger" data-lv-tab="rugs" hidden></button>
      <div class="lv-tools" id="lv-tools"></div>
      <div class="lv-body" id="lv-body"><p class="lv-e">${esc(t("A ligar à pump.fun e ao X…"))}</p></div>`;
    document.body.appendChild(w);
    const p = document.createElement("button");
    p.type = "button"; p.className = "lv-pill"; p.id = "lv-pill"; p.hidden = true; p.dataset.lv = "open";
    document.body.appendChild(p);
    w.addEventListener("click", click);
    p.addEventListener("click", click);
    w.addEventListener("submit", submit);
    w.addEventListener("input", (e) => { if (e.target.name === "lvq") { q = e.target.value.trim().toLowerCase(); paintBody(); } });
    drag(w);
    if ("ResizeObserver" in window) new ResizeObserver(() => {
      if (w.hidden || phone()) return;
      const r = w.getBoundingClientRect();
      if (r.width > 100 && (Math.round(r.width) !== st.w || Math.round(r.height) !== st.h)) { st.w = Math.round(r.width); st.h = Math.round(r.height); save(); }
    }).observe(w);
    window.addEventListener("resize", place);
  }

  function place() {
    const w = document.getElementById("lv-win");
    if (!w || phone() || SOLO) return;
    const W = Math.min(st.w || 400, innerWidth - 16), H = Math.min(st.h || 560, innerHeight - 16);
    const x = st.x == null ? innerWidth - W - 24 : Math.max(8, Math.min(st.x, innerWidth - W - 8));
    const y = st.y == null ? innerHeight - H - 24 : Math.max(8, Math.min(st.y, innerHeight - 60));
    Object.assign(w.style, { left: x + "px", top: y + "px", width: W + "px", height: H + "px" });
  }

  function drag(w) {
    const h = w.querySelector("#lv-drag");
    h.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest("button") || phone() || SOLO) return;
      const r = w.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
      h.setPointerCapture(e.pointerId);
      w.classList.add("moving");
      const move = (ev) => {
        st.x = Math.max(8, Math.min(ev.clientX - dx, innerWidth - r.width - 8));
        st.y = Math.max(8, Math.min(ev.clientY - dy, innerHeight - 48));
        w.style.left = st.x + "px"; w.style.top = st.y + "px";
      };
      const up = () => { h.removeEventListener("pointermove", move); h.removeEventListener("pointerup", up); h.removeEventListener("pointercancel", up); w.classList.remove("moving"); save(); };
      h.addEventListener("pointermove", move); h.addEventListener("pointerup", up); h.addEventListener("pointercancel", up);
    });
  }

  function set(state) {
    build();
    st.state = state; save();
    const w = document.getElementById("lv-win"), p = document.getElementById("lv-pill"), b = document.getElementById("lv-open");
    w.hidden = state !== "open";
    p.hidden = state !== "mini";
    if (b) b.classList.toggle("on", state !== "closed");
    if (state === "open") { place(); tools(); paint_(); }
    clearInterval(timer);
    if (state === "closed") return;
    poll();
    timer = setInterval(poll, state === "open" ? 3000 : 15000);
  }
  async function poll() {
    if (document.hidden || st.state === "closed") return;
    try { LV = await api("/api/memes/live"); } catch (e) { return; }
    paint_();
  }

  /* ---------- painting ---------- */
  function paint_() {
    if (!LV) return;
    const bad = LV.alerts.filter((a) => a.level === "bad");
    const fresh = bad.filter((a) => a.t > seenBad).length;
    const pp = LV.src.pump, tr = LV.src.tree, on = pp.on && tr.on;
    const pill = document.getElementById("lv-pill");
    if (pill && st.state === "mini") paint(pill, `<span class="lv-dot ${on ? "on" : "half"}"></span><b>${esc(t("Ao vivo"))}</b>${LV.signals.length ? `<small>${esc(t("{n} sinais", { n: LV.signals.length }))}</small>` : ""}${fresh ? `<small class="bad">${icon("alert")}${fresh}</small>` : ""}`);
    if (st.state !== "open") return;
    if (st.tab === "rugs" && bad.length) { seenBad = bad[0].t; st.seenBad = seenBad; save(); }
    document.getElementById("lv-dot").className = `lv-dot ${on ? "on" : pp.on || tr.on ? "half" : ""}`;
    paint(document.getElementById("lv-st"), esc([LV.sol ? `SOL ${loc(LV.sol, 2)} $` : "", pp.on ? t("{n} novas/min", { n: loc(LV.per_min, 1) }) : t("pump.fun a ligar"),
      tr.on ? (LV.lag != null ? t("X a {s} s", { s: loc(LV.lag, 1) }) : t("X ligado")) : t("X a ligar")].filter(Boolean).join(" · ")));
    const N = (LV.narr || [])[0];
    const hot = N ? N.coins.filter((c) => c.tags.some((x) => x[0] === "A explodir")).length : 0;
    const TR = LV.trends;
    const n = { trend: TR ? TR.coins.filter((c) => c.channels > 1).length : 0, narr: hot, sinais: LV.signals.length, rugs: fresh, x: LV.posts.filter((p) => p.coins.length).length, novas: LV.launches.length };
    paint(document.getElementById("lv-tabs"), TABS.map(([k, l]) => `<button type="button" data-lv-tab="${k}" class="${k === st.tab ? "on" : ""} ${k === "rugs" && fresh ? "alarm" : ""} ${k === "narr" ? "narr" : ""}" ${k === "narr" && hot ? `title="${esc(t("{n} a explodir", { n: hot }))}"` : ""}>${esc(k === "narr" && N ? N.name : t(l))}${n[k] ? `<small>${n[k]}</small>` : ""}</button>`).join(""));
    const last = bad[0], dz = document.getElementById("lv-danger");
    dz.hidden = !last || st.tab === "rugs" || Date.now() / 1000 - last.t > 1800;
    if (last) paint(dz, `${icon("alert")}<span><b>$${esc(sym(last.symbol))}</b> ${esc(last.text)}</span>`);
    paintBody();
  }
  const paintBody = () => LV && paint(document.getElementById("lv-body"), ({ narr, trend, sinais, rugs, x: xfeed, novas })[st.tab]());

  function tools() {
    const el = document.getElementById("lv-tools");
    if (st.tab === "narr") el.innerHTML = `<div class="lv-chips lv-nsub">${NSUB.map(([k, l]) => `<button type="button" data-lv-nsub="${k}" class="${k === st.nsub ? "on" : ""}">${esc(t(l))}</button>`).join("")}</div>`
      + (st.nsub === "hunt" ? `<form class="lv-add lv-hunt-add" id="lv-hunt-add"><input name="term" placeholder="${esc(t("Palavra a caçar (ex.: dacity)"))}" autocomplete="off"><button class="btn sm primary">${esc(t("Caçar"))}</button></form>` : "");
    else if (st.tab === "trend") el.innerHTML = `<div class="lv-chips lv-nsub">${TSUB.map(([k, l]) => `<button type="button" data-lv-tsub="${k}" class="${k === (st.tsub || "words") ? "on" : ""}">${esc(t(l))}</button>`).join("")}</div>`;
    else if (st.tab === "rugs") el.innerHTML = `<form class="lv-add" id="lv-add"><input name="mint" placeholder="${esc(t("Cola o contrato de uma moeda"))}" autocomplete="off" spellcheck="false"><button class="btn sm primary">${esc(t("Vigiar"))}</button></form>`;
    else if (st.tab === "x") el.innerHTML = `<div class="lv-chips"><button type="button" data-lv-opt="watched" class="${st.watched ? "on" : ""}">${esc(t("Só quem seguimos"))}</button><button type="button" data-lv-opt="coins" class="${st.coins ? "on" : ""}">${esc(t("Só com moedas"))}</button></div>`;
    else if (st.tab === "novas") el.innerHTML = `<input class="lv-q" name="lvq" value="${esc(q)}" placeholder="${esc(t("Procurar nome ou contrato"))}" autocomplete="off">`;
    else el.innerHTML = "";
  }

  const img = (c) => (c.image ? `<img class="lv-img" src="${esc(c.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<i class="lv-img">${esc(sym(c.symbol)[0] || "?")}</i>`);
  const acts = (m, dex) => `<span class="lv-acts"><button type="button" data-lv-copy="${esc(m)}" title="${esc(t("Copiar o contrato"))}">${esc(t("Copiar"))}</button>${/^0x/.test(m) ? (dex ? `<a href="${esc(dex)}" target="_blank" rel="noopener">Dex</a>` : "") : `<a href="https://gmgn.ai/sol/token/${esc(m)}" target="_blank" rel="noopener">GMGN</a>`}</span>`;
  const empty = (s) => `<p class="lv-e">${esc(s)}</p>`;
  const word = (s) => `<span class="lv-tag ${s.tone}">${esc(t(s.word))}</span>`;

  // the narrative (GTA 6): its coins by the money of the last hour, the new launches, the calls and posts, the lives
  const usdK = (v) => (!v ? "—" : v >= 1e6 ? `${loc(v / 1e6, 1)} M$` : v >= 1e3 ? `${loc(v / 1e3, 0)} k$` : `${loc(v, 0)} $`);
  const ageTxt = (h) => (h == null ? "" : h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} d`);
  const SRC = { X: "X", Telegram: "TG", Reddit: "RD" };
  function narr() {
    const N = (LV.narr || [])[0];
    if (!N) return empty(t("A ler a narrativa…"));
    const head = `<div class="lv-nhead"><b>${esc(N.name)}</b><span>${esc(t("{n} moedas · {v} na última hora · {w} a ver lives", { n: N.n_coins, v: usdK(N.vol1), w: loc(N.viewers || 0, 0) }))}</span></div>`;
    if (st.nsub === "hunt") {
      const H = N.hunt || { terms: [], events: [], screens: [] };
      const KIND = { launch: ["Nasceu", "ok"], move: ["A mexer", "ok"], post: ["Falam disso", "info"], title: ["Live", "warn"], screen: ["NO ECRÃ", "bad"] };
      const terms = H.terms.length ? H.terms.map((w) => `<span class="lv-term">🎯 ${esc(w.toUpperCase())}<button type="button" data-lv-unhunt="${esc(w)}" aria-label="${esc(t("Parar de caçar"))}">×</button></span>`).join("") : `<span class="lv-e">${esc(t("Nada a caçar: escreve uma palavra em cima."))}</span>`;
      const status = `<p class="lv-hunt-st">${esc(t("Moedas de 20 em 20 s · lives de minuto a minuto · ecrã de {n} lives lido {a}", { n: H.screens.length, a: H.ocr_at ? ago(H.ocr_at) : t("a começar") }))}</p>`;
      const evs = H.events.length ? H.events.map((e) => { const [w, tone] = KIND[e.kind] || [e.kind, ""]; return `<a class="lv-ev ${e.kind}" href="${esc(e.url || "#")}" target="_blank" rel="noopener">
          <span class="lv-tag ${tone}">${esc(t(w))}</span><span class="lv-m"><b>${esc(e.text)}</b><small>${esc(ago(e.t))}</small></span>${e.coin && e.coin.address ? acts(e.coin.address) : ""}</a>`; }).join("")
        : empty(t("Ainda nenhum sinal. Avisa-te no segundo em que nascer uma moeda, uma começar a mexer, alguém falar disso, ou aparecer no título ou no ECRÃ de uma live."));
      const scr = H.screens.length ? `<p class="lv-sub">${esc(t("O que se lê agora no ecrã das lives"))}</p>` + H.screens.map((x) => `<a class="lv-scr" href="${esc(x.url)}" target="_blank" rel="noopener"><b>${esc(x.channel)}</b><small>${esc(loc(x.viewers, 0))} ${esc(t("a ver"))} · ${esc(ago(x.t))}</small><span>${esc(x.text || t("(sem texto no ecrã)"))}</span></a>`).join("") : "";
      return `<div class="lv-terms">${terms}</div>${status}${evs}${scr}`;
    }
    if (st.nsub === "new") return head + (N.launches.length ? N.launches.map((x) => `<div class="lv-row sm">${img(x)}<span class="lv-m"><b>$${esc(sym(x.symbol))}${x.migrated ? ` <span class="lv-tag ok">${esc(t("Migrou"))}</span>` : ""}</b>
        <small>${esc(x.name)} · ${esc(t("há {s}", { s: since(Date.now() / 1000 - x.t) }))}${x.dev_sol ? " · " + esc(t("criador {n} SOL", { n: loc(x.dev_sol, 2) })) : ""}</small></span>
        <span class="lv-n"><b>${usd(x.mcap)}</b><small>${pct(x.ch5)}</small></span>${acts(x.mint)}</div>`).join("")
      : empty(t("Ainda nenhuma moeda nova com o nome do GTA desde que o Hub arrancou: cada uma aparece aqui no segundo em que nasce na pump.fun.")));
    if (st.nsub === "calls") return head + (N.feed.length ? N.feed.map((p) => `<article class="lv-post ${p.coins && p.coins.length ? "has" : ""}">
        <header><span class="lv-src">${esc(SRC[p.src] || p.src)}</span><b>${esc(p.name || p.who)}</b><small>@${esc(p.who)}</small><time>${esc(ago(p.t))}</time></header>
        <a class="lv-txt" href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.text)}</a>
        ${(p.coins || []).map((c) => `<div class="lv-coin"><span class="lv-m"><b>$${esc(sym(c.symbol))} <em>${esc(t("call"))}</em></b><small>${esc(t("valia {v} quando falou", { v: usd(c.mcap_then) }))}</small></span>${acts(c.address)}</div>`).join("")}
      </article>`).join("") : empty(t("À espera de posts sobre o GTA no X, no Telegram e no Reddit.")));
    if (st.nsub === "lives") return head + (N.lives.length ? N.lives.map((v) => `<a class="lv-live" href="${esc(v.url)}" target="_blank" rel="noopener">
        ${v.thumb ? `<img src="${esc(v.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<i></i>`}
        <span class="lv-m"><b>${esc(v.title)}</b><small>${esc(v.channel)} · ${esc(v.site)}</small></span>
        <span class="lv-viewers"><i></i>${esc(v.viewers >= 1000 ? loc(v.viewers / 1000, v.viewers < 10000 ? 1 : 0) + " mil" : String(v.viewers))}</span></a>`).join("")
      : empty(t("A procurar lives do GTA 6 no YouTube (de 5 em 5 minutos).")));
    return head + (N.coins.length ? N.coins.map((c) => `<div class="lv-row">${img(c)}<span class="lv-m"><b>$${esc(sym(c.symbol))} ${c.tags.map(([w, tone]) => `<span class="lv-tag ${tone}">${esc(t(w))}</span>`).join("")}</b>
        <small>${esc(c.name)}${c.chain !== "solana" ? " · " + esc(c.chain) : ""}${c.age_h != null ? " · " + esc(ageTxt(c.age_h)) : ""} · ${esc(t("pool {v}", { v: usdK(c.liq) }))} · ${esc(t("{v} numa hora", { v: usdK(c.vol1) }))}${c.calls ? " · " + esc(t("{n} calls", { n: c.calls })) : ""}${c.first ? " · " + esc(t("1.º: @{w}", { w: c.first.who })) + (c.first.x ? ` (${loc(c.first.x, 1)}x)` : "") : ""}</small></span>
        <span class="lv-n"><b>${usd(c.mcap)}</b><small>${pct(c.ch1)} 1h</small></span>${acts(c.address, c.url)}</div>`).join("")
      : empty(t("A procurar as moedas do GTA na DexScreener…")));
  }

  // Tendências (memes_trends.py): the words of the pump.fun launches that reach money, the contracts every channel posts, the channels
  const xTxt = (x) => (x == null ? "" : `<span class="${x >= 1 ? "lv-up" : "lv-dn"}">${loc(x, x < 10 ? 1 : 0)}x</span>`);
  function trend() {
    const T = LV.trends;
    if (!T) return empty(t("A contar…"));
    const sub = st.tsub || "words";
    if (sub === "coins") return `<p class="lv-sub">${esc(t("Contratos postados nos canais e no X nas últimas 24 h, os que mais canais repetem primeiro"))}</p>` + (T.coins.length ? T.coins.map((c) => `<div class="lv-row">${img(c)}<span class="lv-m"><b>${c.symbol ? "$" + esc(sym(c.symbol)) : esc(c.address.slice(0, 6) + "…")} <span class="lv-tag ${c.channels > 1 ? "ok" : "info"}">${esc(t("{n} canais", { n: c.channels }))}</span></b>
        <small>${c.first ? esc(t("1.º: {w}", { w: c.first.who })) + " · " + esc(ago(c.first.t)) + (c.first.mc ? " · " + esc(t("valia {v}", { v: usd(c.first.mc) })) + " → " + xTxt(c.first.x) + (c.first.x_peak ? " · " + esc(t("máx.")) + " " + xTxt(c.first.x_peak) : "") : "") : ""}${c.who.length > 1 ? " · " + esc(c.who.slice(1, 4).join(", ")) : ""}</small></span>
        <span class="lv-n"><b>${usd(c.mcap)}</b><small>${pct(c.ch1)} 1h</small></span>${acts(c.address, c.url)}</div>`).join("")
      : empty(t("Ainda nenhum contrato: os canais do Telegram leem-se ao minuto e o X chega em tempo real.")));
    if (sub === "chans") return `<p class="lv-sub">${esc(t("Quem posta mais contratos (24 h) e quantos fizeram 2x desde o post"))}</p>` + (T.channels.length ? T.channels.map((s) => `<div class="lv-row sm"><i class="lv-img">${esc(SRC[s.src] || s.src.slice(0, 2))}</i><span class="lv-m"><b>${esc(s.who)}</b>
        <small>${esc(t("{n} contratos", { n: s.calls }))}${s.first ? " · " + esc(t("{n} vezes o primeiro", { n: s.first })) : ""}${s.judged ? " · " + esc(t("{a} de {b} fizeram 2x", { a: s.x2, b: s.judged })) : ""}</small></span>
        <span class="lv-n"><b>${s.med ? xTxt(s.med) : "—"}</b><small>${esc(t("mediana do máx."))}</small></span></div>`).join("")
      : empty(t("Ainda nenhum canal postou um contrato.")));
    const rows = (l) => l.length ? l.map((w) => `<div class="lv-row sm"><i class="lv-img">${esc(w.word[0].toUpperCase())}</i><span class="lv-m"><b>${esc(w.word)} ${w.win ? `<span class="lv-tag ok">${esc(t("{n} ganharam", { n: w.win }))}</span>` : ""}</b>
        <small>${esc(t("{n} moedas novas", { n: w.n }))} · ${esc(t("{r}% chegaram a {v}", { r: w.rate, v: usd(T.win) }))}${w.best ? " · " + esc(t("melhor ${s} {v}", { s: sym(w.best.symbol), v: usd(w.best.peak) })) : ""}</small></span>
        ${w.best ? acts(w.best.mint, w.best.url) : ""}</div>`).join("") : empty(t("A juntar moedas novas da pump.fun…"));
    return `<p class="lv-sub">${esc(t("Palavras dos nomes das moedas novas: primeiro as que mais vezes chegaram a dinheiro"))}</p><p class="lv-sub">${esc(t("Última hora"))}</p>${rows(T.w1.slice(0, 10))}<p class="lv-sub">${esc(t("Últimas 6 horas · {n} moedas novas", { n: loc(T.launches6) }))}</p>${rows(T.w6.slice(0, 15))}`;
  }

  function sinais() {
    return LV.signals.length ? LV.signals.map((s) => `<div class="lv-row">${img(s)}<span class="lv-m"><b>$${esc(sym(s.symbol))} ${word(s)}</b>
      <small>${esc(since(Date.now() / 1000 - s.t))} · ${esc(s.why)}${s.x.length ? " · " + esc(t("do X: @{w}", { w: s.x.join(", @") })) : ""}</small></span>
      <span class="lv-n"><b>${usd(s.mcap)}</b><small>${pct(s.ch5)}</small></span>${acts(s.mint)}</div>`).join("")
      : empty(t("Ainda nenhum sinal. Cada moeda nova é vista aos 3, 10 e 30 minutos: aparece aqui se tiver dinheiro na pool, mais compradores do que vendedores e o preço a subir."));
  }
  function rugs() {
    const al = LV.alerts.length ? LV.alerts.slice(0, 20).map((a) => `<div class="lv-alert ${a.level}"><b>$${esc(sym(a.symbol))}</b><span>${esc(a.text)}</span><small>${esc(ago(a.t))}</small></div>`).join("")
      : empty(t("Sem alarmes. Cola um contrato em cima: se o preço cair a pique, se tirarem o dinheiro da pool ou se houver vendas a mais, aparece aqui a vermelho."));
    const rd = LV.radar.length ? `<p class="lv-sub">${esc(t("No radar"))}</p>` + LV.radar.map((r) => `<div class="lv-row">${img(r)}<span class="lv-m"><b>$${esc(sym(r.symbol || r.mint.slice(0, 4)))}</b>
      <small>${r.at ? esc(t("pool {l} · 5 min: {b} compras, {s} vendas", { l: usd(r.liq), b: r.b5 ?? 0, s: r.s5 ?? 0 })) : esc(t("à espera dos primeiros números"))}</small></span>
      <span class="lv-n"><b>${usd(r.mcap)}</b><small>${pct(r.ch5)}</small></span><button type="button" class="lv-x" data-lv-del="${esc(r.mint)}" aria-label="${esc(t("Tirar do radar"))}">${icon("x")}</button></div>`).join("") : "";
    return al + rd;
  }
  function xfeed() {
    const l = LV.posts.filter((p) => (!st.watched || p.watched || p.coins.length) && (!st.coins || p.coins.length)).slice(0, 40);
    return l.length ? l.map((p) => `<article class="lv-post ${p.coins.length ? "has" : ""}">
      <header><b>${esc(p.name)}</b><small>@${esc(p.who)}</small><time>${esc(ago(p.t))}</time></header>
      <a class="lv-txt" href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.text)}</a>
      ${p.coins.map((c) => `<div class="lv-coin">${img(c)}<span class="lv-m"><b>${c.best ? "★ " : ""}${c.symbol ? "$" + esc(sym(c.symbol)) : esc(t("Contrato"))} <em>${esc(t("+{s}", { s: since(c.after) }))}</em></b>
        <small>${c.mcap ? esc(t("agora {a} · máx. {p}", { a: usd(c.mcap), p: usd(c.peak) })) : esc(t("à espera do preço"))}</small></span>${acts(c.mint)}</div>`).join("")}
      ${p.more ? `<small class="lv-more">${esc(t("+{n} cópias com menos valor", { n: p.more }))}</small>` : ""}</article>`).join("")
      : empty(t("À espera de tweets: chegam menos de um segundo depois de saírem."));
  }
  function novas() {
    const l = LV.launches.filter((x) => !q || (x.symbol + " " + x.name + " " + x.mint).toLowerCase().includes(q)).slice(0, 80);
    return l.length ? l.map((x) => `<div class="lv-row sm">${img(x)}<span class="lv-m"><b>$${esc(sym(x.symbol))}${x.sig ? " " + word(x.sig) : ""}${x.migrated ? ` <span class="lv-tag ok">${esc(t("Migrou"))}</span>` : ""}</b>
      <small>${esc(x.name)} · ${esc(since(Date.now() / 1000 - x.t))}${x.dev_sol ? " · " + esc(t("criador {n} SOL", { n: loc(x.dev_sol, 2) })) : ""}</small></span>
      <span class="lv-n"><b>${usd(x.mcap)}</b></span>${acts(x.mint)}</div>`).join("") : empty(q ? t("Nenhuma com esse nome.") : t("À espera de moedas novas da pump.fun…"));
  }

  /* ---------- clicks ---------- */
  async function click(e) {
    const a = e.target.closest("[data-lv]");
    if (a) {
      const v = a.dataset.lv;
      if (v === "solo") return openSolo();
      if (v === "close" && SOLO) return window.close();
      return set(v === "mini" ? "mini" : v === "close" ? "closed" : "open");
    }
    const ts = e.target.closest("[data-lv-tsub]");
    if (ts) { st.tsub = ts.dataset.lvTsub; save(); tools(); paintBody(); document.getElementById("lv-body").scrollTop = 0; return; }
    const ns = e.target.closest("[data-lv-nsub]");
    if (ns) { st.nsub = ns.dataset.lvNsub; save(); tools(); paintBody(); document.getElementById("lv-body").scrollTop = 0; return; }
    const tb = e.target.closest("[data-lv-tab]");
    if (tb) { st.tab = tb.dataset.lvTab; save(); tools(); paint_(); document.getElementById("lv-body").scrollTop = 0; return; }
    const op = e.target.closest("[data-lv-opt]");
    if (op) { st[op.dataset.lvOpt] = !st[op.dataset.lvOpt]; save(); tools(); paintBody(); return; }
    const cp = e.target.closest("[data-lv-copy]");
    if (cp) { try { await navigator.clipboard.writeText(cp.dataset.lvCopy); cp.textContent = t("Copiado"); setTimeout(() => { cp.textContent = t("Copiar"); }, 1400); } catch (err) { prompt(t("Contrato"), cp.dataset.lvCopy); } return; }
    const uh = e.target.closest("[data-lv-unhunt]");
    if (uh) { e.preventDefault(); await api("/api/memes/hunt", { method: "POST", body: { term: uh.dataset.lvUnhunt, on: false } }).catch(() => {}); poll(); return; }
    const dl = e.target.closest("[data-lv-del]");
    if (dl) { await api(`/api/memes/radar/${encodeURIComponent(dl.dataset.lvDel)}`, { method: "DELETE" }).catch(() => {}); LV.radar = LV.radar.filter((r) => r.mint !== dl.dataset.lvDel); paintBody(); }
  }
  async function submit(e) {
    if (e.target.id === "lv-hunt-add") {
      e.preventDefault();
      const f = e.target, v = f.term.value.trim();
      if (!v) return;
      try { await api("/api/memes/hunt", { method: "POST", body: { term: v, on: true } }); f.term.value = ""; poll(); } catch (err) { f.term.value = ""; f.term.placeholder = err.message; }
      return;
    }
    if (e.target.id !== "lv-add") return;
    e.preventDefault();
    const f = e.target, v = f.mint.value.trim();
    if (!v) return;
    try { await api("/api/memes/radar", { method: "POST", body: { mint: v } }); f.mint.value = ""; f.mint.placeholder = t("Fica vigiada de 20 em 20 segundos"); poll(); }
    catch (err) { f.mint.value = ""; f.mint.placeholder = err.message; }
  }

  /* ---------- ⧉: a window of its own, over everything ---------- */
  async function openSolo() {
    const url = `${location.origin}/?mini=1&lv=1#login=${encodeURIComponent((typeof token !== "undefined" && token) || "")}&to=/aovivo`;
    set("closed");
    // the widget's big window (widget/team_widget/ui/expand.py): a window of the widget's own, always on top
    if (typeof amgNative !== "undefined" && amgNative && amgNative.openAoVivo) { amgNative.openAoVivo(url); return; }
    if (window.documentPictureInPicture) {   // Chrome / Edge: a window that stays over every app, even over Google
      try {
        const pip = await documentPictureInPicture.requestWindow({ width: 430, height: 700 });
        pip.document.title = "Ao vivo · Memecoins";
        pip.document.body.style.cssText = "margin:0;background:#07080a;overflow:hidden";
        pip.document.body.innerHTML = `<iframe src="${esc(url)}" style="border:0;width:100vw;height:100vh;display:block" allow="clipboard-write"></iframe>`;
        return;
      } catch (e) { /* refused: a small window instead */ }
    }
    window.open(url, "amg-aovivo", "popup,width=430,height=700");
  }
  if (typeof HUB_VIEWS !== "undefined") (HUB_VIEWS.aovivo = async () => { page(`<div class="lv-solo-page"></div>`); set("open"); });

  /* ---------- the button in the side bar; the rest of the Hub opens it with window.aoVivo.open() ---------- */
  window.aoVivo = { open: () => set("open"), toggle: () => set(st.state === "open" ? "closed" : "open"), solo: openSolo };
  function boot() {
    const tools_ = document.querySelector(".side-tools");
    if (tools_ && !document.getElementById("lv-open")) {
      const b = document.createElement("button");
      b.id = "lv-open"; b.className = "tool"; b.title = t("Ao vivo: memecoins (pump.fun e X)"); b.setAttribute("aria-label", b.title);
      b.innerHTML = icon("bolt");
      b.onclick = () => window.aoVivo.toggle();
      tools_.prepend(b);
    }
    if (st.state !== "closed") set(st.state);
  }
  // after the sign-in (the app is hidden until then, and api() needs the token)
  const wait = setInterval(() => { const app = document.getElementById("app"); if (app && !app.hidden && typeof icon === "function") { clearInterval(wait); boot(); } }, 500);
})();
