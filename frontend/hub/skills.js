// Skills (#/skills): the company's skills library, the Empresa AMG's space for them. Asked for by Marco on 14 Oct: bring
// every skill in, have the agents master them, and keep them easy for each agent to use. Three halves:
// - Biblioteca: the skills the company has (library/skills in git, backend/app/routers/skills.py), one lane per agent with
//   the skills that agent masters. The automatic agent reads them with its `skills` tool, and the briefing tells each
//   crew member their own (agent/team_agent/tools/skills_tool.py).
// - Neste PC: the skills installed here (the person's own, the plugins', claude.ai's) that are not in the library yet.
// - Loja: those in the catalogs of the plugin marketplaces this Claude Code knows.
// A GitHub link (a repository, a folder or a SKILL.md) brings in every skill it has. A click on a skill opens it: what it
// says, who masters it (a touch per agent) and the way in or out of the library.
(function () {
  let S = null, cast = [], tab = sessionStorage.getItem("sk.tab") || "lib", q = "", reading = null;
  const HALVES = [["lib", "Biblioteca"], ["pc", "Neste PC"], ["loja", "Loja"]];
  const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const castOf = (id) => cast.find((c) => c.id === id);
  const of = (kind) => (S ? S.skills.filter((k) => k.kind === kind) : []);
  const hit = (k) => !q || fold(`${k.name} ${k.about} ${k.where || ""}`).includes(fold(q));

  function faces() {
    const P = window.CrewPeople;
    cast = (window.CrewCast || []).map((c) => {
      const look = c.look || (P && P.LOOKS[c.id]);
      return { id: c.id, name: c.name, what: c.what, color: c.color, face: P && look ? P.portrait(look, c.id) : "", figure: P && look ? P.portrait(look, c.id, true) : "" };
    });
  }

  // ---------------------------------------------------------------- pieces
  const face = (c, cls = "") => (c && c.face ? `<img class="cr-px ${cls}" src="${c.face}" alt="" title="${esc(c.name)}">` : "");
  function card(k) {
    const owners = (k.crew || []).map(castOf).filter(Boolean);
    const foot = k.kind === "lib"
      ? `<span class="sk-faces">${owners.map((c) => face(c)).join("")}</span><small>${esc(owners.length ? owners.map((c) => c.name).join(", ") : t("Sem agente"))}</small>`
      : `<small>${esc(k.where || "")}</small><button type="button" class="btn sk-take" data-take="${esc(k.name)}">${icon("plus")}${esc(t("Trazer"))}</button>`;
    return `<div class="sk-card" data-skill="${esc(k.name)}" role="button" tabindex="0"><b>${esc(k.name)}</b><p>${esc(k.about || t("Sem descrição."))}</p><footer>${foot}</footer></div>`;
  }
  // the library: a lane per agent, with the skills that agent masters first among its owners (each skill shown once)
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
    const lanes = [...cast.map((c) => ({ c, list: shown.filter((k) => (k.crew || [])[0] === c.id) })), { c: null, list: shown.filter((k) => !castOf((k.crew || [])[0])) }];
    return lanes.filter((l) => l.list.length).map(({ c, list }) => `<section class="sk-lane" style="--p:${c ? c.color : "#8b95a1"}">
        <header>${c && c.figure ? `<img class="cr-px sk-fig" src="${c.figure}" alt="">` : `<span class="sk-fig none">${icon("layers")}</span>`}
          <div><b>${esc(c ? c.name : t("Sem agente"))}</b><span>${esc(c ? t(c.what) : t("Ninguém a domina ainda: abre-a e escolhe quem"))}</span></div>
          <em>${esc(t(list.length === 1 ? "1 skill" : "{n} skills", { n: list.length }))}</em></header>
        <div class="sk-grid">${list.map(card).join("")}</div></section>`).join("");
  }
  // this PC and the shop: grouped by where they come from, each group with a way to bring all of it
  function morePane(kind) {
    const all = of(kind).filter(hit);
    if (!all.length) return `<p class="sk-none">${esc(q ? t("Nenhuma skill com «{q}».", { q }) : kind === "pc" ? t("Todas as skills deste PC já estão na biblioteca.") : t("A Loja não tem mais skills por trazer."))}</p>`;
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
    paint($("sk-sum"), S ? esc(summary()) : "");
    paint($("sk-body"), !S ? ui.skeleton(5) : tab === "lib" ? libPane() : morePane(tab));
  }
  function summary() {
    const lib = of("lib"), owned = new Set(lib.flatMap((k) => k.crew || []));
    return lib.length ? t("{n} skills na biblioteca, de {a} agentes. Os agentes lêem-nas antes de trabalhar.", { n: lib.length, a: owned.size })
      : t("Ainda nenhuma skill na biblioteca.");
  }

  // ---------------------------------------------------------------- a skill, open
  async function openSkill(name) {
    const k = S.skills.find((x) => x.name === name);
    if (!k) return;
    reading = name;
    openModal(`<div class="sk-read">${ui.skeleton(6)}</div>`);
    $("modal-box").classList.add("sk-modal");
    $("modal-box").onclick = (e) => { if (e.target.closest("[data-own], [data-take], [data-drop]")) click(e); };
    let doc;
    try { doc = await api(`/api/skills/${encodeURIComponent(name)}`); } catch (e) { doc = { text: e.message, files: [] }; }
    if (reading !== name || $("modal").hidden) return;
    $("modal-box").innerHTML = reader(k, doc);
  }
  function reader(k, doc) {
    const body = String(doc.text || "").replace(/^---[\s\S]*?\n---\s*/, "").trim();
    const owners = new Set(k.crew || []);
    return `<div class="sk-read">
      <header><div><small>${esc(k.kind === "lib" ? t("Biblioteca da Empresa AMG") : k.where || "")}</small><h2>${esc(k.name)}</h2>${k.about ? `<p>${esc(k.about)}</p>` : ""}</div>
        <button type="button" class="sk-x" data-close aria-label="${esc(t("Fechar"))}">${icon("x")}</button></header>
      ${k.kind === "lib" ? `<section><small class="sk-k">${esc(t("Quem a domina"))}</small><div class="sk-who" id="sk-who">${cast.map((c) => `<button type="button" data-own="${c.id}" class="${owners.has(c.id) ? "on" : ""}" style="--p:${c.color}">${face(c)}<b>${esc(c.name)}</b><span>${esc(t(c.what))}</span></button>`).join("")}</div></section>` : ""}
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
  async function take(names, all, btn) {
    if (btn) { btn.disabled = true; btn.innerHTML = `${icon("spark")}${esc(t("A trazer…"))}`; }
    try {
      const r = await api("/api/skills/adopt", { method: "POST", body: JSON.stringify(all ? { all: true } : { names }) });
      flash(r.added.length ? t(r.added.length === 1 ? "1 skill nova na biblioteca" : "{n} skills novas na biblioteca", { n: r.added.length }) : t("Essas já lá estavam."));
      if (!$("modal").hidden) closeModal();
      if (all) { tab = "lib"; sessionStorage.setItem("sk.tab", tab); }
      await load();
    } catch (e) { flash(e.message); if (btn) btn.disabled = false; }
  }
  async function fromGithub(e) {
    e.preventDefault();
    const input = $("sk-url"), url = input.value.trim(), go = $("sk-go");
    if (!url) return input.focus();
    go.disabled = true; go.textContent = t("A ler o GitHub…");
    try {
      const r = await api("/api/skills/import", { method: "POST", body: JSON.stringify({ url }) });
      flash(r.added.length ? t(r.added.length === 1 ? "1 skill nova: {s}" : "{n} skills novas", { n: r.added.length, s: r.added[0] }) : t("Esse link não trouxe nada de novo: essas skills já estão na biblioteca."));
      input.value = ""; tab = "lib"; sessionStorage.setItem("sk.tab", tab);
      await load();
    } catch (err) { flash(err.message); }
    go.disabled = false; go.textContent = t("Trazer");
  }
  async function own(name, id, btn) {
    const k = S.skills.find((x) => x.name === name);
    if (!k) return;
    const crew = k.crew.includes(id) ? k.crew.filter((c) => c !== id) : [...k.crew, id];
    btn.classList.toggle("on");
    try {
      const r = await api(`/api/skills/${encodeURIComponent(name)}/crew`, { method: "PUT", body: JSON.stringify({ crew }) });
      k.crew = r.crew;
      draw();
    } catch (e) { btn.classList.toggle("on"); flash(e.message); }
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
    else if ((b = at("[data-take-all]"))) take([], true, b);
    else if ((b = at("[data-take-group]"))) take(of(tab).filter((k) => k.where === b.dataset.takeGroup && hit(k)).map((k) => k.name), false, b);
    else if ((b = at("[data-take]"))) take([b.dataset.take], false, b);
    else if ((b = at("[data-own]"))) own(reading, b.dataset.own, b);
    else if ((b = at("[data-drop]"))) drop(b.dataset.drop, b);
    else if ((b = at("[data-skill]"))) openSkill(b.dataset.skill);
  }

  HUB_VIEWS.skills = async function () {
    await Promise.all([lazyFile("hub/crew.js"), lazyFile("hub/crew-people.js")]);
    faces();
    page(`${ui.head("Empresa AMG", t("Skills"), "", `<form class="sk-get" id="sk-get" autocomplete="off"><label>${icon("link")}<input id="sk-url" placeholder="${esc(t("Cola um link do GitHub com skills"))}"></label><button class="btn primary" id="sk-go">${esc(t("Trazer"))}</button></form>`)}
      <p class="sk-sum" id="sk-sum"></p>
      <div class="sk-bar"><nav class="sk-seg" id="sk-seg"></nav><label class="sk-q">${icon("search")}<input id="sk-q" type="search" placeholder="${esc(t("Procurar skills"))}" value="${esc(q)}"></label></div>
      <div class="sk-body" id="sk-body"></div>`);
    $("view").onclick = click;
    $("view").onkeydown = (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.matches(".sk-card")) { e.preventDefault(); openSkill(e.target.dataset.skill); } };
    $("sk-q").oninput = (e) => { q = e.target.value; draw(); };
    $("sk-get").onsubmit = fromGithub;
    draw();
    await load();
  };
})();
