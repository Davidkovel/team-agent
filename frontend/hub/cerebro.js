// O Cérebro (24 Nov, Marco: «o widget é o cérebro principal, tipo um Jarvis... ver tudo com os olhos, sem mexer o rato...
// um chat, um Grok, um Claude, o Gemini, tudo junto... um WhisperFlow lá, de graça... ao vivo para o Kovel e o David...
// num spotzinho enquanto trabalho noutras coisas»). backend/app/routers/cerebro.py.
//
// The one memorable thing is the black hole (canvas, 60 fps while an AI works, 30 when quiet). Around it, all written on
// screen: the partners (GitHub photo, name, how many AIs work for them), each one's Claude windows as small labelled pills,
// and on the outer ring every AI the company uses as its app icon and name (Claude, ChatGPT, Gemini, Grok, Higgsfield,
// Canva...); a line with sparks runs from a window to each AI it is talking to now. Under it the conversation with the
// brain: one thread for the whole team (it travels by sync), text or the microphone (Whisper on this PC, free), answers
// read aloud if wanted, «Conversa» for hands-free. Right: Agora (every window in full), ChatGPT, O fio.
// ?mini=1&cb=1 is the small window that stays over everything (the widget's shortcut, Chrome's picture-in-picture).
(function () {
  const MINI = /[?&]cb=1(&|$)/.test(location.search);
  if (MINI) document.documentElement.classList.add("cb-solo");

  /* ---------- the AIs, as app icons ---------- */
  const rays = (n, r1, r2) => Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; return `M${(12 + Math.cos(a) * r1).toFixed(2)} ${(12 + Math.sin(a) * r1).toFixed(2)}L${(12 + Math.cos(a) * r2).toFixed(2)} ${(12 + Math.sin(a) * r2).toFixed(2)}`; }).join("");
  const AI = {
    "Claude Code": { short: "Claude", bg: "#c96442", glyph: `<path d="${rays(12, 2.4, 8.8)}" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>` },
    ChatGPT: { short: "ChatGPT", bg: "#000", ring: "rgba(255,255,255,.16)", glyph: [0, 60, 120].map((r) => `<ellipse cx="12" cy="12" rx="8" ry="3.5" transform="rotate(${r} 12 12)" fill="none" stroke="#fff" stroke-width="1.6"/>`).join("") + `<circle cx="12" cy="12" r="1.5" fill="#fff"/>` },
    Gemini: { short: "Gemini", bg: "#0d1322", glyph: `<defs><linearGradient id="cbgem" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4f8cff"/><stop offset=".55" stop-color="#9b72f2"/><stop offset="1" stop-color="#d96570"/></linearGradient></defs><path d="M12 2.5C12.6 8 16 11.4 21.5 12 16 12.6 12.6 16 12 21.5 11.4 16 8 12.6 2.5 12 8 11.4 11.4 8 12 2.5Z" fill="url(#cbgem)"/>` },
    Grok: { short: "Grok", bg: "#000", ring: "rgba(255,255,255,.16)", glyph: `<path d="M17.6 5.4 6.4 18.6M9.7 9.3a5.2 5.2 0 0 1 7.4 6.8M14.3 14.7a5.2 5.2 0 0 1-7.4-6.8" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round"/>` },
    Higgsfield: { short: "Higgsfield", bg: "#15111f", ring: "rgba(150,120,255,.35)", glyph: `<path d="M7.5 5v14M16.5 5v14M7.5 12h9" stroke="#cdbdff" stroke-width="2.5" stroke-linecap="round"/>` },
    Canva: { short: "Canva", bg: "#0b1c26", glyph: `<defs><linearGradient id="cbcan" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#20c7e6"/><stop offset="1" stop-color="#7d3cf0"/></linearGradient></defs><circle cx="12" cy="12" r="9.5" fill="url(#cbcan)"/><path d="M15.5 9.3a4.3 4.3 0 1 0 .2 5.3" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round"/>` },
    Chrome: { short: "Chrome", bg: "#f1f3f4", glyph: `<circle cx="12" cy="12" r="9" fill="#db4437"/><path d="M12 12 4.2 16.5A9 9 0 0 0 16.5 19.8Z" fill="#0f9d58"/><path d="M12 12 16.5 19.8A9 9 0 0 0 20.9 10.6Z" fill="#f4b400"/><circle cx="12" cy="12" r="4.1" fill="#fff"/><circle cx="12" cy="12" r="3.1" fill="#4285f4"/>` },
    Web: { short: "Web", bg: "#151b25", glyph: `<circle cx="12" cy="12" r="8.4" fill="none" stroke="#d3e2ff" stroke-width="1.5"/><path d="M3.6 12h16.8M12 3.6c3 3.2 3 13.6 0 16.8M12 3.6c-3 3.2-3 13.6 0 16.8" fill="none" stroke="#d3e2ff" stroke-width="1.3"/>` },
    Subagente: { short: "Subagentes", bg: "#141a29", glyph: `<rect x="5" y="8" width="14" height="10" rx="3" fill="none" stroke="#c4d5ff" stroke-width="1.6"/><path d="M12 8V5M9.5 12.5v1M14.5 12.5v1" stroke="#c4d5ff" stroke-width="1.7" stroke-linecap="round"/>` },
    Firecrawl: { short: "Firecrawl", bg: "#22130a", glyph: `<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-3.5 2.5-5 .3 1.6 1 2.4 2 2.8C11 8.6 11.3 5.5 12 3Z" fill="#ff8a3d"/>` },
    Perplexity: { short: "Perplexity", bg: "#0c2426", glyph: `<path d="M12 3v18M5 7l7 5 7-5M5 7v8l7-3 7 3V7" fill="none" stroke="#5ee0d8" stroke-width="1.6" stroke-linejoin="round"/>` },
    Gmail: { short: "Gmail", bg: "#fff", glyph: `<path d="M4 7.5 12 13l8-5.5V17a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z" fill="none" stroke="#ea4335" stroke-width="2"/>` },
    Notion: { short: "Notion", bg: "#fff", glyph: `<path d="M8 7v10M8 7l8 10V7" fill="none" stroke="#111" stroke-width="2.1" stroke-linejoin="round"/>` },
  };
  const ALWAYS = ["Claude Code", "ChatGPT", "Gemini", "Grok", "Higgsfield", "Canva"];   // the company's AIs: on the ring even when quiet
  const SOON = new Set(["Gemini", "Grok"]);   // on the ring, the accounts still to connect
  const aiOf = (name) => AI[name] || { short: name, bg: "#1a1e24", glyph: `<text x="12" y="16.4" text-anchor="middle" font-size="11.5" font-weight="700" fill="#e6e9ee" font-family="-apple-system,sans-serif">${esc((name || "?")[0])}</text>` };
  const appIcon = (name, cls = "") => { const a = aiOf(name); return `<span class="cb-app ${cls}" style="--bg:${a.bg};--ring:${a.ring || "rgba(255,255,255,.08)"}"><svg viewBox="0 0 24 24" aria-hidden="true">${a.glyph}</svg></span>`; };
  const TINT = { "Claude Code": "#e0896a", ChatGPT: "#e9edf2", Gemini: "#8f8cff", Grok: "#e9edf2", Higgsfield: "#b39cff", Canva: "#3cc8e6", Chrome: "#f4c34f", Web: "#a9c2e6", Subagente: "#9cc1ff" };
  const tint = (name) => TINT[name] || "#c3cad4";

  const STATE = { working: ["A trabalhar", "ok"], waiting: ["À tua espera", "warn"], idle: ["Livre", "idle"], ended: ["Fechada", "idle"], stalled: ["Parada", "bad"] };
  const st = { data: null, chat: [], me: "", tab: "agora", open: null, plan: null, sending: false, timer: 0, chatTimer: 0, raf: 0,
    L: null, sig: "", voice: localStorage.getItem("cb-voz") === "1", talk: false, spoken: new Set(), rec: null, t0: performance.now() };
  const ago = (s) => { const d = Date.now() / 1000 - s; return d < 45 ? t("agora") : d < 3600 ? `${Math.max(1, Math.round(d / 60))} min` : d < 86400 ? `${Math.round(d / 3600)} h` : `${Math.round(d / 86400)} d`; };
  const isoS = (iso) => (iso ? Date.parse(iso) / 1000 : 0);
  const working = (s) => s.state === "working";
  const live = () => (st.data ? st.data.sessions.filter((s) => s.state !== "ended") : []);
  const face = (name, cls = "") => `<span class="cb-face ${cls}">${esc((name || "?")[0])}${githubPhoto(name)}</span>`;
  const svgMic = () => `<svg class="cb-ic" viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>`;
  const svgUp = () => `<svg class="cb-ic" viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6"/></svg>`;
  const svgSpeaker = () => `<svg class="cb-ic" viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>`;
  const svgWave = () => `<svg class="cb-ic" viewBox="0 0 24 24"><path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4"/></svg>`;
  const svgPip = () => `<svg class="cb-ic" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><rect x="12" y="11" width="7" height="6" rx="1.5"/></svg>`;

  /* ---------- page ---------- */
  function chatBlock() {
    return `<div class="cb-chat">
      <header class="cb-chat-h"><b>${esc(t("Conversa"))}</b><small>${esc(t("a equipa vê ao vivo"))}</small>
        <button type="button" class="cb-tog" id="cb-voz" title="${esc(t("Ler as respostas em voz alta"))}">${svgSpeaker()}<span>${esc(t("Voz"))}</span></button>
        <button type="button" class="cb-tog" id="cb-talk" title="${esc(t("Mãos livres: falas, ele responde em voz e volta a ouvir"))}">${svgWave()}<span>${esc(t("Mãos livres"))}</span></button></header>
      <div class="cb-thread" id="cb-thread"></div>
      <div class="cb-hint" id="cb-plan"></div>
      <form class="cb-compose" id="cb-form" autocomplete="off">
        <button type="button" class="cb-mic" id="cb-mic" title="${esc(t("Falar (Ctrl+M)"))}">${svgMic()}</button>
        <div class="cb-field"><textarea id="cb-q" rows="1" placeholder="${esc(t("Fala com o Cérebro"))}"></textarea>
          <div class="cb-recbar" id="cb-recbar"><canvas id="cb-wave" width="200" height="26"></canvas><time id="cb-rect">0:00</time><small>${esc(t("a ouvir… carrega outra vez para acabar"))}</small></div></div>
        <button type="submit" class="cb-sendb" id="cb-send" title="${esc(t("Enviar"))}">${svgUp()}</button>
      </form>
    </div>`;
  }
  function shell() {
    if (MINI) return `<div id="cb" class="cb mini">
      <div class="cb-stage" id="cb-stage"><canvas id="cb-cv"></canvas><div class="cb-layer" id="cb-layer"></div><div class="cb-core" id="cb-core"></div></div>
      <div class="cb-now" id="cb-list"></div>${chatBlock()}</div>`;
    return `<div id="cb" class="cb">
      ${ui.head("", t("Cérebro"), t("Todas as IAs da empresa, ao vivo. Fala com ele: escolhe a melhor IA e põe-na a trabalhar."),
        `<span class="cb-count" id="cb-count"></span><button type="button" class="btn sm" id="cb-pip" title="${esc(t("Uma janela pequena, por cima de tudo, enquanto trabalhas"))}">${svgPip()}${esc(t("Janela flutuante"))}</button>`)}
      <div class="cb-grid">
        <section class="cb-left">
          <div class="cb-stage" id="cb-stage"><canvas id="cb-cv"></canvas><div class="cb-layer" id="cb-layer"></div><div class="cb-core" id="cb-core"></div></div>
          ${chatBlock()}
        </section>
        <aside class="cb-right">
          <nav class="cb-seg" id="cb-seg"><button type="button" data-tab="agora">${esc(t("Agora"))}</button><button type="button" data-tab="gpt">ChatGPT</button><button type="button" data-tab="fio">${esc(t("O fio"))}</button></nav>
          <div class="cb-list" id="cb-list"></div>
        </aside>
      </div>
    </div>`;
  }

  /* ---------- the right column (and the strip of the small window) ---------- */
  const aiRow = (names) => `<div class="cb-ais">${names.map((n) => `<span class="cb-ai">${appIcon(n, "xs")}${esc(aiOf(n).short)}</span>`).join("")}</div>`;
  const trail = (list) => (list.length ? `<ol class="cb-trail">${list.slice().reverse().map((s) => `<li>${s.engine ? appIcon(s.engine, "xxs") : `<i class="cb-tdot"></i>`}<span>${esc(s.text)}</span><time>${esc(ago(s.at))}</time></li>`).join("")}</ol>` : "");
  function winRow(s) {
    const [label, tone] = STATE[s.state] || [s.state, "idle"];
    const open = st.open === `w${s.id}`;
    return `<article class="cb-row ${open ? "open" : ""}" data-open="w${s.id}">
      <div class="cb-row-top">${face(s.name)}
        <div class="cb-row-main"><div class="cb-row-who"><b>${esc(s.name)}</b><span>${esc(s.project || "")}</span><em class="${tone}">${esc(t(label))}, ${esc(ago(isoS(s.since)))}</em></div>
          <h4>${esc(s.topic || s.title || t("Janela do Claude"))}</h4>
          ${s.action ? `<p>${esc(s.action)}</p>` : ""}
          ${aiRow(["Claude Code", ...(s.links || [])])}</div></div>
      ${open ? `<div class="cb-detail">
        ${s.request ? `<h5>${esc(t("O pedido inteiro"))}</h5><pre>${esc(s.request)}</pre>` : ""}
        ${s.result ? `<h5>${esc(t("O que respondeu"))}</h5><p>${esc(s.result)}</p>` : ""}
        ${(s.steps || []).length ? `<h5>${esc(t("Passos"))}</h5>${trail(s.steps)}` : ""}
        ${(s.agents || []).length ? `<h5>${esc(t("Subagentes"))}</h5><ul>${s.agents.map((a) => `<li><b>${esc(a.kind || "agente")}</b> ${esc(a.description || "")} <small>${esc(a.status === "working" ? t("a trabalhar") : a.result || a.status || "")}</small></li>`).join("")}</ul>` : ""}
        ${(s.skills || []).length ? `<h5>${esc(t("Skills"))}</h5><div class="cb-tags">${s.skills.map((k) => `<i>${esc(typeof k === "string" ? k : k.name)}</i>`).join("")}</div>` : ""}
        ${s.model || s.tokens ? `<p class="cb-meta">${esc(s.model || "")}${s.tokens ? `, ${esc(Number(s.tokens).toLocaleString("pt-PT"))} tokens` : ""}</p>` : ""}
      </div>` : ""}
    </article>`;
  }
  function gptRow(g, ask) {
    const id = ask ? `a${g.id}` : `g${g.id}`;
    const open = st.open === id;
    const state = ask ? g.state : g.state === "working" ? "working" : "idle";
    const tone = state === "working" ? "ok" : state === "failed" ? "bad" : "idle";
    const answer = ask ? g.answer || g.error : g.answer;
    return `<article class="cb-row ${open ? "open" : ""}" data-open="${id}">
      <div class="cb-row-top">${appIcon("ChatGPT", "sm")}
        <div class="cb-row-main"><div class="cb-row-who"><b>ChatGPT</b><span>${esc(ask ? t("pedido pelo Cérebro") : g.project || "")}</span>
          <em class="${tone}">${esc(state === "working" ? t("A pensar") : state === "failed" ? t("Falhou") : t("Respondeu"))}, ${esc(ago(ask ? g.at : g.updated_at))}</em></div>
          <h4>${esc((ask ? g.prompt : g.name) || "")}</h4>
          ${answer && !open ? `<p class="cb-clip">${esc(answer)}</p>` : ""}</div></div>
      ${open ? `<div class="cb-detail">${!ask && g.asked ? `<h5>${esc(t("Pedido"))}</h5><pre>${esc(g.asked)}</pre>` : ""}
        ${answer ? `<h5>${esc(t("Resposta"))}</h5><pre>${esc(answer)}</pre>` : ""}
        ${!ask && (g.steps || []).length ? `<h5>${esc(t("Passos"))}</h5>${trail(g.steps.map((x) => ({ at: isoS(x.at), text: x.text, engine: "" })))}` : ""}</div>` : ""}
    </article>`;
  }
  function busyCount() {
    const d = st.data;
    return live().filter(working).length + d.chatgpt.filter((g) => g.state === "working").length + (d.asks || []).filter((a) => a.state === "working").length;
  }
  function paintRight() {
    const d = st.data;
    if (!d) return;
    const wins = live();
    const order = { working: 0, waiting: 1, stalled: 2, idle: 3 };
    wins.sort((a, b) => (order[a.state] ?? 4) - (order[b.state] ?? 4) || isoS(b.updated_at) - isoS(a.updated_at));
    const busy = busyCount();
    if ($("cb-count")) paint($("cb-count"), `<i class="${busy ? "on" : ""}"></i>${busy} ${esc(t(busy === 1 ? "IA a trabalhar" : "IAs a trabalhar"))}`);
    if (MINI) {   // the small window: only who works now, one line each
      const now = wins.filter((s) => s.state === "working" || s.state === "waiting").slice(0, 3);
      paint($("cb-list"), now.length ? now.map((s) => `<div class="cb-nowrow">${face(s.name, "xs")}<b>${esc(s.name)}</b><span>${esc(s.topic || s.project || "")}</span>
        <span class="cb-nowais">${["Claude Code", ...(s.links || [])].slice(0, 4).map((n) => appIcon(n, "xxs")).join("")}</span><i class="cb-st ${(STATE[s.state] || ["", "idle"])[1]}"></i></div>`).join("")
        : `<p class="cb-quiet">${esc(t("Nenhuma IA a trabalhar agora."))}</p>`);
      return;
    }
    document.querySelectorAll("#cb-seg button").forEach((b) => b.classList.toggle("on", b.dataset.tab === st.tab));
    let html;
    if (st.tab === "agora") html = wins.length ? `<div class="cb-group">${wins.slice(0, 16).map(winRow).join("")}</div>` : ui.empty("bot", "Nenhuma janela do Claude aberta", "Fala com o Cérebro e ele abre uma.");
    else if (st.tab === "gpt") {
      const rows = [...(d.asks || []).map((a) => gptRow(a, true)), ...d.chatgpt.map((g) => gptRow(g, false))];
      html = !d.here ? ui.empty("chat", "O ChatGPT vê-se no PC de cada um", "Aqui só aparece o deste computador.")
        : rows.length ? `<div class="cb-group">${rows.join("")}</div>` : ui.empty("chat", d.chatgpt_ready ? "Sem conversas do ChatGPT hoje" : "O ChatGPT não está neste PC", d.chatgpt_ready ? "Pede-lhe uma coisa na conversa." : "");
    } else {
      const rows = [];
      for (const s of d.sessions) for (const x of s.steps || []) rows.push({ at: x.at, who: s.name, where: s.project, text: x.text, engine: x.engine || "Claude Code" });
      for (const g of d.chatgpt) for (const x of g.steps || []) rows.push({ at: isoS(x.at), who: "ChatGPT", where: g.project, text: x.text, engine: "ChatGPT" });
      rows.sort((a, b) => b.at - a.at);
      html = rows.length ? `<div class="cb-group">${rows.slice(0, 50).map((r) => `<div class="cb-fr">${appIcon(r.engine, "xs")}<div><div class="cb-fr-top"><b>${esc(r.who)}</b><span>${esc(r.where || "")}</span><time>${esc(ago(r.at))}</time></div><p>${esc(r.text)}</p></div></div>`).join("")}</div>` : ui.empty("history", "Ainda nada hoje");
    }
    paint($("cb-list"), html);
  }

  /* ---------- the stage: where everything sits (DOM labels, placed when the data changes) ---------- */
  function hot(name) {   // an AI in use now: the windows that work and called it in the last 2 min
    if (!st.data) return false;
    if (name === "ChatGPT" && (st.data.chatgpt.some((g) => g.state === "working") || (st.data.asks || []).some((a) => a.state === "working"))) return true;
    return live().some((s) => usesNow(s, name));
  }
  const usesNow = (s, name) => working(s) && (name === "Claude Code" || (s.steps || []).some((x) => x.engine === name && Date.now() / 1000 - x.at < 120));
  function layout() {
    const stage = $("cb-stage");
    if (!stage || !st.data) return;
    const w = stage.clientWidth, h = stage.clientHeight;
    const cx = w / 2, cy = h / 2;
    const rx = w / 2 - (MINI ? 34 : 64), ry = h / 2 - (MINI ? 30 : 52);
    const wins = live();
    const names = [...ALWAYS];
    wins.forEach((s) => (s.links || []).forEach((n) => { if (!names.includes(n)) names.push(n); }));
    // the AIs in an arc over the top, the partners in an arc underneath: they never sit on each other
    const engines = names.slice(0, MINI ? 8 : 12).map((name, i, all) => {
      const span = Math.PI * (all.length > 7 ? 1.12 : 0.98), a = -Math.PI / 2 - span / 2 + (all.length > 1 ? (i / (all.length - 1)) * span : span / 2);
      return { name, a, x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry * 0.98 + (MINI ? 4 : 10) };
    });
    const people = st.data.people.map((p, i, all) => {
      const a = Math.PI / 2 + (i - (all.length - 1) / 2) * (MINI ? 0.9 : 0.62);
      return { ...p, a, x: cx + Math.cos(a) * rx * (MINI ? 0.62 : 0.66), y: cy + Math.sin(a) * ry * (MINI ? 0.62 : 0.7), wins: wins.filter((s) => s.user === p.user) };
    });
    const pills = [];
    if (!MINI) for (const p of people) {
      const mine = p.wins.slice(0, 3);
      const side = p.x < cx - 4 ? -1 : p.x > cx + 4 ? 1 : 0;
      mine.forEach((s, j) => {
        const off = (j - (mine.length - 1) / 2);
        pills.push({ s, x: side ? p.x + side * 96 : p.x + off * 118, y: side ? p.y - 6 + off * 28 : p.y - 64, side, px: p.x, py: p.y });
      });
    }
    st.L = { w, h, cx, cy, rx, ry, engines, people, pills };
    const sig = JSON.stringify([w, h, MINI, engines.map((e) => [e.name, hot(e.name)]), people.map((p) => [p.user, p.wins.map((s) => [s.id, s.state, s.project])])]);
    if (sig === st.sig) return;
    st.sig = sig;
    $("cb-layer").innerHTML = engines.map((e) => {
      const on = hot(e.name), soon = SOON.has(e.name) && !on;
      return `<div class="cb-eng ${on ? "on" : ""} ${soon ? "soon" : ""}" style="left:${e.x}px;top:${e.y}px">${appIcon(e.name, MINI ? "sm" : "")}<b>${esc(aiOf(e.name).short)}</b>${MINI ? "" : `<small>${esc(on ? t("a trabalhar") : soon ? t("por ligar") : t("pronto"))}</small>`}</div>`;
    }).join("") + people.map((p) => {
      const busy = p.wins.filter(working).length;
      return `<div class="cb-person ${busy ? "on" : ""}" style="left:${p.x}px;top:${p.y}px">${face(p.name, MINI ? "sm" : "md")}
        <b>${esc(p.name)}</b>${MINI ? "" : `<small>${busy ? `${busy} ${esc(t("a trabalhar"))}` : p.wins.length ? `${p.wins.length} ${esc(t(p.wins.length === 1 ? "janela aberta" : "janelas abertas"))}` : esc(t("sem janelas"))}</small>`}</div>`;
    }).join("") + pills.map((q) => {
      const tone = (STATE[q.s.state] || ["", "idle"])[1];
      return `<button type="button" class="cb-win ${tone}" data-open="w${q.s.id}" style="left:${q.x}px;top:${q.y}px"><i></i><span>${esc(q.s.project || "Claude")}</span></button>`;
    }).join("");
  }
  function paintCore() {
    const busy = st.data ? busyCount() : 0;
    paint($("cb-core"), `<b>${busy || ""}</b><small>${busy ? esc(t(busy === 1 ? "IA a trabalhar" : "IAs a trabalhar")) : esc(t("à escuta"))}</small>`);
  }

  /* ---------- the stage: the black hole ---------- */
  let bg = null, disk = [], dpr = 1, lastT = 0;
  function prepare(w, h) {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    bg = document.createElement("canvas");
    bg.width = Math.round(w * dpr); bg.height = Math.round(h * dpr);
    const g = bg.getContext("2d");
    g.scale(dpr, dpr);
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.75);
    grd.addColorStop(0, "#0a1120"); grd.addColorStop(0.42, "#04060b"); grd.addColorStop(1, "#000");
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < (MINI ? 90 : 220); i++) {   // a still field of stars, drawn once
      g.fillStyle = `rgba(220,230,255,${0.06 + rnd() * 0.3})`;
      g.beginPath(); g.arc(rnd() * w, rnd() * h, rnd() * 0.8 + 0.15, 0, Math.PI * 2); g.fill();
    }
    disk = Array.from({ length: MINI ? 300 : 620 }, () => ({ r: 1.3 + Math.pow(rnd(), 1.7) * 1.6, a: rnd() * Math.PI * 2, s: 0.7 + rnd() * 0.6, z: rnd() }));
  }
  function frame(now) {
    const cv = $("cb-cv");
    if (!cv || !st.L) return;
    const { w, h, cx, cy } = st.L;
    if (!bg || cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr) || bg.width !== Math.round(w * dpr)) {
      prepare(w, h); cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    }
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.drawImage(bg, 0, 0, w, h);
    const time = (now - st.t0) / 1000;
    const busy = st.data ? busyCount() : 0;
    const core = Math.min(w, h) * (MINI ? 0.12 : 0.1);
    const spin = 0.18 + Math.min(busy, 4) * 0.08;
    const tilt = 0.26, R = core * 2.3;
    const pos = (p) => { const a = p.a + time * spin * p.s / p.r; return [a, cx + Math.cos(a) * R * p.r * 0.62, cy + Math.sin(a) * R * p.r * 0.62 * tilt]; };
    g.globalCompositeOperation = "lighter";
    // the far half of the disk and the light bent over the top of the hole
    particles(g, pos, false, busy ? 1 : 0.75);
    let grd = g.createRadialGradient(cx, cy, core * 0.95, cx, cy, core * 2.4);
    grd.addColorStop(0, `rgba(150,185,255,${busy ? 0.42 : 0.3})`); grd.addColorStop(0.3, "rgba(100,140,255,.1)"); grd.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grd; g.beginPath(); g.arc(cx, cy, core * 2.4, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = "source-over";
    g.fillStyle = "#000"; g.beginPath(); g.arc(cx, cy, core, 0, Math.PI * 2); g.fill();
    g.strokeStyle = `rgba(230,238,255,${0.8 + (busy ? Math.sin(time * 2.2) * 0.12 : 0)})`; g.lineWidth = 1.3;
    g.beginPath(); g.arc(cx, cy, core * 1.015, 0, Math.PI * 2); g.stroke();
    g.globalCompositeOperation = "lighter";
    particles(g, pos, true, 1.15);   // the near half passes in front of the hole
    // the threads: partner → hole, window → partner, window → each AI it is using now (sparks run on them)
    const L = st.L;
    const eng = Object.fromEntries(L.engines.map((e) => [e.name, e]));
    for (const p of L.people) {
      const on = p.wins.some(working);
      line(g, p.x, p.y, cx, cy, on ? "rgba(156,193,255,.26)" : "rgba(200,212,232,.06)", on ? "#9cc1ff" : null, time, 0.12);
      if (MINI) for (const s of p.wins) for (const name of ["Claude Code", ...(s.links || [])]) {
        const e = eng[name]; if (e && usesNow(s, name)) line(g, p.x, p.y, e.x, e.y, hexA(tint(name), 0.28), tint(name), time + p.x * 0.01, 0.16);
      }
    }
    for (const q of L.pills) {
      line(g, q.px, q.py, q.x, q.y, "rgba(210,220,235,.12)", null, time, 0);
      for (const name of ["Claude Code", ...(q.s.links || [])]) {
        const e = eng[name]; if (e && usesNow(q.s, name)) line(g, q.x, q.y, e.x, e.y, hexA(tint(name), 0.3), tint(name), time + q.x * 0.01, 0.16);
      }
    }
    if (eng.ChatGPT && hot("ChatGPT") && !live().some((s) => usesNow(s, "ChatGPT"))) line(g, cx, cy, eng.ChatGPT.x, eng.ChatGPT.y, hexA(tint("ChatGPT"), 0.26), tint("ChatGPT"), time, 0.1);
    g.globalCompositeOperation = "source-over";
  }
  // The disk in 8 brightness steps, one path and one fill per step (a colour per particle cost 4x the CPU).
  const STEPS = 8, buckets = Array.from({ length: STEPS }, () => []);
  function particles(g, pos, near, gain) {
    for (const b of buckets) b.length = 0;
    for (const p of disk) {
      const [a, x, y] = pos(p);
      if ((Math.sin(a) > 0) !== near) continue;
      const lum = (0.5 + 0.5 * Math.cos(a + 0.7)) * (1.25 - (p.r - 1.3) / 1.6);
      buckets[Math.max(0, Math.min(STEPS - 1, Math.floor(lum * STEPS * 0.8)))].push(x, y, 1 + p.z);
    }
    buckets.forEach((b, i) => {
      if (!b.length) return;
      const k = i / (STEPS - 1);
      g.fillStyle = `rgba(${Math.round(175 + k * 80)},${Math.round(200 + k * 55)},255,${Math.min(1, (0.08 + k * 0.62) * gain).toFixed(3)})`;
      g.beginPath();
      for (let j = 0; j < b.length; j += 3) g.rect(b[j], b[j + 1], b[j + 2], b[j + 2]);
      g.fill();
    });
  }
  function loop(now) {
    if (!$("cb")) return;
    st.raf = requestAnimationFrame(loop);
    if (document.hidden) return;
    const quiet = !st.data || !busyCount();
    if (quiet && now - lastT < 1000 / 30 - 2) return;   // 60 fps while an AI works, 30 when all is quiet
    lastT = now;
    frame(now);
  }
  function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }
  function line(g, x1, y1, x2, y2, stroke, spark, time, bend) {
    const mx = (x1 + x2) / 2 - (y2 - y1) * bend, my = (y1 + y2) / 2 + (x2 - x1) * bend;
    g.strokeStyle = stroke; g.lineWidth = 1;
    g.beginPath(); g.moveTo(x1, y1); g.quadraticCurveTo(mx, my, x2, y2); g.stroke();
    if (!spark) return;
    for (let k = 0; k < 3; k++) {
      const f = (time * 0.42 + k / 3) % 1, u = 1 - f;
      const x = u * u * x1 + 2 * u * f * mx + f * f * x2, y = u * u * y1 + 2 * u * f * my + f * f * y2;
      const grd = g.createRadialGradient(x, y, 0, x, y, 4.5);
      grd.addColorStop(0, hexA(spark, 0.95)); grd.addColorStop(1, hexA(spark, 0));
      g.fillStyle = grd; g.beginPath(); g.arc(x, y, 4.5, 0, Math.PI * 2); g.fill();
    }
  }

  /* ---------- the conversation ---------- */
  function bubble(m, i, list) {
    const prev = list[i - 1], next = list[i + 1];
    const sameAs = (a, b) => a && b && a.role === b.role && a.user === b.user && Math.abs(isoS(a.at) - isoS(b.at)) < 300;
    const first = !sameAs(prev, m), last = !sameAs(m, next);
    if (m.role === "brain") {
      const p = m.plan || {};
      const acts = m.user === st.me && m.status === "ok" && p.action && p.action !== "nenhuma" ? actions(m, p) : "";
      return `<div class="cb-msg brain ${first ? "first" : ""}">${last ? `<span class="cb-av hole"></span>` : `<span class="cb-av"></span>`}
        <div class="cb-col">${first ? `<small class="cb-who">${esc(t("Cérebro"))}${p.label ? `<em>${esc(p.label)}</em>` : ""}</small>` : ""}
          <div class="cb-bub ${m.status}">${m.status === "thinking" ? `<span class="cb-typing"><i></i><i></i><i></i></span>` : esc(m.text)}</div>
          ${m.status === "ok" ? `<div class="cb-under">${p.engines ? aiRow(p.engines.map((e) => e.name)) : ""}<button type="button" class="cb-say" data-say="${m.id}" title="${esc(t("Ouvir"))}">${svgSpeaker()}</button></div>` : ""}${acts}</div></div>`;
    }
    const mine = m.user === st.me;
    return `<div class="cb-msg ${mine ? "me" : "them"} ${first ? "first" : ""}">${mine ? "" : last ? face(m.name, "av") : `<span class="cb-av"></span>`}
      <div class="cb-col">${!mine && first ? `<small class="cb-who">${esc(m.name)}</small>` : ""}
        <div class="cb-bub">${m.via === "voz" ? `<span class="cb-vz">${svgMic()}</span>` : ""}${esc(m.text)}</div>
        ${last ? `<small class="cb-time">${esc(ago(isoS(m.at)))}</small>` : ""}</div></div>`;
  }
  function actions(m, p) {
    const main = { claude: ["claude", "Abrir no Claude Code"], chatgpt: ["chatgpt", "Perguntar ao ChatGPT"], escritorio: ["office", "Mandar para o Escritório"] }[p.action];
    const rest = [["claude", "Claude Code"], ["chatgpt", "ChatGPT"], ["both", "Os dois"], ["office", "Escritório"]].filter(([k]) => !main || k !== main[0]);
    return `<div class="cb-acts">${main ? `<button type="button" class="cb-act main" data-act="${main[0]}" data-q="${m.reply_to}">${esc(t(main[1]))}</button>` : ""}
      ${rest.map(([k, l]) => `<button type="button" class="cb-act" data-act="${k}" data-q="${m.reply_to}">${esc(t(l))}</button>`).join("")}</div>`;
  }
  function paintChat() {
    const box = $("cb-thread");
    if (!box) return;
    const near = box.scrollHeight - box.scrollTop - box.clientHeight < 90;
    paint(box, st.chat.length ? st.chat.map(bubble).join("") : `<div class="cb-hello"><span class="cb-av hole big"></span><b>${esc(t("Olá. Sou o Cérebro da AMG."))}</b>
      <p>${esc(t("Diz-me o que queres fazer e eu escolho a melhor IA para isso. Podes escrever ou carregar no microfone."))}</p></div>`);
    if (near || st.stick) { box.scrollTop = box.scrollHeight; st.stick = false; }
    for (const m of st.chat) {   // read aloud: the brain's answers to my own questions, once, when the voice is on
      if (m.role !== "brain" || m.status !== "ok" || m.user !== st.me || st.spoken.has(m.id)) continue;
      st.spoken.add(m.id);
      if (st.ready && (st.voice || st.talk)) say(m.text, () => { if (st.talk) startRec(); });
    }
    st.ready = true;
  }
  async function loadChat() {
    if (!$("cb")) return;
    try {
      const r = await api("/api/cerebro/chat");
      st.me = r.me;
      const sig = JSON.stringify(r.messages.map((m) => [m.id, m.status, m.text.length]));
      if (sig !== st.chatSig) { st.chatSig = sig; st.chat = r.messages; paintChat(); }
    } catch (e) { /* the next look tries again */ }
  }
  async function sendChat(text, via = "texto") {
    text = (text || "").trim();
    if (text.length < 2 || st.sending) return;
    st.sending = true;
    $("cb-q").value = ""; grow(); st.plan = null; paintPlan();
    const at = new Date().toISOString();
    st.chat = [...st.chat, { id: -1, role: "user", user: st.me, name: "", text, via, at, status: "ok" }, { id: -2, role: "brain", user: st.me, text: "", status: "thinking", plan: null, at }];
    st.stick = true; paintChat();
    try { await api("/api/cerebro/chat", { method: "POST", body: { text, via } }); }
    catch (e) { st.chat = st.chat.filter((m) => m.id > 0); paintChat(); note(e.message || t("Não deu para enviar")); }
    finally { st.sending = false; st.chatSig = ""; loadChat(); }
  }
  async function act(kind, qid) {
    const q = st.chat.find((m) => m.id === Number(qid));
    const a = st.chat.find((m) => m.reply_to === Number(qid) && m.role === "brain");
    if (!q) return;
    try {
      if (kind === "office") {
        const p = (a && a.plan) || {};
        await api("/api/tasks", { method: "POST", body: { title: q.text.split(/[.!?\n]/)[0].slice(0, 120), description: p.prompt || q.text, assignee: st.me, for_ai: true, crew: p.crew || "" } });
        note(t("Foi para o Escritório."));
      } else {
        const r = await api("/api/cerebro/send", { method: "POST", body: { prompt: q.text, to: kind } });
        note([r.claude && (r.claude.ok ? t("Abriu uma janela do Claude Code") : r.claude.error), r.chatgpt && (r.chatgpt.ok ? t("O ChatGPT está a pensar") : r.chatgpt.error)].filter(Boolean).join(". "));
        if (r.chatgpt && r.chatgpt.ok && !MINI) { st.tab = "gpt"; paintRight(); }
      }
      setTimeout(load, 1200);
    } catch (e) { note(e.message || t("Não deu")); }
  }
  function note(text) {
    const el = $("cb-plan");
    if (!el) return;
    el.dataset.note = "1"; el.innerHTML = `<span class="cb-note">${esc(text)}</span>`;
    clearTimeout(st.noteT); st.noteT = setTimeout(() => { if ($("cb-plan")) { delete el.dataset.note; el._html = ""; paintPlan(); } }, 6000);
  }
  let planT = 0;
  function askPlan() {   // while typing: what the brain would do with it
    clearTimeout(planT);
    const q = $("cb-q").value.trim();
    if (q.length < 4) { st.plan = null; paintPlan(); return; }
    planT = setTimeout(async () => {
      try { const p = await api("/api/cerebro/plan", { method: "POST", body: { prompt: q } }); if ($("cb-q") && $("cb-q").value.trim() === q) { st.plan = p; paintPlan(); } } catch (e) { /* only a hint */ }
    }, 300);
  }
  function paintPlan() {
    const el = $("cb-plan");
    if (!el || el.dataset.note) return;
    const p = st.plan;
    paint(el, !p || !p.kind ? "" : `<span class="cb-route">${esc(p.label)}, ${esc(t("vai para"))} ${esc(p.department)} ${esc(t("com"))}</span>${aiRow(p.engines.map((e) => e.name))}`);
  }
  function grow() { const q = $("cb-q"); if (!q) return; q.style.height = "auto"; q.style.height = `${Math.min(150, q.scrollHeight)}px`; }

  /* ---------- the voice: microphone → Whisper on this PC (free), answers read aloud ---------- */
  async function startRec() {
    if (st.rec) return;
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch (e) {
      note(navigator.mediaDevices ? t("Sem acesso ao microfone. Autoriza o browser (no Mac, o microfone funciona no Chrome).") : t("Aqui o microfone não funciona: abre o Cérebro no Chrome."));
      st.talk = false; paintToggles(); return;
    }
    const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((x) => window.MediaRecorder && MediaRecorder.isTypeSupported(x)) || "";
    const rec = new MediaRecorder(stream, type ? { mimeType: type } : {});
    const parts = [];
    rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const an = ctx.createAnalyser(); an.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(an.fftSize), bars = new Array(40).fill(0);
    const started = performance.now();
    let heard = 0, quietSince = 0;
    st.rec = { rec, stream, ctx };
    $("cb-form").classList.add("rec");
    const wave = $("cb-wave").getContext("2d");
    const tick = () => {
      if (!st.rec || st.rec.rec !== rec) return;
      an.getByteTimeDomainData(buf);
      let sum = 0; for (const v of buf) sum += ((v - 128) / 128) ** 2;
      const rms = Math.sqrt(sum / buf.length);
      bars.shift(); bars.push(Math.min(1, rms * 7));
      wave.clearRect(0, 0, 200, 26);
      wave.fillStyle = "#f2f4f7";
      bars.forEach((b, i) => { const hh = 2 + b * 22; wave.fillRect(i * 5, 13 - hh / 2, 2.4, hh); });
      const secs = (performance.now() - started) / 1000;
      $("cb-rect").textContent = `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, "0")}`;
      if (rms > 0.035) { heard++; quietSince = 0; } else if (heard > 6 && !quietSince) quietSince = performance.now();
      if (st.talk && quietSince && performance.now() - quietSince > 1400) { stopRec(); return; }   // hands-free: a pause ends the phrase
      if (secs > 120) { stopRec(); return; }
      requestAnimationFrame(tick);
    };
    rec.onstop = async () => {
      stream.getTracks().forEach((tr) => tr.stop()); ctx.close();
      $("cb-form")?.classList.remove("rec"); $("cb-form")?.classList.add("busy");
      const blob = new Blob(parts, { type: rec.mimeType || "audio/webm" });
      try {
        if (blob.size < 1500 || heard < 3) { if (st.talk) startRec(); return; }
        note(t("A transcrever…"));
        const r = await fetch("/api/cerebro/voice", { method: "POST", headers: { "Content-Type": blob.type, Authorization: `Bearer ${token}` }, body: blob });
        const j = await r.json();
        if (!r.ok) throw new Error(j.detail || "erro");
        const text = (j.text || "").trim();
        const el = $("cb-plan"); if (el) { delete el.dataset.note; el._html = ""; paintPlan(); }
        if (!text) { if (st.talk) startRec(); return; }
        if (st.talk) sendChat(text, "voz");
        else { const q = $("cb-q"); q.value = (q.value ? `${q.value} ` : "") + text; grow(); askPlan(); q.focus(); }
      } catch (e) { note(t("Não percebi. ") + (e.message || "")); }
      finally { $("cb-form")?.classList.remove("busy"); }
    };
    rec.start(250);
    requestAnimationFrame(tick);
  }
  function stopRec() { const r = st.rec; st.rec = null; if (r && r.rec.state !== "inactive") r.rec.stop(); }
  function say(text, done) {
    if (!window.speechSynthesis) { if (done) done(); return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[*_#`>]/g, ""));
    const voices = speechSynthesis.getVoices();
    const v = voices.find((x) => /pt-PT/i.test(x.lang) && /premium|enhanced|Joana|Catarina/i.test(x.name)) || voices.find((x) => /pt-PT/i.test(x.lang)) || voices.find((x) => /^pt/i.test(x.lang));
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = "pt-PT";
    u.rate = 1.05;
    u.onend = u.onerror = () => { if (done) done(); };
    speechSynthesis.speak(u);
  }
  function paintToggles() { $("cb-voz")?.classList.toggle("on", st.voice); $("cb-talk")?.classList.toggle("on", st.talk); }

  /* ---------- the small window over everything ---------- */
  async function openPip() {
    const url = `${location.origin}/?mini=1&cb=1#login=${encodeURIComponent((typeof token !== "undefined" && token) || "")}&to=/cerebro`;
    if (typeof amgNative !== "undefined" && amgNative && amgNative.openCerebro) { amgNative.openCerebro(url); return; }
    if (window.documentPictureInPicture) {   // Chrome: a window that stays over every app
      try {
        const pip = await documentPictureInPicture.requestWindow({ width: 380, height: 640 });
        pip.document.title = "Cérebro AMG";
        pip.document.body.style.cssText = "margin:0;background:#000;overflow:hidden";
        pip.document.body.innerHTML = `<iframe src="${esc(url)}" allow="microphone; autoplay" style="border:0;width:100vw;height:100vh;display:block"></iframe>`;
        return;
      } catch (e) { /* refused: a small window instead */ }
    }
    window.open(url, "amg-cerebro", "popup,width=380,height=640");
  }

  /* ---------- data ---------- */
  async function load() {
    if (!$("cb")) return;
    try { st.data = await api("/api/cerebro"); }
    catch (e) { if (!st.data && !MINI) paint($("cb-list"), ui.error(e.message)); return; }
    layout(); paintCore(); paintRight();
  }

  HUB_VIEWS.cerebro = async function () {
    $("view").innerHTML = `<div class="page cb-page">${shell()}</div>`;
    st.sig = ""; st.chatSig = ""; st.ready = false; st.spoken = new Set(); bg = null;
    paintToggles();
    const root = $("cb");
    root.addEventListener("click", (e) => {
      const seg = e.target.closest("[data-tab]");
      if (seg) { st.tab = seg.dataset.tab; paintRight(); return; }
      const a = e.target.closest("[data-act]");
      if (a) { act(a.dataset.act, a.dataset.q); return; }
      const s = e.target.closest("[data-say]");
      if (s) { const m = st.chat.find((x) => x.id === Number(s.dataset.say)); if (m) say(m.text); return; }
      if (e.target.closest("#cb-pip")) { openPip(); return; }
      const o = e.target.closest("[data-open]");
      if (o && !e.target.closest("pre") && !MINI) {
        const id = o.dataset.open;
        st.open = st.open === id && !o.classList.contains("cb-win") ? null : id;
        if (id.startsWith("w")) st.tab = "agora";
        paintRight();
        document.querySelector(`#cb-list [data-open="${id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    });
    $("cb-form").addEventListener("submit", (e) => { e.preventDefault(); sendChat($("cb-q").value); });
    $("cb-q").addEventListener("input", () => { grow(); askPlan(); });
    $("cb-q").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendChat($("cb-q").value); } });
    $("cb-mic").addEventListener("click", () => (st.rec ? stopRec() : startRec()));
    $("cb-voz").addEventListener("click", () => { st.voice = !st.voice; localStorage.setItem("cb-voz", st.voice ? "1" : "0"); if (!st.voice && window.speechSynthesis) speechSynthesis.cancel(); paintToggles(); });
    $("cb-talk").addEventListener("click", () => { st.talk = !st.talk; paintToggles(); if (st.talk) startRec(); else { stopRec(); if (window.speechSynthesis) speechSynthesis.cancel(); } });
    const keys = (e) => {
      if (!$("cb")) { document.removeEventListener("keydown", keys); return; }
      if (e.key.toLowerCase() === "m" && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) { e.preventDefault(); if (st.rec) stopRec(); else startRec(); }
    };
    document.addEventListener("keydown", keys);
    new ResizeObserver(() => { st.sig = ""; layout(); }).observe($("cb-stage"));
    if (window.speechSynthesis) speechSynthesis.getVoices();
    await Promise.all([load(), loadChat()]);
    cancelAnimationFrame(st.raf); st.raf = requestAnimationFrame(loop);
    clearInterval(st.timer); clearInterval(st.chatTimer);
    st.timer = setInterval(() => { if (!$("cb")) { clearInterval(st.timer); stopRec(); return; } if (!document.hidden) load(); }, 3000);
    st.chatTimer = setInterval(() => { if (!$("cb")) { clearInterval(st.chatTimer); return; } if (!document.hidden) loadChat(); }, 1500);
    if (!MINI) setTimeout(() => $("cb-q")?.focus({ preventScroll: true }), 60);
  };
  onLive(["office"], async () => { if ($("cb")) await load(); });
  onLive(["cerebro"], async () => { if ($("cb")) await loadChat(); });
})();
