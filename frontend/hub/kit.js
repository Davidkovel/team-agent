// Kit do Claude (#/kit), a tab of Trabalho: the same Claude Code on every PC of the team (backend/app/claude_kit.py).
// Asked for by Marco on 16 Oct: «adicionar isso também lá no widget, na zona de trabalho». Built like every page
// (docs/hub-paginas.md): beside the title the state of the kit on this PC and its one action (turn it on here, only for the
// person whose PC it is: it installs the others' plugins and skills on it); then one card per PC (on, off or the PC itself
// off), and which PC has each plugin and each personal skill, and what is on its way here.
(function () {
  let K = null, timer = 0;
  const STATE = { on: ["ok", "Kit ligado"], off: ["wait", "Kit desligado"], down: ["off", "PC desligado"] };
  const plain = (key) => key.split("@")[0];
  const iso = (sec) => (sec ? new Date(sec * 1000).toISOString() : null);
  const first = (who) => String(nameOf(who) || who || "?").split(" ")[0];

  function pcs() {
    const h = K.here;
    return [{ who: h.who, state: h.on ? "on" : "off", plugins: h.plugins, skills: [...h.skills, ...h.came], here: true }, ...K.peers];
  }
  const travels = (p) => (p.plugins || []).filter((k) => !K.fora[k]);   // the ones kept out are not counted

  // the kit on this PC, beside the title: its state and the one thing to do
  function paintCtl() {
    const h = K.here;
    const chip = `<span class="kt-state st ${h.on ? "ok" : "wait"}"><i></i>${esc(t(h.on ? "Ligado neste PC" : "Desligado neste PC"))}</span>`;
    const act = !h.can ? "" : h.on ? `<button type="button" class="btn quiet" data-kit="off">${esc(t("Desligar"))}</button>`
      : `<button type="button" class="btn primary" data-kit="on">${icon("bolt")}${esc(t("Ligar o kit neste PC"))}</button>`;
    paint($("kt-ctl"), chip + act);
  }

  function pcCard(p) {
    const [tone, label] = STATE[p.state] || STATE.down, h = K.here;
    const n = travels(p).length, s = (p.skills || []).length;
    const facts = p.state === "on" ? `<div class="kt-facts"><span><b>${n}</b> ${t(n === 1 ? "plugin" : "plugins")}</span><span><b>${s}</b> ${t(s === 1 ? "skill pessoal" : "skills pessoais")}</span></div>` : "";
    let foot = "";
    if (p.here) {
      const notes = [
        h.busy ? `<span class="kt-busy"><i></i>${esc(t("A instalar o que falta…"))}</span>` : "",
        h.on && h.waiting.length && !h.busy ? `<span class="kt-note">${esc(t(h.waiting.length === 1 ? "1 plugin a caminho" : "{n} plugins a caminho", { n: h.waiting.length }))}</span>` : "",
        h.on && h.at ? `<span class="kt-note">${esc(t("Última volta"))} ${esc(fmt.ago(iso(h.at)))}</span>` : "",
        h.claude ? "" : `<span class="kt-note warn">${esc(t("O Claude Code não está instalado neste PC"))}</span>`,
      ].filter(Boolean).join("");
      const why = !h.can ? t("Só a pessoa deste PC o liga ou desliga.")
        : h.on ? "" : t("Ligado, este PC recebe os plugins e as skills dos outros PCs e dá os teus. Desligas quando quiseres.");
      foot = (why ? `<p class="kt-why">${esc(why)}</p>` : "") + (notes ? `<div class="kt-notes">${notes}</div>` : "");
    } else if (p.state === "off") {
      foot = `<p class="kt-why">${esc(t("Liga-se no widget do {n}: Trabalho › Kit do Claude.", { n: first(p.who) }))}</p>`;
    } else if (p.state === "down") {
      foot = `<p class="kt-why">${esc(t("Quando o PC ligar, aparece aqui o que tem."))}</p>`;
    }
    return `<article class="panel kt-pc ${p.state} ${p.here ? "here" : ""}">
      <header>${ui.avatar(nameOf(p.who))}<div><b>${esc(nameOf(p.who))}</b><span>${esc(t(p.here ? "Este PC" : "Outro PC"))}</span></div>
        <span class="st ${tone}"><i></i>${esc(t(label))}</span></header>${facts}${foot}</article>`;
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
    const head = `<div class="kt-row kt-head" style="--n:${all.length}"><span class="kt-col">${esc(t(kind === "plugin" ? "Plugin" : "Skill"))}</span>${all.map((p) =>
      `<span class="kt-who ${p.state === "on" || p.here ? "" : "dim"}" title="${esc(nameOf(p.who))} · ${esc(t((STATE[p.state] || STATE.down)[1]))}">${ui.avatar(nameOf(p.who), "sm")}<em>${esc(p.here ? t("Aqui") : first(p.who))}</em></span>`).join("")}</div>`;
    return `<div class="panel kt-table">${head}${list.map((key) => {
      const out = kind === "plugin" && K.fora[key];
      const sub = out ? `${t("Fica de fora")}: ${K.fora[key]}` : kind === "plugin" ? K.about[key] || key.split("@")[1] : "";
      return `<div class="kt-row ${out ? "out" : ""}" style="--n:${all.length}"><div class="kt-name"><b>${esc(kind === "plugin" ? plain(key) : key)}</b>${sub ? `<span title="${esc(sub)}">${esc(sub)}</span>` : ""}</div>
        ${all.map((p) => cell(p, key, kind)).join("")}</div>`;
    }).join("")}</div>`;
  }

  const legend = () => `<div class="kt-legend"><span><i class="kt-c yes">${icon("tick")}</i>${esc(t("Tem"))}</span>
    <span><i class="kt-c yes copy">${icon("tick")}</i>${esc(t("Veio de outro PC"))}</span><span><i class="kt-c way">${esc(t("a caminho"))}</i>${esc(t("Vai ser instalado aqui"))}</span>
    <span><i class="kt-c no">—</i>${esc(t("Não tem"))}</span><span><i class="kt-c none">·</i>${esc(t("Kit ou PC desligado"))}</span></div>`;

  function draw() {
    const all = pcs(), h = K.here;
    const plugins = [...new Set([...all.flatMap((p) => p.plugins || []), ...h.known, ...h.waiting])].filter((k) => !K.fora[k]).sort((a, b) => plain(a).localeCompare(plain(b)));
    const out = Object.keys(K.fora).filter((k) => all.some((p) => (p.plugins || []).includes(k)) || h.plugins.includes(k));
    const skills = [...new Set(all.flatMap((p) => p.skills || []))].sort();
    const on = all.filter((p) => p.state === "on").length;
    paintCtl();
    // the Painel's row (hub/painel.css): how far the team is from having the same kit on every PC
    const mine = h.plugins.filter((k) => plugins.includes(k)).length, failed = Object.keys(h.failed || {}).length;
    const kpis = ui.kpis([
      ui.kpi({ label: "Kit ligado", value: `${on}/${all.length}`, sub: t(on === all.length ? "em todos os PCs" : "PCs com o kit ligado"), viz: ui.ring(all.length ? (on / all.length) * 100 : null) }),
      ui.kpi({ label: "Plugins da equipa", value: plugins.length, sub: t("{n} neste PC", { n: mine }),
        viz: plugins.length ? ui.ring((mine / plugins.length) * 100) : "" }),
      ui.kpi({ label: "Skills pessoais", value: skills.length, sub: t("de todos os PCs"),
        viz: all.length > 1 && skills.length ? ui.cols(all.map((p) => (p.skills || []).length), { fat: true, hi: all.findIndex((p) => p.here) }) : "" }),
      ui.kpi({ label: "A caminho deste PC", value: h.waiting.length, sub: failed ? t("{n} falharam", { n: failed }) : h.busy ? t("a instalar agora") : t("nada a falhar"),
        cls: failed ? "warn" : "" }),
    ]);
    paint($("kt-body"), `${kpis}${ui.sec("PCs da equipa", `<span class="kt-aside">${esc(t(on === 1 ? "1 de {m} com o kit ligado" : "{n} de {m} com o kit ligado", { n: on, m: all.length }))}</span>`)}
      <div class="kt-pcs">${all.map(pcCard).join("")}</div>
      ${ui.sec("Plugins", `<span class="kt-count">${plugins.length}</span>`)}
      ${plugins.length || out.length ? matrix([...plugins, ...out], "plugin") + legend() : `<div class="panel">${ui.empty("plugins", "Ainda não se sabe de plugins", "Liga o kit para ver os dos outros PCs.")}</div>`}
      ${ui.sec("Skills pessoais", `<span class="kt-count">${skills.length}</span>`)}
      ${skills.length ? matrix(skills, "skill") : `<div class="panel">${ui.empty("skills", "Nenhuma skill pessoal à vista", "As da biblioteca da empresa estão em Skills e chegam a todos pelo git.")}</div>`}
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
    page(`${ui.head("Trabalho", t("Kit do Claude"), t("Os mesmos plugins e skills do Claude Code em todos os PCs, de PC para PC pela VPN da equipa (nada passa pelo GitHub)."),
      `<div class="kt-ctl" id="kt-ctl"></div>`)}
      <div id="kt-body">${ui.skeleton(6)}</div>`);
    $("view").onclick = (e) => {
      const b = e.target.closest("[data-kit]");
      if (b) press(b);
      else if (e.target.closest("[data-retry]")) load();
    };
    await load();
  };
})();
