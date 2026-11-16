// Memecoins (#/memes, the first entry of 04 · Trading): what the agents of this PC collect day and night about the
// memecoins (backend/app/memes.py, /api/memes). Robin reads the DEX, the Oráculo the X (Tree News), Telegram and Reddit,
// Lucius checks for rugs, the Batman (Claude, off by default) writes reports, and the Motor GMGN shows the gmgn-tracker's
// signals and paper trades. 16 nov, Marco: «o maior cérebro de memecoins... até a dormir». Only watching: nothing is bought.
// Layout per docs/hub-paginas.md: head with state, figures, the agents, the radar, what is said, influencers, Batman, GMGN.
(function () {
  let S = null, timer = 0, filter = "todas", feedSrc = "todas";
  const loc = (v, d = 0) => Number(v).toLocaleString("pt-PT", { minimumFractionDigits: d, maximumFractionDigits: d });
  const usd = (v) => (v == null ? "—" : v >= 1e9 ? `$${loc(v / 1e9, 2)}B` : v >= 1e6 ? `$${loc(v / 1e6, 2)}M` : v >= 1e3 ? `$${loc(v / 1e3, 1)}K` : `$${loc(v, 0)}`);
  const price = (v) => (v == null ? "—" : v >= 1 ? `$${loc(v, 3)}` : v > 0 ? `$${Number(v).toPrecision(3)}` : "$0");
  const pct = (v) => (v == null ? `<span class="mc-dim">—</span>` : `<span class="${v > 0 ? "mc-up" : v < 0 ? "mc-dn" : ""}">${v > 0 ? "+" : ""}${loc(v, Math.abs(v) < 10 ? 1 : 0)}%</span>`);
  const ago = (ts) => { if (!ts) return t("nunca"); const s = Date.now() / 1000 - ts; return s < 60 ? t("agora") : s < 3600 ? t("há {n} min", { n: Math.round(s / 60) }) : s < 86400 ? t("há {n} h", { n: Math.round(s / 3600) }) : t("há {n} d", { n: Math.round(s / 86400) }); };
  const age = (h) => (h == null ? "—" : h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} d`);
  const grade = (s) => (s >= 75 ? "hi" : s >= 55 ? "mid" : "lo");
  const sym = (v) => String(v || "?").replace(/^\$+/, "");   // Claude sometimes writes the $ already
  const NET = { x: "X", telegram: "Telegram", youtube: "YouTube", tiktok: "TikTok", instagram: "Instagram", reddit: "Reddit" };
  const LINK = { x: (h) => `https://x.com/${h}`, telegram: (h) => `https://t.me/${h}`, youtube: (h) => `https://youtube.com/@${h}`, tiktok: (h) => `https://tiktok.com/@${h}`, instagram: (h) => `https://instagram.com/${h}`, reddit: (h) => `https://reddit.com/user/${h}` };

  HUB_VIEWS.memes = async function () {
    page(`<div class="mc" id="mc">
      ${ui.head("Trading", t("Memecoins"), t("Os agentes vigiam as DEX, o X, o Telegram e o Reddit dia e noite e juntam tudo aqui. Por agora só vigiam: não compram nada."), `<div class="mc-ctl" id="mc-ctl"></div>`)}
      <div class="mc-msg" id="mc-msg" hidden></div>
      <div id="mc-kpis">${ui.skeleton(2)}</div>
      ${ui.sec("Os agentes", `<small class="mc-sr">${esc(t("correm neste PC, mesmo com a página fechada"))}</small>`)}
      <div class="mc-agents" id="mc-agents"></div>
      <div id="mc-radar-h"></div>
      <section class="panel mc-radar" id="mc-radar"></section>
      <div class="mc-grid">
        <div>${ui.sec("O que se diz", `<div class="segx mc-fs" id="mc-fs"></div>`)}<section class="panel mc-feed" id="mc-feed"></section></div>
        <div>
          ${ui.sec("Mais falados · 6 h")}<section class="panel pad" id="mc-tick"></section>
          ${ui.sec("Influencers", `<small class="mc-sr">${esc(t("pesam três vezes"))}</small>`)}<section class="panel pad" id="mc-inf"></section>
        </div>
      </div>
      ${ui.sec("Relatórios do Batman")}<section class="panel pad" id="mc-rep"></section>
      ${ui.sec("Motor GMGN", `<small class="mc-sr">gmgn-tracker</small>`)}<section class="panel pad" id="mc-gmgn"></section>
      ${ui.sec("Fontes e regras", `<small class="mc-sr">${esc(t("guardam-se sozinhas"))}</small>`)}<section class="panel pad" id="mc-cfg"></section>
    </div>`);
    bind();
    await load().catch((e) => paint($("mc-kpis"), ui.error(e.message)));
    clearInterval(timer);
    timer = setInterval(() => { if (!$("mc")) { clearInterval(timer); return; } if (!document.hidden) load().catch(() => {}); }, 20000);
  };

  async function load() {
    S = await api("/api/memes/state");
    paintCtl(); paintKpis(); paintAgents(); paintRadar(); paintFeed(); paintTick(); paintInf(); paintRep(); paintGmgn();
    if (!$("mc-cfg")._html) paintCfg();
  }

  function msg(text) {
    const el = $("mc-msg"); if (!el) return;
    el.hidden = false; el.textContent = text;
    clearTimeout(msg.t); msg.t = setTimeout(() => { el.hidden = true; }, 6000);
  }

  function paintCtl() {
    const on = S.cfg.on, busy = S.agents.find((a) => a.busy);
    const chip = !on ? `<span class="st off"><i></i>${esc(t("Desligado"))}</span>`
      : busy ? `<span class="st busy"><i></i>${esc(t("{a} a trabalhar", { a: busy.name }))}</span>`
      : `<span class="st ok"><i></i>${esc(t("A vigiar"))}</span>`;
    paint($("mc-ctl"), `${chip}
      <button type="button" class="btn quiet" data-act="toggle">${esc(on ? t("Desligar") : t("Ligar"))}</button>
      <button type="button" class="btn primary" data-act="run" data-agent="all">${icon("bolt")}${esc(t("Recolher agora"))}</button>`);
  }

  function paintKpis() {
    const best = S.tokens[0], strong = S.tokens.filter((x) => x.score >= 60 && !x.danger).length;
    const n6 = S.hours.slice(-6).reduce((a, b) => a + b, 0), prev6 = S.hours.slice(-12, -6).reduce((a, b) => a + b, 0);
    const today = S.alerts.filter((a) => Date.now() / 1000 - a.t < 86400).length;
    paint($("mc-kpis"), ui.kpis([
      ui.kpi({ label: t("Moedas seguidas"), value: S.n_tokens ? String(S.n_tokens) : null, sub: S.n_tokens ? t("{n} com nota 60 ou mais e sem perigo", { n: strong }) : t("O Robin ainda não passou.") }),
      ui.kpi({ label: t("Menções nas últimas 6 h"), value: S.posts.length ? String(n6) : null, delta: prev6 ? ui.delta(n6, prev6) : "",
        viz: S.hours.some(Boolean) ? ui.cols(S.hours) : "", sub: t("por hora, nas últimas 24 h") }),
      ui.kpi({ label: t("Melhor nota agora"), value: best ? `${best.score}<small> · $${esc(best.symbol)}</small>` : null, viz: best ? ui.ring(best.score) : "",
        sub: best ? (best.why || [])[0] || "" : "" }),
      ui.kpi({ label: t("Alertas em 24 h"), value: String(today), sub: t("nota {n} ou mais, sem perigo", { n: S.cfg.alert_score }) }),
    ]));
  }

  function paintAgents() {
    const cl = S.cfg.claude;
    paint($("mc-agents"), S.agents.map((a) => {
      const state = a.id === "batman" && !cl ? ["off", t("Desligado")] : a.busy ? ["busy", t("A trabalhar")] : !a.at ? ["off", t("Ainda não correu")] : a.ok ? ["ok", ago(a.at)] : ["bad", t("Falhou {h}", { h: ago(a.at) })];
      const extra = a.id === "batman"
        ? `<div class="mc-ag-act"><button type="button" class="btn sm ${cl ? "" : "primary"}" data-act="claude">${esc(cl ? t("Desligar o Claude") : t("Ligar o Claude"))}</button>
           ${cl ? `<button type="button" class="btn sm quiet" data-act="run" data-agent="batman">${esc(t("Relatório agora"))}</button>` : ""}
           <small>${esc(S.claude.installed ? t("{n} de {c} hoje · gasta o plano deste PC", { n: S.claude.today, c: S.cfg.cap }) : t("O Claude Code não está instalado neste PC"))}</small></div>`
        : a.id === "gmgn" && !(S.gmgn && S.gmgn.ok) ? `<div class="mc-ag-act"><a class="btn sm quiet" href="#/memes" data-act="go-gmgn">${esc(t("Ligar o motor"))}</a></div>` : "";
      return `<article class="panel mc-ag ${a.busy ? "is-busy" : ""}">
        <header><span class="mc-mono">${esc(a.code)}</span><div><b>${esc(t(a.dept))}</b><small>${esc(a.name)}</small></div><span class="st ${state[0]}"><i></i>${esc(state[1])}</span></header>
        <p>${esc(t(a.does))}</p>
        ${a.note ? `<p class="mc-note">${esc(a.note)}</p>` : ""}${extra}
      </article>`;
    }).join(""));
  }

  const FILTERS = [["todas", "Todas"], ["seguras", "Sem perigo"], ["novas", "Menos de 24 h"], ["faladas", "Com menções"], ["seguidas", "Seguidas"]];
  function rows() {
    const l = S.tokens;
    if (filter === "seguras") return l.filter((x) => !x.danger && !(x.flags || []).some((f) => f[0] === "bad"));
    if (filter === "novas") return l.filter((x) => x.age_h != null && x.age_h < 24);
    if (filter === "faladas") return l.filter((x) => x.n6);
    if (filter === "seguidas") return l.filter((x) => x.watched);
    return l;
  }

  function paintRadar() {
    paint($("mc-radar-h"), ui.sec("Radar de memecoins", `<div class="segx mc-filt">${FILTERS.map(([k, l]) => `<button type="button" data-filt="${k}" class="${k === filter ? "on" : ""}">${esc(t(l))}</button>`).join("")}</div>`));
    const l = rows().slice(0, 25);
    if (!S.n_tokens) return paint($("mc-radar"), ui.empty("target", "O radar ainda está vazio", t("O Robin passa de 3 em 3 minutos. Carrega para ele ir já."), `<button type="button" class="btn primary" data-act="run" data-agent="all">${esc(t("Recolher agora"))}</button>`));
    if (!l.length) return paint($("mc-radar"), ui.empty("search", "Nenhuma moeda neste filtro", ""));
    paint($("mc-radar"), `<div class="mc-tw"><table class="mc-t">
      <thead><tr><th>${esc(t("Moeda"))}</th><th>${esc(t("Nota"))}</th><th class="r">${esc(t("Preço"))}</th><th class="r">1 h</th><th class="r">24 h</th><th class="r mc-hide">${esc(t("Volume 24 h"))}</th><th class="r">${esc(t("Liquidez"))}</th><th class="r mc-hide">${esc(t("Cap."))}</th><th class="r mc-hide">${esc(t("Idade"))}</th><th class="r">${esc(t("Menções"))}</th><th>${esc(t("Atenção"))}</th></tr></thead>
      <tbody>${l.map((x) => `<tr data-key="${esc(x.key)}">
        <td><div class="mc-coin">${x.image ? `<img src="${esc(x.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<i class="mc-noimg">${esc((x.symbol || "?")[0])}</i>`}<div><b>$${esc(x.symbol)}${x.watched ? ` <span class="mc-star">★</span>` : ""}</b><small>${esc(x.name || "")} · ${esc(x.chain_name)}</small></div></div></td>
        <td><span class="mc-score ${grade(x.score)}">${x.score}</span></td>
        <td class="r mc-num">${price(x.price)}</td><td class="r mc-num">${pct(x.ch1)}</td><td class="r mc-num">${pct(x.ch24)}</td>
        <td class="r mc-num mc-hide">${usd(x.vol24)}</td><td class="r mc-num">${usd(x.liq)}</td><td class="r mc-num mc-hide">${usd(x.mcap)}</td><td class="r mc-num mc-hide">${age(x.age_h)}</td>
        <td class="r mc-num">${x.n6 ? `${x.n6}${x.inf6 ? ` <span class="mc-inf-dot" title="${esc(t("de influencers"))}">★${x.inf6}</span>` : ""}` : `<span class="mc-dim">0</span>`}</td>
        <td>${x.danger ? ui.tag(t("Perigo"), "bad") : (x.flags || []).slice(0, 1).map((f) => ui.tag(f[1], f[0])).join("") || `<span class="mc-dim">—</span>`}</td>
      </tr>`).join("")}</tbody></table></div>
      <p class="mc-foot">${esc(t("A nota (0–100) junta o momento (preço, volume, compras), o social (quantas contas falam, influencers, listas de tendências) e a segurança (liquidez, idade, RugCheck). Com perigo, no máximo 30. Clica numa moeda para ver tudo."))}</p>`);
  }

  function paintFeed() {
    const srcs = ["todas", ...new Set(S.posts.map((p) => p.src))];
    paint($("mc-fs"), srcs.map((s) => `<button type="button" data-fsrc="${esc(s)}" class="${s === feedSrc ? "on" : ""}">${esc(s === "todas" ? t("Tudo") : s)}</button>`).join(""));
    const l = S.posts.filter((p) => feedSrc === "todas" || p.src === feedSrc).sort((a, b) => b.t - a.t).slice(0, 40);
    if (!l.length) return paint($("mc-feed"), ui.empty("eye", "Ainda nada", t("O Oráculo passa de 5 em 5 minutos pelo X, Telegram e Reddit.")));
    paint($("mc-feed"), l.map(post).join(""));
  }

  const post = (p) => `<a class="mc-post ${p.inf ? "is-inf" : ""}" href="${esc(p.url)}" target="_blank" rel="noopener">
    <header><span class="mc-src">${esc(p.src)}</span><b>@${esc(p.who)}</b>${p.inf ? ui.tag(t("Influencer"), "ok") : ""}<time>${esc(ago(p.t))}</time></header>
    <p>${esc(p.text)}</p>
    ${p.tickers.length ? `<div class="mc-tags">${p.tickers.map((k) => `<span>$${esc(k)}</span>`).join("")}</div>` : ""}
  </a>`;

  function paintTick() {
    const cg = S.cg_trending || [];
    paint($("mc-tick"), (S.tickers.length ? `<div class="mc-ticks">${S.tickers.map((k) => `<span><b>$${esc(k.t)}</b><small>${k.n} ${esc(k.n === 1 ? t("conta") : t("contas"))}</small></span>`).join("")}</div>` : `<p class="mc-dim">${esc(t("Ainda sem cashtags nas últimas 6 h."))}</p>`)
      + (cg.length ? `<p class="mc-sub">${esc(t("Em alta na CoinGecko"))}</p><div class="mc-ticks sm">${cg.map((k) => `<span><b>${esc(k)}</b></span>`).join("")}</div>` : ""));
  }

  function paintInf() {
    const l = S.influencers;
    paint($("mc-inf"), `<form class="mc-inf-f" id="mc-inf-f">
        <select name="platform">${Object.entries(NET).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}</select>
        <input name="handle" placeholder="${esc(t("@nome ou link"))}" required>
        <input name="note" placeholder="${esc(t("nota (opcional)"))}">
        <button class="btn sm primary">${icon("plus")}${esc(t("Juntar"))}</button>
      </form>
      ${l.length ? `<ul class="mc-inf-l">${l.map((i) => `<li><span class="mc-src">${esc(NET[i.platform] || i.platform)}</span>
        <a href="${esc((LINK[i.platform] || LINK.x)(i.handle))}" target="_blank" rel="noopener">@${esc(i.handle)}</a>
        <small>${esc(i.note || "")}${i.by ? ` · ${esc(i.by)}` : ""}</small>
        <button type="button" class="btn sm quiet" data-del="${esc(i.platform)}/${esc(i.handle)}" title="${esc(t("Tirar"))}">${icon("x")}</button></li>`).join("")}</ul>`
        : `<p class="mc-dim">${esc(t("Ainda não há influencers. Junta os que querem seguir."))}</p>`}
      <p class="mc-foot">${esc(t("Telegram: o Oráculo lê o canal diretamente. X: lê o que o Tree News passa (cerca de 2000 contas grandes) e o Batman procura o resto na web. Para ler qualquer conta do X ao segundo é preciso pagar uma API (twitterapi.io ≈ 0,15 $ por 1000 tweets)."))}</p>`);
  }

  function paintRep() {
    const r = S.reports;
    if (!r.length) return paint($("mc-rep"), ui.empty("spark", S.cfg.claude ? "O Batman ainda não escreveu" : "O Batman está desligado",
      S.cfg.claude ? t("Escreve de {m} em {m} minutos, no máximo {c} por dia.", { m: S.cfg.every_min, c: S.cfg.cap }) : t("Liga o Claude no cartão dele: lê as melhores candidatas e o que se diz, procura os influencers na web e dá um veredicto."),
      S.cfg.claude ? `<button type="button" class="btn primary" data-act="run" data-agent="batman">${esc(t("Relatório agora"))}</button>` : `<button type="button" class="btn primary" data-act="claude">${esc(t("Ligar o Claude"))}</button>`));
    const VER = { ver: ["Ver de perto", "ok"], cedo: ["Ainda cedo", "warn"], evitar: ["Evitar", "bad"] };
    paint($("mc-rep"), r.slice(0, 3).map((x, i) => `<article class="mc-rep ${i ? "old" : ""}">
      <header><b>${esc(new Date(x.t * 1000).toLocaleString("pt-PT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }))}</b><small>${esc(x.reason || "")}</small></header>
      <p>${esc(x.resumo || "")}</p>
      ${(x.destaques || []).length ? `<div class="mc-dest">${x.destaques.map((d) => `<div><b>$${esc(sym(d.symbol))}</b>${ui.tag(t((VER[d.veredicto] || [d.veredicto || "?"])[0]), (VER[d.veredicto] || [])[1] || "")}<p>${esc(d.porque || "")}</p>${d.risco ? `<small>${esc(t("Risco"))}: ${esc(d.risco)}</small>` : ""}</div>`).join("")}</div>` : ""}
      ${(x.influencers || []).length ? `<ul class="mc-said">${x.influencers.map((d) => `<li><b>@${esc(d.handle)}</b> ${esc(d.disse || "")}${d.moeda ? ` <span>$${esc(sym(d.moeda))}</span>` : ""}</li>`).join("")}</ul>` : ""}
    </article>`).join(""));
  }

  function paintGmgn() {
    const g = S.gmgn, c = S.cfg;
    if (!g || !g.ok) {
      return paint($("mc-gmgn"), `<div class="mc-g-off">
        <p>${esc(t("O gmgn-tracker do David e do Kovel apanha todas as moedas novas da pump.fun, faz paper trading a 100 $ por estratégia e aprende quais ganham. Corre no servidor deles e guarda tudo no gmgn.db."))}</p>
        <p class="mc-dim">${esc(g && g.error && !g.setup ? t("Erro: {e}", { e: g.error }) : t("Ainda não está ligado a este Hub."))}</p>
        <form class="mc-g-f" id="mc-g-f">
          <label>${esc(t("Endereço do serviço no servidor"))}<input name="gmgn_url" value="${esc(c.gmgn_url || "")}" placeholder="http://servidor:8787"></label>
          <label>${esc(t("Chave"))}<input name="gmgn_key" type="password" placeholder="${esc(c.gmgn_key ? t("guardada · escreve para trocar") : "")}"></label>
          <label>${esc(t("Ou o gmgn.db neste PC"))}<input name="gmgn_db" value="${esc(c.gmgn_db || "")}" placeholder="~/.team-agent/gmgn-tracker/gmgn.db"></label>
          <button class="btn primary">${esc(t("Ligar"))}</button>
        </form>
        <p class="mc-foot">${esc(t("No servidor, ao lado do gmgn.db, corre-se uma vez: python3 gmgn_link.py serve --db gmgn.db --port 8787 --key <segredo> (o ficheiro está em team-agent/backend/app/gmgn_link.py). Só lê, nunca escreve no gmgn.db."))}</p>
      </div>`);
    }
    const best = (g.tiers || []).filter((x) => x.paper_n);
    paint($("mc-gmgn"), `<div class="mc-g-kp">
        <div><small>${esc(t("Moedas apanhadas"))}</small><b>${loc(g.tokens)}</b><span>${esc(t("{n} nas últimas 24 h", { n: loc(g.new24) }))}</span></div>
        <div><small>${esc(t("Paper trading · {d} dias", { d: g.days }))}</small><b class="${g.paper.usd >= 0 ? "mc-up" : "mc-dn"}">${g.paper.usd >= 0 ? "+" : ""}${loc(g.paper.usd)} $</b><span>${esc(t("{n} trades a 100 $, {w} ganhas", { n: g.paper.n, w: g.paper.wins }))}</span></div>
        <div><small>${esc(t("Carteiras boas"))}</small><b>${loc(g.good_wallets)}</b><span>${esc(t("contas do X ligadas a moedas: {n}", { n: loc(g.x_handles) }))}</span></div>
        <div><small>${esc(t("Ligação"))}</small><b>${esc(g.via === "local" ? t("Neste PC") : t("Servidor"))}</b><span>${esc(ago(g.at))}</span></div>
      </div>
      ${best.length ? `<table class="mc-t mc-g-t"><thead><tr><th>${esc(t("Estratégia"))}</th><th class="r">${esc(t("Entradas"))}</th><th class="r">${esc(t("×2 / −50%"))}</th><th class="r">${esc(t("Paper"))}</th><th class="r">${esc(t("Média"))}</th><th>${esc(t("As duas metades"))}</th></tr></thead><tbody>
        ${best.map((x) => `<tr><td>${esc(x.name)}</td><td class="r mc-num">${x.entries}</td><td class="r mc-num">${x.wins} / ${x.losses}</td><td class="r mc-num"><span class="${x.paper_usd >= 0 ? "mc-up" : "mc-dn"}">${x.paper_usd >= 0 ? "+" : ""}${loc(x.paper_usd)} $</span></td><td class="r mc-num">${loc(x.paper_avg, 1)} $</td><td>${x.both_halves ? ui.tag(t("em plus"), "ok") : ui.tag(t("não"), "warn")}</td></tr>`).join("")}
      </tbody></table>` : ""}
      ${(g.signals || []).length ? `<p class="mc-sub">${esc(t("Últimos sinais"))}</p><div class="mc-sig">${g.signals.slice(0, 12).map((s) => `<a href="https://gmgn.ai/sol/token/${esc(s.mint)}" target="_blank" rel="noopener">
        <b>$${esc(s.symbol || "?")}</b><small>${esc(s.tier_name)} · ${esc(ago(s.ts))}</small>${ui.tag(t(s.action || "?"), s.action === "Entrar" ? "ok" : "")}
        <span>${usd(s.mc)}${s.paper_usd != null ? ` · <i class="${s.paper_usd >= 0 ? "mc-up" : "mc-dn"}">${s.paper_usd >= 0 ? "+" : ""}${loc(s.paper_usd)} $</i>` : ""}</span></a>`).join("")}</div>` : ""}`);
  }

  function paintCfg() {
    const c = S.cfg;
    paint($("mc-cfg"), `<form class="mc-cfg" id="mc-cfg-f">
      <label>${esc(t("Canais do Telegram"))}<textarea name="telegram" rows="3">${esc(c.telegram.join(", "))}</textarea><small>${esc(t("só canais públicos (t.me/s/nome abre no browser)"))}</small></label>
      <label>${esc(t("Subreddits"))}<textarea name="reddit" rows="3">${esc(c.reddit.join(", "))}</textarea></label>
      <label>${esc(t("Avisar a partir da nota"))}<input name="alert_score" type="number" min="40" max="100" value="${c.alert_score}"><small>${esc(t("chega ao sino, ao widget e ao telemóvel"))}</small></label>
      <label>${esc(t("Liquidez mínima ($)"))}<input name="min_liq" type="number" min="0" step="1000" value="${c.min_liq}"><small>${esc(t("abaixo disto a moeda leva alerta vermelho"))}</small></label>
      <label>${esc(t("Batman: de quantos em quantos minutos"))}<input name="every_min" type="number" min="20" max="1440" value="${c.every_min}"></label>
      <label>${esc(t("Batman: máximo por dia"))}<input name="cap" type="number" min="1" max="40" value="${c.cap}"></label>
      <label>${esc(t("Batman: modelo"))}<select name="model">${["haiku", "sonnet", "opus"].map((m) => `<option ${m === c.model ? "selected" : ""}>${m}</option>`).join("")}</select></label>
      <label class="mc-chk"><input type="checkbox" name="alerts" ${c.alerts ? "checked" : ""}>${esc(t("Mandar avisos"))}</label>
    </form>`);
  }

  async function openToken(key) {
    openModal(`<div class="mc-md">${ui.skeleton(4)}</div>`);
    let x;
    try { x = await api(`/api/memes/token?key=${encodeURIComponent(key)}`); } catch (e) { return paint(document.querySelector(".mc-md"), ui.error(e.message)); }
    const P = x.parts || {};
    const links = [["DexScreener", x.url], ["GMGN", x.chain === "solana" ? `https://gmgn.ai/sol/token/${x.address}` : null], ["RugCheck", x.chain === "solana" ? `https://rugcheck.xyz/tokens/${x.address}` : null],
      ["X", x.twitter], ["Telegram", x.telegram], ["Site", x.website], ["Procurar no X", `https://x.com/search?q=${encodeURIComponent("$" + x.symbol)}&f=live`]].filter((l) => l[1]);
    const el = document.querySelector(".mc-md"); if (!el) return;
    paint(el, `<header class="mc-md-h">${x.image ? `<img src="${esc(x.image)}" alt="" referrerpolicy="no-referrer">` : ""}<div><h2>$${esc(x.symbol)}</h2><small>${esc(x.name || "")} · ${esc(x.chain_name)} · ${esc(t("vista pela 1.ª vez {h}", { h: ago(x.first) }))}</small></div>
        <span class="mc-score big ${grade(x.score)}">${x.score}</span><button class="btn quiet sm" data-close>${icon("x")}</button></header>
      <div class="mc-md-parts">${[["Momento", P.momento, 35], ["Social", P.social, 40], ["Segurança", P.seguranca, 25]].map(([l, v, m]) => `<div><small>${esc(t(l))}</small><b>${v ?? "—"}<i>/${m}</i></b>${ui.progress(((v || 0) / m) * 100)}</div>`).join("")}</div>
      ${(x.spark || []).length > 2 ? `<div class="mc-md-sp">${ui.spark(x.spark, { w: 560, h: 70 })}<small>${esc(t("preço nas últimas horas, visto pelo Robin"))}</small></div>` : ""}
      <div class="mc-md-g">
        <div><small>${esc(t("Preço"))}</small><b>${price(x.price)}</b></div><div><small>5 min · 1 h · 24 h</small><b>${pct(x.ch5)} · ${pct(x.ch1)} · ${pct(x.ch24)}</b></div>
        <div><small>${esc(t("Liquidez"))}</small><b>${usd(x.liq)}</b></div><div><small>${esc(t("Capitalização"))}</small><b>${usd(x.mcap)}</b></div>
        <div><small>${esc(t("Volume 1 h · 24 h"))}</small><b>${usd(x.vol1)} · ${usd(x.vol24)}</b></div><div><small>${esc(t("Compras / vendas 1 h"))}</small><b>${x.buys1 ?? "—"} / ${x.sells1 ?? "—"}</b></div>
        <div><small>${esc(t("Idade"))}</small><b>${age(x.age_h)}</b></div><div><small>RugCheck</small><b>${x.rug ? `${x.rug.score ?? "—"}/10${x.rug.lp_locked != null ? ` · LP ${loc(x.rug.lp_locked, 0)}%` : ""}` : esc(x.chain === "solana" ? t("por ver") : t("só Solana"))}</b></div>
      </div>
      ${(x.why || []).length ? `<p class="mc-sub">${esc(t("Porque está aqui"))}</p><ul class="mc-why">${x.why.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
      ${(x.flags || []).length || (x.rug && x.rug.risks.length) ? `<p class="mc-sub">${esc(t("Atenção"))}</p><div class="mc-flags">${(x.flags || []).map((f) => ui.tag(f[1], f[0])).join("")}${x.rug ? x.rug.risks.filter((r) => r.level !== "danger").map((r) => ui.tag(r.name, r.level === "warn" ? "warn" : "")).join("") : ""}</div>` : ""}
      <div class="mc-md-links">${links.map(([l, u]) => `<a class="btn sm" href="${esc(u)}" target="_blank" rel="noopener">${esc(t(l))}</a>`).join("")}
        <button type="button" class="btn sm" data-copy="${esc(x.address)}">${esc(t("Copiar contrato"))}</button>
        <button type="button" class="btn sm ${x.watched ? "" : "primary"}" data-watch="${esc(x.key)}">${esc(x.watched ? t("Deixar de seguir") : t("Seguir"))}</button></div>
      <p class="mc-sub">${esc(t("O que se disse · 48 h"))}</p>
      ${(x.mentions || []).length ? `<div class="mc-md-feed">${x.mentions.map(post).join("")}</div>` : `<p class="mc-dim">${esc(t("Ninguém das fontes falou dela ainda."))}</p>`}
      <p class="mc-foot">${esc(t("Memecoins são de altíssimo risco e quase todas vão a zero. Isto é informação, não um conselho para comprar."))}</p>`);
    el.onclick = async (e) => {
      const c = e.target.closest("[data-copy]"), w = e.target.closest("[data-watch]");
      if (c) { navigator.clipboard.writeText(c.dataset.copy).then(() => { c.textContent = t("Copiado"); }); }
      if (w) { await api("/api/memes/watch", { method: "POST", body: { key: w.dataset.watch } }); closeModal(); load(); }
    };
  }

  const list = (v) => v.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);

  function bind() {
    const root = $("mc");
    root.addEventListener("click", async (e) => {
      const row = e.target.closest("tr[data-key]");
      if (row) return openToken(row.dataset.key);
      const f = e.target.closest("[data-filt]");
      if (f) { filter = f.dataset.filt; return paintRadar(); }
      const fs = e.target.closest("[data-fsrc]");
      if (fs) { feedSrc = fs.dataset.fsrc; return paintFeed(); }
      const d = e.target.closest("[data-del]");
      if (d) { const [p, h] = d.dataset.del.split("/"); S.influencers = (await api(`/api/memes/influencers/${encodeURIComponent(p)}/${encodeURIComponent(h)}`, { method: "DELETE" })).influencers; return paintInf(); }
      const b = e.target.closest("[data-act]");
      if (!b) return;
      if (b.dataset.act === "go-gmgn") { e.preventDefault(); return $("mc-gmgn").scrollIntoView({ behavior: "smooth" }); }
      b.disabled = true;
      try {
        if (b.dataset.act === "toggle") { S.cfg = (await api("/api/memes/cfg", { method: "POST", body: { on: !S.cfg.on } })).cfg; paintCtl(); }
        if (b.dataset.act === "claude") { S.cfg = (await api("/api/memes/cfg", { method: "POST", body: { claude: !S.cfg.claude } })).cfg; paintAgents(); paintRep(); }
        if (b.dataset.act === "run") {
          const r = await api("/api/memes/run", { method: "POST", body: { agent: b.dataset.agent } });
          msg(r.busy ? t("Os agentes já estão a meio de uma volta: os números chegam daqui a pouco.") : b.dataset.agent === "batman" ? t("O Batman foi pesquisar: o relatório chega em 2–5 minutos.") : t("Os agentes foram recolher: os números chegam em cerca de 30 segundos."));
          setTimeout(() => load().catch(() => {}), b.dataset.agent === "batman" ? 60000 : 25000);
        }
      } catch (err) { msg(err.message); } finally { b.disabled = false; }
    });
    root.addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target;
      try {
        if (f.id === "mc-inf-f") {
          S.influencers = (await api("/api/memes/influencers", { method: "POST", body: { platform: f.platform.value, handle: f.handle.value, note: f.note.value } })).influencers;
          paintInf(); msg(t("Influencer juntado: conta a partir da próxima volta do Oráculo."));
        }
        if (f.id === "mc-g-f") {
          const body = { gmgn_url: f.gmgn_url.value.trim(), gmgn_db: f.gmgn_db.value.trim() };
          if (f.gmgn_key.value) body.gmgn_key = f.gmgn_key.value;
          S.cfg = (await api("/api/memes/cfg", { method: "POST", body })).cfg;
          msg(t("A ligar ao gmgn-tracker...")); setTimeout(() => load().catch(() => {}), 4000);
        }
      } catch (err) { msg(err.message); }
    });
    root.addEventListener("change", async (e) => {
      const f = e.target.closest("#mc-cfg-f");
      if (!f) return;
      const body = { telegram: list(f.telegram.value), reddit: list(f.reddit.value), alert_score: +f.alert_score.value, min_liq: +f.min_liq.value,
        every_min: +f.every_min.value, cap: +f.cap.value, model: f.model.value, alerts: f.alerts.checked };
      try { S.cfg = (await api("/api/memes/cfg", { method: "POST", body })).cfg; msg(t("Guardado.")); }
      catch (err) { msg(err.message); $("mc-cfg")._html = ""; paintCfg(); }
    });
  }
})();
