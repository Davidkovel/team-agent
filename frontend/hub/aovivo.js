// Ao vivo: the gmgn-tracker's MemeIntel widget (desktop/, Windows only, in Russian) remade for the Hub, in Portuguese, as a
// floating window over any page (backend/app/memes_live.py, /api/memes/live). The same four tabs: Sinais, Rugs (the radar),
// X ao vivo (tweets and the pump.fun coins launched under them) and Novas (every launch).
//
// 17 nov, Marco, on the first version (a panel on top of «Quem acerta»): «não ficou nada confortável... um botão para abrir...
// vou precisar de arrastar isso para outras páginas... que combine ao máximo... economiza isso». So: the ⚡ button at the
// bottom of the side bar (and «Ao vivo» in the black hole) opens a glass window that is dragged by its top, resized by its
// corner, stays open from page to page, and shrinks to a small pill (live dot, signals, alarms). Where it was, its size, tab
// and state are kept on this browser. It asks the Hub every 3 s while open, every 15 s as a pill, never when closed.
(function () {
  const KEY = "lv-win";
  const loc = (v, d = 0) => Number(v).toLocaleString("pt-PT", { minimumFractionDigits: d, maximumFractionDigits: d });
  const usd = (v) => (!v ? "—" : v >= 1e9 ? `${loc(v / 1e9, 1)} mil M$` : v >= 1e6 ? `${loc(v / 1e6, 1)} M$` : v >= 1e3 ? `${loc(v / 1e3, 0)} mil $` : `${loc(v, 0)} $`);
  const pct = (v) => (v == null ? "" : `<span class="${v > 0 ? "lv-up" : v < 0 ? "lv-dn" : ""}">${v > 0 ? "+" : ""}${loc(v, Math.abs(v) < 10 ? 1 : 0)}%</span>`);
  const ago = (ts) => { const s = Date.now() / 1000 - ts; return s < 60 ? t("agora mesmo") : s < 3600 ? t("há {n} min", { n: Math.round(s / 60) }) : t("há {n} h", { n: Math.round(s / 3600) }); };
  const since = (s) => (s < 60 ? `${Math.round(s)} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`);
  const sym = (v) => String(v || "?").replace(/^\$+/, "");
  const TABS = [["x", "X ao vivo"], ["sinais", "Sinais"], ["rugs", "Rugs"], ["novas", "Novas"]];
  const phone = () => document.documentElement.classList.contains("is-phone");

  let st = { state: "closed", tab: "x", x: null, y: null, w: 400, h: 560, watched: true, coins: false };
  try { st = { ...st, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch (e) { /* private window */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* private window */ } };
  let LV = null, timer = 0, q = "", seenBad = Number(st.seenBad || 0);

  /* ---------- the window and the pill ---------- */
  function build() {
    if (document.getElementById("lv-win")) return;
    const w = document.createElement("section");
    w.className = "lv-win"; w.id = "lv-win"; w.hidden = true;
    w.setAttribute("aria-label", t("Ao vivo"));
    w.innerHTML = `<header class="lv-h" id="lv-drag"><span class="lv-dot" id="lv-dot"></span><b>${esc(t("Ao vivo"))}</b><small id="lv-st">${esc(t("a ligar…"))}</small>
        <button type="button" class="lv-hb" data-lv="mini" title="${esc(t("Encolher"))}" aria-label="${esc(t("Encolher"))}"><i class="lv-min"></i></button>
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
    if (!w || phone()) return;
    const W = Math.min(st.w || 400, innerWidth - 16), H = Math.min(st.h || 560, innerHeight - 16);
    const x = st.x == null ? innerWidth - W - 24 : Math.max(8, Math.min(st.x, innerWidth - W - 8));
    const y = st.y == null ? innerHeight - H - 24 : Math.max(8, Math.min(st.y, innerHeight - 60));
    Object.assign(w.style, { left: x + "px", top: y + "px", width: W + "px", height: H + "px" });
  }

  function drag(w) {
    const h = w.querySelector("#lv-drag");
    h.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest("button") || phone()) return;
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
    const n = { sinais: LV.signals.length, rugs: fresh, x: LV.posts.filter((p) => p.coins.length).length, novas: LV.launches.length };
    paint(document.getElementById("lv-tabs"), TABS.map(([k, l]) => `<button type="button" data-lv-tab="${k}" class="${k === st.tab ? "on" : ""} ${k === "rugs" && fresh ? "alarm" : ""}">${esc(t(l))}${n[k] ? `<small>${n[k]}</small>` : ""}</button>`).join(""));
    const last = bad[0], dz = document.getElementById("lv-danger");
    dz.hidden = !last || st.tab === "rugs" || Date.now() / 1000 - last.t > 1800;
    if (last) paint(dz, `${icon("alert")}<span><b>$${esc(sym(last.symbol))}</b> ${esc(last.text)}</span>`);
    paintBody();
  }
  const paintBody = () => LV && paint(document.getElementById("lv-body"), ({ sinais, rugs, x: xfeed, novas })[st.tab]());

  function tools() {
    const el = document.getElementById("lv-tools");
    if (st.tab === "rugs") el.innerHTML = `<form class="lv-add" id="lv-add"><input name="mint" placeholder="${esc(t("Cola o contrato de uma moeda"))}" autocomplete="off" spellcheck="false"><button class="btn sm primary">${esc(t("Vigiar"))}</button></form>`;
    else if (st.tab === "x") el.innerHTML = `<div class="lv-chips"><button type="button" data-lv-opt="watched" class="${st.watched ? "on" : ""}">${esc(t("Só quem seguimos"))}</button><button type="button" data-lv-opt="coins" class="${st.coins ? "on" : ""}">${esc(t("Só com moedas"))}</button></div>`;
    else if (st.tab === "novas") el.innerHTML = `<input class="lv-q" name="lvq" value="${esc(q)}" placeholder="${esc(t("Procurar nome ou contrato"))}" autocomplete="off">`;
    else el.innerHTML = "";
  }

  const img = (c) => (c.image ? `<img class="lv-img" src="${esc(c.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<i class="lv-img">${esc(sym(c.symbol)[0] || "?")}</i>`);
  const acts = (m) => `<span class="lv-acts"><button type="button" data-lv-copy="${esc(m)}" title="${esc(t("Copiar o contrato"))}">${esc(t("Copiar"))}</button><a href="https://gmgn.ai/sol/token/${esc(m)}" target="_blank" rel="noopener">GMGN</a></span>`;
  const empty = (s) => `<p class="lv-e">${esc(s)}</p>`;
  const word = (s) => `<span class="lv-tag ${s.tone}">${esc(t(s.word))}</span>`;

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
    if (a) { const v = a.dataset.lv; return set(v === "mini" ? "mini" : v === "close" ? "closed" : "open"); }
    const tb = e.target.closest("[data-lv-tab]");
    if (tb) { st.tab = tb.dataset.lvTab; save(); tools(); paint_(); document.getElementById("lv-body").scrollTop = 0; return; }
    const op = e.target.closest("[data-lv-opt]");
    if (op) { st[op.dataset.lvOpt] = !st[op.dataset.lvOpt]; save(); tools(); paintBody(); return; }
    const cp = e.target.closest("[data-lv-copy]");
    if (cp) { try { await navigator.clipboard.writeText(cp.dataset.lvCopy); cp.textContent = t("Copiado"); setTimeout(() => { cp.textContent = t("Copiar"); }, 1400); } catch (err) { prompt(t("Contrato"), cp.dataset.lvCopy); } return; }
    const dl = e.target.closest("[data-lv-del]");
    if (dl) { await api(`/api/memes/radar/${encodeURIComponent(dl.dataset.lvDel)}`, { method: "DELETE" }).catch(() => {}); LV.radar = LV.radar.filter((r) => r.mint !== dl.dataset.lvDel); paintBody(); }
  }
  async function submit(e) {
    if (e.target.id !== "lv-add") return;
    e.preventDefault();
    const f = e.target, v = f.mint.value.trim();
    if (!v) return;
    try { await api("/api/memes/radar", { method: "POST", body: { mint: v } }); f.mint.value = ""; f.mint.placeholder = t("Fica vigiada de 20 em 20 segundos"); poll(); }
    catch (err) { f.mint.value = ""; f.mint.placeholder = err.message; }
  }

  /* ---------- the button in the side bar; the rest of the Hub opens it with window.aoVivo.open() ---------- */
  window.aoVivo = { open: () => set("open"), toggle: () => set(st.state === "open" ? "closed" : "open") };
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
