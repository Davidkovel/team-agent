// Skills (#/skills): the company's skills library, the Empresa AMG's space for them. Asked for by Marco on 14 Oct: bring
// every skill in, have the agents master them, and keep them easy for each agent to use. Three halves:
// - Biblioteca: the skills the company has (library/skills in git, backend/app/routers/skills.py), by theme or by the
//   department that uses them (the departments are crew.js's, window.AMGDepts: a monogram, a name, a sentence; since 23
//   Oct no characters). The automatic agent reads them with its `skills` tool, and the briefing tells each department its
//   own (agent/team_agent/tools/skills_tool.py).
// - Neste PC: the skills installed here (the person's own, the plugins', claude.ai's) that are not in the library yet.
// - Loja: those in the catalogs of the plugin marketplaces this Claude Code knows.
// A GitHub link (a repository, a folder or a SKILL.md) brings in every skill it has. A click on a skill opens it: what it
// says, its theme, which departments use it (a touch each) and the way in or out of the library.
// Every half is sorted by theme first (Marco, 21 Oct: «organizado por tema, para saber o que serve para cada; sempre que
// metemos uma skill, fica lá»): a section per theme with what the theme is for, a row of themes on top to jump to one,
// and the themes the library still lacks at the end with how many skills this PC and the Loja have for each. The theme of
// a skill comes from the server (scripts/claude_contexto.py finds it, the same the Claude windows see), so a skill that
// comes in lands in its theme by itself; a theme chosen by hand in the open skill stays (library/skills/temas.json).
// «Departamento» / «Origem» is the other way of sorting: by the department that uses it, or by where it comes from.
(function () {
  let S = null, cast = [], tab = sessionStorage.getItem("sk.tab") || "lib", by = sessionStorage.getItem("sk.by") || "tema", q = "", reading = null;
  const HALVES = [["lib", "Biblioteca"], ["pc", "Neste PC"], ["loja", "Loja"]];
  const THEME_ICON = { "Sites": "sites", "Clientes e vendas": "target", "SEO": "search", "Anúncios": "flag", "Vídeo": "videos",
    "Redes sociais e conteúdo": "note", "Print-on-demand": "bag", "Loja Shopify": "wallet", "Marca e design": "tema", "Marketing": "trend",
    "Documentos": "docs", "Finanças e dados": "chart", "Trading": "candles", "Equipa e RH": "users", "Hub e widget": "monitor", "Código": "code", "Claude, MCP e skills": "plugins", "Operações e suporte": "gear" };
  const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const castOf = (id) => cast.find((c) => c.id === id);
  const of = (kind) => (S ? S.skills.filter((k) => k.kind === kind) : []);
  const hit = (k) => !q || fold(`${k.name} ${k.about} ${k.where || ""} ${k.tema || ""}`).includes(fold(q));
  const themeIcon = (name) => icon(THEME_ICON[name] || "layers");
  const themeId = (name) => `sk-t-${fold(name).replace(/[^a-z0-9]+/g, "-")}`;
  const count = (n) => t(n === 1 ? "1 skill" : "{n} skills", { n });
  // the skills of a list by theme, in the themes' own order (Sites first, Outras last), only the themes that have some
  function byTheme(list) {
    const order = (S.temas || []).map((th) => th.name);
    for (const k of list) if (!order.includes(k.tema || "Outras")) order.splice(Math.max(order.length - 1, 0), 0, k.tema || "Outras");
    return order.map((name) => ({ name, para: ((S.temas || []).find((th) => th.name === name) || {}).para || "", list: list.filter((k) => (k.tema || "Outras") === name) }))
      .filter((g) => g.list.length);
  }

  // the departments (crew.js): who uses each skill is shown by their monogram and name
  function faces() { cast = (window.AMGDepts && window.AMGDepts.list) || []; }
  const mono = (c, cls = "") => (window.AMGDepts ? window.AMGDepts.mono(c, cls) : "");

  // ---------------------------------------------------------------- pieces
  function card(k) {
    const owners = (k.crew || []).map(castOf).filter(Boolean);
    const foot = k.kind === "lib"
      ? `<span class="sk-faces">${owners.map((c) => mono(c, "xs")).join("")}</span><small>${esc(owners.length ? t("Usada por {d}", { d: owners.map((c) => c.name).join(", ") }) : t("Ainda sem departamento"))}</small>`
      : `<small>${esc(k.where || "")}</small><button type="button" class="btn sk-take" data-take="${esc(k.name)}">${icon("plus")}${esc(t("Trazer"))}</button>`;
    const tag = by === "tema" ? "" : `<span class="sk-tag">${themeIcon(k.tema)}${esc(t(k.tema || "Outras"))}</span>`;
    return `<div class="sk-card" data-skill="${esc(k.name)}" role="button" tabindex="0">${tag}<b>${esc(k.name)}</b><p>${esc(k.about || t("Sem descrição."))}</p><footer>${foot}</footer></div>`;
  }
  // a theme: what it is for over its skills; out of the library, a way to bring all of them
  function themeLane(g, kind) {
    const take = kind === "lib" ? "" : `<button type="button" class="btn sk-take" data-take-tema="${esc(g.name)}">${icon("plus")}${esc(g.list.length === 1 ? t("Trazer") : t("Trazer as {n}", { n: g.list.length }))}</button>`;
    return `<section class="sk-lane sk-theme" id="${themeId(g.name)}">
        <header><span class="sk-fig none">${themeIcon(g.name)}</span><div><b>${esc(t(g.name))}</b><span class="sk-para">${esc(t(g.para))}</span></div>
          <em>${esc(count(g.list.length))}</em>${take}</header>
        <div class="sk-grid">${g.list.map(card).join("")}</div></section>`;
  }
  // the themes the library has nothing in yet, each with how many skills this PC and the Loja have for it
  function emptyThemes(lib) {
    const more = [...of("pc"), ...of("loja")];
    const empty = (S.temas || []).filter((th) => th.name !== "Outras" && !lib.some((k) => k.tema === th.name));
    if (!empty.length) return "";
    return `<section class="sk-lane sk-shelf"><header><span class="sk-fig none">${icon("plus")}</span>
        <div><b>${esc(t("Temas ainda vazios"))}</b><span class="sk-para">${esc(t("Cada skill que entra vai sozinha para o tema dela. Toca num tema para ver as que há neste PC e na Loja."))}</span></div></header>
      <div class="sk-wait">${empty.map((th) => {
        const n = more.filter((k) => k.tema === th.name).length;
        return `<button type="button" data-find="${esc(th.name)}" ${n ? "" : "disabled"} title="${esc(t(th.para))}">${themeIcon(th.name)}<b>${esc(t(th.name))}</b><small>${esc(n ? t("{n} por trazer", { n }) : t("nenhuma por agora"))}</small></button>`;
      }).join("")}</div></section>`;
  }
  // the row of themes over the skills: a touch goes to that theme's section
  function themeNav(list) {
    if (by !== "tema" || !list.length) return "";
    return byTheme(list).map((g) => `<button type="button" data-jump="${esc(g.name)}">${themeIcon(g.name)}${esc(t(g.name))}<b>${g.list.length}</b></button>`).join("");
  }
  function current() {
    return (tab === "lib" ? of("lib") : of(tab)).filter(hit);
  }
  // the library: a section per theme (or, sorted by agent, a lane per agent with the skills that agent masters first)
  function libPane() {
    const all = of("lib");
    if (!all.length) {
      const here = of("pc").length;
      return `<div class="sk-empty"><span class="sk-empty-i">${icon("layers")}</span><h2>${esc(t("A biblioteca ainda está vazia"))}</h2>
        <p>${esc(t("Traz as skills que já usas neste computador, escolhe-as na Loja ou cola em cima o link de um repositório do GitHub. Cada skill fica com o agente do setor, e os agentes lêem-na antes de fazerem esse trabalho."))}</p>
        ${here ? `<button type="button" class="btn primary" data-take-all>${icon("plus")}${esc(t("Trazer as {n} skills deste PC", { n: here }))}</button>` : ""}</div>`;
    }
    const shown = all.filter(hit);
    if (!shown.length) return `<p class="sk-none">${esc(t("Nenhuma skill da biblioteca com «{q}».", { q }))}</p>`;
    if (by === "tema") return byTheme(shown).map((g) => themeLane(g, "lib")).join("") + (q ? "" : emptyThemes(all));
    const lanes = [...cast.map((c) => ({ c, list: shown.filter((k) => (k.crew || [])[0] === c.id) })), { c: null, list: shown.filter((k) => !castOf((k.crew || [])[0])) }];
    return lanes.filter((l) => l.list.length).map(({ c, list }) => `<section class="sk-lane sk-dept">
        <header>${c ? mono(c, "md") : `<span class="sk-fig none">${icon("layers")}</span>`}
          <div><b>${c ? `<small>${c.n}</small>` : ""}${esc(c ? c.name : t("Sem departamento"))}</b><span class="sk-para">${esc(c ? t(c.what) : t("Ninguém a usa ainda: abre-a e escolhe o departamento."))}</span></div>
          <em>${esc(t(list.length === 1 ? "1 skill" : "{n} skills", { n: list.length }))}</em></header>
        <div class="sk-grid">${list.map(card).join("")}</div></section>`).join("");
  }
  // this PC and the shop: by theme, or grouped by where they come from; each group with a way to bring all of it
  function morePane(kind) {
    const all = of(kind).filter(hit);
    if (!all.length) return `<p class="sk-none">${esc(q ? t("Nenhuma skill com «{q}».", { q }) : kind === "pc" ? t("Todas as skills deste PC já estão na biblioteca.") : t("A Loja não tem mais skills por trazer."))}</p>`;
    if (by === "tema") return byTheme(all).map((g) => themeLane(g, kind)).join("");
    const groups = new Map();
    for (const k of all) { if (!groups.has(k.where)) groups.set(k.where, []); groups.get(k.where).push(k); }
    return [...groups].map(([where, list]) => `<section class="sk-lane sk-src">
        <header><span class="sk-fig none">${icon(kind === "pc" ? "monitor" : "bag")}</span><div><b>${esc(where)}</b><span>${esc(t(list.length === 1 ? "1 skill" : "{n} skills", { n: list.length }))}</span></div>
          <button type="button" class="btn sk-take" data-take-group="${esc(where)}">${icon("plus")}${esc(list.length === 1 ? t("Trazer") : t("Trazer as {n}", { n: list.length }))}</button></header>
        <div class="sk-grid">${list.map(card).join("")}</div></section>`).join("");
  }
  function draw() {
    if (!$("sk-body")) return;
    paint($("sk-seg"), HALVES.map(([id, label]) => `<button type="button" data-half="${id}" class="${tab === id ? "on" : ""}">${esc(t(label))}<b>${S ? of(id).length : ""}</b></button>`).join(""));
    paint($("sk-by"), [["tema", "Tema"], ["dono", tab === "lib" ? "Departamento" : "Origem"]].map(([id, label]) => `<button type="button" data-by="${id}" class="${by === id ? "on" : ""}">${esc(t(label))}</button>`).join(""));
    const sum = document.querySelector(".ph p");
    if (S && sum) sum.textContent = summary();
    paint($("sk-nav"), S ? themeNav(current()) : "");
    paint($("sk-body"), !S ? ui.skeleton(5) : tab === "lib" ? libPane() : morePane(tab));
  }
  function summary() {
    const lib = of("lib"), themes = new Set(lib.map((k) => k.tema));
    return lib.length ? t("{n} skills na biblioteca, em {th} temas. Uma skill é um método escrito: o departamento que a usa lê-a antes de fazer esse trabalho.", { n: lib.length, th: themes.size })
      : t("Ainda nenhuma skill na biblioteca.");
  }
  function jump(name) {
    const el = document.getElementById(themeId(name));
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---------------------------------------------------------------- a skill, open
  async function openSkill(name) {
    const k = S.skills.find((x) => x.name === name);
    if (!k) return;
    reading = name;
    openModal(`<div class="sk-read">${ui.skeleton(6)}</div>`);
    $("modal-box").classList.add("sk-modal");
    $("modal-box").onclick = (e) => { if (e.target.closest("[data-own], [data-take], [data-drop], [data-tema]")) click(e); };
    let doc;
    try { doc = await api(`/api/skills/${encodeURIComponent(name)}`); } catch (e) { doc = { text: e.message, files: [] }; }
    if (reading !== name || $("modal").hidden) return;
    $("modal-box").innerHTML = reader(k, doc);
  }
  function reader(k, doc) {
    const body = String(doc.text || "").replace(/^---[\s\S]*?\n---\s*/, "").trim();
    const owners = new Set(k.crew || []);
    return `<div class="sk-read">
      <header><div><small>${esc(`${t(k.tema || "Outras")} · ${k.kind === "lib" ? t("Biblioteca da Empresa AMG") : k.where || ""}`)}</small><h2>${esc(k.name)}</h2>${k.about ? `<p>${esc(k.about)}</p>` : ""}</div>
        <button type="button" class="sk-x" data-close aria-label="${esc(t("Fechar"))}">${icon("x")}</button></header>
      ${k.kind === "lib" ? `<section><small class="sk-k">${esc(t("Tema"))}</small><div class="sk-themes" id="sk-themes">${(S.temas || []).map((th) => `<button type="button" data-tema="${esc(th.name)}" class="${(k.tema || "Outras") === th.name ? "on" : ""}" title="${esc(t(th.para))}">${themeIcon(th.name)}${esc(t(th.name))}</button>`).join("")}</div></section>` : ""}
      ${k.kind === "lib" ? `<section><small class="sk-k">${esc(t("Que departamentos a usam"))}</small><div class="sk-who" id="sk-who">${cast.map((c) => `<button type="button" data-own="${c.id}" class="${owners.has(c.id) ? "on" : ""}" aria-pressed="${owners.has(c.id)}">${mono(c, "sm")}<b>${esc(c.name)}</b><span>${c.n}</span></button>`).join("")}</div></section>` : ""}
      <section><small class="sk-k">${esc(t("O que diz"))}</small><div class="sk-md">${md(body)}</div></section>
      ${(doc.files || []).length > 1 ? `<section><small class="sk-k">${esc(t("Ficheiros ({n})", { n: doc.files.length }))}</small><p class="sk-files">${doc.files.map((f) => `<span>${esc(f)}</span>`).join("")}</p></section>` : ""}
      <footer>${k.kind === "lib" ? `<button type="button" class="btn sk-drop" data-drop="${esc(k.name)}">${icon("trash")}${esc(t("Tirar da biblioteca"))}</button>`
        : `<button type="button" class="btn primary" data-take="${esc(k.name)}">${icon("plus")}${esc(t("Trazer para a biblioteca"))}</button>`}</footer></div>`;
  }

  // ---------------------------------------------------------------- what the person does
  async function load() {
    try { S = await api("/api/skills"); } catch (e) { if ($("sk-body")) $("sk-body").innerHTML = ui.error(e.message); return; }
    draw();
  }
  // what came in and where it went: «site-x entrou em Sites», or how many and in how many themes
  function landed(added) {
    if (!added.length) return "";
    const themes = [...new Set(added.map((n) => (S.skills.find((k) => k.name === n && k.kind === "lib") || {}).tema).filter(Boolean))];
    if (added.length === 1) return themes.length ? t("{s} entrou na biblioteca, no tema {th}", { s: added[0], th: t(themes[0]) }) : t("1 skill nova na biblioteca");
    return t(themes.length === 1 ? "{n} skills novas, no tema {th}" : "{n} skills novas, arrumadas em {k} temas", { n: added.length, th: t(themes[0] || ""), k: themes.length });
  }
  async function take(names, all, btn) {
    if (btn) { btn.disabled = true; btn.innerHTML = `${icon("spark")}${esc(t("A trazer…"))}`; }
    try {
      const r = await api("/api/skills/adopt", { method: "POST", body: (all ? { all: true } : { names }) });
      if (!$("modal").hidden) closeModal();
      if (all) { tab = "lib"; sessionStorage.setItem("sk.tab", tab); }
      await load();
      flash(landed(r.added) || t("Essas já lá estavam."));
    } catch (e) { flash(e.message); if (btn) btn.disabled = false; }
  }
  async function fromGithub(e) {
    e.preventDefault();
    const input = $("sk-url"), url = input.value.trim(), go = $("sk-go");
    if (!url) return input.focus();
    go.disabled = true; go.textContent = t("A ler o GitHub…");
    try {
      const r = await api("/api/skills/import", { method: "POST", body: ({ url }) });
      input.value = ""; tab = "lib"; sessionStorage.setItem("sk.tab", tab);
      await load();
      flash(landed(r.added) || t("Esse link não trouxe nada de novo: essas skills já estão na biblioteca."));
    } catch (err) { flash(err.message); }
    go.disabled = false; go.textContent = t("Trazer");
  }
  async function own(name, id, btn) {
    const k = S.skills.find((x) => x.name === name);
    if (!k) return;
    const crew = k.crew.includes(id) ? k.crew.filter((c) => c !== id) : [...k.crew, id];
    btn.classList.toggle("on");
    try {
      const r = await api(`/api/skills/${encodeURIComponent(name)}/crew`, { method: "PUT", body: ({ crew }) });
      k.crew = r.crew;
      draw();
    } catch (e) { btn.classList.toggle("on"); flash(e.message); }
  }
  async function retheme(name, tema, btn) {
    const k = S.skills.find((x) => x.name === name);
    if (!k || k.tema === tema) return;
    const before = k.tema;
    document.querySelectorAll("#sk-themes [data-tema]").forEach((b) => b.classList.toggle("on", b === btn));
    try {
      await api(`/api/skills/${encodeURIComponent(name)}/tema`, { method: "PUT", body: ({ tema }) });
      k.tema = tema;
      draw();
      flash(t("{s} passou para o tema {th}", { s: name, th: t(tema) }));
    } catch (e) {
      document.querySelectorAll("#sk-themes [data-tema]").forEach((b) => b.classList.toggle("on", b.dataset.tema === before));
      flash(e.message);
    }
  }
  async function drop(name, btn) {
    btn.disabled = true;
    try {
      await api(`/api/skills/${encodeURIComponent(name)}`, { method: "DELETE" });
      flash(t("{s} saiu da biblioteca", { s: name }));
      closeModal();
      await load();
    } catch (e) { flash(e.message); btn.disabled = false; }
  }
  function click(e) {
    const at = (sel) => e.target.closest(sel);
    let b;
    if ((b = at("[data-half]"))) { tab = b.dataset.half; sessionStorage.setItem("sk.tab", tab); draw(); }
    else if ((b = at("[data-by]"))) { by = b.dataset.by; sessionStorage.setItem("sk.by", by); draw(); }
    else if ((b = at("[data-jump]"))) jump(b.dataset.jump);
    else if ((b = at("[data-find]"))) {   // an empty theme of the library: where its skills are, this PC first
      const name = b.dataset.find;
      tab = of("pc").some((k) => k.tema === name) ? "pc" : "loja"; by = "tema"; q = "";
      sessionStorage.setItem("sk.tab", tab); sessionStorage.setItem("sk.by", by); $("sk-q").value = "";
      draw(); jump(name);
    }
    else if ((b = at("[data-take-all]"))) take([], true, b);
    else if ((b = at("[data-take-group]"))) take(of(tab).filter((k) => k.where === b.dataset.takeGroup && hit(k)).map((k) => k.name), false, b);
    else if ((b = at("[data-take-tema]"))) take(of(tab).filter((k) => k.tema === b.dataset.takeTema && hit(k)).map((k) => k.name), false, b);
    else if ((b = at("[data-tema]"))) retheme(reading, b.dataset.tema, b);
    else if ((b = at("[data-take]"))) take([b.dataset.take], false, b);
    else if ((b = at("[data-own]"))) own(reading, b.dataset.own, b);
    else if ((b = at("[data-drop]"))) drop(b.dataset.drop, b);
    else if ((b = at("[data-skill]"))) openSkill(b.dataset.skill);
  }

  HUB_VIEWS.skills = async function () {
    await Promise.all([lazyFile("hub/crew.js"), lazyFile("hub/crew.css").catch(() => {})]);
    faces();
    page(`${ui.head("", t("Skills"), t("Os métodos escritos que os departamentos leem antes de trabalhar, arrumados por tema."), `<form class="sk-get" id="sk-get" autocomplete="off"><label>${icon("link")}<input id="sk-url" placeholder="${esc(t("Cola um link do GitHub com skills"))}"></label><button class="btn primary" id="sk-go">${esc(t("Trazer"))}</button></form>`)}
      <div class="sk-bar"><nav class="sk-seg" id="sk-seg"></nav><nav class="sk-seg sk-by" id="sk-by" aria-label="${esc(t("Arrumar por"))}"></nav><label class="sk-q">${icon("search")}<input id="sk-q" type="search" placeholder="${esc(t("Procurar skills"))}" value="${esc(q)}"></label></div>
      <nav class="sk-nav" id="sk-nav"></nav>
      <div class="sk-body" id="sk-body"></div>`);
    $("view").onclick = click;
    $("view").onkeydown = (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.matches(".sk-card")) { e.preventDefault(); openSkill(e.target.dataset.skill); } };
    $("sk-q").oninput = (e) => { q = e.target.value; draw(); };
    $("sk-get").onsubmit = fromGithub;
    draw();
    await load();
    const asked = sessionStorage.getItem("sk.open");   // a department's sheet sent us to one of its skills
    if (asked) { sessionStorage.removeItem("sk.open"); openSkill(asked); }
  };
})();
