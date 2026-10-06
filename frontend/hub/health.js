// Saúde: what the Agente AMG itself costs on each person's PC (backend/app/health.py, /api/health), against the regras
// de peso (docs/empresa-amg.md): widget and Hub under 1% of the PC idle, the big window under 3% open. Each PC measures
// itself once a minute and sync brings the others. Its own file, loaded when the page opens (lazyView in ui.js).
(function () {
  const PARTS = [["widget", "Widget", "O painel pequeno"], ["hub", "Hub", "O motor, em segundo plano"], ["web", "Janela grande", "A central de comando"]];
  const cpu = (v) => (v == null ? "—" : `${v < 10 ? v.toFixed(1).replace(".", ",") : Math.round(v)}%`);
  const ram = (v) => (v == null ? "" : v >= 1024 ? `${(v / 1024).toFixed(1).replace(".", ",")} GB` : `${v} MB`);

  function partRow(pc, [key, label, what], limits) {
    const value = pc[`${key}_cpu`], limit = limits[key];
    const tone = value == null ? "none" : value <= limit ? "ok" : value <= limit * 3 ? "warn" : "bad";
    const width = value == null ? 0 : Math.min(100, (value / (limit * 3)) * 100);
    return `<div class="hl-part ${tone}"><div class="hl-name"><b>${t(label)}</b><span>${t(what)}</span></div>
      <div class="hl-bar"><i style="width:${width.toFixed(1)}%"></i><u style="left:${(100 / 3).toFixed(2)}%" title="${t("limite")} ${cpu(limit)}"></u></div>
      <div class="hl-num"><b>${cpu(value)}</b><span>${esc(ram(pc[`${key}_ram`]))}</span></div></div>`;
  }

  function pcCard(pc, limits, every) {
    const stale = !pc.updated_at || Date.now() - new Date(pc.updated_at) > every * 3000;
    const over = PARTS.some(([key]) => pc[`${key}_cpu`] != null && pc[`${key}_cpu`] > limits[key]);
    return `<article class="hl-pc ${over ? "over" : ""} ${stale ? "stale" : ""}">
      <header>${ui.avatar(pc.name)}<div><b>${esc(pc.name)}</b><span>${pc.updated_at
        ? `${t(stale ? "última medição" : "medido")} ${esc(fmt.ago(pc.updated_at))}${pc.cores ? ` · ${pc.cores} ${t("núcleos")}` : ""}` : t("ainda sem medição")}</span></div>
        <em>${t(!pc.updated_at ? "—" : over ? "Pesado" : "Leve")}</em></header>
      ${PARTS.map((part) => partRow(pc, part, limits)).join("")}</article>`;
  }

  async function loadHealth() {
    if (!$("hl-pcs")) return;
    const d = await api("/api/health");
    paint($("hl-pcs"), d.pcs.map((pc) => pcCard(pc, d.limits, d.every)).join(""));
  }

  HUB_VIEWS.saude = async function () {
    page(`${ui.head("Sistema", t("Saúde"), t("Quanto o Agente AMG gasta em cada PC. Limites com tudo parado: widget e Hub abaixo de 1% do PC, janela grande aberta abaixo de 3%."))}
      <div class="hl-pcs" id="hl-pcs">${ui.skeleton(4)}</div>
      <p class="faint" style="margin-top:14px">${t("Cada PC mede-se a si próprio de minuto a minuto, com as contas do Windows (não pesa nada), e a sincronização traz os outros. A barra vai até três vezes o limite; o traço é o limite.")}</p>`);
    await loadHealth();
  };
  onLive(["tick"], () => loadHealth());
})();
