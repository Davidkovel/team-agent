// Memecoins (04 · Trading): what the agents of this PC collect day and night about the memecoins (backend/app/memes.py,
// /api/memes). Robin reads the DEX, the Oráculo the X (Tree News), Telegram and Reddit, Lucius checks for rugs, the Batman
// (Claude, off by default) writes reports, and the Motor GMGN shows the gmgn-tracker's signals. Only watching: nothing bought.
//
// 16 nov, Marco, on the first version (one long page): «está tudo baralhado... qualquer pessoa que olha fica tipo que merda é
// esta... vai ser empresarial, tenho de mostrar aos comparsas... uma pessoa que não percebe nada de trading». So: four tabs
// (Resumo, Moedas, Redes sociais, Agentes, the NAV entry's pages), the Resumo says in one sentence what is going on, every
// coin gets a verdict in words (Forte, A ganhar força, Fraca, Ignorar, Perigo) and every term is explained in plain words.
(function () {
  let S = null, B = null, P = [], timer = 0, view = "quem", filter = "todas";
  const loc = (v, d = 0) => Number(v).toLocaleString("pt-PT", { minimumFractionDigits: d, maximumFractionDigits: d });
  const usd = (v) => (v == null ? "—" : v >= 1e9 ? `${loc(v / 1e9, 1)} mil M$` : v >= 1e6 ? `${loc(v / 1e6, 1)} M$` : v >= 1e3 ? `${loc(v / 1e3, 0)} mil $` : `${loc(v, 0)} $`);
  const price = (v) => (v == null ? "—" : v >= 1 ? `${loc(v, 2)} $` : v > 0 ? `${Number(v).toPrecision(3)} $` : "0 $");
  const pct = (v) => (v == null ? `<span class="mc-dim">—</span>` : `<span class="${v > 0 ? "mc-up" : v < 0 ? "mc-dn" : ""}">${v > 0 ? "+" : ""}${loc(v, Math.abs(v) < 10 ? 1 : 0)}%</span>`);
  const ago = (ts) => { if (!ts) return t("nunca"); const s = Date.now() / 1000 - ts; return s < 60 ? t("agora mesmo") : s < 3600 ? t("há {n} min", { n: Math.round(s / 60) }) : s < 86400 ? t("há {n} h", { n: Math.round(s / 3600) }) : t("há {n} dias", { n: Math.round(s / 86400) }); };
  const age = (h) => (h == null ? "—" : h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} dias`);
  const sym = (v) => String(v || "?").replace(/^\$+/, "");
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");
  const NET = { x: "X", telegram: "Telegram", youtube: "YouTube", tiktok: "TikTok", instagram: "Instagram", reddit: "Reddit" };
  const LINK = { x: (h) => `https://x.com/${h}`, telegram: (h) => `https://t.me/${h}`, youtube: (h) => `https://youtube.com/@${h}`, tiktok: (h) => `https://tiktok.com/@${h}`, instagram: (h) => `https://instagram.com/${h}`, reddit: (h) => `https://reddit.com/user/${h}` };

  // the verdict of a coin, in words anybody reads: [word, tone, what it means]
  function verdict(x) {
    if (x.danger || (x.flags || []).some((f) => f[0] === "bad")) return ["Perigo", "bad", t("Há um risco grave (ver «Atenção»). Não mexer.")];
    if (x.score >= 75) return ["Forte", "ok", t("Está a subir, fala-se dela e parece segura.")];
    if (x.score >= 55) return ["A ganhar força", "warn", t("Tem sinais bons, mas ainda não chega para «Forte».")];
    if (x.score >= 35) return ["Fraca", "", t("Pouca coisa a favor dela.")];
    return ["Ignorar", "mute", t("Quase nada a favor dela.")];
  }
  const pill = (x) => { const v = verdict(x); return `<span class="mc-v ${v[1]}"><b>${x.score}</b>${esc(t(v[0]))}</span>`; };
  const logo = (x) => (x.image ? `<img src="${esc(x.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<i class="mc-noimg">${esc(sym(x.symbol)[0])}</i>`);

  const VIEWS = { memes: "quem", "meme-calls": "calls", "meme-moedas": "moedas", "meme-agentes": "agentes" };
  for (const [id, v] of Object.entries(VIEWS)) HUB_VIEWS[id] = () => open(v);

  const HEAD = {
    quem: ["Quem acerta", "Para cada call de um influencer, vemos se a moeda subiu ou desceu nas 24 horas seguintes."],
    calls: ["Calls", "Cada moeda que os nossos influencers mandaram, e o que aconteceu a seguir."],
    moedas: ["Moedas", "As moedas que os agentes estão a seguir, da mais forte para a mais fraca."],
    agentes: ["Agentes", "Quem faz o trabalho, o que fez da última vez e as regras que segue."],
  };

  async function open(v) {
    view = v;
    if (holeFull && $("mc-hole")) $("mc-hole").remove();
    holeFull = false; portal = "";
    document.documentElement.classList.remove("mc-holefull");
    const [title, sub] = HEAD[v];
    page(`<div class="mc mc-${v}" id="mc">
      ${ui.head("Trading", t(title), t(sub), `<div class="mc-ctl" id="mc-ctl"></div>`)}
      <div class="mc-msg" id="mc-msg" hidden></div>
      <div id="mc-body">${ui.skeleton(4)}</div>
    </div>`);
    bind();
    await load(true).catch((e) => paint($("mc-body"), ui.error(e.message)));
    clearInterval(timer);
    timer = setInterval(() => { if (!$("mc")) { clearInterval(timer); return; } if (!document.hidden) load().catch(() => {}); }, 20000);
  }

  async function load(first) {
    [S, B, P] = await Promise.all([api("/api/memes/state"), view === "quem" || view === "calls" ? api("/api/memes/board") : Promise.resolve(B),
      view === "quem" ? api("/api/plans").catch(() => []) : Promise.resolve(P)]);
    paintCtl();
    const typing = $("mc-body").querySelector("input:focus, textarea:focus, select:focus, details[open]");
    if (first || !typing) ({ quem, calls: callsView, moedas, agentes })[view]();
  }

  function msg(text) {
    const el = $("mc-msg"); if (!el) return;
    el.hidden = false; el.textContent = text;
    clearTimeout(msg.t); msg.t = setTimeout(() => { el.hidden = true; }, 6000);
  }

  const lastRun = () => Math.max(0, ...S.agents.filter((a) => a.id !== "batman").map((a) => a.at || 0));

  function paintCtl() {
    const busy = S.agents.find((a) => a.busy);
    const chip = !S.cfg.on ? `<span class="st off"><i></i>${esc(t("Agentes desligados"))}</span>`
      : busy ? `<span class="st busy"><i></i>${esc(t("{a} a trabalhar", { a: busy.name }))}</span>`
      : `<span class="st ok"><i></i>${esc(t("A vigiar · {h}", { h: ago(lastRun()) }))}</span>`;
    paint($("mc-ctl"), `${chip}${view === "agentes" ? `<button type="button" class="btn quiet" data-act="toggle">${esc(S.cfg.on ? t("Desligar os agentes") : t("Ligar os agentes"))}</button>` : ""}
      <button type="button" class="btn primary" data-act="run" data-agent="all">${esc(t("Atualizar agora"))}</button>`);
  }

  function state(a) {
    if (a.id === "batman" && !S.cfg.claude) return ["off", t("Desligado")];
    if (a.id === "gmgn" && !(S.gmgn && S.gmgn.ok)) return ["off", t("Por ligar")];
    if (a.id === "leitor" && !S.ler.on) return ["off", t("Desligado")];
    if (a.busy) return ["busy", t("A trabalhar")];
    if (!a.at) return ["off", t("Ainda não correu")];
    return a.ok ? ["ok", ago(a.at)] : ["bad", t("Falhou {h}", { h: ago(a.at) })];
  }

  /* ---------------------------------------------------------------- Quem acerta */
  // 16 nov, Marco (3.ª volta): «depois das calls que os gajos mandam, uma análise a cada dia, se eram positivos ou negativos,
  // para ver se vale a pena seguir... encontrar os melhores influencers... muita gente tem de perceber, empresários». So the
  // first page is one question, «quem acerta?»: a ranking where each influencer is one line with one big number, «se tivesses
  // posto 100 $ em cada call», and a click opens his day by day and his calls. Few words, big figures (backend/app/memes_calls.py).
  const PLAT = { x: "X", telegram: "Telegram", youtube: "YouTube", tiktok: "TikTok", instagram: "Instagram", reddit: "Reddit" };
  const face = (i, big) => i.avatar ? `<img class="mc-face ${big ? "big" : ""}" src="${esc(i.avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : `<i class="mc-face ${big ? "big" : ""}">${esc((i.name || i.handle || i.who || "?").replace(/^@/, "")[0].toUpperCase())}</i>`;
  const usdSig = (v) => `<span class="${v > 0 ? "mc-up" : v < 0 ? "mc-dn" : ""}">${v > 0 ? "+" : v < 0 ? "−" : ""}${loc(Math.abs(v), 0)} $</span>`;
  const day = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("pt-PT", { weekday: "short", day: "2-digit", month: "short" });
  const when = (ts) => new Date(ts * 1000).toLocaleString("pt-PT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  let openInf = "", callWho = "";



  // 16 nov, Marco (6.ª volta): «quero que seja um buraco negro... o pet do widget, o Farol, nesse buraco negro... quando
  // maximizar tenho o buraco negro enorme e acesso a tudo: clicar na aba do Twitter, do Reddit, do Telegram e ver os calls
  // todos... um buraco negro cheio de coisas, cheio de robôs». So the top of the page is a black hole (canvas: chrome and
  // ice-blue, the colours of the Farol and of the AMG black) with the six agents as Farols (the widget's pet, its three poses
  // from widget/team_widget/assets, copied to frontend/assets/farol; the eyes drawn on top as in ui/pet.py) around it, the
  // influencers on an inner ring falling in, and a dock of portals (X, Telegram, Reddit, Calls, Moedas, Influencers,
  // Relatórios) that open a glass drawer. «Maximizar» makes it the whole screen. Built once; a refresh only repaints the Farols
  // and the counts, so an open drawer and the full screen stay. The hole turns and pulls particles in only while an agent works
  // or while it is maximised; otherwise it is one still frame.
  const FAROL_EYES = { idle: [[121, 102, 138, 117], [158, 101, 175, 117]], think: [[164, 89, 177, 100], [202, 77, 214, 89]],
    work: [[115, 130, 127, 143], [151, 136, 163, 150]] };   // ui/pet.py EYES, in the 293 × 320 pose images
  const ORBIT = { oraculo: -154, leitor: -103, robin: -51, lucius: 0, arbitro: 51, batman: 103, gmgn: 154 };
  const JOB = { oraculo: "Apanha o X, o Telegram e o Reddit", leitor: "Lê, vê e ouve o que os influencers dizem", robin: "Vê as bolsas de memecoins", lucius: "Vê se as moedas são seguras",
    arbitro: "Julga os calls", batman: "Escreve relatórios com o Claude", gmgn: "Liga ao tracker do David e do Kovel" };
  const PORTAL_OF = { oraculo: "redes", leitor: "leitura", robin: "moedas", lucius: "perigo", arbitro: "calls", batman: "relatorios", gmgn: "gmgn" };
  const live = (a) => a.busy || (a.ok && a.at && Date.now() / 1000 - a.at < 150);
  const look = (a) => state(a)[0] === "off" ? "off" : a.ok === false ? "bad" : a.busy ? "work" : live(a) ? "think" : "idle";
  const short = (s) => String(s || "").split(/[;,(]/)[0].trim();
  let portal = "", holeFull = false;

  function hole() {
    if (!$("mc-hole")) {
      $("mc-hole-w").innerHTML = `<section class="mc-hole" id="mc-hole">
        <canvas class="mc-hole-c" id="mc-hole-c" aria-hidden="true"></canvas>
        <div class="mc-hole-top"><span><b>${esc(t("O buraco negro"))}</b><small id="mc-hole-st"></small></span>
          <span class="mc-hole-btns"><button type="button" class="btn sm" data-act="aovivo">${icon("bolt")}${esc(t("Ao vivo"))}</button><button type="button" class="btn sm" data-act="full">${esc(t("Maximizar"))}</button></span></div>
        <div class="mc-orbit" id="mc-orbit"></div>
        <nav class="mc-dock" id="mc-dock"></nav>
        <aside class="mc-drawer" id="mc-drawer" hidden></aside>
      </section><div id="mc-planbar"></div>`;
      $("mc-hole").addEventListener("click", holeClick);
      holeSize();
      if ("ResizeObserver" in window) new ResizeObserver(() => { holeSize(); drawHole(performance.now() / 1000); }).observe($("mc-hole"));
    }
    paintOrbit();
    paintDock();
    if (portal) paintDrawer();
    paint($("mc-planbar"), planbar());
    holeRun();
  }

  function planbar() {
    const p = (P || []).find((x) => /^Memecoins/i.test(x.title) && x.status !== "done");
    const cur = p ? p.steps.findIndex((s) => !s.done) : -1;
    return p && cur >= 0 ? `<a class="panel mc-planbar" href="#/escritorio"><span class="mc-sub">${esc(t("O plano"))}</span>
      <b>${esc(t("Passo {n} de {m}", { n: cur + 1, m: p.steps.length }))}: ${esc(p.steps[cur].text.split(":")[0])}</b>
      <span class="mc-planbar-p">${p.steps.map((s, i) => `<i class="${s.done ? "pb-done" : i === cur ? "pb-now" : ""}"></i>`).join("")}</span><span class="mc-more">${esc(t("Ver o plano"))} ›</span></a>` : "";
  }

  function farol(a) {
    const lk = look(a), pose = lk === "work" ? "work" : lk === "think" ? "think" : "idle";
    const eyes = FAROL_EYES[pose].map(([x0, y0, x1, y1]) => `<i class="mc-eye" style="left:${(x0 / 2.93).toFixed(1)}%;top:${(y0 / 3.2).toFixed(1)}%;width:${((x1 - x0) / 2.93).toFixed(1)}%;height:${((y1 - y0) / 3.2).toFixed(1)}%"></i>`).join("");
    const word = lk === "work" ? t("a trabalhar…") : lk === "off" ? (a.id === "batman" ? t("a dormir") : t("por ligar")) : lk === "bad" ? t("teve um erro") : cap(short(a.note)) || t("atento");
    return `<span class="mc-farol"><img src="assets/farol/farol-${pose}.png" alt="" draggable="false">${eyes}</span><b>${esc(a.name)}</b><small>${esc(word)}</small>`;
  }

  function paintOrbit() {
    const pets = B.agents.filter((a) => a.id in ORBIT).map((a) => {
      const deg = ORBIT[a.id], x = 50 + 41 * Math.cos(deg * Math.PI / 180), y = 50 + 34 * Math.sin(deg * Math.PI / 180);
      const k = 0.82 + 0.3 * ((y - 16) / 68);   // nearer (lower) is bigger
      return `<button type="button" class="mc-pet lk-${look(a)} ${portal === PORTAL_OF[a.id] ? "on" : ""}" data-portal="${PORTAL_OF[a.id]}" title="${esc(t(JOB[a.id]))}${a.note ? " · " + esc(a.note) : ""}"
        style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;--k:${k.toFixed(2)};z-index:${Math.round(y)}">${farol(a)}</button>`;
    }).join("");
    const infs = S.influencers.map((i, n, all) => {
      const deg = -90 + (360 / Math.max(1, all.length)) * n + 18, x = 50 + 19 * Math.cos(deg * Math.PI / 180), y = 50 + 13 * Math.sin(deg * Math.PI / 180);
      return `<button type="button" class="mc-star" data-portal="inf:${esc(i.platform)}/${esc(i.handle)}" style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%" title="${esc(i.name || "@" + i.handle)}">${face(i)}</button>`;
    }).join("");
    paint($("mc-orbit"), infs + pets);
    const st = $("mc-hole-st"), busy = B.agents.filter((a) => a.busy).map((a) => a.name);
    if (st) st.textContent = busy.length ? t("{a} a trabalhar", { a: busy.join(", ") }) : t("{n} moedas · {p} publicações · {c} calls lá dentro", { n: S.n_tokens, p: S.posts.length, c: B.calls.length });
  }

  const DOCK = [["leitura", "O que dizem"], ["x", "X"], ["telegram", "Telegram"], ["reddit", "Reddit"], ["calls", "Calls"], ["moedas", "Moedas"], ["infs", "Influencers"], ["relatorios", "Relatórios"]];
  const bySrc = (src) => S.posts.filter((p) => p.src.toLowerCase() === src);
  function count(k) {
    return { leitura: S.inf_posts.filter((p) => p.read).length, x: bySrc("x").length, telegram: bySrc("telegram").length, reddit: bySrc("reddit").length, calls: B.calls.length, moedas: S.n_tokens,
      infs: S.influencers.length, relatorios: S.reports.length }[k];
  }
  function paintDock() {
    paint($("mc-dock"), DOCK.map(([k, l]) => `<button type="button" class="${portal === k ? "on" : ""}" data-portal="${k}"><b>${esc(t(l))}</b><small>${count(k) ?? 0}</small></button>`).join(""));
  }

  function paintDrawer() {
    const d = $("mc-drawer");
    if (!portal) { d.hidden = true; d._html = ""; d.innerHTML = ""; return; }
    d.hidden = false;
    const head = (title, sub = "") => `<header><div><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</div><button type="button" class="btn sm quiet" data-portal="" aria-label="${esc(t("Fechar"))}">${icon("x")}</button></header>`;
    const posts = (l, empty) => l.length ? `<div class="mc-dr-l">${l.sort((a, b) => b.t - a.t).slice(0, 40).map(post).join("")}</div>` : `<p class="mc-dim mc-dr-e">${esc(empty)}</p>`;
    let html;
    if (portal === "x") html = head("X (Twitter)", S.x.on ? t("contas dos influencers e do Tree News") : t("sem chave: só o que o Tree News passa")) + posts(bySrc("x"), t("Ainda nada do X."));
    else if (portal === "telegram") html = head("Telegram", t("{n} canais", { n: S.cfg.telegram.length + S.influencers.filter((i) => i.platform === "telegram").length })) + posts(bySrc("telegram"), t("Ainda nada do Telegram."));
    else if (portal === "reddit") html = head("Reddit", S.cfg.reddit.map((r) => "r/" + r).join(" · ")) + posts(bySrc("reddit"), t("Ainda nada do Reddit."));
    else if (portal === "leitura") {
      const L = S.ler, l = S.inf_posts.filter((p) => p.read && SAYF[sayf][1](p.read.tipo));
      html = head(t("O que os influencers dizem"), L.ears ? t("lido, visto nas imagens e ouvido nos vídeos pelo Leitor") : t("lido e visto nas imagens pelo Leitor"))
        + `<div class="mc-dr-pad mc-sayf">${Object.entries(SAYF).map(([k, [lb]]) => `<button type="button" class="${k === sayf ? "on" : ""}" data-sayf="${k}">${esc(t(lb))}</button>`).join("")}</div>`
        + (l.length ? `<div class="mc-dr-l">${l.slice(0, 40).map(said).join("")}</div>`
          : `<p class="mc-dim mc-dr-e">${esc(!L.on ? t("O Leitor está desligado (Agentes).") : L.left ? t("O Leitor está a ler {n} publicações.", { n: L.left }) : t("Nada deste tipo nas últimas 48 horas."))}</p>`);
    }
    else if (portal === "redes") html = head(t("Tudo o que o Oráculo leu"), t("X, Telegram e Reddit")) + posts([...S.posts], t("Ainda nada."));
    else if (portal === "calls") html = head(t("Calls"), t("o resultado 24 h depois")) + (B.calls.length ? `<div class="mc-dr-l">${B.calls.slice(0, 40).map((x) => `<div class="mc-dr-call">${face(x)}<span><b>${esc(x.name)}</b><small>${esc(when(x.t))}</small></span>${mini(x)}</div>`).join("")}</div>` : `<p class="mc-dim mc-dr-e">${esc(t("Ainda sem calls."))}</p>`) + `<a class="mc-more mc-dr-more" href="#/meme-calls">${esc(t("Abrir a página dos calls"))} ›</a>`;
    else if (portal === "moedas" || portal === "perigo") {
      const l = S.tokens.filter((x) => (portal === "perigo") === (verdict(x)[0] === "Perigo")).slice(0, 30);
      html = head(portal === "perigo" ? t("Moedas com perigo") : t("Moedas"), portal === "perigo" ? t("o Lucius pô-las de fora") : t("da mais forte para a mais fraca"))
        + (l.length ? `<div class="mc-dr-l">${l.map((x) => `<button type="button" class="mc-dr-coin" data-key="${esc(x.key)}">${logo(x)}<span><b>$${esc(sym(x.symbol))}</b><small>${esc((x.why || [])[0] || (x.flags || [[0, ""]])[0][1] || x.name || "")}</small></span>${pill(x)}</button>`).join("")}</div>` : `<p class="mc-dim mc-dr-e">${esc(t("Nenhuma."))}</p>`);
    }
    else if (portal === "infs") html = head(t("Influencers"), t("quem acerta, do melhor para o pior")) + `<div class="mc-dr-l">${B.ranking.map((r) => `<button type="button" class="mc-dr-coin" data-portal="inf:${esc(r.platform)}/${esc(r.handle)}">${face(r)}<span><b>${esc(r.name || "@" + r.handle)}</b><small>${esc(PLAT[r.platform] || r.platform)} · ${esc(t("{n} calls", { n: r.calls }))}</small></span><span class="mc-v ${r.tone}">${esc(t(r.verdict))}</span></button>`).join("")}</div>`;
    else if (portal === "relatorios") html = head(t("Relatórios do Batman")) + `<div class="mc-dr-pad">${reports()}</div>`;
    else if (portal === "gmgn") html = head("Motor GMGN", "gmgn-tracker") + `<div class="mc-dr-pad">${gmgn()}</div>`;
    else if (portal.startsWith("inf:")) {
      const [pl, h] = portal.slice(4).split("/"), r = B.ranking.find((x) => x.platform === pl && x.handle === h) || { platform: pl, handle: h, days: [], calls: 0 };
      const mine = S.posts.filter((p) => (p.platform || p.src.toLowerCase()) === pl && p.who.toLowerCase() === h.toLowerCase());
      html = head(r.name || "@" + h, `${PLAT[pl] || pl} · ${r.verdict ? t(r.verdict) : ""}`)
        + `<div class="mc-dr-pad">${r.judged ? `<p class="mc-dr-big">${usdSig(r.usd)}<small>${esc(t("100 $ em cada call · {u} subiram, {d} desceram", { u: r.up, d: r.down }))}</small></p>` : ""}
           ${B.calls.filter((x) => x.platform === pl && x.who.toLowerCase() === h.toLowerCase()).slice(0, 10).map(mini).join("") || `<p class="mc-dim">${esc(t("Ainda sem calls."))}</p>`}</div>`
        + (mine.length ? `<p class="mc-sub mc-dr-pad">${esc(t("O que publicou"))}</p>` + `<div class="mc-dr-l">${mine.sort((a, b) => b.t - a.t).slice(0, 30).map((p) => p.read ? said({ ...p, name: r.name || p.who, avatar: r.avatar }) : post(p)).join("")}</div>` : "");
    }
    paint(d, `<div class="mc-dr-in">${html || ""}</div>`);
  }

  /* the black hole itself */
  let holeRaf = 0, holeAt = 0, stars = null;
  function holeSize() {
    const c = $("mc-hole-c"); if (!c) return;
    const r = c.getBoundingClientRect(), dpr = Math.min(1.5, window.devicePixelRatio || 1);
    c.width = Math.max(10, Math.round(r.width * dpr)); c.height = Math.max(10, Math.round(r.height * dpr));
    stars = null;
  }
  function drawHole(time) {
    const c = $("mc-hole-c"); if (!c) return;
    const g = c.getContext("2d"), W = c.width, H = c.height, cx = W / 2, cy = H * 0.5, R = Math.min(W, H) * (holeFull ? 0.13 : 0.12);
    if (!stars) {   // the starfield, once per size
      stars = document.createElement("canvas"); stars.width = W; stars.height = H;
      const s = stars.getContext("2d"); let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < (W * H) / 2600; i++) { s.fillStyle = `rgba(220,232,255,${0.15 + rnd() * 0.55})`; const z = rnd() < 0.08 ? 1.6 : 0.9; s.fillRect(rnd() * W, rnd() * H, z, z); }
    }
    g.clearRect(0, 0, W, H);
    g.drawImage(stars, 0, 0);
    const halo = g.createRadialGradient(cx, cy, R, cx, cy, R * 5);
    halo.addColorStop(0, "rgba(127,212,255,.16)"); halo.addColorStop(0.4, "rgba(127,212,255,.04)"); halo.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = halo; g.fillRect(0, 0, W, H);
    const tilt = 0.24, spin = time * 0.35;
    const disk = (front) => {   // the accretion disk, ring by ring, brighter on the side coming towards us
      for (let k = 0; k < 26; k++) {
        const f = k / 25, r = R * (1.35 + f * 2.4), seg = 64;
        for (let i = 0; i < seg; i++) {
          const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1.15) / seg) * Math.PI * 2, mid = (a0 + a1) / 2;
          if ((Math.sin(mid) > 0) !== front) continue;
          const doppler = 0.55 + 0.45 * Math.cos(mid + 0.4), streak = 0.6 + 0.4 * Math.sin(mid * 3 + spin * (3 - f * 2) + k);
          const al = (1 - f) ** 1.6 * doppler * streak * 0.55;
          if (al < 0.01) continue;
          g.strokeStyle = f < 0.25 ? `rgba(255,255,255,${al})` : `rgba(${Math.round(190 - f * 60)},${Math.round(225 - f * 40)},255,${al})`;
          g.lineWidth = R * 0.07 * (1 - f * 0.5);
          g.beginPath(); g.ellipse(cx, cy, r, r * tilt, 0, a0, a1); g.stroke();
        }
      }
    };
    g.globalCompositeOperation = "lighter";
    disk(false);
    // the lensed image of the far side of the disk, bent over the top of the hole
    for (let k = 0; k < 10; k++) {
      const r = R * (1.08 + k * 0.05), al = 0.22 * (1 - k / 10);
      g.strokeStyle = `rgba(220,240,255,${al})`; g.lineWidth = R * 0.05;
      g.beginPath(); g.ellipse(cx, cy, r, r * 0.92, 0, Math.PI * 1.02, Math.PI * 1.98); g.stroke();
    }
    g.globalCompositeOperation = "source-over";
    g.fillStyle = "#000"; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();   // the event horizon
    g.globalCompositeOperation = "lighter";
    g.strokeStyle = "rgba(235,248,255,.85)"; g.lineWidth = Math.max(1, R * 0.025); g.shadowColor = "rgba(127,212,255,.9)"; g.shadowBlur = R * 0.25;
    g.beginPath(); g.arc(cx, cy, R * 1.03, 0, Math.PI * 2); g.stroke();   // the photon ring
    g.shadowBlur = 0;
    disk(true);
    // information falling in: from each working Farol, a spiral of sparks
    const busy = B ? B.agents.filter((a) => a.busy && a.id in ORBIT) : [];
    const src = (busy.length ? busy : holeFull ? B.agents.filter((a) => a.id in ORBIT && live(a)) : []).map((a) => ORBIT[a.id] * Math.PI / 180);
    src.forEach((a0, n) => {
      for (let i = 0; i < 14; i++) {
        const f = ((time * 0.45 + i / 14 + n * 0.37) % 1), r = (1 - f) * Math.min(W * 0.41, H * 0.6) + f * R, a = a0 + f * 2.2;
        g.fillStyle = `rgba(200,236,255,${0.85 * (1 - f) + 0.1})`;
        g.beginPath(); g.arc(cx + r * Math.cos(a), cy + r * Math.sin(a) * 0.82, Math.max(1, R * 0.03 * (1 - f * 0.6)), 0, Math.PI * 2); g.fill();
      }
    });
    g.globalCompositeOperation = "source-over";
  }
  function holeRun() {
    drawHole(performance.now() / 1000);
    cancelAnimationFrame(holeRaf);
    const loop = (now) => {
      if (!$("mc-hole") || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const moving = holeFull || B.agents.some((a) => a.busy);
      if (!moving) return;   // still: one frame is enough
      if (!document.hidden && now - holeAt > 100) { holeAt = now; drawHole(now / 1000); }
      holeRaf = requestAnimationFrame(loop);
    };
    holeRaf = requestAnimationFrame(loop);
  }
  // the hole's own clicks: it leaves the page for the whole screen (on <body>, out of the page's animated box), so the page's
  // listener cannot see them then; the page's listener skips anything inside it
  async function holeClick(e) {
    const pt = e.target.closest("[data-portal]");
    if (pt) { portal = portal === pt.dataset.portal ? "" : pt.dataset.portal; paintDock(); paintOrbit(); paintDrawer(); return; }
    const sf = e.target.closest("[data-sayf]");
    if (sf) { sayf = sf.dataset.sayf; paintDrawer(); return; }
    if (e.target.closest("[data-act=full]")) return setFull(!holeFull);
    if (e.target.closest("[data-act=aovivo]")) return window.aoVivo && window.aoVivo.open();   // hub/aovivo.js: the floating window
    const k = e.target.closest("[data-key]");
    if (k) return openToken(k.dataset.key);
  }
  function setFull(on) {
    holeFull = on;
    const h = $("mc-hole");
    if (on) document.body.appendChild(h); else if ($("mc-hole-w")) $("mc-hole-w").prepend(h); else h.remove();
    h.classList.toggle("full", on);
    h.style.removeProperty("background");   // vidro.js may have made it see-through while it was the size of the screen
    document.documentElement.classList.toggle("mc-holefull", on);
    const b = $("mc-hole").querySelector("[data-act=full]"); if (b) b.textContent = on ? t("Sair") : t("Maximizar");
    requestAnimationFrame(() => { holeSize(); holeRun(); });
  }
  window.addEventListener("hashchange", () => { if (holeFull && $("mc-hole")) setFull(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && holeFull && $("mc-hole")) { if (portal) { portal = ""; paintDock(); paintOrbit(); paintDrawer(); } else setFull(false); } });

  function quem() {
    const R = B.ranking.filter((r) => r.calls || true), lead = R.find((r) => r.judged >= 5 && r.usd > 0);
    const judged = R.reduce((a, r) => a + r.judged, 0);
    if (!$("mc-hole-w")) $("mc-body").innerHTML = `<div id="mc-hole-w"></div><div id="mc-rest"></div>`;
    hole();
    paint($("mc-rest"), `
      ${lead ? `<section class="panel mc-lead-c">
          <span class="mc-lead-k">${esc(t("O melhor a seguir agora"))}</span>
          <div class="mc-lead-w">${face(lead, true)}<div><b>${esc(lead.name || "@" + lead.handle)}</b><small>${esc(PLAT[lead.platform] || lead.platform)}</small></div></div>
          <div class="mc-lead-n">${usdSig(lead.usd)}<small>${esc(t("se tivesses posto 100 $ em cada call"))}</small></div>
          <div class="mc-lead-n"><b>${lead.up}<i>/${lead.judged}</i></b><small>${esc(t("calls subiram"))}</small></div>
        </section>`
      : `<section class="panel pad mc-wait"><b>${esc(t("Ainda a juntar calls"))}</b><p>${esc(t("Um influencer entra no ranking a sério com 5 calls julgados. Cada call é julgado 24 horas depois. Já julgámos {n}.", { n: judged }))}</p></section>`}
      ${ui.sec("Ranking", `<button type="button" class="mc-more" data-act="add-inf">+ ${esc(t("Juntar influencer"))}</button>`)}
      <form class="panel pad mc-add" id="mc-inf-f" hidden>
        <select name="platform" aria-label="${esc(t("Rede"))}">${Object.entries(PLAT).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}</select>
        <input name="handle" placeholder="${esc(t("Link do perfil ou @"))}" required>
        <input name="note" placeholder="${esc(t("Nota (opcional)"))}">
        <button class="btn primary">${esc(t("Juntar"))}</button>
      </form>
      <section class="panel mc-rank">
        <div class="mc-rank-h"><span></span><span>${esc(t("Influencer"))}</span><span>${esc(t("Veredicto"))}</span><span class="mc-hide">${esc(t("Últimos calls"))}</span><span class="r">${esc(t("100 $ em cada call"))}</span></div>
        ${R.map((r, n) => row(r, n)).join("")}
      </section>
      <p class="mc-foot">${esc(t("Como contamos: compra ao preço da hora do call, venda 24 horas depois, sem taxas. Ninguém comprou nada: é só para comparar quem acerta."))}</p>`);
  }

  function row(r, n) {
    const k = `${r.platform}/${r.handle}`, open = openInf === k;
    return `<div class="mc-rank-r ${open ? "open" : ""}">
      <button type="button" class="mc-rank-l" data-inf="${esc(k)}">
        <span class="mc-pos">${r.judged >= 5 ? n + 1 : "–"}</span>
        <span class="mc-who">${face(r)}<span><b>${esc(r.name || "@" + r.handle)}</b><small>${esc(PLAT[r.platform] || r.platform)} · ${esc(r.calls ? (r.calls === 1 ? t("1 call") : t("{n} calls", { n: r.calls })) : r.platform === "telegram" ? t("sem calls ainda") : t("não se lê de graça"))}</small></span></span>
        <span><span class="mc-v ${r.tone}">${esc(t(r.verdict))}</span></span>
        <span class="mc-dots mc-hide">${r.last10.length ? r.last10.map((d) => `<i class="${d > 0 ? "up" : "dn"}"></i>`).join("") : `<small class="mc-dim">—</small>`}</span>
        <span class="r mc-big">${r.judged ? usdSig(r.usd) : `<span class="mc-dim">—</span>`}<small>${esc(r.judged ? t("{u} subiram · {d} desceram", { u: r.up, d: r.down }) : r.open ? t("{n} à espera de 24 h", { n: r.open }) : "")}</small></span>
      </button>
      ${open ? detail(r) : ""}
    </div>`;
  }

  function detail(r) {
    const mine = B.calls.filter((x) => x.platform === r.platform && x.who.toLowerCase() === r.handle.toLowerCase()).slice(0, 8);
    return `<div class="mc-rank-d">
      <div><p class="mc-sub">${esc(t("Dia a dia"))}</p>${r.days.length ? `<table class="mc-t mc-days"><thead><tr><th>${esc(t("Dia"))}</th><th class="r">${esc(t("Calls"))}</th><th class="r">${esc(t("Subiram"))}</th><th class="r">${esc(t("Resultado"))}</th></tr></thead>
        <tbody>${r.days.map((d) => `<tr><td>${esc(day(d.day))}</td><td class="r mc-num">${d.n}</td><td class="r mc-num">${d.up} / ${d.n}</td><td class="r mc-num">${usdSig(d.usd)}</td></tr>`).join("")}</tbody></table>`
        : `<p class="mc-dim">${esc(t("Ainda nenhum call julgado."))}</p>`}</div>
      <div><p class="mc-sub">${esc(t("Últimos calls"))}</p>${mine.length ? mine.map(mini).join("") : `<p class="mc-dim">${esc(t("Sem calls ainda."))}</p>`}
        ${r.calls > mine.length ? `<a class="mc-more" href="#/meme-calls" data-callwho="${esc(r.handle.toLowerCase())}">${esc(t("Ver todos os calls"))} ›</a>` : ""}</div>
      <div class="mc-rank-x"><button type="button" class="btn sm quiet" data-del="${esc(r.platform)}/${esc(r.handle)}">${esc(t("Deixar de seguir"))}</button></div>
    </div>`;
  }

  const res = (x) => x.r24 != null ? `<span class="mc-res ${x.r24 > 0 ? "up" : "dn"}">${x.r24 > 0 ? "+" : ""}${loc(x.r24, Math.abs(x.r24) < 10 ? 1 : 0)}%</span>`
    : x.now != null ? `<span class="mc-res run">${esc(t("a decorrer"))} · ${x.now > 0 ? "+" : ""}${loc(x.now, 0)}%</span>`
    : `<span class="mc-res run">${esc(x.err ? t("sem preço") : t("a ver o preço"))}</span>`;
  const coinL = (c) => `${c.image ? `<img src="${esc(c.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<i class="mc-noimg">${esc(sym(c.symbol)[0])}</i>`}`;
  const mini = (x) => `<a class="mc-mini" href="${esc(x.url)}" target="_blank" rel="noopener">${coinL(x.coin)}<b>$${esc(sym(x.coin.symbol))}</b><small>${esc(when(x.t))}</small>${res(x)}</a>`;

  /* ---------------------------------------------------------------- Calls */
  function callsView() {
    const who = [...new Map(B.calls.map((x) => [x.who.toLowerCase(), x.name])).entries()];
    const l = B.calls.filter((x) => !callWho || x.who.toLowerCase() === callWho);
    paint($("mc-body"), `
      <div class="mc-bar"><div class="segx"><button type="button" data-cw="" class="${callWho ? "" : "on"}">${esc(t("Todos"))}</button>${who.map(([k, n]) => `<button type="button" data-cw="${esc(k)}" class="${k === callWho ? "on" : ""}">${esc(n)}</button>`).join("")}</div>
        <small class="mc-dim">${esc(t("{n} calls · o mais recente primeiro", { n: l.length }))}</small></div>
      <section class="panel mc-list">${l.length ? `<div class="mc-tw"><table class="mc-t mc-calls">
        <thead><tr><th>${esc(t("Quem"))}</th><th>${esc(t("Moeda"))}</th><th class="mc-hide">${esc(t("Quando"))}</th><th class="r">${esc(t("24 h depois"))}</th><th class="r mc-hide">${esc(t("Melhor momento"))}</th><th class="r mc-hide">${esc(t("Pior momento"))}</th></tr></thead>
        <tbody>${l.slice(0, 80).map((x) => `<tr data-key="${esc(x.coin.key)}">
          <td><div class="mc-coin">${face(x)}<div><b>${esc(x.name)}</b><small>${esc(when(x.t))}</small></div></div></td>
          <td><div class="mc-coin">${coinL(x.coin)}<div><b>$${esc(sym(x.coin.symbol))}</b><small>${esc(x.how === "contrato" ? t("pelo contrato") : t("pelo nome"))}</small></div></div></td>
          <td class="mc-hide mc-dim">${esc(ago(x.t))}</td>
          <td class="r">${res(x)}</td>
          <td class="r mc-num mc-hide">${x.peak != null ? `<span class="mc-up">+${loc(x.peak, 0)}%</span>` : "—"}</td>
          <td class="r mc-num mc-hide">${x.low != null ? `<span class="mc-dn">${loc(x.low, 0)}%</span>` : "—"}</td></tr>`).join("")}</tbody></table></div>`
        : ui.empty("eye", "Ainda sem calls", t("O Alfred procura os calls dos influencers de 5 em 5 minutos, também nas publicações dos últimos 30 dias."))}</section>
      <p class="mc-foot">${esc(t("«24 h depois» = quanto a moeda mexeu do preço na hora do call até 24 horas depois. «Pelo nome» = o influencer só escreveu o $NOME: escolhemos a moeda com esse nome que já existia e tinha mais dinheiro."))}</p>`);
  }

  /* ---------------------------------------------------------------- Moedas */
  const FILTERS = [["todas", "Todas"], ["boas", "Fortes e a ganhar força"], ["novas", "Nascidas hoje"], ["faladas", "Fala-se delas"], ["seguidas", "As que seguimos"], ["perigo", "Perigo"]];
  function rows() {
    const l = S.tokens, w = (x) => verdict(x)[0];
    if (filter === "boas") return l.filter((x) => ["Forte", "A ganhar força"].includes(w(x)));
    if (filter === "novas") return l.filter((x) => x.age_h != null && x.age_h < 24 && w(x) !== "Perigo");
    if (filter === "faladas") return l.filter((x) => x.n6);
    if (filter === "seguidas") return l.filter((x) => x.watched);
    if (filter === "perigo") return l.filter((x) => w(x) === "Perigo");
    return l;
  }

  function moedas() {
    const all = rows(), l = all.slice(0, 40);
    paint($("mc-body"), `<div class="mc-bar"><div class="segx">${FILTERS.map(([k, lb]) => `<button type="button" data-filt="${k}" class="${k === filter ? "on" : ""}">${esc(t(lb))}</button>`).join("")}</div>
        <small class="mc-dim">${esc(t("{n} moedas · clica numa para ver tudo", { n: all.length }))}</small></div>
      <section class="panel mc-list">${!l.length ? ui.empty("search", "Nenhuma moeda aqui", t("Experimenta outro filtro.")) : `<div class="mc-tw"><table class="mc-t">
        <thead><tr><th>${esc(t("Moeda"))}</th><th>${esc(t("Veredicto"))}</th><th class="r">${esc(t("Última hora"))}</th><th class="r mc-hide">${esc(t("Último dia"))}</th>
          <th class="r">${esc(t("Na pool"))}</th><th class="r mc-hide">${esc(t("Tamanho"))}</th><th class="r mc-hide">${esc(t("Idade"))}</th><th class="r mc-hide">${esc(t("Fala-se"))}</th></tr></thead>
        <tbody>${l.map((x) => `<tr data-key="${esc(x.key)}">
          <td><div class="mc-coin">${logo(x)}<div><b>$${esc(sym(x.symbol))}${x.watched ? ` <span class="mc-star">★</span>` : ""}</b><small>${esc(x.name || "")} · ${esc(x.chain_name)}</small></div></div></td>
          <td>${pill(x)}</td><td class="r mc-num">${pct(x.ch1)}</td><td class="r mc-num mc-hide">${pct(x.ch24)}</td>
          <td class="r mc-num">${usd(x.liq)}</td><td class="r mc-num mc-hide">${usd(x.mcap)}</td><td class="r mc-num mc-hide">${age(x.age_h)}</td>
          <td class="r mc-num mc-hide">${x.people6 ? esc(t("{n} contas", { n: x.people6 })) : `<span class="mc-dim">—</span>`}</td></tr>`).join("")}</tbody></table></div>`}</section>
      <p class="mc-foot">${esc(t("Na pool = quanto dinheiro há para comprar e vender. Tamanho = quanto vale a moeda toda. Quando o tamanho é muitas vezes maior do que a pool, um vendedor grande derruba o preço."))}</p>`);
  }

  // 17 nov, Marco: «tens mesmo que ler o que está escrito, ouvir o que eles dizem nos vídeos... super organizado». What the
  // Leitor (backend/app/memes_ler.py) read in each influencer post: the kind in one coloured word, one plain sentence, the
  // coins, how sure he sounds, entry/target/stop when he said them, his strongest line, and what he said in the video.
  const TIPO = { compra: ["Manda comprar", "ok"], venda: ["Manda vender", "bad"], aviso: ["Avisa de perigo", "bad"],
    resultado: ["Mostra lucro antigo", "warn"], noticia: ["Notícia", ""], conversa: ["Conversa", "mute"] };
  const SAYF = { tudo: ["Tudo", (k) => k !== "conversa"], compra: ["Mandam comprar", (k) => k === "compra"],
    perigo: ["Avisos e vendas", (k) => k === "aviso" || k === "venda"], resultado: ["Mostram lucro", (k) => k === "resultado"], conversa: ["Conversa", (k) => k === "conversa"] };
  let sayf = "tudo";
  const tipo = (k) => { const v = TIPO[k] || TIPO.conversa; return `<span class="mc-v ${v[1]} mc-tipo">${esc(t(v[0]))}</span>`; };
  const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  function said(p) {
    const r = p.read, h = p.heard, has = p.has || [];
    const plan = [["Entrada", r.entrada], ["Alvo", r.alvo], ["Stop", r.stop]].filter((x) => x[1]);
    return `<article class="mc-said">
      <header>${face(p)}<span><b>${esc(p.name || "@" + p.who)}</b><small>${esc(PLAT[p.platform] || p.src)} · ${esc(ago(p.t))}${has.includes("video") ? " · " + esc(t("vídeo")) : has.includes("voice") ? " · " + esc(t("áudio")) : ""}${has.includes("photos") ? " · " + esc(t("imagem")) : ""}</small></span>${tipo(r.tipo)}</header>
      <p class="mc-said-r">${esc(r.resumo || t("Sem nada para dizer."))}</p>
      ${(r.moedas || []).length || r.conviccao ? `<div class="mc-said-m">${(r.moedas || []).map((c) => `<span class="mc-sdc">${c.symbol ? "$" + esc(c.symbol) : esc(c.address.slice(0, 4) + "…" + c.address.slice(-4))}</span>`).join("")}
        ${r.conviccao ? `<span class="mc-conv" title="${esc(t("Quão convencido parece, de 0 a 5"))}">${esc(t("Certeza"))} ${[1, 2, 3, 4, 5].map((n) => `<i class="${n <= r.conviccao ? "on" : ""}"></i>`).join("")}</span>` : ""}</div>` : ""}
      ${plan.length ? `<div class="mc-said-p">${plan.map(([k, v]) => `<span><small>${esc(t(k))}</small>${esc(v)}</span>`).join("")}</div>` : ""}
      ${r.citacao ? `<blockquote>«${esc(r.citacao)}»</blockquote>` : ""}
      ${h && h.text ? `<details class="mc-said-h"><summary>${esc(t("O que disse no vídeo"))}${h.dur ? " · " + mmss(h.dur) : ""}</summary><p>${esc(h.text)}</p></details>` : h && h.note ? `<p class="mc-dim mc-said-n">${esc(h.note)}</p>` : ""}
      <a class="mc-more" href="${esc(p.url)}" target="_blank" rel="noopener">${esc(t("Abrir a publicação"))} ›</a>
    </article>`;
  }

  // the posts that named a coin, inside the coin's window
  const post = (p) => `<a class="mc-post ${p.inf ? "is-inf" : ""}" href="${esc(p.url)}" target="_blank" rel="noopener">
    <header><span class="mc-src">${esc(p.src)}</span><b>@${esc(p.who)}</b>${p.inf ? ui.tag(t("Influencer"), "ok") : ""}<time>${esc(ago(p.t))}</time></header>
    ${p.read ? `<div class="mc-post-r">${tipo(p.read.tipo)}<span>${esc(p.read.resumo)}</span></div>` : ""}
    ${p.text ? `<p>${esc(p.text)}</p>` : ""}${p.tickers.length ? `<div class="mc-tags">${p.tickers.map((k) => `<span>$${esc(k)}</span>`).join("")}</div>` : ""}</a>`;

  /* ---------------------------------------------------------------- Agentes */
  function agentes() {
    const cl = S.cfg.claude;
    paint($("mc-body"), `
      <div class="mc-agents">${S.agents.map((a) => {
        const st = state(a);
        const extra = a.id === "batman"
          ? `<div class="mc-ag-act"><button type="button" class="btn sm ${cl ? "" : "primary"}" data-act="claude">${esc(cl ? t("Desligar") : t("Ligar o Batman"))}</button>
             ${cl ? `<button type="button" class="btn sm quiet" data-act="run" data-agent="batman">${esc(t("Escrever relatório agora"))}</button>` : ""}
             <small>${esc(S.claude.installed ? t("{n} de {c} relatórios hoje · usa o Claude deste PC", { n: S.claude.today, c: S.cfg.cap }) : t("O Claude Code não está instalado neste PC"))}</small></div>`
          : a.id === "leitor" ? `<div class="mc-ag-act"><button type="button" class="btn sm ${S.ler.on ? "" : "primary"}" data-act="ler">${esc(S.ler.on ? t("Desligar") : t("Ligar o Leitor"))}</button>
             <small>${esc(t("{n} de {c} leituras hoje · usa o Claude deste PC", { n: S.ler.today, c: S.ler.cap }))} · ${esc(S.ler.ears ? t("{n} vídeos ouvidos", { n: S.ler.heard }) : t("sem ouvidos neste PC (falta o faster-whisper)"))}</small></div>`
          : a.id === "gmgn" && !(S.gmgn && S.gmgn.ok) ? `<div class="mc-ag-act"><small>${esc(t("Por ligar: ver «Motor GMGN» mais abaixo."))}</small></div>` : "";
        return `<article class="panel mc-ag ${a.busy ? "is-busy" : ""}">
          <header><span class="mc-mono">${esc(a.code)}</span><div><b>${esc(t(a.dept))}</b><small>${esc(a.name)}</small></div><span class="st ${st[0]}"><i></i>${esc(st[1])}</span></header>
          <p>${esc(t(a.does))}</p>${a.note && st[0] !== "off" ? `<p class="mc-note">${esc(t("Da última vez: {n}", { n: a.note }))}</p>` : ""}${extra}</article>`;
      }).join("")}</div>
      ${ui.sec("Relatórios do Batman")}<section class="panel pad">${reports()}</section>
      ${ui.sec("Motor GMGN", `<small class="mc-dim">gmgn-tracker</small>`)}<section class="panel pad">${gmgn()}</section>
      ${ui.sec("Regras", `<small class="mc-dim">${esc(t("guardam-se sozinhas"))}</small>`)}<section class="panel pad">${rules()}</section>`);
  }

  function reports() {
    const r = S.reports, VER = { ver: ["Ver de perto", "ok"], cedo: ["Ainda cedo", "warn"], evitar: ["Evitar", "bad"] };
    if (!r.length) return ui.empty("spark", S.cfg.claude ? "O Batman ainda não escreveu" : "O Batman está desligado",
      S.cfg.claude ? t("Escreve de {m} em {m} minutos, no máximo {c} por dia.", { m: S.cfg.every_min, c: S.cfg.cap })
        : t("Ligado, lê as melhores moedas e o que se diz delas, procura na web o que os influencers disseram e dá um veredicto em português."),
      S.cfg.claude ? `<button type="button" class="btn primary" data-act="run" data-agent="batman">${esc(t("Escrever relatório agora"))}</button>` : `<button type="button" class="btn primary" data-act="claude">${esc(t("Ligar o Batman"))}</button>`);
    return r.slice(0, 3).map((x, i) => `<article class="mc-rep ${i ? "old" : ""}">
      <header><b>${esc(new Date(x.t * 1000).toLocaleString("pt-PT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }))}</b></header>
      <p>${esc(x.resumo || "")}</p>
      ${(x.destaques || []).length ? `<div class="mc-dest">${x.destaques.map((d) => `<div><header><b>$${esc(sym(d.symbol))}</b>${ui.tag(t((VER[d.veredicto] || [d.veredicto || "?"])[0]), (VER[d.veredicto] || [])[1] || "")}</header><p>${esc(d.porque || "")}</p>${d.risco ? `<small>${esc(t("Risco"))}: ${esc(d.risco)}</small>` : ""}</div>`).join("")}</div>` : ""}
      ${(x.influencers || []).length ? `<ul class="mc-said">${x.influencers.map((d) => `<li><b>@${esc(d.handle)}</b> ${esc(d.disse || "")}${d.moeda ? ` <span>$${esc(sym(d.moeda))}</span>` : ""}</li>`).join("")}</ul>` : ""}
    </article>`).join("");
  }

  function gmgn() {
    const g = S.gmgn, c = S.cfg;
    if (!g || !g.ok) {
      return `<p class="mc-lead">${esc(t("O gmgn-tracker do David e do Kovel apanha todas as moedas novas da pump.fun e testa cada estratégia com dinheiro a fingir (100 $ por sinal), para saber quais ganham. Corre no servidor deles."))}</p>
        <p class="mc-dim">${esc(g && g.error && !g.setup ? t("Erro ao ligar: {e}", { e: g.error }) : t("Ainda não está ligado a este Hub."))}</p>
        <details class="mc-det"><summary>${esc(t("Como ligar (para o David ou o Kovel)"))}</summary>
          <p>${esc(t("No servidor, ao lado do gmgn.db, correr uma vez: python3 gmgn_link.py serve --db gmgn.db --port 8787 --key <segredo>. O ficheiro está em team-agent/backend/app/gmgn_link.py e só lê, nunca escreve."))}</p>
          <form class="mc-g-f" id="mc-g-f">
            <label>${esc(t("Endereço"))}<input name="gmgn_url" value="${esc(c.gmgn_url || "")}" placeholder="http://servidor:8787"></label>
            <label>${esc(t("Chave"))}<input name="gmgn_key" type="password" placeholder="${esc(c.gmgn_key ? t("guardada") : "")}"></label>
            <label>${esc(t("Ou o gmgn.db neste PC"))}<input name="gmgn_db" value="${esc(c.gmgn_db || "")}" placeholder="~/.team-agent/gmgn-tracker/gmgn.db"></label>
            <button class="btn primary">${esc(t("Ligar"))}</button>
          </form></details>`;
    }
    const tiers = (g.tiers || []).filter((x) => x.paper_n);
    return `<div class="mc-g-kp">
        <div><small>${esc(t("Moedas apanhadas"))}</small><b>${loc(g.tokens)}</b><span>${esc(t("{n} nas últimas 24 h", { n: loc(g.new24) }))}</span></div>
        <div><small>${esc(t("Dinheiro a fingir · {d} dias", { d: g.days }))}</small><b class="${g.paper.usd >= 0 ? "mc-up" : "mc-dn"}">${g.paper.usd >= 0 ? "+" : ""}${loc(g.paper.usd)} $</b><span>${esc(t("{n} trades de 100 $, {w} ganhas", { n: g.paper.n, w: g.paper.wins }))}</span></div>
        <div><small>${esc(t("Ligação"))}</small><b>${esc(g.via === "local" ? t("Neste PC") : t("Servidor"))}</b><span>${esc(ago(g.at))}</span></div>
      </div>
      ${tiers.length ? `<div class="mc-tw"><table class="mc-t mc-g-t"><thead><tr><th>${esc(t("Estratégia"))}</th><th class="r">${esc(t("Trades"))}</th><th class="r">${esc(t("Resultado"))}</th><th>${esc(t("Ganha de forma estável?"))}</th></tr></thead><tbody>
        ${tiers.map((x) => `<tr><td>${esc(x.name)}</td><td class="r mc-num">${x.paper_n}</td><td class="r mc-num"><span class="${x.paper_usd >= 0 ? "mc-up" : "mc-dn"}">${x.paper_usd >= 0 ? "+" : ""}${loc(x.paper_usd)} $</span></td>
          <td>${x.both_halves ? ui.tag(t("Sim"), "ok") : ui.tag(t("Ainda não"), "warn")}</td></tr>`).join("")}</tbody></table></div>
        <p class="mc-foot">${esc(t("«Ganha de forma estável» = ganhou na 1.ª metade do período e também na 2.ª. Uma estratégia que só ganhou numa metade pode ter sido sorte."))}</p>` : ""}`;
  }

  function rules() {
    const c = S.cfg;
    return `<form class="mc-cfg" id="mc-cfg-f">
      <label>${esc(t("Avisar quando a nota passa"))}<input name="alert_score" type="number" min="40" max="100" value="${c.alert_score}"><small>${esc(t("o aviso chega ao widget e ao telemóvel"))}</small></label>
      <label>${esc(t("Dinheiro mínimo na pool ($)"))}<input name="min_liq" type="number" min="0" step="1000" value="${c.min_liq}"><small>${esc(t("abaixo disto a moeda leva «Perigo»"))}</small></label>
      <label>${esc(t("Batman: um relatório a cada (minutos)"))}<input name="every_min" type="number" min="20" max="1440" value="${c.every_min}"></label>
      <label>${esc(t("Batman: máximo por dia"))}<input name="cap" type="number" min="1" max="40" value="${c.cap}"></label>
      <label class="mc-chk"><input type="checkbox" name="alerts" ${c.alerts ? "checked" : ""}>${esc(t("Mandar avisos"))}</label>
      <div class="mc-wide mc-xkey"><b>${esc(t("X (Twitter)"))}</b>
        <p>${esc(S.x.on ? t("Ligado: lê as contas do X dos nossos influencers de {m} em {m} minutos. Já leu {n} tweets (≈ {u} $).", { m: c.x_every, n: S.x.tweets, u: loc(S.x.usd, 2) })
          : t("Para ler as contas do X: cria conta em twitterapi.io, põe 5 $ de crédito, copia a «API Key» e cola aqui. Custa cerca de 0,15 $ por cada 1000 tweets lidos."))}</p>
        <div class="mc-xkey-f"><input id="mc-xkey" type="password" autocomplete="off" placeholder="${esc(S.x.on ? t("chave guardada · cola outra para trocar") : t("cola aqui a API Key"))}">
          <button type="button" class="btn sm primary" data-act="xkey">${esc(t("Guardar"))}</button>${S.x.on ? `<button type="button" class="btn sm quiet" data-act="xoff">${esc(t("Tirar a chave"))}</button>` : ""}</div></div>
      <details class="mc-det mc-wide"><summary>${esc(t("Fontes avançadas: canais do Telegram, comunidades do Reddit, modelo do Claude"))}</summary>
        <div class="mc-cfg-adv">
          <label>${esc(t("Canais do Telegram (públicos)"))}<textarea name="telegram" rows="3">${esc(c.telegram.join(", "))}</textarea></label>
          <label>${esc(t("Comunidades do Reddit"))}<textarea name="reddit" rows="3">${esc(c.reddit.join(", "))}</textarea></label>
          <label>${esc(t("Modelo do Batman"))}<select name="model">${["haiku", "sonnet", "opus"].map((m) => `<option ${m === c.model ? "selected" : ""}>${m}</option>`).join("")}</select><small>${esc(t("haiku gasta menos, opus pensa melhor"))}</small></label>
        </div></details>
    </form>`;
  }

  /* ---------------------------------------------------------------- one coin */
  async function openToken(key) {
    openModal(`<div class="mc-md">${ui.skeleton(4)}</div>`);
    let x;
    try { x = await api(`/api/memes/token?key=${encodeURIComponent(key)}`); } catch (e) { return paint(document.querySelector(".mc-md"), ui.error(e.message)); }
    const P = x.parts || {}, v = verdict(x);
    const links = [["Gráfico (DexScreener)", x.url], ["GMGN", x.chain === "solana" ? `https://gmgn.ai/sol/token/${x.address}` : null], ["RugCheck", x.chain === "solana" ? `https://rugcheck.xyz/tokens/${x.address}` : null],
      ["X da moeda", x.twitter], ["Telegram da moeda", x.telegram], ["Site", x.website], ["O que se diz no X", `https://x.com/search?q=${encodeURIComponent("$" + sym(x.symbol))}&f=live`]].filter((l) => l[1]);
    const el = document.querySelector(".mc-md"); if (!el) return;
    const warns = [...(x.flags || []).map((f) => [f[0], cap(f[1])]), ...(x.rug ? x.rug.risks.filter((r) => r.level !== "danger").map((r) => ["warn", `RugCheck: ${r.name}`]) : [])];
    paint(el, `<header class="mc-md-h">${logo(x)}<div><h2>$${esc(sym(x.symbol))}</h2><small>${esc(x.name || "")} · ${esc(x.chain_name)}</small></div><button class="btn quiet sm" data-close aria-label="${esc(t("Fechar"))}">${icon("x")}</button></header>
      <div class="mc-md-v ${v[1]}"><span class="mc-v ${v[1]}"><b>${x.score}</b>${esc(t(v[0]))}</span><p>${esc(v[2])}</p></div>
      <div class="mc-md-parts">${[["Está a subir?", P.momento, 35], ["Fala-se dela?", P.social, 40], ["Parece segura?", P.seguranca, 25]].map(([l, val, m]) => `<div><small>${esc(t(l))}</small><b>${val ?? "—"}<i> ${esc(t("de {m}", { m }))}</i></b>${ui.progress(((val || 0) / m) * 100)}</div>`).join("")}</div>
      ${(x.why || []).length || warns.length ? `<div class="mc-md-why">
        ${(x.why || []).length ? `<div><p class="mc-sub">${esc(t("A favor"))}</p><ul>${x.why.map((w) => `<li>${esc(cap(w))}</li>`).join("")}</ul></div>` : ""}
        ${warns.length ? `<div><p class="mc-sub">${esc(t("Atenção"))}</p><ul>${warns.map((w) => `<li class="${w[0]}">${esc(w[1])}</li>`).join("")}</ul></div>` : ""}</div>` : ""}
      <div class="mc-md-g">
        <div><small>${esc(t("Preço"))}</small><b>${price(x.price)}</b></div>
        <div><small>${esc(t("Última hora · último dia"))}</small><b>${pct(x.ch1)} · ${pct(x.ch24)}</b></div>
        <div><small>${esc(t("Dinheiro na pool"))}</small><b>${usd(x.liq)}</b></div>
        <div><small>${esc(t("Tamanho da moeda"))}</small><b>${usd(x.mcap)}</b></div>
        <div><small>${esc(t("Negócios na última hora"))}</small><b>${x.buys1 ?? "—"} ${esc(t("compras"))} · ${x.sells1 ?? "—"} ${esc(t("vendas"))}</b></div>
        <div><small>${esc(t("Idade"))}</small><b>${age(x.age_h)}</b></div>
      </div>
      <div class="mc-md-links">${links.map(([l, u]) => `<a class="btn sm" href="${esc(u)}" target="_blank" rel="noopener">${esc(t(l))}</a>`).join("")}
        <button type="button" class="btn sm" data-copy="${esc(x.address)}">${esc(t("Copiar o contrato"))}</button>
        <button type="button" class="btn sm ${x.watched ? "" : "primary"}" data-watch="${esc(x.key)}">${esc(x.watched ? t("Deixar de seguir") : t("Seguir esta moeda"))}</button></div>
      <p class="mc-sub">${esc(t("O que se disse dela · 48 h"))}</p>
      ${(x.mentions || []).length ? `<div class="mc-md-feed">${x.mentions.map(post).join("")}</div>` : `<p class="mc-dim">${esc(t("Ninguém nas nossas fontes falou dela ainda."))}</p>`}
      <p class="mc-foot">${esc(t("Memecoins são de altíssimo risco e a maioria vai a zero. Isto é informação para decidir, não um conselho para comprar."))}</p>`);
    el.onclick = async (e) => {
      const c = e.target.closest("[data-copy]"), w = e.target.closest("[data-watch]");
      if (c) navigator.clipboard.writeText(c.dataset.copy).then(() => { c.textContent = t("Copiado"); });
      if (w) { await api("/api/memes/watch", { method: "POST", body: { key: w.dataset.watch } }); closeModal(); load(); }
    };
  }

  const list = (v) => v.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);

  function bind() {
    const root = $("mc");
    root.addEventListener("click", async (e) => {
      if (e.target.closest("#mc-hole") || e.target.closest("#mc-live")) return;   // the hole and Ao vivo answer their own clicks
      const inf = e.target.closest("[data-inf]");
      if (inf) { openInf = openInf === inf.dataset.inf ? "" : inf.dataset.inf; return quem(); }
      const cw = e.target.closest("[data-cw]");
      if (cw) { callWho = cw.dataset.cw; return callsView(); }
      const cwl = e.target.closest("[data-callwho]");
      if (cwl) { callWho = cwl.dataset.callwho; return; }   // the link opens Calls with this influencer
      const add = e.target.closest("[data-act=add-inf]");
      if (add) { const f = $("mc-inf-f"); f.hidden = !f.hidden; if (!f.hidden) f.handle.focus(); return; }
      const g = e.target.closest("[data-goto]");
      if (g) { filter = g.dataset.goto; return; }   // the link itself opens Moedas with that filter
      const k = e.target.closest("[data-key]");
      if (k) return openToken(k.dataset.key);
      const f = e.target.closest("[data-filt]");
      if (f) { filter = f.dataset.filt; return moedas(); }
      const d = e.target.closest("[data-del]");
      if (d) { const [p, h] = d.dataset.del.split("/"); if (!confirm(t("Deixar de seguir @{h}?", { h }))) return; await api(`/api/memes/influencers/${encodeURIComponent(p)}/${encodeURIComponent(h)}`, { method: "DELETE" }); openInf = ""; return load(true); }
      const b = e.target.closest("[data-act]");
      if (!b) return;
      b.disabled = true;
      try {
        if (b.dataset.act === "xkey" || b.dataset.act === "xoff") {
          const v = b.dataset.act === "xoff" ? "" : $("mc-xkey").value.trim();
          if (b.dataset.act === "xkey" && v.length < 10) throw new Error(t("Cola a chave inteira."));
          await api("/api/memes/cfg", { method: "POST", body: { x_key: v } });
          msg(v ? t("Chave guardada. O Oráculo lê o X na próxima volta (até 5 minutos).") : t("Chave tirada."));
          await load(true);
        }
        if (b.dataset.act === "toggle") { S.cfg = (await api("/api/memes/cfg", { method: "POST", body: { on: !S.cfg.on } })).cfg; paintCtl(); }
        if (b.dataset.act === "ler") { S.cfg = (await api("/api/memes/cfg", { method: "POST", body: { ler: !S.ler.on } })).cfg; S.ler.on = S.cfg.ler; agentes(); }
        if (b.dataset.act === "claude") { S.cfg = (await api("/api/memes/cfg", { method: "POST", body: { claude: !S.cfg.claude } })).cfg; agentes(); }
        if (b.dataset.act === "run") {
          const r = await api("/api/memes/run", { method: "POST", body: { agent: b.dataset.agent } });
          msg(r.busy ? t("Os agentes já estão a meio de uma volta: os números chegam daqui a pouco.") : b.dataset.agent === "batman" ? t("O Batman foi pesquisar: o relatório chega em 2 a 5 minutos.") : t("Os agentes foram ver: os números chegam em cerca de 30 segundos."));
          setTimeout(() => load(true).catch(() => {}), b.dataset.agent === "batman" ? 90000 : 30000);
        }
      } catch (err) { msg(err.message); } finally { b.disabled = false; }
    });
    root.addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target;
      try {
        if (f.id === "mc-inf-f") {
          await api("/api/memes/influencers", { method: "POST", body: { platform: f.platform.value, handle: f.handle.value, note: f.note.value } });
          await load(true); msg(t("Juntado. O Alfred vai buscar os calls dele dos últimos 30 dias (uns minutos)."));
        }
        if (f.id === "mc-g-f") {
          const body = { gmgn_url: f.gmgn_url.value.trim(), gmgn_db: f.gmgn_db.value.trim() };
          if (f.gmgn_key.value) body.gmgn_key = f.gmgn_key.value;
          S.cfg = (await api("/api/memes/cfg", { method: "POST", body })).cfg;
          msg(t("A ligar ao gmgn-tracker...")); setTimeout(() => load(true).catch(() => {}), 4000);
        }
      } catch (err) { msg(err.message); }
    });
    root.addEventListener("change", async (e) => {
      const f = e.target.closest("#mc-cfg-f");
      if (!f) return;
      const body = { telegram: list(f.telegram.value), reddit: list(f.reddit.value), alert_score: +f.alert_score.value, min_liq: +f.min_liq.value,
        every_min: +f.every_min.value, cap: +f.cap.value, model: f.model.value, alerts: f.alerts.checked };
      try { S.cfg = (await api("/api/memes/cfg", { method: "POST", body })).cfg; msg(t("Guardado.")); }
      catch (err) { msg(err.message); agentes(); }
    });
  }
})();
