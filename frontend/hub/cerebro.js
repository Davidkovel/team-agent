// O Cérebro (24 Nov, Marco: «o widget é o cérebro principal, tipo um Jarvis... aquelas bolas dos reis em que só olhavam
// para a bola e mostrava tudo... a prompt toda visível... ver o ChatGPT a falar com o Claude»). backend/app/routers/cerebro.py.
//
// One screen: the ball (every Claude window of the team around its person, the AIs each one reaches on the outer ring,
// ChatGPT's conversations on this PC, a line and a spark for every call that is happening), the request box under it (the
// brain says while you type what kind of work it is, which AI is best and why, which skills; Enviar opens a Claude Code
// window here with that prompt, or asks ChatGPT, or both, or gives it to the office), and on the right every window in full:
// the whole request, its trail of steps, its subagents, skills and AIs. Below, the thread of what happened.
// Weight: the ball moves only while something works and the page is on screen; asks the Hub every 3 s while open.
(function () {
  const ENGINE_COLOR = { "Claude Code": "#d9a27a", ChatGPT: "#7fd6b5", Higgsfield: "#c9a4ff", Canva: "#7fc4ff", Chrome: "#f2c46b",
    Web: "#9fb3c8", Subagente: "#8fb4ff", Firecrawl: "#ff9a6b", Perplexity: "#6be0e0", Gmail: "#ef8a7a", Notion: "#d0d4da" };
  const STATE = { working: ["A trabalhar", "ok"], waiting: ["À tua espera", "warn"], idle: ["Livre", "idle"], ended: ["Fechada", "idle"], stalled: ["Parada", "bad"] };
  const st = { data: null, open: null, plan: null, planFor: "", sending: false, timer: 0, raf: 0, nodes: [], hover: null, t0: performance.now() };
  const ago = (s) => { const d = Date.now() / 1000 - s; return d < 60 ? t("agora") : d < 3600 ? `${Math.round(d / 60)} min` : `${Math.round(d / 3600)} h`; };
  const isoS = (iso) => (iso ? Date.parse(iso) / 1000 : 0);
  const working = (s) => s.state === "working";
  const color = (name) => ENGINE_COLOR[name] || "#b8c0ca";

  /* ---------- page ---------- */
  function shell() {
    return `<div id="cb" class="cb">
      ${ui.head("", t("Cérebro"), t("Tudo o que as IAs da empresa estão a fazer, à vista. Escreve o que queres: o cérebro escolhe a melhor IA."),
        `<span class="cb-chip" id="cb-count"></span>`)}
      <div class="cb-grid">
        <section class="cb-main">
          <div class="cb-orb" id="cb-orb"><canvas id="cb-cv"></canvas><div class="cb-tip" id="cb-tip" hidden></div>
            <div class="cb-legend" id="cb-legend"></div></div>
          <form class="cb-ask" id="cb-ask" autocomplete="off">
            <textarea id="cb-q" rows="2" placeholder="${esc(t("Diz ao cérebro o que queres… (ex.: faz-me um reel do C63 para o Instagram)"))}"></textarea>
            <div class="cb-plan" id="cb-plan"></div>
            <div class="cb-send">
              <button type="submit" class="btn primary" data-to="auto">${icon("spark")}${esc(t("Enviar"))}</button>
              <button type="button" class="btn" data-to="claude">${esc(t("Claude Code"))}</button>
              <button type="button" class="btn" data-to="chatgpt" id="cb-gpt">${esc(t("ChatGPT"))}</button>
              <button type="button" class="btn" data-to="both" id="cb-both">${esc(t("Os dois"))}</button>
              <button type="button" class="btn" data-to="office">${esc(t("Escritório"))}</button>
              <small id="cb-msg"></small>
            </div>
          </form>
        </section>
        <aside class="cb-side">
          <div class="cb-sec">${esc(t("Agora"))}<small id="cb-now"></small></div>
          <div id="cb-wins" class="cb-wins"></div>
          <div class="cb-sec" id="cb-gpt-h">${esc(t("ChatGPT neste PC"))}</div>
          <div id="cb-gpts" class="cb-wins"></div>
        </aside>
      </div>
      <div class="cb-sec">${esc(t("O fio"))}<small>${esc(t("o que cada IA fez, do mais novo para o mais antigo"))}</small></div>
      <div id="cb-film" class="cb-film"></div>
    </div>`;
  }

  /* ---------- the windows on the right ---------- */
  function steps(list) {
    return list.length ? `<ol class="cb-steps">${list.slice().reverse().map((s) => `<li><time>${esc(ago(s.at))}</time>${s.engine ? `<i style="--c:${color(s.engine)}">${esc(s.engine)}</i>` : ""}<span>${esc(s.text)}</span></li>`).join("")}</ol>` : "";
  }
  function winCard(s) {
    const [label, tone] = STATE[s.state] || [s.state, "idle"];
    const open = st.open === `w${s.id}`;
    const links = ["Claude Code", ...(s.links || [])];
    return `<article class="cb-win ${tone} ${open ? "open" : ""}" data-open="w${s.id}">
      <header><span class="cb-dot ${tone}"></span><b>${esc(s.name)}</b><span class="cb-proj">${esc(s.project || "")}</span>
        <span class="cb-st">${esc(t(label))} · ${esc(ago(isoS(s.since)))}</span></header>
      <h4>${esc(s.topic || s.title || t("Janela do Claude"))}</h4>
      <p class="cb-act">${esc(s.action || "")}</p>
      <div class="cb-links">${links.map((n) => `<i style="--c:${color(n)}">${esc(n)}</i>`).join("")}${s.model ? `<em>${esc(s.model)}</em>` : ""}</div>
      ${open ? `<div class="cb-more">
        ${s.request ? `<div class="cb-lbl">${esc(t("O pedido inteiro"))}</div><pre class="cb-req">${esc(s.request)}</pre>` : ""}
        ${s.result ? `<div class="cb-lbl">${esc(t("O que disse no fim"))}</div><p class="cb-res">${esc(s.result)}</p>` : ""}
        ${(s.steps || []).length ? `<div class="cb-lbl">${esc(t("Passos"))}</div>${steps(s.steps)}` : ""}
        ${(s.agents || []).length ? `<div class="cb-lbl">${esc(t("Subagentes"))}</div><ul class="cb-agents">${s.agents.map((a) =>
          `<li><b>${esc(a.kind || "agente")}</b> ${esc(a.description || "")}<small>${esc(a.status === "working" ? t("a trabalhar") : a.result || a.status || "")}</small></li>`).join("")}</ul>` : ""}
        ${(s.skills || []).length ? `<div class="cb-lbl">${esc(t("Skills"))}</div><div class="cb-links">${s.skills.map((k) => `<i>${esc(typeof k === "string" ? k : k.name)}</i>`).join("")}</div>` : ""}
        ${s.tokens ? `<p class="cb-tok">${esc(Number(s.tokens).toLocaleString("pt-PT"))} tokens</p>` : ""}
      </div>` : ""}
    </article>`;
  }
  function gptCard(g) {
    const open = st.open === `g${g.id}`;
    return `<article class="cb-win gpt ${g.state === "working" ? "ok" : "idle"} ${open ? "open" : ""}" data-open="g${g.id}">
      <header><span class="cb-dot ${g.state === "working" ? "ok" : "idle"}"></span><b>ChatGPT</b><span class="cb-proj">${esc(g.project || "")}</span>
        <span class="cb-st">${esc(g.state === "working" ? t("A trabalhar") : t("Livre"))} · ${esc(ago(g.updated_at))}</span></header>
      <h4>${esc(g.name)}</h4>
      ${g.answer ? `<p class="cb-act">${esc(g.answer.slice(0, 160))}</p>` : ""}
      <div class="cb-links"><i style="--c:${color("ChatGPT")}">ChatGPT</i>${g.from_brain ? `<i>${esc(t("pedido pelo Cérebro"))}</i>` : ""}${g.model ? `<em>${esc(g.model)}</em>` : ""}</div>
      ${open ? `<div class="cb-more">
        ${g.asked ? `<div class="cb-lbl">${esc(t("O pedido"))}</div><pre class="cb-req">${esc(g.asked)}</pre>` : ""}
        ${g.answer ? `<div class="cb-lbl">${esc(t("A resposta"))}</div><pre class="cb-req">${esc(g.answer)}</pre>` : ""}
        ${(g.steps || []).length ? `<div class="cb-lbl">${esc(t("Passos"))}</div>${steps(g.steps.map((s) => ({ at: isoS(s.at), text: s.text, engine: "" })))}` : ""}
      </div>` : ""}
    </article>`;
  }
  function askCard(a) {
    const open = st.open === `a${a.id}`;
    const tone = a.state === "working" ? "ok" : a.state === "failed" ? "bad" : "idle";
    return `<article class="cb-win gpt ${tone} ${open ? "open" : ""}" data-open="a${a.id}">
      <header><span class="cb-dot ${tone}"></span><b>ChatGPT</b><span class="cb-proj">${esc(t("Cérebro"))}</span>
        <span class="cb-st">${esc(a.state === "working" ? t("A pensar…") : a.state === "failed" ? t("Falhou") : t("Respondeu"))} · ${esc(ago(a.at))}</span></header>
      <h4>${esc(a.prompt)}</h4>
      ${a.answer || a.error ? `<pre class="cb-req ${open ? "" : "cut"}">${esc(a.answer || a.error)}</pre>` : ""}
    </article>`;
  }
  function paintSide() {
    const d = st.data;
    const live = d.sessions.filter((s) => s.state !== "ended");
    const order = { working: 0, waiting: 1, stalled: 2, idle: 3 };
    live.sort((a, b) => (order[a.state] ?? 4) - (order[b.state] ?? 4) || isoS(b.updated_at) - isoS(a.updated_at));
    paint($("cb-wins"), live.length ? live.slice(0, 14).map(winCard).join("") : ui.empty("bot", "Nenhuma janela do Claude aberta", "Escreve um pedido em baixo e o cérebro abre uma."));
    const busy = live.filter(working).length;
    paint($("cb-now"), `${busy} ${t("a trabalhar")} · ${live.length} ${t("abertas")}`);
    paint($("cb-count"), `${d.people.length} ${t("sócios")} · ${busy + d.chatgpt.filter((g) => g.state === "working").length} ${t("IAs a trabalhar")}`);
    const gpt = [...(d.asks || []).map(askCard), ...d.chatgpt.map(gptCard)];
    $("cb-gpt-h").hidden = !d.here;
    paint($("cb-gpts"), !d.here ? "" : gpt.length ? gpt.join("") : ui.empty("chat", d.chatgpt_ready ? "Sem conversas do ChatGPT hoje" : "O ChatGPT não está neste PC",
      d.chatgpt_ready ? "Carrega em «ChatGPT» para lhe perguntar." : ""));
    $("cb-gpt").disabled = $("cb-both").disabled = !d.chatgpt_ready;
  }
  function paintFilm() {
    const d = st.data;
    const rows = [];
    for (const s of d.sessions) for (const x of s.steps || []) rows.push({ at: x.at, who: s.name, where: s.project, text: x.text, engine: x.engine || "Claude Code" });
    for (const g of d.chatgpt) for (const x of g.steps || []) rows.push({ at: isoS(x.at), who: "ChatGPT", where: g.project, text: x.text, engine: "ChatGPT" });
    rows.sort((a, b) => b.at - a.at);
    paint($("cb-film"), rows.length ? rows.slice(0, 40).map((r) => `<div class="cb-fr"><time>${esc(ago(r.at))}</time><i style="--c:${color(r.engine)}"></i>
      <b>${esc(r.who)}</b><span class="cb-proj">${esc(r.where || "")}</span><span>${esc(r.text)}</span><em>${esc(r.engine)}</em></div>`).join("") : `<p class="cb-none">${esc(t("Ainda nada hoje."))}</p>`);
  }

  /* ---------- the ball ---------- */
  function layout(w, h) {
    const d = st.data;
    const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2;
    const nodes = [];
    const live = d.sessions.filter((s) => s.state !== "ended");
    const engines = new Set(["Claude Code", "ChatGPT"]);
    live.forEach((s) => (s.links || []).forEach((n) => engines.add(n)));
    const eng = [...engines];
    eng.forEach((name, i) => {
      const a = -Math.PI / 2 + (i / eng.length) * Math.PI * 2;
      nodes.push({ kind: "engine", name, x: cx + Math.cos(a) * R * 0.86, y: cy + Math.sin(a) * R * 0.78, r: 7, a });
    });
    const people = d.people;
    people.forEach((p, i) => {
      const a = -Math.PI / 2 + Math.PI / people.length + (i / people.length) * Math.PI * 2;
      const px = cx + Math.cos(a) * R * 0.45, py = cy + Math.sin(a) * R * 0.42;
      const mine = live.filter((s) => s.user === p.user);
      nodes.push({ kind: "person", name: p.name, x: px, y: py, r: 13, busy: mine.some(working), a });
      mine.slice(0, 8).forEach((s, j) => {
        const b = a + (j - (Math.min(mine.length, 8) - 1) / 2) * 0.42;
        nodes.push({ kind: "win", s, name: s.topic || s.title || s.project, who: p.name, x: px + Math.cos(b) * R * 0.27, y: py + Math.sin(b) * R * 0.25,
          r: 5.5, px, py, state: s.state, links: ["Claude Code", ...(s.links || [])] });
      });
    });
    (d.chatgpt || []).slice(0, 5).forEach((g, j) => {
      const e = nodes.find((n) => n.kind === "engine" && n.name === "ChatGPT");
      if (!e) return;
      const b = e.a + (j - 2) * 0.16;
      nodes.push({ kind: "gpt", g, name: g.name, x: e.x - Math.cos(b) * R * 0.16, y: e.y - Math.sin(b) * R * 0.15, r: 4.5, ex: e.x, ey: e.y, state: g.state });
    });
    return { nodes, cx, cy, R };
  }
  const recent = (s, name) => (s.steps || []).some((x) => x.engine === name && Date.now() / 1000 - x.at < 120) || (name === "Claude Code" && working(s));

  function draw() {
    const cv = $("cb-cv");
    if (!cv || !st.data) return false;
    const box = cv.parentElement.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(box.width * dpr) || cv.height !== Math.round(box.height * dpr)) {
      cv.width = Math.round(box.width * dpr); cv.height = Math.round(box.height * dpr);
    }
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = box.width, h = box.height;
    const time = (performance.now() - st.t0) / 1000;
    const L = layout(w, h);
    st.nodes = L.nodes;
    g.clearRect(0, 0, w, h);
    // the ball: glass, a cold core, rings that turn
    const core = Math.min(w, h) * 0.17;
    let grad = g.createRadialGradient(L.cx, L.cy, 0, L.cx, L.cy, L.R * 0.98);
    grad.addColorStop(0, "rgba(143,180,255,.10)"); grad.addColorStop(0.55, "rgba(143,180,255,.035)"); grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad; g.beginPath(); g.arc(L.cx, L.cy, L.R * 0.98, 0, Math.PI * 2); g.fill();
    g.lineWidth = 1;
    [0.45, 0.66, 0.84].forEach((k, i) => {
      g.strokeStyle = `rgba(200,215,235,${0.07 - i * 0.015})`;
      g.setLineDash(i === 1 ? [2, 6] : []);
      g.beginPath(); g.ellipse(L.cx, L.cy, L.R * k * 1.0, L.R * k * 0.93, 0, 0, Math.PI * 2); g.stroke();
    });
    g.setLineDash([]);
    const busy = st.data.sessions.filter(working).length + st.data.chatgpt.filter((x) => x.state === "working").length;
    const spin = busy ? time * 0.25 : 0;
    for (let i = 0; i < 3; i++) {
      g.save(); g.translate(L.cx, L.cy); g.rotate(spin * (i % 2 ? -1 : 1) + i * 1.1);
      g.strokeStyle = `rgba(143,180,255,${busy ? 0.32 : 0.16})`; g.lineWidth = 1.2;
      g.beginPath(); g.ellipse(0, 0, core * (1.25 + i * 0.18), core * (0.42 + i * 0.12), 0, 0, Math.PI * 2); g.stroke(); g.restore();
    }
    grad = g.createRadialGradient(L.cx - core * 0.3, L.cy - core * 0.35, core * 0.05, L.cx, L.cy, core);
    grad.addColorStop(0, "rgba(235,242,255,.95)"); grad.addColorStop(0.25, "rgba(150,185,255,.55)"); grad.addColorStop(0.7, "rgba(40,60,110,.55)"); grad.addColorStop(1, "rgba(10,14,24,.9)");
    g.fillStyle = grad; g.beginPath(); g.arc(L.cx, L.cy, core * (1 + (busy ? Math.sin(time * 2.2) * 0.025 : 0)), 0, Math.PI * 2); g.fill();
    g.strokeStyle = "rgba(220,230,245,.35)"; g.lineWidth = 1; g.stroke();
    g.fillStyle = "rgba(255,255,255,.92)"; g.font = `600 ${Math.max(11, core * 0.2)}px var(--display), -apple-system, sans-serif`; g.textAlign = "center";
    g.fillText("AMG", L.cx, L.cy + core * 0.07);
    g.fillStyle = "rgba(220,230,245,.6)"; g.font = `500 ${Math.max(9, core * 0.11)}px -apple-system, sans-serif`;
    g.fillText(busy ? `${busy} ${t("a trabalhar")}` : t("em silêncio"), L.cx, L.cy + core * 0.3);
    // lines: person → core, window → person, window → the AIs it reaches (a spark runs on the ones in use now)
    const byName = Object.fromEntries(L.nodes.filter((n) => n.kind === "engine").map((n) => [n.name, n]));
    for (const n of L.nodes) {
      if (n.kind === "person") line(g, L.cx, L.cy, n.x, n.y, n.busy ? "rgba(143,180,255,.35)" : "rgba(200,210,225,.10)", n.busy, time, "#8fb4ff");
      if (n.kind === "win") {
        line(g, n.px, n.py, n.x, n.y, "rgba(200,210,225,.18)", false, time);
        for (const name of n.links) {
          const e = byName[name]; if (!e) continue;
          const hot = recent(n.s, name);
          if (!hot && n.state !== "working") continue;
          line(g, n.x, n.y, e.x, e.y, hot ? hexA(color(name), 0.45) : "rgba(200,210,225,.06)", hot, time + n.x, color(name));
        }
      }
      if (n.kind === "gpt") line(g, n.x, n.y, n.ex, n.ey, n.state === "working" ? hexA(color("ChatGPT"), 0.5) : "rgba(127,214,181,.15)", n.state === "working", time, color("ChatGPT"));
    }
    // nodes
    for (const n of L.nodes) {
      const hov = st.hover === n;
      if (n.kind === "engine") {
        const used = st.data.sessions.some((s) => working(s) && (n.name === "Claude Code" || recent(s, n.name))) || (n.name === "ChatGPT" && st.data.chatgpt.some((x) => x.state === "working"));
        glow(g, n.x, n.y, used ? 18 : 9, color(n.name), used ? 0.35 : 0.12);
        g.fillStyle = color(n.name); g.beginPath(); g.arc(n.x, n.y, n.r + (hov ? 2 : 0), 0, Math.PI * 2); g.fill();
        label(g, n.name, n.x, n.y + (n.y > L.cy ? 22 : -14), used ? "rgba(240,244,250,.95)" : "rgba(200,208,220,.6)", 11);
      } else if (n.kind === "person") {
        glow(g, n.x, n.y, 24, "#8fb4ff", n.busy ? 0.3 : 0.08);
        g.fillStyle = "#14181f"; g.strokeStyle = n.busy ? "#8fb4ff" : "rgba(220,226,235,.35)"; g.lineWidth = 1.5;
        g.beginPath(); g.arc(n.x, n.y, n.r + (hov ? 2 : 0), 0, Math.PI * 2); g.fill(); g.stroke();
        g.fillStyle = "#eef1f5"; g.font = "600 11px -apple-system, sans-serif"; g.textAlign = "center"; g.fillText((n.name || "?")[0], n.x, n.y + 4);
        label(g, n.name, n.x, n.y + 29, "rgba(236,238,241,.85)", 11);
      } else {
        const c = n.state === "working" ? "#5fcf8c" : n.state === "waiting" ? "#e2b55c" : n.state === "stalled" ? "#ef6f5e" : "#7b838d";
        const pulse = n.state === "working" ? 0.5 + Math.sin(time * 3 + n.x) * 0.5 : 0;
        glow(g, n.x, n.y, 10 + pulse * 6, c, n.state === "working" ? 0.35 : 0.1);
        g.fillStyle = n.kind === "gpt" ? color("ChatGPT") : c; g.beginPath(); g.arc(n.x, n.y, n.r + (hov ? 2 : 0), 0, Math.PI * 2); g.fill();
        if (hov) { g.strokeStyle = "#fff"; g.lineWidth = 1.2; g.stroke(); }
      }
    }
    return busy > 0;
  }
  function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }
  function glow(g, x, y, r, c, a) {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, hexA(c, a)); gr.addColorStop(1, hexA(c, 0));
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  function line(g, x1, y1, x2, y2, stroke, spark, time, c) {
    g.strokeStyle = stroke; g.lineWidth = spark ? 1.3 : 1;
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    if (!spark) return;
    for (let k = 0; k < 2; k++) {
      const f = ((time * 0.6 + k * 0.5) % 1);
      glow(g, x1 + (x2 - x1) * f, y1 + (y2 - y1) * f, 6, c || "#8fb4ff", 0.9);
    }
  }
  function label(g, text, x, y, c, size) {
    g.font = `500 ${size}px -apple-system, "SF Pro Text", sans-serif`; g.textAlign = "center";
    g.fillStyle = "rgba(0,0,0,.55)"; g.fillText(text, x + 0.5, y + 1);
    g.fillStyle = c; g.fillText(text, x, y);
  }
  function loop() {
    cancelAnimationFrame(st.raf);
    let last = 0;
    const frame = (now) => {
      if (!$("cb")) return;
      if (now - last > 1000 / 24) { last = now; if (!draw() && !st.hover) return; }   // nothing working: one still frame
      st.raf = requestAnimationFrame(frame);
    };
    st.raf = requestAnimationFrame(frame);
  }
  function legend() {
    paint($("cb-legend"), `<span><i class="ok"></i>${esc(t("a trabalhar"))}</span><span><i class="warn"></i>${esc(t("à tua espera"))}</span>
      <span><i class="idle"></i>${esc(t("livre"))}</span><span><i class="line"></i>${esc(t("a falar com outra IA"))}</span>`);
  }
  function hit(e) {
    const r = $("cb-cv").getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    return st.nodes.find((n) => Math.hypot(n.x - x, n.y - y) < n.r + 7) || null;
  }
  function tip(n, e) {
    const el = $("cb-tip");
    if (!n) { el.hidden = true; return; }
    const r = $("cb-orb").getBoundingClientRect();
    const text = n.kind === "win" ? `<b>${esc(n.who)} · ${esc(n.s.project || "")}</b><span>${esc(n.name || "")}</span><small>${esc(n.s.action || "")}</small><small>${esc(n.links.join(" · "))}</small>`
      : n.kind === "gpt" ? `<b>ChatGPT</b><span>${esc(n.name)}</span><small>${esc((n.g.answer || "").slice(0, 120))}</small>`
      : n.kind === "person" ? `<b>${esc(n.name)}</b><small>${esc(st.data.sessions.filter((s) => s.name === n.name && s.state !== "ended").length)} ${esc(t("janelas"))}</small>`
      : `<b>${esc(n.name)}</b><small>${esc(t("usado por"))} ${esc(st.data.sessions.filter((s) => s.state !== "ended" && (n.name === "Claude Code" || (s.links || []).includes(n.name))).length)} ${esc(t("janelas"))}</small>`;
    el.innerHTML = text; el.hidden = false;
    el.style.left = `${Math.min(r.width - 240, e.clientX - r.left + 14)}px`; el.style.top = `${e.clientY - r.top + 12}px`;
  }

  /* ---------- the request ---------- */
  let planTimer = 0;
  function askPlan() {
    clearTimeout(planTimer);
    const q = $("cb-q").value.trim();
    if (q.length < 3) { st.plan = null; paintPlan(); return; }
    planTimer = setTimeout(async () => {
      try { const p = await api("/api/cerebro/plan", { method: "POST", body: { prompt: q } }); if ($("cb-q") && $("cb-q").value.trim() === q) { st.plan = p; paintPlan(); } } catch (e) { /* the plan is a hint */ }
    }, 320);
  }
  function paintPlan() {
    const p = st.plan;
    if (!p || !p.kind) { paint($("cb-plan"), `<span class="cb-hint">${esc(t("O cérebro diz aqui o que vai fazer: que IA, que modelo e que skills."))}</span>`); return; }
    paint($("cb-plan"), `<div class="cb-route"><b>${esc(p.label)}</b>${p.also.length ? `<small>+ ${esc(p.also.join(", "))}</small>` : ""}
        <span>→ ${esc(p.department)}</span><span class="cb-model">${esc(p.model)}</span>
        <span class="cb-go">${esc(p.target === "chatgpt" ? t("Vai para o ChatGPT") : t("Abre uma janela do Claude Code"))}</span></div>
      <div class="cb-engines">${p.engines.map((e) => `<span class="cb-eng ${e.ready ? "" : "off"}" style="--c:${color(e.name)}"><i></i><b>${esc(e.name)}</b>${esc(e.why)}</span>`).join("")}</div>
      ${p.skills.length ? `<div class="cb-skills">${esc(t("Skills"))}: ${p.skills.map((s) => `<i title="${esc(s.about)}">${esc(s.name)}</i>`).join("")}</div>` : ""}`);
  }
  async function send(to) {
    const q = $("cb-q").value.trim();
    if (q.length < 3 || st.sending) return;
    st.sending = true;
    const msg = $("cb-msg");
    msg.textContent = t("A enviar…");
    try {
      if (to === "office") {
        const p = st.plan || {};
        await api("/api/tasks", { method: "POST", body: { title: q.split(/[.!?\n]/)[0].slice(0, 120), description: p.prompt || q, assignee: me.username, for_ai: true, crew: p.crew || "" } });
        msg.textContent = t("Foi para o Escritório: o agente pega nela.");
      } else {
        const r = await api("/api/cerebro/send", { method: "POST", body: { prompt: q, to } });
        const parts = [];
        if (r.claude) parts.push(r.claude.ok ? t("Abriu uma janela do Claude Code") : r.claude.error);
        if (r.chatgpt) parts.push(r.chatgpt.ok ? t("O ChatGPT está a pensar") : r.chatgpt.error);
        msg.textContent = parts.join(" · ");
      }
      $("cb-q").value = ""; st.plan = null; paintPlan();
      setTimeout(load, 1500);
    } catch (e) {
      msg.textContent = e.message || t("Não deu para enviar");
    } finally {
      st.sending = false;
      setTimeout(() => { if ($("cb-msg") === msg) msg.textContent = ""; }, 8000);
    }
  }

  /* ---------- data ---------- */
  async function load() {
    if (!$("cb")) return;
    try {
      st.data = await api("/api/cerebro");
    } catch (e) {
      if (!st.data) paint($("cb-wins"), ui.error(e.message));
      return;
    }
    paintSide(); paintFilm(); loop();
  }
  function start() {
    clearInterval(st.timer);
    st.timer = setInterval(() => { if (!$("cb")) { clearInterval(st.timer); return; } if (!document.hidden) load(); }, 3000);
  }

  HUB_VIEWS.cerebro = async function () {
    $("view").innerHTML = `<div class="page cb-page">${shell()}</div>`;
    legend(); paintPlan();
    const root = $("cb");
    root.addEventListener("click", (e) => {
      const b = e.target.closest("[data-to]");
      if (b && b.type === "button") { send(b.dataset.to); return; }
      const card = e.target.closest("[data-open]");
      if (card && !e.target.closest("pre, a, button")) { st.open = st.open === card.dataset.open ? null : card.dataset.open; paintSide(); }
    });
    $("cb-ask").addEventListener("submit", (e) => { e.preventDefault(); send("auto"); });
    $("cb-q").addEventListener("input", askPlan);
    $("cb-q").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send("auto"); } });
    const cv = $("cb-cv");
    cv.addEventListener("mousemove", (e) => { const n = hit(e); if (n !== st.hover) { st.hover = n; draw(); } tip(n, e); cv.style.cursor = n && (n.kind === "win" || n.kind === "gpt") ? "pointer" : ""; });
    cv.addEventListener("mouseleave", () => { st.hover = null; tip(null); draw(); });
    cv.addEventListener("click", (e) => {
      const n = hit(e);
      if (n?.kind === "win") { st.open = `w${n.s.id}`; paintSide(); document.querySelector(`[data-open="w${n.s.id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
      if (n?.kind === "gpt") { st.open = `g${n.g.id}`; paintSide(); document.querySelector(`[data-open="g${n.g.id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
    });
    new ResizeObserver(() => draw()).observe($("cb-orb"));
    await load();
    start();
    setTimeout(() => $("cb-q")?.focus(), 50);
  };
  onLive(["office"], async () => { if ($("cb")) await load(); });
})();
