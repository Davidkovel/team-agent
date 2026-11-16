// Memecoins (04 · Trading): what the agents of this PC collect day and night about the memecoins (backend/app/memes.py,
// /api/memes). Robin reads the DEX, the Oráculo the X (Tree News), Telegram and Reddit, Lucius checks for rugs, the Batman
// (Claude, off by default) writes reports, and the Motor GMGN shows the gmgn-tracker's signals. Only watching: nothing bought.
//
// 16 nov, Marco, on the first version (one long page): «está tudo baralhado... qualquer pessoa que olha fica tipo que merda é
// esta... vai ser empresarial, tenho de mostrar aos comparsas... uma pessoa que não percebe nada de trading». So: four tabs
// (Resumo, Moedas, Redes sociais, Agentes, the NAV entry's pages), the Resumo says in one sentence what is going on, every
// coin gets a verdict in words (Forte, A ganhar força, Fraca, Ignorar, Perigo) and every term is explained in plain words.
(function () {
  let S = null, timer = 0, view = "resumo", filter = "todas", feedSrc = "todas";
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

  const VIEWS = { memes: "resumo", "meme-moedas": "moedas", "meme-redes": "redes", "meme-agentes": "agentes" };
  for (const [id, v] of Object.entries(VIEWS)) HUB_VIEWS[id] = () => open(v);

  const HEAD = {
    resumo: ["Memecoins", "O que os nossos agentes estão a ver agora nas memecoins, em palavras simples. Só vigiam: não compram nada."],
    moedas: ["Moedas", "Todas as moedas que os agentes estão a seguir, da mais forte para a mais fraca."],
    redes: ["Redes sociais", "O que se diz no X, no Telegram e no Reddit, e os influencers que a equipa segue."],
    agentes: ["Agentes", "Quem faz o trabalho, o que fez da última vez e as regras que segue."],
  };

  async function open(v) {
    view = v;
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
    S = await api("/api/memes/state");
    paintCtl();
    const typing = $("mc-body").querySelector("input:focus, textarea:focus, select:focus, details[open]");
    if (first || !typing) ({ resumo, moedas, redes, agentes })[view]();
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
    if (a.busy) return ["busy", t("A trabalhar")];
    if (!a.at) return ["off", t("Ainda não correu")];
    return a.ok ? ["ok", ago(a.at)] : ["bad", t("Falhou {h}", { h: ago(a.at) })];
  }

  /* ---------------------------------------------------------------- Resumo */
  function resumo() {
    const toks = S.tokens, w = (x) => verdict(x)[0];
    const strong = toks.filter((x) => w(x) === "Forte"), rising = toks.filter((x) => w(x) === "A ganhar força");
    const weak = toks.filter((x) => ["Fraca", "Ignorar"].includes(w(x))).length, danger = toks.filter((x) => w(x) === "Perigo").length;
    const best = toks.find((x) => w(x) !== "Perigo");
    const n6 = S.hours.slice(-6).reduce((a, b) => a + b, 0), prev6 = S.hours.slice(-12, -6).reduce((a, b) => a + b, 0);
    const today = S.alerts.filter((a) => Date.now() / 1000 - a.t < 86400).length;
    if (!S.n_tokens) {
      return paint($("mc-body"), `<section class="panel pad">${ui.empty("target", "Os agentes ainda não fizeram a primeira volta", t("Demora cerca de um minuto depois de o Hub arrancar. Podes mandá-los já."),
        `<button type="button" class="btn primary" data-act="run" data-agent="all">${esc(t("Atualizar agora"))}</button>`)}</section>`);
    }
    const [line, tone] = strong.length ? [t("{n} moedas fortes agora.", { n: strong.length }), "ok"]
      : rising.length ? [t("Nada forte ainda: {n} a ganhar força.", { n: rising.length }), "warn"]
      : [t("Mercado calmo: nada que valha a pena agora."), "calm"];
    const top = toks.filter((x) => w(x) !== "Perigo").slice(0, 6);
    paint($("mc-body"), `
      <div class="pn-split mc-hero">
        <section class="panel pad mc-gauge"><div class="pn-card-h">${esc(t("A melhor nota agora"))}<small>${esc(t("de 0 a 100"))}</small></div>
          ${best ? ui.gauge(best.score, 100, { label: `$${sym(best.symbol)} · ${t(w(best))}` }) : ""}</section>
        <section class="panel pad mc-now ${tone}">
          <div class="pn-card-h">${esc(t("Agora, numa frase"))}<small>${esc(t("atualizado {h}", { h: ago(lastRun()) }))}</small></div>
          <h2>${esc(line)}</h2>
          <p>${esc(t("Os agentes seguem {m} moedas e leram {p} publicações sobre moedas nas últimas 6 horas.", { m: S.n_tokens, p: n6 }))}
            ${danger ? esc(t("{d} têm perigo e ficam de fora.", { d: danger })) : ""}</p>
          <div class="mc-count">
            <a href="#/meme-moedas" data-goto="boas" class="ok"><b>${strong.length}</b><span>${esc(t("Fortes"))}</span></a>
            <a href="#/meme-moedas" data-goto="boas" class="warn"><b>${rising.length}</b><span>${esc(t("A ganhar força"))}</span></a>
            <a href="#/meme-moedas" data-goto="todas"><b>${weak}</b><span>${esc(t("Fracas"))}</span></a>
            <a href="#/meme-moedas" data-goto="perigo" class="bad"><b>${danger}</b><span>${esc(t("Perigo"))}</span></a>
          </div>
        </section>
      </div>
      ${ui.kpis([
        ui.kpi({ label: t("Conversa nas redes · 6 h"), value: String(n6), delta: prev6 ? ui.delta(n6, prev6) : "", viz: S.hours.some(Boolean) ? ui.cols(S.hours) : "", sub: t("publicações sobre moedas, por hora, nas últimas 24 h") }),
        ui.kpi({ label: t("Avisos nas últimas 24 h"), value: String(today), sub: t("quando uma moeda passa a nota {n} sem perigo", { n: S.cfg.alert_score }), cls: "pn-plain" }),
        ui.kpi({ label: t("Influencers seguidos"), value: String(S.influencers.length), sub: t("o que dizem conta três vezes"), cls: "pn-plain" }),
      ])}
      ${ui.sec("As melhores agora", `<a class="mc-more" href="#/meme-moedas">${esc(t("Ver todas"))} ›</a>`)}
      <div class="mc-cards">${top.map(card).join("")}</div>
      ${ui.sec("Como ler isto")}
      <section class="panel pad mc-learn">
        <div><b>${esc(t("A nota"))}</b><p>${esc(t("De 0 a 100. Junta três coisas: se está a subir, se se fala dela nas redes e se parece segura. 75 ou mais é «Forte»."))}</p></div>
        <div><b>${esc(t("Dinheiro na pool"))}</b><p>${esc(t("Quanto dinheiro há para comprar e vender (a «liquidez»). Abaixo de {n} é fácil ficar preso sem conseguir vender.", { n: usd(S.cfg.min_liq) }))}</p></div>
        <div><b>${esc(t("Idade"))}</b><p>${esc(t("Há quanto tempo a moeda existe. Com minutos de vida tudo pode acontecer: subir 10 vezes ou ir a zero."))}</p></div>
        <div><b>${esc(t("Perigo"))}</b><p>${esc(t("Cada moeda passa pelo RugCheck e pelas nossas regras. Com perigo, pode ser uma burla e fica de fora."))}</p></div>
      </section>
      ${ui.sec("Quem está a trabalhar", `<a class="mc-more" href="#/meme-agentes">${esc(t("Ver os agentes"))} ›</a>`)}
      <section class="panel mc-strip">${S.agents.map((a) => `<a href="#/meme-agentes"><span class="st ${state(a)[0]}"><i></i></span><div><b>${esc(t(a.dept))}</b><small>${esc(state(a)[1])}</small></div></a>`).join("")}</section>`);
  }

  function card(x) {
    const v = verdict(x), warn = (x.flags || [])[0];
    return `<button type="button" class="panel mc-card" data-key="${esc(x.key)}">
      <header>${logo(x)}<div><b>$${esc(sym(x.symbol))}</b><small>${esc(x.name || "")} · ${esc(x.chain_name)}</small></div>${pill(x)}</header>
      <p>${esc((x.why || [])[0] ? cap(x.why[0]) : v[2])}</p>
      <dl><div><dt>${esc(t("Última hora"))}</dt><dd>${pct(x.ch1)}</dd></div><div><dt>${esc(t("Na pool"))}</dt><dd>${usd(x.liq)}</dd></div><div><dt>${esc(t("Idade"))}</dt><dd>${age(x.age_h)}</dd></div></dl>
      <footer class="${warn ? warn[0] : "ok"}">${esc(warn ? cap(warn[1]) : t("Sem alertas"))}</footer>
    </button>`;
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

  /* ---------------------------------------------------------------- Redes sociais */
  function redes() {
    const srcs = ["todas", ...new Set(S.posts.map((p) => p.src))];
    const l = S.posts.filter((p) => feedSrc === "todas" || p.src === feedSrc).sort((a, b) => b.t - a.t).slice(0, 50);
    paint($("mc-body"), `<div class="mc-grid">
      <div>${ui.sec("Últimas publicações", `<div class="segx">${srcs.map((s) => `<button type="button" data-fsrc="${esc(s)}" class="${s === feedSrc ? "on" : ""}">${esc(s === "todas" ? t("Tudo") : s)}</button>`).join("")}</div>`)}
        <section class="panel mc-feed">${l.length ? l.map(post).join("") : ui.empty("eye", "Ainda nada", t("O Oráculo lê o X, o Telegram e o Reddit de 5 em 5 minutos."))}</section></div>
      <div>
        ${ui.sec("Influencers que seguimos", `<small class="mc-dim">${esc(t("contam três vezes"))}</small>`)}
        <section class="panel pad">${influencers()}</section>
        ${ui.sec("Moedas mais faladas · 6 h")}
        <section class="panel pad">${S.tickers.length ? `<div class="mc-ticks">${S.tickers.map((k) => `<span><b>$${esc(k.t)}</b><small>${k.n} ${esc(k.n === 1 ? t("conta") : t("contas"))}</small></span>`).join("")}</div>` : `<p class="mc-dim">${esc(t("Ainda ninguém falou de moedas nas últimas 6 horas."))}</p>`}
          ${(S.cg_trending || []).length ? `<p class="mc-sub">${esc(t("Em alta na CoinGecko"))}</p><div class="mc-ticks sm">${S.cg_trending.map((k) => `<span><b>${esc(k)}</b></span>`).join("")}</div>` : ""}</section>
        ${ui.sec("De onde vem")}
        <section class="panel pad mc-sources">
          <div><b>X (Twitter)</b><p>${esc(t("Os posts das contas grandes que o Tree News retransmite (cerca de 2000). Para ler qualquer conta ao segundo é preciso pagar uma API."))}</p></div>
          <div><b>Telegram</b><p>${esc(t("{n} canais públicos, lidos diretamente: {l}.", { n: S.cfg.telegram.length, l: S.cfg.telegram.slice(0, 4).join(", ") + (S.cfg.telegram.length > 4 ? "…" : "") }))}</p></div>
          <div><b>Reddit</b><p>${esc(t("{n} comunidades: {l}.", { n: S.cfg.reddit.length, l: S.cfg.reddit.map((r) => "r/" + r).join(", ") }))}</p></div>
        </section>
      </div></div>`);
  }

  const post = (p) => `<a class="mc-post ${p.inf ? "is-inf" : ""}" href="${esc(p.url)}" target="_blank" rel="noopener">
    <header><span class="mc-src">${esc(p.src)}</span><b>@${esc(p.who)}</b>${p.inf ? ui.tag(t("Influencer"), "ok") : ""}<time>${esc(ago(p.t))}</time></header>
    <p>${esc(p.text)}</p>${p.tickers.length ? `<div class="mc-tags">${p.tickers.map((k) => `<span>$${esc(k)}</span>`).join("")}</div>` : ""}</a>`;

  function influencers() {
    const l = S.influencers;
    return `<form class="mc-inf-f" id="mc-inf-f">
        <select name="platform" aria-label="${esc(t("Rede"))}">${Object.entries(NET).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}</select>
        <input name="handle" placeholder="${esc(t("@nome ou link do perfil"))}" required>
        <input name="note" placeholder="${esc(t("Porque o seguimos (opcional)"))}">
        <button class="btn primary">${esc(t("Juntar"))}</button>
      </form>
      ${l.length ? `<ul class="mc-inf-l">${l.map((i) => `<li><span class="mc-src">${esc(NET[i.platform] || i.platform)}</span>
        <div><a href="${esc((LINK[i.platform] || LINK.x)(i.handle))}" target="_blank" rel="noopener">@${esc(i.handle)}</a><small>${esc(i.note || "")}${i.by ? ` · ${esc(t("juntado por {p}", { p: i.by }))}` : ""}</small></div>
        <button type="button" class="btn sm quiet" data-del="${esc(i.platform)}/${esc(i.handle)}" title="${esc(t("Tirar da lista"))}">${icon("x")}</button></li>`).join("")}</ul>`
        : `<p class="mc-dim">${esc(t("Ainda não há influencers. Junta os que querem seguir."))}</p>`}`;
  }

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
      const g = e.target.closest("[data-goto]");
      if (g) { filter = g.dataset.goto; return; }   // the link itself opens Moedas with that filter
      const k = e.target.closest("[data-key]");
      if (k) return openToken(k.dataset.key);
      const f = e.target.closest("[data-filt]");
      if (f) { filter = f.dataset.filt; return moedas(); }
      const fs = e.target.closest("[data-fsrc]");
      if (fs) { feedSrc = fs.dataset.fsrc; return redes(); }
      const d = e.target.closest("[data-del]");
      if (d) { const [p, h] = d.dataset.del.split("/"); S.influencers = (await api(`/api/memes/influencers/${encodeURIComponent(p)}/${encodeURIComponent(h)}`, { method: "DELETE" })).influencers; return redes(); }
      const b = e.target.closest("[data-act]");
      if (!b) return;
      b.disabled = true;
      try {
        if (b.dataset.act === "toggle") { S.cfg = (await api("/api/memes/cfg", { method: "POST", body: { on: !S.cfg.on } })).cfg; paintCtl(); }
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
          S.influencers = (await api("/api/memes/influencers", { method: "POST", body: { platform: f.platform.value, handle: f.handle.value, note: f.note.value } })).influencers;
          redes(); msg(t("Juntado. Conta a partir da próxima volta do Oráculo (até 5 minutos)."));
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
