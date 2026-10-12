// Sala de Trading (#/trading): the trading desk of the Empresa AMG. The room's read of the markets
// (backend/app/tradingroom/: candles from TradingView's feed, Smart Money Concepts on five timeframes), a chart that
// draws all of it (gaps, blocks, liquidity, sweeps, BOS/CHoCH, killzones, premium/discount, the setups), the meeting
// table of its two traders, the Pinguim (macro and news) and the Duas-Caras (the chart), the calendar and the
// headlines. Also the big alert (showAlert), which trading-alert.js opens on any page.
// Fetched the first time the page or an alert opens (lazyView). Live: the "trading" event, about once a minute.
(function () {
  const UP = "#16e08a", DOWN = "#ff3b5c", GOLD = "#f5c451", BLUE = "#5aa9ff", VIOLET = "#a77bff", INK = "#07080a";
  const TFS = ["M5", "M15", "H1", "H4", "D1"];
  const TF_SEC = { M5: 300, M15: 900, H1: 3600, H4: 14400, D1: 86400 };
  const LAYERS = [["fvg", "FVG"], ["ob", "OB"], ["liq", "Liquidez"], ["bos", "BOS/CHoCH"], ["kz", "Killzones"], ["pd", "Premium/desconto"], ["setup", "Setup"]];
  const PEOPLE = { penguin: { name: "Pinguim", what: "Macro e notícias" }, twoface: { name: "Duas-Caras", what: "Gráfico (SMC)" } };
  const STATE_PT = { intact: "intacto", swept: "varrido", taken: "rompido", testing: "a testar" };
  const STATUS_PT = { armed: "à espera do preço", active: "preço na zona", won: "alvo atingido" };
  const DIR_PT = { buy: "Compra", sell: "Venda", compra: "Compra", venda: "Venda", esperar: "Esperar" };

  let S = null, chartData = null, view = { n: 120, off: 0 }, hover = null, drag = null, openMeeting = null, clockTimer = 0, chartAt = 0;
  let sel = localStorage.getItem("trading.sel") || "XAUUSD", tf = localStorage.getItem("trading.tf") || "M15";
  let layers = Object.assign({ fvg: 1, ob: 1, liq: 1, bos: 1, kz: 1, pd: 0, setup: 1 }, JSON.parse(localStorage.getItem("trading.layers") || "{}"));

  const num = (v, dp) => (v == null || Number.isNaN(v) ? "—" : Number(v).toLocaleString("pt-PT", { minimumFractionDigits: dp, maximumFractionDigits: dp }));
  const pct = (v) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2).replace(".", ",")}%`);
  const sign = (v) => (v == null ? "" : v >= 0 ? "up" : "down");
  const hm = (t) => new Date(t).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
  const ago = (sec) => { const m = Math.max(0, Math.round((Date.now() / 1000 - sec) / 60)); return m < 60 ? t("há {n} min", { n: m }) : m < 1440 ? t("há {n} h", { n: Math.round(m / 60) }) : t("há {n} d", { n: Math.round(m / 1440) }); };
  // the portrait is kept here as a picture, drawn under a key of its own: a frame the cave keeps can come back blank
  // (Chrome drops the contents of canvases it put away), and a blank one is never kept
  const faces = {};
  const portrait = (who) => {
    if (faces[who]) return faces[who];
    const P = window.CrewPeople, url = P && P.LOOKS && P.LOOKS[who] ? P.portrait(P.LOOKS[who], `${who}:${Date.now()}`) : "";
    if (url.length > 400) faces[who] = url;
    return url;
  };
  const nyHour = (() => {
    const f = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", hour12: false });
    return (sec) => { const p = f.formatToParts(new Date(sec * 1000)); const h = +p.find((x) => x.type === "hour").value % 24; return h + +p.find((x) => x.type === "minute").value / 60; };
  })();

  // ================================================================ the page
  HUB_VIEWS.trading = async function () {
    await lazyFile("hub/crew-people.js").catch(() => {});
    page(`<div class="tr" id="tr">
      <header class="tr-head">
        <div class="tr-brand"><span class="tr-logo">${bars()}</span><div><small>${esc(t("AMG Capital · a mesa de trading da Empresa AMG"))}</small><h1>${esc(t("Sala de Trading"))}</h1></div></div>
        <div class="tr-clocks" id="tr-clocks"></div>
        <div class="tr-acts">
          <label class="tr-switch" title="${esc(t("Ligado: as reuniões são dois Claudes a sério, neste PC (gasta do plano deste computador). Desligado: a reunião é escrita a partir dos números."))}">
            <input type="checkbox" id="tr-claude"><i></i><span id="tr-claude-l">${esc(t("Claude neste PC"))}</span></label>
          <select id="tr-model" class="tr-model" title="${esc(t("Modelo do Claude nas reuniões"))}"></select>
          <button type="button" class="btn" id="tr-test" title="${esc(t("Mostra o aviso grande com o que a sala vê agora (só neste ecrã)"))}">${icon("bell")}${esc(t("Ver o aviso"))}</button>
          <button type="button" class="btn primary" id="tr-meet">${icon("users")}${esc(t("Convocar reunião"))}</button>
        </div>
      </header>
      <div class="tr-tape" id="tr-tape"><div></div></div>
      <section class="tr-radar" id="tr-radar"></section>
      <div class="tr-main">
        <section class="tr-chartbox">
          <div class="tr-chartbar">
            <div class="tr-sym" id="tr-sym"></div>
            <div class="tr-tfs" id="tr-tfs">${TFS.map((x) => `<button type="button" data-tf="${x}">${x}</button>`).join("")}</div>
            <div class="tr-layers" id="tr-layers">${LAYERS.map(([k, l]) => `<button type="button" data-layer="${k}">${esc(t(l))}</button>`).join("")}</div>
          </div>
          <div class="tr-canvas"><canvas id="tr-chart"></canvas><div class="tr-tip" id="tr-tip" hidden></div><p class="tr-wait" id="tr-wait">${esc(t("A ler o mercado…"))}</p></div>
          <div class="tr-read" id="tr-read"></div>
        </section>
        <aside class="tr-table" id="tr-table"></aside>
      </div>
      <div class="tr-lower">
        <section class="tr-cal"><h2>${icon("calendar")}${esc(t("Calendário económico"))}<small>${esc(t("alto e médio impacto · hora de Lisboa"))}</small></h2><div id="tr-cal"></div></section>
        <section class="tr-news"><h2>${icon("doc")}${esc(t("Manchetes"))}<small>Reuters · Dow Jones · FXStreet</small></h2><div id="tr-news"></div></section>
      </div>
    </div>`);
    const root = $("tr");
    root.querySelector("#tr-tfs").onclick = (e) => { const b = e.target.closest("[data-tf]"); if (b) { tf = b.dataset.tf; localStorage.setItem("trading.tf", tf); view = { n: 120, off: 0 }; loadChart(true); paintBar(); } };
    root.querySelector("#tr-layers").onclick = (e) => { const b = e.target.closest("[data-layer]"); if (b) { layers[b.dataset.layer] = layers[b.dataset.layer] ? 0 : 1; localStorage.setItem("trading.layers", JSON.stringify(layers)); paintBar(); drawMain(); } };
    root.querySelector("#tr-radar").onclick = (e) => { const b = e.target.closest("[data-sym]"); if (b) pick(b.dataset.sym); };
    root.querySelector("#tr-meet").onclick = () => meet();
    root.querySelector("#tr-test").onclick = async (e) => { e.currentTarget.disabled = true; try { showAlert(await api("/api/trading-room/alerts/test", { method: "POST" })); } finally { e.currentTarget.disabled = false; } };
    root.querySelector("#tr-claude").onchange = (e) => setting({ claude: e.target.checked });
    root.querySelector("#tr-model").onchange = (e) => setting({ model: e.target.value });
    root.querySelector("#tr-table").onclick = (e) => {
      const m = e.target.closest("[data-meeting]"); if (m) { openMeeting = Number(m.dataset.meeting); paintTable(); return; }
      if (e.target.closest("[data-meet]")) meet();
      const f = e.target.closest("[data-focus]"); if (f) pick(f.dataset.focus);
    };
    bindChart($("tr-chart"));
    paintBar();
    clearInterval(clockTimer);
    clockTimer = setInterval(() => { if (!$("tr")) { clearInterval(clockTimer); return; } paintClocks(); paintCal(); }, 1000);
    await load();
    loadChart(true);
  };

  async function load() {
    S = await api("/api/trading-room/state");
    if (!$("tr")) return;
    if (!S.instruments.some((a) => a.id === sel) && S.instruments[0]) sel = S.instruments[0].id;
    paintAll();
  }
  onLive(["trading"], async () => {
    if (!$("tr")) return;
    await load().catch(() => {});
    if (Date.now() - chartAt > 15000) loadChart(false);
  });
  function pick(id) { sel = id; localStorage.setItem("trading.sel", id); view = { n: 120, off: 0 }; paintRadar(); paintBar(); paintRead(); loadChart(true); $("tr-chart").scrollIntoView({ behavior: "smooth", block: "nearest" }); }
  async function setting(body) { try { S.settings = await api("/api/trading-room/settings", { method: "POST", body }); } catch (e) { /* shown by the next load */ } paintHead(); }
  async function meet() {
    const b = $("tr-meet"); if (b) b.disabled = true;
    try { await api("/api/trading-room/meet", { method: "POST", body: { focus: [sel] } }); openMeeting = null; await load(); }
    catch (e) { alert(String(e.message || e)); }
    finally { if (b) b.disabled = false; }
  }

  function paintAll() { paintHead(); paintClocks(); paintTape(); paintRadar(); paintBar(); paintRead(); paintTable(); paintCal(); paintNews(); }

  function paintHead() {
    const st = S && S.settings; if (!st) return;
    const c = $("tr-claude"), m = $("tr-model");
    c.checked = st.claude; c.disabled = !st.installed;
    $("tr-claude-l").textContent = !st.installed ? t("Claude não instalado") : st.claude ? t("Claude ligado · {n}/{c} hoje", { n: st.today, c: st.cap }) : t("Claude desligado");
    if (!m.options.length) m.innerHTML = st.models.map((x) => `<option value="${x}">${x[0].toUpperCase() + x.slice(1)}</option>`).join("");
    m.value = st.model; m.hidden = !st.claude;
    const running = S.meetings[0] && S.meetings[0].status === "running";
    $("tr-meet").disabled = running;
    $("tr-meet").innerHTML = `${icon("users")}${esc(running ? t("Em reunião…") : t("Convocar reunião"))}`;
  }

  function paintClocks() {
    if (!S) return;
    const now = new Date();
    const ses = S.sessions.map((s) => {
      const left = Math.max(0, Math.round(((new Date(s.open ? s.closes : s.opens)) - now) / 60000));
      return `<span class="tr-ses ${s.open ? "on" : ""}" title="${esc(s.open ? t("Aberta: fecha em {h}h{m}", { h: Math.floor(left / 60), m: String(left % 60).padStart(2, "0") }) : t("Fechada: abre em {h}h{m}", { h: Math.floor(left / 60), m: String(left % 60).padStart(2, "0") }))}"><i></i>${esc(t(s.name))}<small>${s.open ? t("fecha {h}h{m}", { h: Math.floor(left / 60), m: String(left % 60).padStart(2, "0") }) : t("abre {h}h{m}", { h: Math.floor(left / 60), m: String(left % 60).padStart(2, "0") })}</small></span>`;
    }).join("");
    const kz = S.killzone ? `<span class="tr-kz">${icon("target")}${esc(t("Killzone"))} · ${esc(t(S.killzone.name))}${S.killzone.silver ? ` · <b>${esc(t("silver bullet"))}</b>` : ""}</span>` : "";
    paint($("tr-clocks"), `<b class="tr-now">${now.toLocaleTimeString("pt-PT")}</b>${ses}${kz}`);
  }

  function paintTape() {
    const items = [...S.instruments.map((a) => ({ id: a.id, p: a.price, c: a.chg, dp: a.dp })), ...S.context.map((c) => ({ id: c.id, p: c.price, c: c.chg, dp: c.dp }))];
    const one = items.map((x) => `<span><b>${x.id}</b>${num(x.p, x.dp)}<em class="${sign(x.c)}">${x.c >= 0 ? "▲" : "▼"} ${pct(x.c)}</em></span>`).join("");
    const el = $("tr-tape").firstElementChild;
    if (el._one !== one) { el._one = one; el.innerHTML = one + one; }
  }

  function trendArrow(tr) { return tr === "bull" ? `<i class="up">▲</i>` : tr === "bear" ? `<i class="down">▼</i>` : `<i>•</i>`; }
  function paintRadar() {
    paint($("tr-radar"), S.instruments.map((a) => {
      const s = a.setups[0], pd = a.pd == null ? null : Math.max(0, Math.min(1, a.pd));
      const up = a.above[0], dn = a.below[0];
      return `<button type="button" class="tr-card ${a.id === sel ? "on" : ""} b-${a.bias.dir}" data-sym="${a.id}">
        <div class="tr-card-h"><b>${a.id}</b><small>${esc(t(a.name))}</small>${s ? `<span class="tr-grade g-${s.grade.replace("+", "p")}">${s.grade}</span>` : ""}</div>
        <div class="tr-card-p"><strong>${num(a.price, a.dp)}</strong><em class="${sign(a.chg)}">${pct(a.chg)}</em></div>
        <div class="tr-card-tf">${["D1", "H4", "H1", "M15"].map((x) => `<span>${x}${trendArrow(a.tf[x] && a.tf[x].trend)}</span>`).join("")}</div>
        <div class="tr-pd" title="${esc(t("Onde está o preço no range H4: à esquerda desconto, à direita premium"))}"><i style="left:${pd == null ? 50 : pd * 100}%"></i></div>
        <div class="tr-card-l"><span class="up">${up ? `▲ ${esc(short(up.label))} ${num(up.dist, 1)}` : "—"}</span><span class="down">${dn ? `▼ ${esc(short(dn.label))} ${num(dn.dist, 1)}` : "—"}</span></div>
        ${a.open ? "" : `<span class="tr-closed">${esc(t("fechado"))}</span>`}
      </button>`;
    }).join(""));
  }
  const short = (label) => label.replace("máximo de ontem (PDH)", "PDH").replace("mínimo de ontem (PDL)", "PDL").replace("máximo da semana passada (PWH)", "PWH")
    .replace("mínimo da semana passada (PWL)", "PWL").replace("máximo da Ásia", "Ásia ↑").replace("mínimo da Ásia", "Ásia ↓").replace("máximo de Londres", "Londres ↑")
    .replace("mínimo de Londres", "Londres ↓").replace("Topos iguais", "EQH").replace("Fundos iguais", "EQL");

  function paintBar() {
    const a = S && S.instruments.find((x) => x.id === sel);
    $("tr-tfs").querySelectorAll("[data-tf]").forEach((b) => b.classList.toggle("on", b.dataset.tf === tf));
    $("tr-layers").querySelectorAll("[data-layer]").forEach((b) => b.classList.toggle("on", !!layers[b.dataset.layer]));
    if (a) paint($("tr-sym"), `<b>${a.id}</b><strong>${num(a.price, a.dp)}</strong><em class="${sign(a.chg)}">${pct(a.chg)}</em><span class="tr-bias b-${a.bias.dir}">${esc(t(a.bias.text.split(" · ")[0]))}</span>`);
  }

  // what the room reads in the chosen instrument: the bias, the key levels, the zones, the setups
  function paintRead() {
    const a = S && S.instruments.find((x) => x.id === sel); if (!a) return;
    const keys = a.keys.slice().sort((p, q) => q.p - p.p).map((k) => `<li class="k-${k.state}"><b>${k.key}</b><span>${num(k.p, a.dp)}</span><em>${esc(t(STATE_PT[k.state] || k.state))}</em></li>`).join("");
    const pois = a.pois.slice(0, 5).map((p) => `<li class="${p.dir}"><b>${p.type} ${p.tf}</b><span>${num(p.bot, a.dp)} – ${num(p.top, a.dp)}</span><em>${esc(p.dir === "up" ? t("compra") : t("venda"))}${p.inside ? " · " + esc(t("preço dentro")) : ""}</em></li>`).join("");
    const setups = a.setups.map((s) => setupCard(s, a)).join("") || `<p class="tr-none">${esc(t("Sem setup limpo agora. O modelo espera um sweep de liquidez, uma mudança de estrutura e uma zona para entrar."))}</p>`;
    const ev = a.events.slice(0, 6).map((e) => `<li><time>${hm(e.t * 1000)}</time>${esc(e.text.split(": ").slice(1).join(": "))}</li>`).join("");
    paint($("tr-read"), `<div class="tr-read-grid">
      <div><h3>${esc(t("Viés"))}</h3><p class="tr-biastext">${esc(a.bias.text)}</p>
        ${a.pd != null ? `<p class="tr-pdtext">${esc(t("{p}% do range H4", { p: Math.round(a.pd * 100) }))} · <b class="${a.pd > .5 ? "down" : "up"}">${esc(a.pd > .5 ? t("premium (zona de vender)") : t("desconto (zona de comprar)"))}</b></p>` : ""}
        <h3>${esc(t("Liquidez-chave"))}</h3><ul class="tr-keys">${keys}</ul></div>
      <div><h3>${esc(t("Setups do modelo"))}</h3>${setups}</div>
      <div><h3>${esc(t("Zonas H1/H4"))}</h3><ul class="tr-pois">${pois || `<li>${esc(t("nenhuma perto do preço"))}</li>`}</ul>
        <h3>${esc(t("O que aconteceu"))}</h3><ul class="tr-events">${ev || `<li>${esc(t("nada de novo"))}</li>`}</ul></div>
    </div>`);
  }
  function setupCard(s, a) {
    const sell = s.dir === "sell";
    return `<article class="tr-setup ${sell ? "sell" : "buy"}">
      <header><span class="tr-grade g-${s.grade.replace("+", "p")}">${s.grade}</span><b>${esc(t(sell ? "Venda" : "Compra"))} · ${s.tf}</b><em>${s.score}/100 · ${esc(t(STATUS_PT[s.status] || s.status))}</em></header>
      <dl><div><dt>${esc(t("Zona"))}</dt><dd>${num(s.zone[0], a.dp)} – ${num(s.zone[1], a.dp)}</dd></div><div><dt>${esc(t("Stop"))}</dt><dd class="down">${num(s.stop, a.dp)}</dd></div>
        <div><dt>${esc(t("Alvos"))}</dt><dd class="up">${s.targets.map((x) => num(x.p, a.dp)).join(" · ")}</dd></div><div><dt>RR</dt><dd>${num(s.rr, 1)}</dd></div></dl>
      <ul>${s.why.map((w) => `<li class="${/\(contra\)|\(lado errado\)/.test(w) ? "bad" : ""}">${esc(w)}</li>`).join("")}</ul>
      ${s.news_risk && s.news_risk.length ? `<p class="tr-risk">${icon("alert")}${esc(t("Notícia perto"))}: ${esc(s.news_risk.join("; "))}</p>` : ""}
    </article>`;
  }

  // ================================================================ the meeting table
  function paintTable() {
    const ms = S.meetings || [];
    const m = (openMeeting && ms.find((x) => x.id === openMeeting)) || ms[0];
    const running = m && m.status === "running";
    const next = running ? (m.turns.length % 2 ? "twoface" : "penguin") : null;
    const turns = m ? m.turns.map((x) => bubble(x.who, x.text, x.at)).join("") + (running ? `<div class="tr-say ${next} typing"><img src="${portrait(next)}" alt=""><div><b>${esc(t(PEOPLE[next].name))}</b><p><i></i><i></i><i></i></p></div></div>` : "") : "";
    const v = m && m.verdict;
    const st = S.settings;
    paint($("tr-table"), `<div class="tr-duo">
        ${["penguin", "twoface"].map((w) => `<div class="tr-who ${w} ${next === w ? "speaking" : ""}"><img src="${portrait(w)}" alt=""><b>${esc(t(PEOPLE[w].name))}</b><small>${esc(t(PEOPLE[w].what))}</small></div>`).join(`<span class="tr-vs">${icon("users")}</span>`)}
      </div>
      <div class="tr-mhead"><h2>${esc(t("Mesa de reunião"))}</h2>${m ? `<span class="tr-mode ${m.mode}">${esc(m.mode === "claude" ? `Claude ${m.model || ""}` : t("automática"))}</span><time>${hm(m.at)}</time>` : ""}</div>
      ${m ? `<p class="tr-reason">${esc(m.reason)}</p>` : `<p class="tr-none">${esc(t("Ainda não houve reunião. Reúnem-se sozinhos antes de Londres e de Nova Iorque, antes e depois das notícias de alto impacto e quando aparece um sweep ou um setup que importa."))}</p>`}
      ${m && m.error ? `<p class="tr-err">${esc(m.error)}</p>` : ""}
      <div class="tr-talk">${turns}</div>
      ${v ? verdictCard(v) : ""}
      ${!st.claude ? `<p class="tr-hint">${icon("bot")}${esc(t("Com o Claude desligado, a reunião é escrita a partir dos números. Liga-o em cima para os dois agentes pensarem a sério."))}</p>` : ""}
      ${ms.length > 1 ? `<h3>${esc(t("Reuniões anteriores"))}</h3><ul class="tr-past">${ms.slice(0, 10).map((x) => `<li><button type="button" data-meeting="${x.id}" class="${m && x.id === m.id ? "on" : ""}"><time>${hm(x.at)}</time><span>${esc((x.verdict && x.verdict.titulo) || x.reason)}</span>${x.verdict ? `<i class="lvl l${x.verdict.importancia}">${x.verdict.importancia}</i>` : `<i class="lvl">${x.status === "running" ? "…" : "×"}</i>`}</button></li>`).join("")}</ul>` : ""}`);
    const talk = $("tr-table").querySelector(".tr-talk");
    if (talk && running) talk.scrollTop = talk.scrollHeight;
  }
  function bubble(who, text, at) {
    return `<div class="tr-say ${who}"><img src="${portrait(who)}" alt=""><div><b>${esc(t(PEOPLE[who].name))}${at ? `<time>${hm(at)}</time>` : ""}</b>${String(text).split(/\n+/).map((p) => `<p>${esc(p)}</p>`).join("")}</div></div>`;
  }
  function verdictCard(v) {
    return `<article class="tr-verdict l${v.importancia}">
      <header><span>${esc(t("Ata da reunião"))}</span><i class="tr-dots">${[1, 2, 3, 4, 5].map((i) => `<b class="${i <= v.importancia ? "on" : ""}"></b>`).join("")}</i>${v.alerta ? `<em>${icon("bell")}${esc(t("aviso enviado"))}</em>` : ""}</header>
      <h3>${esc(v.titulo)}</h3><p>${esc(v.resumo)}</p>
      ${(v.foco || []).map((f) => `<div class="tr-focus d-${(f.direcao || "").split(" ")[0]}" data-focus="${esc(f.simbolo)}">
        <b>${esc(f.simbolo)}</b><span class="tr-dir">${esc(t(DIR_PT[(f.direcao || "").split(" ")[0]] || f.direcao))}</span>
        <dl>${f.zona ? `<div><dt>${esc(t("Zona"))}</dt><dd>${esc(f.zona)}</dd></div>` : ""}${f.stop ? `<div><dt>${esc(t("Stop"))}</dt><dd>${esc(f.stop)}</dd></div>` : ""}${(f.alvos || []).length ? `<div><dt>${esc(t("Alvos"))}</dt><dd>${esc(f.alvos.join(" · "))}</dd></div>` : ""}</dl>
        ${f.condicao ? `<p>${esc(f.condicao)}</p>` : ""}<i class="tr-conf" style="--c:${(f.confianca || 0) * 20}%"></i></div>`).join("")}
      ${(v.atencao || []).length ? `<ul class="tr-att">${v.atencao.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    </article>`;
  }

  // ================================================================ calendar and headlines
  function paintCal() {
    if (!S || !$("tr-cal")) return;
    const now = Date.now();
    let mark = false;
    const rows = S.calendar.map((e) => {
      const at = new Date(e.t).getTime(), mins = Math.round((at - now) / 60000);
      const soon = mins >= 0 && mins <= 60, past = mins < -2;
      let line = "";
      if (!past && !mark) { mark = true; line = `<div class="tr-nowline"><span>${esc(t("agora"))}</span></div>`; }
      const cd = soon ? `${Math.floor(mins / 60) ? Math.floor(mins / 60) + "h" : ""}${String(mins % 60).padStart(Math.floor(mins / 60) ? 2 : 1, "0")}min` : "";
      const unit = e.unit || "";
      return `${line}<div class="tr-ev i${e.imp} ${past ? "past" : ""} ${soon ? "soon" : ""}">
        <time>${new Date(e.t).toLocaleDateString("pt-PT", { weekday: "short" })} ${hm(e.t)}</time><span class="tr-ccy">${esc(e.ccy)}</span>
        <span class="tr-imp">${"<i></i>".repeat(e.imp)}</span><b title="${esc(e.title)}">${esc(t(e.pt || e.title))}</b>
        <span class="tr-fig"><em class="${e.actual != null && e.forecast != null ? (e.actual >= e.forecast ? "up" : "down") : ""}">${e.actual != null ? esc(e.actual + unit) : soon ? `<i class="tr-cd">${cd}</i>` : "—"}</em><small>${esc(t("prev."))} ${e.forecast != null ? esc(e.forecast + unit) : "—"} · ${esc(t("ant."))} ${e.previous != null ? esc(e.previous + unit) : "—"}</small></span></div>`;
    }).join("");
    paint($("tr-cal"), rows || `<p class="tr-none">${esc(t("Calendário vazio."))}</p>`);
  }
  function paintNews() {
    paint($("tr-news"), S.news.map((n) => `<a class="tr-headline ${n.urgent ? "urgent" : ""}" href="${esc(n.url)}" target="_blank" rel="noopener">
      <time>${ago(n.t)}</time><span>${esc(n.title)}</span><small>${esc(n.source)}${n.for.map((x) => `<i>${esc(x)}</i>`).join("")}</small></a>`).join("") || `<p class="tr-none">${esc(t("Sem manchetes."))}</p>`);
  }

  // ================================================================ the chart
  async function loadChart(fresh) {
    const id = sel, frame = tf;
    if (fresh) { chartData = null; const w = $("tr-wait"); if (w) w.hidden = false; drawMain(); }
    try {
      const d = await api(`/api/trading-room/chart?id=${encodeURIComponent(id)}&tf=${frame}`);
      if (id !== sel || frame !== tf) return;
      chartData = d; chartAt = Date.now();
      const w = $("tr-wait"); if (w) w.hidden = true;
      drawMain();
    } catch (e) { const w = $("tr-wait"); if (w) { w.hidden = false; w.textContent = String(e.message || e); } }
  }
  function drawMain() { const c = $("tr-chart"); if (c && chartData) drawChart(c, chartData, view, { layers, hover }); else if (c) c.getContext("2d").clearRect(0, 0, c.width, c.height); }

  function bindChart(c) {
    const at = (e) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    c.onpointerdown = (e) => { drag = { x: e.clientX, off: view.off }; c.setPointerCapture(e.pointerId); };
    c.onpointermove = (e) => {
      if (drag && chartData) {
        const per = (c.clientWidth - 70) / (view.n + 8);
        view.off = Math.max(0, Math.min(chartData.candles.length - 20, Math.round(drag.off + (e.clientX - drag.x) / per)));
      }
      hover = at(e); drawMain(); tip();
    };
    c.onpointerup = () => { drag = null; };
    c.onpointerleave = () => { hover = null; drag = null; drawMain(); tip(); };
    c.ondblclick = () => { view = { n: 120, off: 0 }; drawMain(); };
    c.addEventListener("wheel", (e) => { e.preventDefault(); if (!chartData) return; view.n = Math.max(30, Math.min(chartData.candles.length, Math.round(view.n * (e.deltaY > 0 ? 1.12 : .89)))); drawMain(); }, { passive: false });
    new ResizeObserver(() => drawMain()).observe(c);
  }
  function tip() {
    const el = $("tr-tip"); if (!el) return;
    const k = hover && chartData && chartData._hit;
    if (!k) { el.hidden = true; return; }
    const [ts, o, h, l, cl] = k, dp = chartData.dp;
    el.hidden = false;
    el.innerHTML = `<b>${new Date(ts * 1000).toLocaleString("pt-PT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</b>
      <span>A ${num(o, dp)}</span><span>M ${num(h, dp)}</span><span>m ${num(l, dp)}</span><span class="${cl >= o ? "up" : "down"}">F ${num(cl, dp)}</span>`;
  }

  // Draws one chart. d: /api/trading-room/chart; v: { n candles shown, off from the right }; o: { layers, hover, mini, reveal }.
  function drawChart(c, d, v, o = {}) {
    const dpr = window.devicePixelRatio || 1, W = c.clientWidth, H = c.clientHeight;
    if (!W || !H) return;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const L = o.layers || {}, mini = !!o.mini, dp = d.dp;
    const all = d.candles, end = all.length - (v.off || 0), n = Math.min(v.n, end), start = Math.max(0, end - n);
    const vis = all.slice(start, Math.min(end, o.reveal != null ? start + o.reveal : end));
    if (!vis.length) return;
    const AX = mini ? 0 : 66, BX = mini ? 0 : 22, PAD = mini ? 2 : 8, PW = W - AX, PH = H - BX;
    const slot = PW / (n + PAD), cw = Math.max(1, Math.min(14, slot * .68));
    let lo = Math.min(...vis.map((x) => x[3])), hi = Math.max(...vis.map((x) => x[2]));
    const s0 = L.setup && d.setups && d.setups[0];
    if (s0 && !mini) { lo = Math.min(lo, s0.stop, ...s0.targets.map((x) => x.p), s0.zone[0]); hi = Math.max(hi, s0.stop, ...s0.targets.map((x) => x.p), s0.zone[1]); }
    const pad = (hi - lo) * .08 || 1; lo -= pad; hi += pad;
    const X = (i) => (i - start + .5) * slot, Y = (p) => PH - ((p - lo) / (hi - lo)) * PH;
    const tAt = (ts) => { let a = 0, b = all.length - 1; if (ts <= all[0][0]) return 0; while (a < b) { const m = (a + b) >> 1; if (all[m][0] < ts) a = m + 1; else b = m; } return a; };
    const XT = (ts) => X(tAt(ts));
    const right = PW;
    // background: the grid and the name
    g.fillStyle = mini ? "rgba(0,0,0,0)" : "#07090c"; g.fillRect(0, 0, W, H);
    g.save(); g.font = `700 ${mini ? 120 : 64}px "Space Grotesk", system-ui`; g.fillStyle = "rgba(255,255,255,.028)"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(`${d.id}${mini ? "" : " · " + d.tf}`, PW / 2, PH / 2); g.restore();
    const step = niceStep((hi - lo) / 7);
    g.strokeStyle = "rgba(255,255,255,.045)"; g.lineWidth = 1; g.font = `500 10.5px Inter, system-ui`; g.fillStyle = "#6f7782"; g.textBaseline = "middle";
    for (let p = Math.ceil(lo / step) * step; p < hi; p += step) {
      const y = Math.round(Y(p)) + .5; g.beginPath(); g.moveTo(0, y); g.lineTo(PW, y); g.stroke();
      if (!mini) g.fillText(num(p, dp), PW + 8, y);
    }
    // killzones (intraday): London, New York AM, Asia
    if (L.kz && !mini && TF_SEC[d.tf] <= 3600) {
      const KZ = [[2, 5, "rgba(90,169,255,.07)", "Londres"], [7, 10, "rgba(167,123,255,.075)", "NY AM"], [20, 24, "rgba(255,255,255,.03)", "Ásia"]];
      let prev = null;
      vis.forEach((x, k) => {
        const h = nyHour(x[0]), z = KZ.find(([a, b]) => h >= a && h < b);
        if (z) { g.fillStyle = z[2]; g.fillRect(X(start + k) - slot / 2, 0, slot + .5, PH); if (prev !== z) { g.fillStyle = "rgba(220,228,240,.4)"; g.font = "600 9.5px Inter, system-ui"; g.textBaseline = "top"; g.fillText(z[3].toUpperCase(), X(start + k) - slot / 2 + 3, 6); } }
        prev = z;
      });
    }
    // premium / discount of the dealing range
    if (L.pd && d.range && d.range.hi && !mini) {
      const eq = (d.range.hi + d.range.lo) / 2;
      g.fillStyle = "rgba(255,59,92,.05)"; g.fillRect(0, Y(d.range.hi), PW, Y(eq) - Y(d.range.hi));
      g.fillStyle = "rgba(22,224,138,.05)"; g.fillRect(0, Y(eq), PW, Y(d.range.lo) - Y(eq));
      dashed(g, 0, Y(eq), PW, "rgba(255,255,255,.25)", [2, 4]);
      tag(g, 6, Y(eq) - 9, "EQ 50%", "rgba(255,255,255,.55)", null);
      tag(g, 6, Y(d.range.hi) + 4, t("PREMIUM"), "rgba(255,120,140,.75)", null);
      tag(g, 6, Y(d.range.lo) - 14, t("DESCONTO"), "rgba(80,230,160,.75)", null);
    }
    // fair value gaps and order blocks, from where they formed to the right edge
    const box = (x0, top, bot, fill, line, label) => {
      const y0 = Y(top), y1 = Y(bot); if (y1 < 0 || y0 > PH) return;
      g.fillStyle = fill; g.fillRect(x0, y0, right - x0, Math.max(1, y1 - y0));
      g.strokeStyle = line; g.lineWidth = 1; g.beginPath(); g.moveTo(x0, y0 + .5); g.lineTo(right, y0 + .5); g.moveTo(x0, y1 - .5); g.lineTo(right, y1 - .5); g.stroke();
      if (label && !mini) { g.font = "700 9px Inter, system-ui"; g.fillStyle = line; g.textBaseline = "bottom"; g.fillText(label, Math.max(x0, 0) + 3, y1 - 2); }
    };
    if (L.fvg) for (const f of d.fvg || []) box(Math.max(0, XT(f.t) - slot / 2), f.top, f.bot, f.dir === "up" ? "rgba(22,224,138,.11)" : "rgba(255,59,92,.11)", f.dir === "up" ? "rgba(22,224,138,.55)" : "rgba(255,59,92,.55)", "FVG");
    if (L.ob) for (const b of d.ob || []) box(Math.max(0, XT(b.t) - slot / 2), b.top, b.bot, b.dir === "up" ? "rgba(90,169,255,.12)" : "rgba(255,159,67,.12)", b.dir === "up" ? "rgba(90,169,255,.75)" : "rgba(255,159,67,.75)", "OB");
    // liquidity: equal highs/lows and swings still resting, and where they were swept
    if (L.liq) {
      for (const p of d.pools || []) {
        const x0 = XT(p.t), y = Y(p.p);
        if (y < 0 || y > PH || x0 > right) continue;
        const done = p.state === "swept" || p.state === "taken", x1 = done && p.tt ? XT(p.tt) : right;
        if (p.eq) { dashed(g, x0, y, x1, done ? "rgba(245,196,81,.35)" : "rgba(245,196,81,.85)", [5, 3]); if (!done && !mini) tag(g, x0 + 2, y + (p.kind === "BSL" ? -14 : 3), `$$$ ${p.kind === "BSL" ? "EQH" : "EQL"}`, GOLD, null); }
        else if (!done) dashed(g, x0, y, x1, "rgba(200,208,220,.28)", [1, 3]);
        if (p.state === "swept" && p.tt && !mini) sweepMark(g, XT(p.tt), Y(p.x), p.kind === "BSL");
      }
      for (const k of d.keys || []) {
        const y = Y(k.p); if (y < 0 || y > PH) continue;
        const col = k.state === "intact" ? GOLD : k.state === "swept" ? "#ff6bd5" : "rgba(160,168,180,.6)";
        dashed(g, 0, y, right, col, k.state === "intact" ? [8, 4] : [2, 4]);
        if (!mini) tag(g, right - 6, y - 8, `${k.key} · ${t(STATE_PT[k.state] || k.state)}`, col, "rgba(7,9,12,.85)", true);
        if (k.state === "swept" && k.at && !mini) sweepMark(g, XT(k.at), Y(k.x), k.above);
      }
    }
    // structure: from the swing that broke to the candle that broke it
    if (L.bos && !mini) for (const s of d.structure || []) {
      const x0 = XT(s.from), x1 = XT(s.t), y = Y(s.level); if (x1 < 0 || y < 0 || y > PH) continue;
      const col = s.dir === "up" ? UP : DOWN;
      g.strokeStyle = col; g.lineWidth = s.kind === "CHoCH" ? 1.6 : 1; g.setLineDash(s.kind === "CHoCH" ? [] : [4, 3]);
      g.beginPath(); g.moveTo(Math.max(0, x0), y + .5); g.lineTo(x1, y + .5); g.stroke(); g.setLineDash([]);
      g.font = "700 9.5px Inter, system-ui"; g.fillStyle = col; g.textAlign = "center"; g.textBaseline = s.dir === "up" ? "bottom" : "top";
      g.fillText(s.kind, (Math.max(0, x0) + x1) / 2, y + (s.dir === "up" ? -2 : 3)); g.textAlign = "left";
    }
    // the candles
    vis.forEach((x, k) => {
      const i = start + k, cx0 = X(i), up = x[4] >= x[1], col = up ? UP : DOWN;
      g.strokeStyle = col; g.lineWidth = 1; g.beginPath(); g.moveTo(Math.round(cx0) + .5, Y(x[2])); g.lineTo(Math.round(cx0) + .5, Y(x[3])); g.stroke();
      const yo = Y(x[1]), yc = Y(x[4]), top = Math.min(yo, yc), h = Math.max(1, Math.abs(yc - yo));
      g.fillStyle = up ? col : col; g.globalAlpha = up ? .95 : .95; g.fillRect(Math.round(cx0 - cw / 2), top, Math.max(1, Math.round(cw)), h); g.globalAlpha = 1;
    });
    // the setup: the zone, the stop, the targets
    if (s0 && !mini) {
      const x0 = Math.max(0, XT(s0.t)), sell = s0.dir === "sell";
      g.fillStyle = "rgba(90,169,255,.16)"; g.fillRect(x0, Y(s0.zone[1]), right - x0, Y(s0.zone[0]) - Y(s0.zone[1]));
      g.strokeStyle = "rgba(90,169,255,.9)"; g.strokeRect(x0 + .5, Y(s0.zone[1]) + .5, right - x0 - 1, Y(s0.zone[0]) - Y(s0.zone[1]));
      line(g, x0, Y(s0.stop), right, DOWN, 1.4); tag(g, x0 + 4, Y(s0.stop) + (sell ? -15 : 3), `SL ${num(s0.stop, dp)}`, "#fff", DOWN);
      s0.targets.forEach((tg, k) => { line(g, x0, Y(tg.p), right, UP, 1.4); tag(g, x0 + 4, Y(tg.p) + (sell ? 3 : -15), `TP${k + 1} ${num(tg.p, dp)}`, "#04130b", UP); });
      tag(g, x0 + 4, Y(s0.zone[sell ? 1 : 0]) + (sell ? -15 : 3), `${s0.grade} ${t(sell ? "VENDA" : "COMPRA")} · RR ${num(s0.rr, 1)}`, "#04101f", BLUE);
    }
    // the price now
    const last = all[Math.min(end, all.length) - 1];
    if (last && !mini) {
      const y = Y(last[4]), col = last[4] >= last[1] ? UP : DOWN;
      dashed(g, 0, y, PW, col, [2, 2]);
      g.fillStyle = col; rrect(g, PW + 2, y - 9, AX - 4, 18, 4); g.fill();
      g.fillStyle = INK; g.font = "700 11px Inter, system-ui"; g.textBaseline = "middle"; g.fillText(num(last[4], dp), PW + 7, y);
    }
    // time along the bottom
    if (!mini) {
      g.fillStyle = "#6f7782"; g.font = "500 10px Inter, system-ui"; g.textBaseline = "top";
      const every = Math.max(1, Math.ceil(90 / slot));
      vis.forEach((x, k) => { if ((start + k) % every === 0) { const dt = new Date(x[0] * 1000); g.fillText(TF_SEC[d.tf] >= 14400 ? dt.toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit" }) : dt.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" }), X(start + k) - 14, PH + 6); } });
      g.strokeStyle = "rgba(255,255,255,.08)"; g.beginPath(); g.moveTo(PW + .5, 0); g.lineTo(PW + .5, H); g.moveTo(0, PH + .5); g.lineTo(W, PH + .5); g.stroke();
    }
    // the crosshair
    d._hit = null;
    if (o.hover && !mini && o.hover.x < PW && o.hover.y < PH) {
      const i = Math.round(o.hover.x / slot - .5) + start;
      if (i >= start && i < start + vis.length) d._hit = all[i];
      g.strokeStyle = "rgba(255,255,255,.28)"; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(Math.round(X(i)) + .5, 0); g.lineTo(Math.round(X(i)) + .5, PH); g.moveTo(0, Math.round(o.hover.y) + .5); g.lineTo(PW, Math.round(o.hover.y) + .5); g.stroke(); g.setLineDash([]);
      const p = lo + (1 - o.hover.y / PH) * (hi - lo);
      g.fillStyle = "#2a3038"; rrect(g, PW + 2, o.hover.y - 9, AX - 4, 18, 4); g.fill();
      g.fillStyle = "#fff"; g.font = "600 11px Inter, system-ui"; g.textBaseline = "middle"; g.fillText(num(p, dp), PW + 7, o.hover.y);
    }
  }
  function niceStep(raw) { const p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p; }
  function dashed(g, x0, y, x1, col, dash) { g.strokeStyle = col; g.lineWidth = 1; g.setLineDash(dash); g.beginPath(); g.moveTo(x0, Math.round(y) + .5); g.lineTo(x1, Math.round(y) + .5); g.stroke(); g.setLineDash([]); }
  function line(g, x0, y, x1, col, w) { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(x0, Math.round(y) + .5); g.lineTo(x1, Math.round(y) + .5); g.stroke(); }
  function rrect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function tag(g, x, y, text, col, bg, alignRight) {
    g.font = "700 9.5px Inter, system-ui"; g.textBaseline = "top";
    const w = g.measureText(text).width + (bg ? 10 : 0), x0 = alignRight ? x - w : x;
    if (bg) { g.fillStyle = bg; rrect(g, x0, y, w, 15, 3); g.fill(); }
    g.fillStyle = col; g.fillText(text, x0 + (bg ? 5 : 0), y + (bg ? 3 : 0));
  }
  function sweepMark(g, x, y, above) {
    g.strokeStyle = "#ff6bd5"; g.lineWidth = 1.6; const r = 4;
    g.beginPath(); g.moveTo(x - r, y - r); g.lineTo(x + r, y + r); g.moveTo(x + r, y - r); g.lineTo(x - r, y + r); g.stroke();
    tag(g, x - 18, above ? y - 17 : y + 6, "SWEEP", "#ff6bd5", null);
  }
  function bars() { return `<svg viewBox="0 0 24 24"><path d="M5 4v16M5 7h-2v8h2M12 2v20M12 6h2v9h-2M19 5v15M19 9h2v6h-2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`; }

  // ================================================================ the big alert
  let alertEl = null, alertRaf = 0;
  function showAlert(a) {
    closeAlert(false);
    const dirKey = (a.dir || "").split(" ")[0];
    const sell = /venda|sell/.test(dirKey), buy = /compra|buy/.test(dirKey);
    const tone = sell ? "sell" : buy ? "buy" : "news";
    alertEl = document.createElement("div");
    alertEl.className = `tr-alert ${tone} l${a.level}`;
    alertEl.setAttribute("role", "alertdialog");
    alertEl.setAttribute("aria-label", a.title);
    const f = (a.focus || [])[0] || {};
    const tape = (S ? S.instruments : []).map((x) => `<span><b>${x.id}</b> ${num(x.price, x.dp)} <em class="${sign(x.chg)}">${pct(x.chg)}</em></span>`).join("");
    alertEl.innerHTML = `<canvas class="tr-alert-bg"></canvas><div class="tr-alert-scan"></div>
      <div class="tr-alert-led top"><div>${(tape || `<span>${esc(t("SALA DE TRADING · AMG CAPITAL"))}</span>`).repeat(4)}</div></div>
      <div class="tr-alert-card">
        <div class="tr-alert-top"><span class="tr-alert-live"><i></i>${esc(t("Sala de Trading"))}</span><span>${esc(t("Mensagem dos agentes"))}</span>
          <span class="tr-alert-lvl">${[1, 2, 3, 4, 5].map((i) => `<b class="${i <= a.level ? "on" : ""}"></b>`).join("")}</span></div>
        <div class="tr-alert-sym">${a.symbol ? `<strong>${esc(a.symbol)}</strong>` : ""}<span class="tr-alert-dir">${esc(t(DIR_PT[dirKey] || (tone === "news" ? "Atenção" : a.dir || "")))}</span></div>
        <h1>${esc(a.title)}</h1>
        <p class="tr-alert-body">${esc(a.body)}</p>
        ${f.zona || f.stop || (f.alvos || []).length ? `<div class="tr-alert-plan">
          ${f.zona ? `<div><small>${esc(t("Zona de entrada"))}</small><b>${esc(f.zona)}</b></div>` : ""}
          ${f.stop ? `<div class="sl"><small>${esc(t("Stop"))}</small><b>${esc(f.stop)}</b></div>` : ""}
          ${(f.alvos || []).length ? `<div class="tp"><small>${esc(t("Alvos"))}</small><b>${esc(f.alvos.join(" · "))}</b></div>` : ""}
          ${f.condicao ? `<p>${icon("alert")}${esc(f.condicao)}</p>` : ""}</div>` : ""}
        <div class="tr-alert-duo">${(a.turns || []).slice(-2).map((x) => `<figure class="${x.who}"><img src="${portrait(x.who)}" alt=""><figcaption><b>${esc(t(PEOPLE[x.who] ? PEOPLE[x.who].name : x.who))}</b><span>${esc(clip(x.text, 190))}</span></figcaption></figure>`).join("")}</div>
        ${(a.attention || []).length ? `<ul class="tr-alert-att">${a.attention.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
        <div class="tr-alert-acts"><button type="button" class="btn primary" data-a="open">${icon("trend")}${esc(t("Abrir a Sala de Trading"))}</button><button type="button" class="btn" data-a="ok">${esc(t("Visto"))}</button>
          <small>${esc(a.mode === "claude" ? t("Reunião do Pinguim e do Duas-Caras (Claude)") : t("Leitura automática da sala"))} · ${hm(a.at)}${a.test ? " · " + esc(t("ensaio")) : ""}</small></div>
      </div>
      <div class="tr-alert-led bottom"><div>${(tape || "").repeat(4)}</div></div>`;
    document.body.append(alertEl);
    if (!tape) api("/api/trading-room/pulse").then((p) => {   // opened on another page: the tape from the room's pulse
      const one = (p.ticker || []).map((x) => `<span><b>${x.id}</b> ${num(x.price, x.dp)} <em class="${sign(x.chg)}">${pct(x.chg)}</em></span>`).join("");
      if (one && alertEl) alertEl.querySelectorAll(".tr-alert-led > div").forEach((d) => { d.innerHTML = one.repeat(3); });
    }).catch(() => {});
    requestAnimationFrame(() => alertEl && alertEl.classList.add("in"));
    alertEl.onclick = (e) => {
      const b = e.target.closest("[data-a]"); if (!b) return;
      seen(a);
      if (b.dataset.a === "open") { if (a.symbol) { sel = a.symbol; localStorage.setItem("trading.sel", sel); } location.hash = "#/trading"; }
      closeAlert(true);
    };
    document.addEventListener("keydown", escClose);
    chime(a.level);
    // behind it, the chart of the instrument, drawing itself
    const c = alertEl.querySelector(".tr-alert-bg");
    if (a.symbol) api(`/api/trading-room/chart?id=${encodeURIComponent(a.symbol)}&tf=M15`).then((d) => {
      if (!alertEl || !c.isConnected) return;
      let k = 0;
      const run = () => { if (!alertEl || !c.isConnected) return; k = Math.min(100, k + 1.2); drawChart(c, d, { n: 100, off: 0 }, { mini: true, reveal: Math.round(k), layers: { fvg: 1, ob: 1, liq: 1 } }); if (k < 100) alertRaf = requestAnimationFrame(run); };
      run();
    }).catch(() => {});
    function escClose(e) { if (e.key === "Escape") { seen(a); closeAlert(true); document.removeEventListener("keydown", escClose); } }
  }
  function seen(a) { api(`/api/trading-room/alerts/${a.id}/seen`, { method: "POST" }).catch(() => {}); }
  function closeAlert(animate) {
    cancelAnimationFrame(alertRaf);
    const el = alertEl; alertEl = null;
    if (!el) return;
    if (!animate) { el.remove(); return; }
    el.classList.remove("in"); el.classList.add("out"); setTimeout(() => el.remove(), 420);
  }
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s);
  // three notes, rising for a buy or a news call, falling for a sell; louder the more it matters
  function chime(level) {
    try {
      const A = new (window.AudioContext || window.webkitAudioContext)(), now = A.currentTime;
      [523.25, 659.25, 783.99, level >= 5 ? 1046.5 : null].filter(Boolean).forEach((f, i) => {
        const o = A.createOscillator(), v = A.createGain();
        o.type = "triangle"; o.frequency.value = f; v.gain.setValueAtTime(0, now + i * .13);
        v.gain.linearRampToValueAtTime(.05 + level * .012, now + i * .13 + .02); v.gain.exponentialRampToValueAtTime(.0001, now + i * .13 + .7);
        o.connect(v).connect(A.destination); o.start(now + i * .13); o.stop(now + i * .13 + .75);
      });
      setTimeout(() => A.close(), 1600);
    } catch (e) { /* no sound here */ }
  }

  window.TradingRoom = { showAlert, drawChart };
})();
