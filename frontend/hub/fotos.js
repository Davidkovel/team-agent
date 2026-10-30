// Fotos (#/fotos, 03 · Negócios): the Ten Fold's photo library (30 Oct, Marco: «uma livraria, uma cena para fotos... a gente
// tem que organizar bem aquilo»). backend/app/routers/photos.py. Laid out like the iPhone's Photos, in the agency's black and
// gold, next to its Chat: the albums on the left (the whole library first), the open one on the right as a grid by month.
// Photos go in with «Adicionar», a paste or a drop anywhere on the app, into the album that is open; each is made small here
// (≤ 2000 px, and a ≤ 480 px thumb for the grid) so it travels to the other PCs by sync. The brand work already in the
// company library (Marcas, Instagram) shows as albums of its own, to see and save but not to change.
(function () {
  const ALL = "", GERAL = "Geral";
  const REPO = [["marcas", "Marcas"], ["instagram", "Instagram"]];   // the company.json sections with photos
  let lib = { items: [], albums: [] }, repo = [], album = ALL, find = "", picking = false, picked = new Set(), fresh = [], sending = 0;
  const imgUrl = (p, size = "full") => (p.repo ? `/api/hub/tenfold/${p.section}/media?id=${encodeURIComponent(p.rid)}&token=${encodeURIComponent(token)}`
    : `/api/photos/${p.id}/img?size=${size}&token=${encodeURIComponent(token)}`);
  const SAVE = '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/></svg>';
  const ARROW = (d) => `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
  const month = (iso) => { const d = iso ? new Date(iso) : null; if (!d || isNaN(d)) return t("Sem data"); const s = d.toLocaleDateString("pt-PT", { month: "long", year: "numeric" }); return s[0].toUpperCase() + s.slice(1); };
  const when = (iso) => (iso ? new Date(iso).toLocaleString("pt-PT", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

  // ---------------------------------------------------------------- what there is
  const albums = () => {
    const mine = lib.albums.map((a) => ({ ...a, cover: lib.items.find((p) => p.id === a.cover) }));
    fresh.filter((n) => !mine.some((a) => a.name === n)).forEach((n) => mine.unshift({ name: n, count: 0, cover: null }));
    const theirs = [...new Set(repo.map((p) => p.album))].map((n) => { const in_ = repo.filter((p) => p.album === n); return { name: n, count: in_.length, cover: in_[0], repo: true }; });
    return { mine, theirs };
  };
  const all = () => lib.items.concat(repo);
  const shown = () => {
    const q = find.trim().toLowerCase();
    return all().filter((p) => (album === ALL || p.album === album) && (!q || `${p.title} ${p.album} ${p.by}`.toLowerCase().includes(q)));
  };
  const isRepo = (name) => repo.some((p) => p.album === name) && !lib.items.some((p) => p.album === name);

  async function load() {
    const [mine, ...secs] = await Promise.all([api("/api/photos"), ...REPO.map(([id]) => api(`/api/hub/tenfold/${id}`).catch(() => ({ items: [] })))]);
    lib = mine;
    repo = secs.flatMap((d, i) => (d.items || []).filter((it) => /\.(png|jpe?g|webp|gif)$/i.test(it.name)).map((it) => ({
      repo: true, section: REPO[i][0], rid: it.id, id: `r:${REPO[i][0]}:${it.id}`, album: it.group || REPO[i][1],
      title: it.name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " "), by: "", created_at: it.mtime ? new Date(it.mtime * 1000).toISOString() : null })));
    fresh = fresh.filter((n) => !lib.albums.some((a) => a.name === n));
  }

  // ---------------------------------------------------------------- drawing
  function railHtml() {
    const { mine, theirs } = albums();
    const row = (a, label = a.name) => `<button type="button" class="ft-alb ${album === (a.all ? ALL : a.name) ? "on" : ""}" data-album="${esc(a.all ? ALL : a.name)}">
      <span class="ft-cover">${a.cover ? `<img src="${imgUrl(a.cover, "thumb")}" alt="" loading="lazy" decoding="async">` : icon("fotos")}</span>
      <span class="ft-alb-t"><b>${esc(label)}</b><small>${a.count === 1 ? t("1 foto") : t("{n} fotos", { n: a.count })}</small></span></button>`;
    return `<header class="ft-rail-h"><span class="ft-seal">TF</span><div><b>${esc(t("Fotos"))}</b><small>Ten Fold</small></div></header>
      <label class="ft-find">${icon("search")}<input id="ft-find" type="search" placeholder="${esc(t("Procurar"))}" value="${esc(find)}" autocomplete="off"></label>
      <div class="ft-albs">
        ${row({ all: true, name: "", count: all().length, cover: all()[0] }, t("Biblioteca"))}
        <div class="ft-cap"><span>${esc(t("Os nossos álbuns"))}</span><button type="button" class="ft-new" data-new-album title="${esc(t("Novo álbum"))}">${icon("plus")}</button></div>
        ${mine.length ? mine.map((a) => row(a)).join("") : `<p class="ft-none">${esc(t("Ainda não há álbuns. Cria um ou junta fotos à Biblioteca."))}</p>`}
        ${theirs.length ? `<div class="ft-cap"><span>${esc(t("Trabalho da agência"))}</span></div>${theirs.map((a) => row(a)).join("")}` : ""}
      </div>`;
  }

  function gridHtml() {
    const list = shown(), groups = [];
    list.forEach((p) => { const m = month(p.created_at); (groups.at(-1)?.m === m ? groups.at(-1) : (groups.push({ m, items: [] }), groups.at(-1))).items.push(p); });
    const title = album === ALL ? t("Biblioteca") : album, repoAlbum = album !== ALL && isRepo(album);
    const count = list.length === 1 ? t("1 foto") : t("{n} fotos", { n: list.length });
    const tools = picking
      ? `<span class="ft-picked">${picked.size ? (picked.size === 1 ? t("1 escolhida") : t("{n} escolhidas", { n: picked.size })) : t("Escolhe as fotos")}</span>
         <button type="button" class="ft-btn" data-move-picked ${picked.size ? "" : "disabled"}>${icon("folder")}${esc(t("Mover"))}</button>
         <button type="button" class="ft-btn bad" data-del-picked ${picked.size ? "" : "disabled"}>${icon("trash")}${esc(t("Apagar"))}</button>
         <button type="button" class="ft-btn" data-pick>${esc(t("Feito"))}</button>`
      : `${album !== ALL && !repoAlbum ? `<button type="button" class="ft-btn" data-rename-album>${esc(t("Mudar o nome"))}</button>` : ""}
         ${lib.items.length ? `<button type="button" class="ft-btn" data-pick>${esc(t("Selecionar"))}</button>` : ""}
         ${repoAlbum ? "" : `<button type="button" class="ft-btn gold" data-add>${icon("plus")}${esc(t("Adicionar"))}</button>`}`;
    const empty = find ? t("Nenhuma foto com «{q}».", { q: find })
      : repoAlbum ? "" : t("Arrasta fotos para aqui, cola-as, ou carrega em Adicionar.");
    return `<header class="ft-head">
        <button type="button" class="ft-back" data-album-back>${icon("chevron")}${esc(t("Álbuns"))}</button>
        <div class="ft-title"><h1>${esc(title)}</h1><small>${esc(count)}${repoAlbum ? ` · ${esc(t("do repositório da agência"))}` : ""}${sending ? ` · ${esc(t("a enviar {n}…", { n: sending }))}` : ""}</small></div>
        <div class="ft-tools">${tools}</div>
      </header>
      <div class="ft-body" id="ft-body">${groups.length ? groups.map((g) => `<section class="ft-month"><h2>${esc(g.m)}</h2><div class="ft-grid">${g.items.map((p) => `
        <button type="button" class="ft-ph ${picked.has(p.id) ? "picked" : ""} ${picking && p.repo ? "locked" : ""}" data-photo="${esc(String(p.id))}" aria-label="${esc(p.title || t("Foto"))}">
          <img src="${imgUrl(p, "thumb")}" alt="" loading="lazy" decoding="async">${picking && !p.repo ? '<i class="ft-tick"></i>' : ""}</button>`).join("")}</div></section>`).join("")
        : `<div class="ft-empty">${icon("fotos")}<p>${esc(empty)}</p>${repoAlbum || find ? "" : `<button type="button" class="ft-btn gold" data-add>${icon("plus")}${esc(t("Adicionar fotos"))}</button>`}</div>`}</div>
      <input type="file" id="ft-file" accept="image/*" multiple hidden>`;
  }

  function draw() {
    const box = $("ft");
    if (!box) return;
    box.classList.toggle("open", album !== ALL || box.classList.contains("open"));
    const rail = $("ft-rail"), focus = document.activeElement?.id === "ft-find", at = focus ? document.activeElement.selectionStart : 0;
    rail.innerHTML = railHtml();
    $("ft-main").innerHTML = gridHtml();
    if (focus) { const f = $("ft-find"); f.focus({ preventScroll: true }); f.setSelectionRange(at, at); }
    $("ft-find").oninput = (e) => { find = e.target.value; $("ft-main").innerHTML = gridHtml(); };
    $("ft-file").onchange = (e) => { add([...e.target.files]); e.target.value = ""; };
  }

  // ---------------------------------------------------------------- adding: made small here, then one by one to the Hub
  function shrink(file, max, q) {
    return new Promise((ok, fail) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement("canvas");
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        const g = c.getContext("2d");
        g.fillStyle = "#000"; g.fillRect(0, 0, c.width, c.height);   // a transparent PNG would come out black-on-black otherwise
        g.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        ok(c.toDataURL("image/jpeg", q));
      };
      img.onerror = () => { URL.revokeObjectURL(url); fail(new Error(t("Não consegui abrir essa foto."))); };
      img.src = url;
    });
  }
  async function add(files) {
    files = files.filter((f) => f && f.type.startsWith("image/"));
    if (!files.length) return flash(t("Isso não é uma foto."));
    const into = album === ALL || isRepo(album) ? GERAL : album;
    sending += files.length; draw();
    let ok = 0;
    for (const f of files) {
      try {
        const [image, thumb] = await Promise.all([shrink(f, 2000, 0.85), shrink(f, 480, 0.78)]);
        await api("/api/photos", { method: "POST", body: { image, thumb, album: into, title: f.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 160) } });
        ok++;
      } catch (err) { flash(err.message); }
      sending--;
    }
    if (album === ALL || isRepo(album)) album = into;
    await load(); draw();
    if (ok) flash(ok === 1 ? t("1 foto em «{a}».", { a: into }) : t("{n} fotos em «{a}».", { n: ok, a: into }));
  }

  // ---------------------------------------------------------------- a small sheet that asks for a name
  function ask(title, { value = "", ok = "Guardar", options = [] } = {}) {
    return new Promise((done) => {
      const box = Object.assign(document.createElement("div"), { className: "ft-sheet-bg" });
      box.innerHTML = `<form class="ft-sheet"><h3>${esc(t(title))}</h3>
        ${options.length ? `<div class="ft-opts">${options.map((o) => `<button type="button" class="ft-opt" data-opt="${esc(o)}">${esc(o)}</button>`).join("")}</div>` : ""}
        <input id="ft-ask" value="${esc(value)}" maxlength="80" placeholder="${esc(t(options.length ? "…ou um álbum novo" : "Nome"))}" autocomplete="off">
        <div class="ft-sheet-a"><button type="button" class="ft-btn" data-no>${esc(t("Cancelar"))}</button><button class="ft-btn gold">${esc(t(ok))}</button></div></form>`;
      const close = (v) => { box.remove(); document.removeEventListener("keydown", key); done(v); };
      const key = (e) => { if (e.key === "Escape") close(null); };
      box.onclick = (e) => {
        if (e.target === box || e.target.closest("[data-no]")) return close(null);
        const o = e.target.closest("[data-opt]"); if (o) close(o.dataset.opt);
      };
      box.querySelector("form").onsubmit = (e) => { e.preventDefault(); const v = $("ft-ask").value.trim(); close(v || null); };
      document.addEventListener("keydown", key);
      document.body.append(box);
      $("ft-ask").focus(); $("ft-ask").select();
    });
  }
  const ourAlbums = () => [...new Set([...lib.albums.map((a) => a.name), ...fresh])];

  async function move(ids) {
    const to = await ask("Mover para que álbum?", { ok: "Mover", options: ourAlbums().filter((a) => a !== album) });
    if (!to) return false;
    try { for (const id of ids) await api(`/api/photos/${id}`, { method: "PATCH", body: { album: to } }); }
    catch (err) { flash(err.message); }
    flash(ids.length === 1 ? t("Foto movida para «{a}».", { a: to }) : t("{n} fotos movidas para «{a}».", { n: ids.length, a: to }));
    await load(); draw();
    return true;
  }
  async function remove(ids) {
    try { for (const id of ids) await api(`/api/photos/${id}`, { method: "DELETE" }); }
    catch (err) { flash(err.message); }
    flash(ids.length === 1 ? t("Foto apagada.") : t("{n} fotos apagadas.", { n: ids.length }));
    await load(); draw();
  }

  // ---------------------------------------------------------------- the photo, big: ← → pass, Esc closes
  function viewer(id) {
    const list = shown();
    let i = Math.max(0, list.findIndex((p) => String(p.id) === String(id)));
    const box = Object.assign(document.createElement("div"), { className: "ft-view" });
    const paintV = () => {
      const p = list[i], confirm = box.dataset.confirm === "1";
      box.innerHTML = `<header class="ft-view-h"><button type="button" class="ft-ic" data-close aria-label="${esc(t("Fechar"))}">${icon("x")}</button>
          <div><b>${esc(p.title || t("Foto"))}</b><small>${esc([p.album, p.by, when(p.created_at)].filter(Boolean).join(" · "))}</small></div><span>${i + 1} / ${list.length}</span></header>
        <div class="ft-view-img"><img src="${imgUrl(p)}" alt="">
          ${list.length > 1 ? `<button type="button" class="ft-ic ft-prev" data-step="-1" aria-label="${esc(t("Anterior"))}">${ARROW("M15 5l-7 7 7 7")}</button>
          <button type="button" class="ft-ic ft-next" data-step="1" aria-label="${esc(t("Seguinte"))}">${ARROW("M9 5l7 7-7 7")}</button>` : ""}</div>
        <footer class="ft-view-a"><a class="ft-btn" href="${imgUrl(p)}" download="${esc((p.title || "foto").replace(/[\\/:*?"<>|]+/g, "-"))}.jpg">${SAVE}${esc(t("Guardar"))}</a>
          ${p.repo ? "" : `<button type="button" class="ft-btn" data-title>${esc(t("Mudar o nome"))}</button><button type="button" class="ft-btn" data-move>${icon("folder")}${esc(t("Mover"))}</button>
          <button type="button" class="ft-btn bad" data-del>${icon("trash")}${esc(t(confirm ? "Carrega outra vez para apagar" : "Apagar"))}</button>`}</footer>`;
    };
    const close = () => { box.remove(); document.removeEventListener("keydown", key); };
    const step = (d) => { i = (i + d + list.length) % list.length; box.dataset.confirm = ""; paintV(); };
    const key = (e) => { if (document.querySelector(".ft-sheet-bg")) return; if (e.key === "Escape") close(); if (e.key === "ArrowLeft") step(-1); if (e.key === "ArrowRight") step(1); };
    box.onclick = async (e) => {
      const p = list[i];
      if (e.target.closest("[data-close]") || e.target === box || e.target.classList.contains("ft-view-img")) return close();
      const s = e.target.closest("[data-step]"); if (s) return step(Number(s.dataset.step));
      if (e.target.closest("[data-move]")) { if (await move([p.id])) close(); return; }
      if (e.target.closest("[data-title]")) {
        const v = await ask("Nome da foto", { value: p.title });
        if (v) { await api(`/api/photos/${p.id}`, { method: "PATCH", body: { title: v } }).catch((err) => flash(err.message)); p.title = v; paintV(); load().then(draw); }
        return;
      }
      if (e.target.closest("[data-del]")) {
        if (box.dataset.confirm !== "1") { box.dataset.confirm = "1"; return paintV(); }
        close(); return remove([p.id]);
      }
    };
    let x0 = null;   // a swipe on the phone passes too
    box.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
    box.addEventListener("touchend", (e) => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1); });
    document.addEventListener("keydown", key);
    paintV();
    document.body.append(box);
  }

  // ---------------------------------------------------------------- the clicks of the app
  function wire() {
    const box = $("ft");
    box.onclick = async (e) => {
      const a = e.target.closest("[data-album]");
      if (a) { album = a.dataset.album; picking = false; picked.clear(); box.classList.add("open"); return draw(); }
      if (e.target.closest("[data-album-back]")) { box.classList.remove("open"); album = ALL; return draw(); }
      if (e.target.closest("[data-add]")) return $("ft-file").click();
      if (e.target.closest("[data-new-album]")) {
        const name = await ask("Novo álbum", { ok: "Criar" });
        if (!name) return;
        if (!ourAlbums().includes(name)) fresh.unshift(name);
        album = name; box.classList.add("open"); draw();
        return;
      }
      if (e.target.closest("[data-rename-album]")) {
        const to = await ask("Nome do álbum", { value: album });
        if (!to || to === album) return;
        if (fresh.includes(album)) { fresh = fresh.map((n) => (n === album ? to : n)); album = to; return draw(); }
        try { await api("/api/photos/album", { method: "POST", body: { name: album, to } }); album = to; await load(); draw(); }
        catch (err) { flash(err.message); }
        return;
      }
      if (e.target.closest("[data-pick]")) { picking = !picking; picked.clear(); return draw(); }
      if (e.target.closest("[data-move-picked]")) { if (await move([...picked])) { picking = false; picked.clear(); draw(); } return; }
      if (e.target.closest("[data-del-picked]")) {
        const b = e.target.closest("[data-del-picked]");
        if (!b.dataset.sure) { b.dataset.sure = "1"; b.lastChild.textContent = t("Carrega outra vez"); return; }
        const ids = [...picked]; picking = false; picked.clear(); return remove(ids);
      }
      const ph = e.target.closest("[data-photo]");
      if (ph) {
        const id = ph.dataset.photo, p = all().find((x) => String(x.id) === id);
        if (!picking) return viewer(id);
        if (!p || p.repo) return;
        picked.has(p.id) ? picked.delete(p.id) : picked.add(p.id);
        $("ft-main").innerHTML = gridHtml();
      }
    };
    box.addEventListener("dragover", (e) => { if ([...(e.dataTransfer?.types || [])].includes("Files")) { e.preventDefault(); box.classList.add("drop"); } });
    box.addEventListener("dragleave", (e) => { if (!box.contains(e.relatedTarget)) box.classList.remove("drop"); });
    box.addEventListener("drop", (e) => { e.preventDefault(); box.classList.remove("drop"); add([...(e.dataTransfer?.files || [])]); });
  }
  document.addEventListener("paste", (e) => {
    if (!$("ft") || document.querySelector(".ft-sheet-bg")) return;
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/"));
    if (files.length) { e.preventDefault(); add(files); }
  });

  // a photo added on another PC shows here at once (sync rings `photo`, routers/photos.py too)
  onLive(["photo"], () => ($("ft") && !sending ? load().then(draw).catch(() => {}) : Promise.resolve()));

  HUB_VIEWS.fotos = async function (r) {
    if (r.company) album = decodeURIComponent(r.company);
    page(`<div class="ft ${album !== ALL ? "open" : ""}" id="ft"><nav class="ft-rail" id="ft-rail"></nav><section class="ft-main" id="ft-main"></section></div>`);
    $("ft-rail").innerHTML = `<p class="ft-none">${esc(t("A carregar…"))}</p>`;
    wire();
    try { await load(); } catch (err) { $("ft-main").innerHTML = `<div class="ft-empty"><p>${esc(err.message)}</p></div>`; return; }
    draw();
  };
})();
