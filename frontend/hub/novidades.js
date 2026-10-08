// Novidades: what changed in the Hub and the widget, who changed it, in one short line each. It reads the commits of
// the Agente AMG repository (/api/commits, commits.py) and keeps only the first idea of each message: "Área: o que
// mudou — pormenores; mais" becomes a chip with the area and the "o que mudou"; the rest folds under a tap. Commits
// that only touched notes (*.md) are left out: they change nothing anybody sees. Unseen ones are marked and counted on
// the tab, against the last time this person opened the page (kept in this browser).
(function () {
  const REPO = "Agente AMG", SEEN = "hub.novidadesSeen";
  const WHO = { "david kovel": "Kovel", davidkovel: "Kovel", daviddsstt: "David", "marco goucha": "Marco", "slayer-marco": "Marco" };
  const who = (author) => WHO[(author || "").trim().toLowerCase()] || (author || "?").trim().split(/\s+/)[0];
  const PLACES = [[/^widget\//, "Widget"], [/mobile\.(js|css)$|sw\.js$|manifest\.json$/, "Telemóvel"], [/^frontend\//, "Hub"], [/^backend\//, "Hub"],
    [/^agent\//, "Agente"], [/^scripts\/|\.cmd$|\.ps1$/, "Ferramentas"]];

  const seenAt = () => {
    try { const v = localStorage.getItem(SEEN); if (v) return v; } catch { /* private window */ }
    return new Date(Date.now() - 2 * 864e5).toISOString();   // the first time: the last two days count as new
  };
  const markSeen = (iso) => { try { localStorage.setItem(SEEN, iso); } catch { /* private window */ } };

  const notesOnly = (c) => c.files?.length && c.files.every((f) => /\.md$/i.test(f.path));
  const ours = (list) => (list || []).filter((c) => c.repo === REPO && !/^Merge /.test(c.message) && !notesOnly(c))
    .sort((a, b) => new Date(b.date) - new Date(a.date));   // the Hub sorts the dates as text, and they come with different time zones

  const cut = (s, n) => (s.length > n ? s.slice(0, n - 1).replace(/[\s,;:.]+\S*$/, "") + "…" : s);
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
  // "Telemóvel: tarefas abrem ao estilo iOS — pormenor; outro" → area "Telemóvel", head "Tarefas abrem ao estilo iOS",
  // more ["Pormenor", "Outro", …the body's "- " lines]
  function brief(c) {
    const m = c.message.match(/^([^:]{2,40}):\s+(.+)$/);
    const area = m ? m[1].trim() : "", rest = m ? m[2] : c.message;
    const parts = rest.split(/\s+[—–-]\s+|;\s+/).map((s) => s.trim()).filter(Boolean);
    const body = (c.body || "").split("\n").map((l) => l.trim()).filter((l) => /^[-*•]\s+/.test(l)).map((l) => l.replace(/^[-*•]\s+/, ""));
    const places = [...new Set((c.files || []).flatMap((f) => PLACES.filter(([rx]) => rx.test(f.path)).map(([, p]) => p).slice(0, 1)))];
    return { area, places: places.filter((p) => p.toLowerCase() !== area.toLowerCase()).slice(0, 2), head: cap(cut(parts[0] || rest, 120)),
      more: [...parts.slice(1), ...body].map((s) => cap(cut(s, 160))).slice(0, 6) };
  }

  const dayOf = (iso) => {
    const d = new Date(iso), today = new Date(); today.setHours(0, 0, 0, 0);
    const diff = Math.round((today - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
    if (diff <= 0) return t("Hoje");
    if (diff === 1) return t("Ontem");
    const s = d.toLocaleDateString("pt-PT", diff < 7 ? { weekday: "long" } : { day: "numeric", month: "long" });
    return s[0].toUpperCase() + s.slice(1);
  };
  const hhmm = (iso) => new Date(iso).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });

  function rowHtml(c, seen) {
    const b = brief(c), name = who(c.author), fresh = new Date(c.date) > new Date(seen) && name.toLowerCase() !== (me.display_name || "").toLowerCase();
    const chips = [b.area, ...b.places].filter(Boolean).map((a) => `<span class="nv-chip">${esc(a)}</span>`).join("");
    return `<article class="nv-row ${fresh ? "fresh" : ""} ${b.more.length ? "can-open" : ""}" data-nv="${esc(c.sha)}">
      ${ui.avatar(name)}<div class="nv-main"><div class="nv-top"><b>${esc(name)}</b>${chips}<time>${hhmm(c.date)}</time>${fresh ? `<i class="nv-new">${t("Novo")}</i>` : ""}</div>
        <p class="nv-head">${esc(b.head)}</p>
        ${b.more.length ? `<ul class="nv-more">${b.more.map((x) => `<li>${esc(x)}</li>`).join("")}</ul><span class="nv-fold">${t("Ver pormenores")}</span>` : ""}</div></article>`;
  }

  HUB_VIEWS.novidades = async function () {
    page(`${ui.head("Equipa", t("Novidades"), t("O que mudou no Hub e no widget, e quem mudou. Toca numa linha para ver os pormenores."))}
      <div id="nv-filter" class="nv-filter"></div><div id="nv-list">${ui.skeleton(6)}</div>`);
    const seen = seenAt();
    let list, person = "";
    try { list = ours(await api("/api/commits?limit=100")); } catch (e) { $("nv-list").innerHTML = ui.error(e.message); return; }
    if (list[0]) markSeen(list[0].date);
    setBadge(0);
    const draw = () => {
      const people = [...new Set(list.map((c) => who(c.author)))];
      $("nv-filter").innerHTML = people.length > 1 ? [["", "Todos"], ...people.map((p) => [p, p])]
        .map(([id, label]) => `<button data-who="${esc(id)}" class="${id === person ? "on" : ""}">${esc(t(label))}</button>`).join("") : "";
      const shown = list.filter((c) => !person || who(c.author) === person);
      if (!shown.length) { $("nv-list").innerHTML = ui.empty("spark", "Ainda sem novidades", "Quando alguém mudar o Hub ou o widget, aparece aqui."); return; }
      const days = [];
      for (const c of shown) { const d = dayOf(c.date); (days.at(-1)?.[0] === d ? days.at(-1)[1] : days[days.push([d, []]) - 1][1]).push(c); }
      $("nv-list").innerHTML = days.map(([d, cs]) => `<section class="nv-day"><h4>${esc(d)}<i>${cs.length}</i></h4><div class="nv-card">${cs.map((c) => rowHtml(c, seen)).join("")}</div></section>`).join("");
    };
    draw();
    $("view").onclick = (e) => {
      const f = e.target.closest("[data-who]");
      if (f) { person = f.dataset.who; return draw(); }
      const row = e.target.closest(".nv-row.can-open");
      if (row) row.classList.toggle("open");
    };
  };

  // the count on the tab: changes by somebody else since this person last opened the page
  function setBadge(n) {
    badgeCount.novidades = n;
    document.querySelectorAll('[data-badge="novidades"]').forEach((b) => { b.textContent = n; b.hidden = !n; });
  }
  async function count() {
    if (typeof me === "undefined" || !me || location.hash.startsWith("#/novidades")) return;
    try {
      const seen = seenAt();
      setBadge(ours(await api("/api/commits?limit=60")).filter((c) => new Date(c.date) > new Date(seen) && who(c.author).toLowerCase() !== (me.display_name || "").toLowerCase()).length);
    } catch { /* the Hub will say when it does not answer */ }
  }
  setTimeout(count, 4000);
  setInterval(count, 120000);
})();
