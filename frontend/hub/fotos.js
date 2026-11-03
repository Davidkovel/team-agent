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
  // 3 Nov, Marco: «deixa-me trocar de nome as fotos e organizar... tipo Logotipo, ou banner»: each photo has a type, chosen in
  // the photo (or for many at once with Selecionar), and the chips over the grid show only one type. Same list as the Hub's
  // KINDS (routers/photos.py) and mensagens.js; the brand work of the repository gets its type from its file's name.
  const KINDS = ["Logótipo", "Banner", "Post", "Story", "Fotografia", "Mockup", "Apresentação", "Outro"];
  const KIND_WORDS = [["Logótipo", ["logo", "logotipo", "marca", "brand", "icon"]], ["Banner", ["banner", "capa", "cover", "header", "cartaz"]],
    ["Story", ["story", "stories", "reel"]], ["Apresentação", ["slide", "carrossel", "carousel", "deck", "apresenta"]], ["Mockup", ["mockup", "mock"]],
    ["Post", ["post", "instagram", "feed"]], ["Fotografia", ["img_", "dsc", "foto", "photo", "whatsapp image", "screenshot"]]];
  const guessKind = (s) => { const l = String(s || "").toLowerCase(); const k = KIND_WORDS.find(([, w]) => w.some((x) => l.includes(x))); return k ? k[0] : ""; };
  const NONE = "—";   // the chip of the photos without a type
  let kind = "", freshKinds = [];
  // every type there is: the usual ones that have photos, the team's own, and the ones just made (still empty)
  const allKinds = () => {
    const used = [...new Set(all().map((p) => p.kind).filter(Boolean))];
    const own = used.filter((k) => !KINDS.includes(k)).sort((a, b) => a.localeCompare(b, "pt"));
    return [...KINDS.filter((k) => used.includes(k)), ...own, ...freshKinds.filter((k) => !used.includes(k))];
  };
  const kindCover = (k) => all().find((p) => p.kind === k);
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
    return all().filter((p) => (album === ALL || p.album === album) && (!kind || (kind === NONE ? !p.kind : p.kind === kind))
      && (!q || `${p.title} ${p.album} ${p.by} ${p.kind || ""}`.toLowerCase().includes(q)));
  };
  const isRepo = (name) => repo.some((p) => p.album === name) && !lib.items.some((p) => p.album === name);

  async function load() {
    const [mine, ...secs] = await Promise.all([api("/api/photos"), ...REPO.map(([id]) => api(`/api/hub/tenfold/${id}`).catch(() => ({ items: [] })))]);
    lib = mine;
    repo = secs.flatMap((d, i) => (d.items || []).filter((it) => /\.(png|jpe?g|webp|gif)$/i.test(it.name)).map((it) => ({
      repo: true, section: REPO[i][0], rid: it.id, id: `r:${REPO[i][0]}:${it.id}`, album: it.group || REPO[i][1],
      title: it.name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " "), kind: guessKind(`${it.name} ${it.group || REPO[i][1]}`), by: "",
      created_at: it.mtime ? new Date(it.mtime * 1000).toISOString() : null })));
    fresh = fresh.filter((n) => !lib.albums.some((a) => a.name === n));
  }

  // ---------------------------------------------------------------- drawing
  function railHtml() {
    const { mine, theirs } = albums();
    const row = (a, label = a.name) => `<button type="button" class="ft-alb ${album === (a.all ? ALL : a.name) && !(a.all && kind) ? "on" : ""}" data-album="${esc(a.all ? ALL : a.name)}" ${a.all || a.repo ? "" : `data-drop-album="${esc(a.name)}"`}>
      <span class="ft-cover">${a.cover ? `<img src="${imgUrl(a.cover, "thumb")}" alt="" loading="lazy" decoding="async">` : icon("fotos")}</span>
      <span class="ft-alb-t"><b>${esc(label)}</b><small>${a.count === 1 ? t("1 foto") : t("{n} fotos", { n: a.count })}</small></span></button>`;
    return `<header class="ft-rail-h"><img class="ft-seal tf-logo" src="assets/tenfold-tf.png" alt="Ten Fold"><div><b>${esc(t("Fotos"))}</b><small>Ten Fold</small></div></header>
      <label class="ft-find">${icon("search")}<input id="ft-find" type="search" placeholder="${esc(t("Procurar"))}" value="${esc(find)}" autocomplete="off"></label>
      <div class="ft-albs">
        ${row({ all: true, name: "", count: all().length, cover: all()[0] }, t("Biblioteca"))}
        <div class="ft-cap"><span>${esc(t("Tipos"))}</span><button type="button" class="ft-new" data-new-kind title="${esc(t("Novo tipo"))}">${icon("plus")}</button></div>
        ${allKinds().map((k) => { const n = all().filter((p) => p.kind === k).length, c = kindCover(k);
          return `<button type="button" class="ft-alb ft-ty ${album === ALL && kind === k ? "on" : ""}" data-open-kind="${esc(k)}" data-drop-kind="${esc(k)}">
            <span class="ft-cover">${c ? `<img src="${imgUrl(c, "thumb")}" alt="" loading="lazy" decoding="async">` : icon("fotos")}</span>
            <span class="ft-alb-t"><b>${esc(t(k))}</b><small>${n === 1 ? t("1 foto") : n ? t("{n} fotos", { n }) : t("Vazio · arrasta fotos para aqui")}</small></span></button>`; }).join("")}
        <div class="ft-cap"><span>${esc(t("Os nossos álbuns"))}</span><button type="button" class="ft-new" data-new-album title="${esc(t("Novo álbum"))}">${icon("plus")}</button></div>
        ${mine.length ? mine.map((a) => row(a)).join("") : `<p class="ft-none">${esc(t("Ainda não há álbuns. Cria um ou junta fotos à Biblioteca."))}</p>`}
        ${theirs.length ? `<div class="ft-cap"><span>${esc(t("Trabalho da agência"))}</span></div>${theirs.map((a) => row(a)).join("")}` : ""}
      </div>`;
  }

  // the chips of the types, over the grid: only the ones this album has, each with how many
  function kindsHtml() {
    const here = all().filter((p) => album === ALL || p.album === album);
    if (!here.length) return "";
    const n = (k) => here.filter((p) => (k === NONE ? !p.kind : p.kind === k)).length;
    const chips = KINDS.filter((k) => n(k)).map((k) => [k, k, n(k)]);
    if (n(NONE)) chips.push([NONE, t("Sem tipo"), n(NONE)]);
    if (kind && !chips.some(([k]) => k === kind) && !freshKinds.includes(kind)) kind = "";
    return `<nav class="ft-kinds"><button type="button" class="${kind ? "" : "on"}" data-kind="">${esc(t("Tudo"))}<i>${here.length}</i></button>${chips.map(([k, l, c]) =>
      `<button type="button" class="${kind === k ? "on" : ""}" data-kind="${esc(k)}">${esc(t(l))}<i>${c}</i></button>`).join("")}</nav>`;
  }

  function gridHtml() {
    const kinds = kindsHtml();
    const list = shown(), groups = [];
    list.forEach((p) => { const m = month(p.created_at); (groups.at(-1)?.m === m ? groups.at(-1) : (groups.push({ m, items: [] }), groups.at(-1))).items.push(p); });
    const title = album === ALL ? (kind && kind !== NONE ? t(kind) : t("Biblioteca")) : album, repoAlbum = album !== ALL && isRepo(album);
    const count = list.length === 1 ? t("1 foto") : t("{n} fotos", { n: list.length });
    const tools = picking
      ? `<span class="ft-picked">${picked.size ? (picked.size === 1 ? t("1 escolhida") : t("{n} escolhidas", { n: picked.size })) : t("Escolhe as fotos")}</span>
         <button type="button" class="ft-btn" data-kind-picked ${picked.size ? "" : "disabled"}>${esc(t("Tipo"))}</button>
         <button type="button" class="ft-btn" data-move-picked ${picked.size ? "" : "disabled"}>${icon("folder")}${esc(t("Mover"))}</button>
         <button type="button" class="ft-btn bad" data-del-picked ${picked.size ? "" : "disabled"}>${icon("trash")}${esc(t("Apagar"))}</button>
         <button type="button" class="ft-btn" data-pick>${esc(t("Feito"))}</button>`
      : `${album !== ALL && !repoAlbum ? `<button type="button" class="ft-btn" data-rename-album>${esc(t("Mudar o nome"))}</button>` : ""}
         ${album === ALL && kind && kind !== NONE ? `<button type="button" class="ft-btn" data-rename-kind>${esc(t("Mudar o nome do tipo"))}</button>` : ""}
         ${lib.items.length ? `<button type="button" class="ft-btn" data-pick>${esc(t("Selecionar"))}</button>` : ""}
         ${repoAlbum ? "" : `<button type="button" class="ft-btn gold" data-add>${icon("plus")}${esc(t("Adicionar"))}</button>`}`;
    const empty = find ? t("Nenhuma foto com «{q}».", { q: find })
      : repoAlbum ? "" : t("Arrasta fotos para aqui, cola-as, ou carrega em Adicionar.");
    return `<header class="ft-head">
        <button type="button" class="ft-back" data-album-back>${icon("chevron")}${esc(t("Álbuns"))}</button>
        <div class="ft-title"><h1>${esc(title)}</h1><small>${esc(count)}${repoAlbum ? ` · ${esc(t("do repositório da agência"))}` : ""}${sending ? ` · ${esc(t("a enviar {n}…", { n: sending }))}` : ""}</small></div>
        <div class="ft-tools">${tools}</div>
      </header>${kinds}
      <div class="ft-body" id="ft-body">${groups.length ? groups.map((g) => `<section class="ft-month"><h2>${esc(g.m)}</h2><div class="ft-grid">${g.items.map((p) => `
        <button type="button" class="ft-ph ${picked.has(p.id) ? "picked" : ""} ${picking && p.repo ? "locked" : ""}" data-photo="${esc(String(p.id))}" aria-label="${esc(p.title || t("Foto"))}" ${p.repo ? "" : 'draggable="true"'}>
          <span class="ft-ph-img"><img src="${imgUrl(p, "thumb")}" alt="" loading="lazy" decoding="async">${p.kind ? `<em class="ft-kind">${esc(t(p.kind))}</em>` : ""}${picking && !p.repo ? '<i class="ft-tick"></i>' : ""}</span>
          <small class="ft-ph-t">${esc(p.title || t("Sem nome"))}</small></button>`).join("")}</div></section>`).join("")
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
          <div>${p.repo ? `<b>${esc(p.title || t("Foto"))}</b>` : `<input class="ft-name" id="ft-name" value="${esc(p.title || "")}" placeholder="${esc(t("Dá um nome a esta foto"))}" maxlength="160" title="${esc(t("Clica para mudar o nome; Enter guarda"))}">`}
            <small>${esc([p.album, p.by, when(p.created_at)].filter(Boolean).join(" · "))}</small></div><span>${i + 1} / ${list.length}</span></header>
        <div class="ft-view-img"><img src="${imgUrl(p)}" alt="">
          ${list.length > 1 ? `<button type="button" class="ft-ic ft-prev" data-step="-1" aria-label="${esc(t("Anterior"))}">${ARROW("M15 5l-7 7 7 7")}</button>
          <button type="button" class="ft-ic ft-next" data-step="1" aria-label="${esc(t("Seguinte"))}">${ARROW("M9 5l7 7-7 7")}</button>` : ""}</div>
        ${p.repo ? "" : `<div class="ft-view-k"><span>${esc(t("Tipo"))}</span>${[...new Set([...KINDS, ...allKinds()])].map((k) => `<button type="button" class="${p.kind === k ? "on" : ""}" data-set-kind="${esc(k)}">${esc(t(k))}</button>`).join("")}<button type="button" class="ft-k-new" data-new-kind-here title="${esc(t("Novo tipo"))}">+</button></div>`}
        <footer class="ft-view-a"><a class="ft-btn" href="${imgUrl(p)}" download="${esc((p.title || "foto").replace(/[\\/:*?"<>|]+/g, "-"))}.jpg">${SAVE}${esc(t("Guardar"))}</a>
          ${p.repo ? "" : `<button type="button" class="ft-btn" data-move>${icon("folder")}${esc(t("Mover"))}</button>
          <button type="button" class="ft-btn bad" data-del>${icon("trash")}${esc(t(confirm ? "Carrega outra vez para apagar" : "Apagar"))}</button>`}</footer>`;
    };
    const saveName = async () => {   // the name field of the photo: Enter or leaving it saves
      const p = list[i], f = $("ft-name");
      if (!f || p.repo) return;
      const v = f.value.trim();
      if (!v || v === (p.title || "")) { f.value = p.title || ""; return; }
      try { await api(`/api/photos/${p.id}`, { method: "PATCH", body: { title: v } }); p.title = v; flash(t("Nome guardado.")); load().then(draw); }
      catch (err) { flash(err.message); f.value = p.title || ""; }
    };
    const close = () => { saveName(); box.remove(); document.removeEventListener("keydown", key); };
    const step = (d) => { saveName(); i = (i + d + list.length) % list.length; box.dataset.confirm = ""; paintV(); };
    const key = (e) => {
      if (document.querySelector(".ft-sheet-bg")) return;
      if (e.target && e.target.id === "ft-name") { if (e.key === "Enter") { e.preventDefault(); e.target.blur(); } else if (e.key === "Escape") { e.target.value = list[i].title || ""; e.target.blur(); } return; }
      if (e.key === "Escape") close(); if (e.key === "ArrowLeft") step(-1); if (e.key === "ArrowRight") step(1);
    };
    box.addEventListener("focusout", (e) => { if (e.target.id === "ft-name") saveName(); });
    box.onclick = async (e) => {
      const p = list[i];
      if (e.target.closest("[data-close]") || e.target === box || e.target.classList.contains("ft-view-img")) return close();
      const s = e.target.closest("[data-step]"); if (s) return step(Number(s.dataset.step));
      if (e.target.closest("#ft-name")) return;
      if (e.target.closest("[data-move]")) { if (await move([p.id])) close(); return; }
      if (e.target.closest("[data-new-kind-here]")) {
        const v = await ask("Novo tipo", { ok: "Criar" });
        if (!v) return;
        try { const r = await api(`/api/photos/${p.id}`, { method: "PATCH", body: { kind: v } }); p.kind = r.kind; paintV(); load().then(draw); }
        catch (err) { flash(err.message); }
        return;
      }
      const k = e.target.closest("[data-set-kind]");
      if (k) {   // the same chip again takes the type off
        const to = p.kind === k.dataset.setKind ? "" : k.dataset.setKind;
        try { await api(`/api/photos/${p.id}`, { method: "PATCH", body: { kind: to } }); p.kind = to; paintV(); load().then(draw); }
        catch (err) { flash(err.message); }
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
      if (a) { album = a.dataset.album; kind = ""; picking = false; picked.clear(); box.classList.add("open"); return draw(); }
      const ok_ = e.target.closest("[data-open-kind]");
      if (ok_) { album = ALL; kind = ok_.dataset.openKind; picking = false; picked.clear(); box.classList.add("open"); return draw(); }
      if (e.target.closest("[data-new-kind]")) {
        const name = await ask("Novo tipo", { ok: "Criar" });
        if (!name) return;
        if (!allKinds().some((k) => k.toLowerCase() === name.toLowerCase())) freshKinds.push(name);
        album = ALL; kind = allKinds().find((k) => k.toLowerCase() === name.toLowerCase()) || name; box.classList.add("open"); draw();
        flash(t("Arrasta fotos para «{k}» na coluna da esquerda, ou escolhe o tipo na foto.", { k: name }));
        return;
      }
      if (e.target.closest("[data-rename-kind]")) {
        const to = await ask("Nome do tipo", { value: kind });
        if (!to || to === kind) return;
        if (freshKinds.includes(kind)) { freshKinds = freshKinds.map((k) => (k === kind ? to : k)); kind = to; return draw(); }
        try { await api("/api/photos/kind", { method: "POST", body: { name: kind, to } }); kind = to; await load(); draw(); }
        catch (err) { flash(err.message); }
        return;
      }
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
      const kc = e.target.closest("[data-kind]");
      if (kc) { kind = kc.dataset.kind; $("ft-main").innerHTML = gridHtml(); return; }
      if (e.target.closest("[data-kind-picked]")) {
        const to = await ask("Que tipo são?", { ok: "Guardar", options: [...new Set([...KINDS, ...allKinds()])], value: "" });
        if (!to) return;
        const k2 = allKinds().concat(KINDS).find((x) => x.toLowerCase() === to.toLowerCase()) || to;
        try { for (const id of picked) await api(`/api/photos/${id}`, { method: "PATCH", body: { kind: k2 } }); }
        catch (err) { flash(err.message); }
        flash(picked.size === 1 ? t("1 foto é agora «{k}».", { k: k2 }) : t("{n} fotos são agora «{k}».", { n: picked.size, k: k2 }));
        picking = false; picked.clear(); await load(); draw();
        return;
      }
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
    // organizing (3 Nov, Marco: «mete de forma em que consigamos mexer e nós também organizar»): a photo dragged onto an
    // album of the left moves there, onto a type takes that type; with photos picked, all of them go
    let dragging = null;
    box.addEventListener("dragstart", (e) => {
      const ph = e.target.closest && e.target.closest(".ft-ph[draggable]");
      if (!ph) return;
      const id = Number(ph.dataset.photo);
      dragging = picking && picked.has(id) ? [...picked] : [id];
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", "amg-photos");
      box.classList.add("dragging");
    });
    box.addEventListener("dragend", () => { dragging = null; box.classList.remove("dragging"); box.querySelectorAll(".drop-on").forEach((x) => x.classList.remove("drop-on")); });
    box.addEventListener("dragover", (e) => {
      if (!dragging) return;
      const tgt = e.target.closest("[data-drop-album],[data-drop-kind]");
      box.querySelectorAll(".drop-on").forEach((x) => x !== tgt && x.classList.remove("drop-on"));
      if (tgt) { e.preventDefault(); tgt.classList.add("drop-on"); }
    });
    box.addEventListener("drop", async (e) => {
      if (!dragging) return;
      e.preventDefault(); e.stopPropagation();
      const tgt = e.target.closest("[data-drop-album],[data-drop-kind]"), ids = dragging;
      dragging = null; box.classList.remove("dragging");
      if (!tgt) return;
      tgt.classList.remove("drop-on");
      const toAlbum = tgt.dataset.dropAlbum, toKind = tgt.dataset.dropKind;
      try { for (const id of ids) await api(`/api/photos/${id}`, { method: "PATCH", body: toAlbum ? { album: toAlbum } : { kind: toKind } }); }
      catch (err) { flash(err.message); }
      const n = ids.length;
      flash(toAlbum ? (n === 1 ? t("Foto movida para «{a}».", { a: toAlbum }) : t("{n} fotos movidas para «{a}».", { n, a: toAlbum }))
        : (n === 1 ? t("1 foto é agora «{k}».", { k: toKind }) : t("{n} fotos são agora «{k}».", { n, k: toKind })));
      freshKinds = freshKinds.filter((k) => k !== toKind);
      if (picking) { picking = false; picked.clear(); }
      await load(); draw();
    }, true);
    box.addEventListener("dragover", (e) => { if ([...(e.dataTransfer?.types || [])].includes("Files")) { e.preventDefault(); box.classList.add("drop"); } });
    box.addEventListener("dragleave", (e) => { if (!box.contains(e.relatedTarget)) box.classList.remove("drop"); });
    box.addEventListener("drop", (e) => { if (!e.dataTransfer?.files?.length) return; e.preventDefault(); box.classList.remove("drop"); add([...e.dataTransfer.files]); });
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
