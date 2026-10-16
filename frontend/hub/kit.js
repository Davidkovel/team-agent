// Kit do Claude (#/kit), a tab of Trabalho: the same Claude Code on every PC of the team (backend/app/claude_kit.py).
// Asked for by Marco on 16 Oct: «adicionar isso também lá no widget, na zona de trabalho». On top, one card per PC: on,
// off or the PC itself off, and on this PC the one button that turns the kit on here (only for the person whose PC it
// is: it installs the others' plugins and skills on it). Below, which PC has each plugin and each personal skill, and
// what is on its way here.
(function () {
  let K = null, timer = 0;
  const STATE = { on: ["ok", "Ligado"], off: ["warn", "Desligado"], down: ["", "PC desligado"] };
  const plain = (key) => key.split("@")[0];
  const iso = (sec) => (sec ? new Date(sec * 1000).toISOString() : null);
  const first = (who) => String(nameOf(who) || who || "?").split(" ")[0];

  function pcs() {
    const h = K.here;
    return [{ who: h.who, state: h.on ? "on" : "off", plugins: h.plugins, skills: [...h.skills, ...h.came], here: true }, ...K.peers];
  }
  const travels = (p) => (p.plugins || []).filter((k) => !K.fora[k]);   // the ones kept out are not counted

  function pcCard(p) {
    const [tone, label] = STATE[p.state] || STATE.down, h = K.here;
    const n = travels(p).length, s = (p.skills || []).length;
    const facts = `<span class="kt-st ${tone}"><i></i>${esc(t(label))}</span>` + (p.state === "on" ? `<span><b>${n}</b> ${t(n === 1 ? "plugin" : "plugins")}</span><span><b>${s}</b> ${t(s === 1 ? "skill" : "skills")}</span>` : "");
    let foot = "";
    if (p.here) {
      const busy = h.busy ? `<span class="kt-busy"><i></i>${esc(t("A instalar o que falta…"))}</span>` : "";
      const waiting = h.on && h.waiting.length && !h.busy ? `<span class="kt-note">${esc(t(h.waiting.length === 1 ? "1 plugin a caminho" : "{n} plugins a caminho", { n: h.waiting.length }))}</span>` : "";
      const last = h.on && h.at ? `<span class="kt-note">${esc(t("Última volta"))} ${esc(fmt.ago(iso(h.at)))}</span>` : "";
      const noClaude = h.claude ? "" : `<span class="kt-note warn">${esc(t("O Claude Code não está instalado neste PC"))}</span>`;
      foot = !h.can ? `<p class="kt-why">${esc(t("Só a pessoa deste PC o liga ou desliga."))}</p>`
        : h.on ? `<div class="kt-act">${busy}${waiting}${last}${noClaude}<button type="button" class="btn quiet kt-off" data-kit="off">${esc(t("Desligar"))}</button></div>`
        : `<p class="kt-why">${esc(t("Liga e este PC recebe os plugins e as skills dos outros PCs, e dá os teus. Desligas quando quiseres."))}</p>
           <button type="button" class="btn primary kt-on" data-kit="on">${icon("bolt")}${esc(t("Ligar o kit neste PC"))}</button>${noClaude}`;
    } else if (p.state === "off") {
      foot = `<p class="kt-why">${esc(t("Liga-se no widget do {n}: Trabalho › Kit do Claude.", { n: first(p.who) }))}</p>`;
    } else if (p.state === "down") {
      foot = `<p class="kt-why">${esc(t("Quando o PC ligar, aparece aqui o que tem."))}</p>`;
    }
    return `<article class="kt-pc ${p.state} ${p.here ? "here" : ""}">
      <header>${ui.avatar(nameOf(p.who))}<div><b>${esc(nameOf(p.who))}</b><span>${esc(t(p.here ? "Este PC" : "Outro PC"))}</span></div></header>
      <div class="kt-facts">${facts}</div>${foot}</article>`;
  }

  // one cell: what that PC has of this plugin or skill
  function cell(p, key, kind) {
    const h = K.here;
    if (p.state !== "on" && !p.here) return `<span class="kt-c none" title="${esc(t(p.state === "off" ? "Kit desligado nesse PC" : "PC desligado"))}">·</span>`;
    if (kind === "plugin") {
      if ((p.plugins || []).includes(key)) return `<span class="kt-c yes" title="${esc(t("Tem"))}">${icon("tick")}</span>`;
      if (!p.here) return `<span class="kt-c no">—</span>`;
      if (K.fora[key]) return `<span class="kt-c no">—</span>`;
      if (h.removed.includes(key)) return `<span class="kt-c gone" title="${esc(t("Tiraste-o deste PC: não volta"))}">${esc(t("tirado"))}</span>`;
      if (h.failed[key]) return `<span class="kt-c bad" title="${esc(h.failed[key])}">${esc(t("falhou"))}</span>`;
      if (h.waiting.includes(key)) return `<span class="kt-c way">${esc(t(h.busy ? "a instalar" : "a caminho"))}</span>`;
      return `<span class="kt-c no">—</span>`;
    }
    if (p.here && h.came.includes(key)) return `<span class="kt-c yes copy" title="${esc(t("Veio de outro PC"))}">${icon("tick")}</span>`;
    return (p.skills || []).includes(key) ? `<span class="kt-c yes" title="${esc(t("É dele"))}">${icon("tick")}</span>` : `<span class="kt-c no">—</span>`;
  }

  function matrix(list, kind) {
    const all = pcs();
    const head = `<div class="kt-row kt-head" style="--n:${all.length}"><span></span>${all.map((p) => `<span class="kt-who" title="${esc(nameOf(p.who))}">${ui.avatar(nameOf(p.who), "sm")}<em>${esc(p.here ? t("Aqui") : first(p.who))}</em></span>`).join("")}</div>`;
    return `<div class="kt-table">${head}${list.map((key) => {
      const out = kind === "plugin" && K.fora[key];
      const sub = out ? `${t("Fica de fora")}: ${K.fora[key]}` : kind === "plugin" ? K.about[key] || key.split("@")[1] : "";
      return `<div class="kt-row ${out ? "out" : ""}" style="--n:${all.length}"><div class="kt-name"><b>${esc(kind === "plugin" ? plain(key) : key)}</b>${sub ? `<span>${esc(sub)}</span>` : ""}</div>
        ${all.map((p) => cell(p, key, kind)).join("")}</div>`;
    }).join("")}</div>`;
  }

  function draw() {
    const all = pcs(), h = K.here;
    const plugins = [...new Set([...all.flatMap((p) => p.plugins || []), ...h.known, ...h.waiting])].filter((k) => !K.fora[k]).sort((a, b) => plain(a).localeCompare(plain(b)));
    const out = Object.keys(K.fora).filter((k) => all.some((p) => (p.plugins || []).includes(k)) || h.plugins.includes(k));
    const skills = [...new Set(all.flatMap((p) => p.skills || []))].sort();
    const on = all.filter((p) => p.state === "on").length;
    paint($("kt-body"), `<p class="kt-sum">${esc(t(on === 1 ? "1 de {m} PCs com o kit ligado." : "{n} de {m} PCs com o kit ligado.", { n: on, m: all.length }))}
        ${esc(t("Nada passa pelo GitHub: vai de PC para PC pela VPN da equipa."))}</p>
      <div class="kt-pcs">${all.map(pcCard).join("")}</div>
      ${ui.sec("Plugins", `<span class="kt-count">${plugins.length}</span>`)}
      ${plugins.length || out.length ? matrix([...plugins, ...out], "plugin") : `<p class="kt-none">${esc(t("Ainda não se sabe de plugins: liga o kit para ver os dos outros PCs."))}</p>`}
      ${ui.sec("Skills pessoais", `<span class="kt-count">${skills.length}</span>`)}
      ${skills.length ? matrix(skills, "skill") : `<p class="kt-none">${esc(t("Nenhuma skill pessoal à vista. As da biblioteca da empresa estão em Skills e chegam a todos pelo git."))}</p>`}
      <p class="kt-foot">${esc(t("Uma skill com um ficheiro .privada na pasta nunca sai do PC. Um plugin que tirares não volta a ser instalado. O kit dá uma volta de 30 em 30 minutos."))}</p>`);
    clearTimeout(timer);
    if (h.busy || (h.on && h.waiting.length)) timer = setTimeout(() => $("kt-body") && load(), 15000);   // follow the installs
  }

  async function load() {
    try {
      K = await api("/api/kit");
      draw();
    } catch (e) {
      if (e.message !== "unauthorized" && $("kt-body")) $("kt-body").innerHTML = ui.error(e.message);
    }
  }

  async function press(b) {
    const on = b.dataset.kit === "on";
    b.disabled = true;
    try {
      K = await api("/api/kit", { method: "POST", body: { on } });
      flash(t(on ? "Kit ligado: os plugins e as skills dos outros PCs começam a chegar." : "Kit desligado neste PC."));
      draw();
      if (on) setTimeout(() => $("kt-body") && load(), 8000);
    } catch (e) {
      b.disabled = false;
      flash(e.message);
    }
  }

  HUB_VIEWS.kit = async function () {
    page(`${ui.head("Trabalho", t("Kit do Claude"), t("O mesmo Claude Code em todos os PCs: os plugins e as skills pessoais de cada um chegam aos outros."))}
      <div id="kt-body">${ui.skeleton(6)}</div>`);
    $("view").onclick = (e) => {
      const b = e.target.closest("[data-kit]");
      if (b) press(b);
      else if (e.target.closest("[data-retry]")) load();
    };
    await load();
  };
})();
