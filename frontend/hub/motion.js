/* The Hub's motion, from the reels David sent on 31 Oct 2026 (a «Sales CRM» dashboard and the «Relay» landing): «tudo muito
   clean... movimentos suaves e tudo rápido com bons fps».
   - The marker under the tab you are on slides to the next one and stretches on the way: the edge in front leaves first and
     fast, the one behind follows (as in the reel's code: power3.out 0.30 s, power3.inOut 0.48 s). Sub-tabs and sidebar both.
   - Changing page, the new one comes up out of a blur, its blocks one after the other; the numbers count up from 0, the trend
     lines draw themselves and the bars grow.
   Only on a change of page: a page that redraws itself with fresh data (every few seconds) does not replay any of it. Nothing
   runs once it has arrived (transform/opacity/filter, on the compositor), and «reduce motion» turns it all off. */
(() => {
  const view = document.getElementById("view"), tabs = document.getElementById("tabs");
  if (!view || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const LEAD = 300, TRAIL = 480, COUNT = 1150, ARMED = 2500, LEAVE = 260;
  const out3 = (t) => 1 - (1 - t) ** 3, outExpo = (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t)), inout3 = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
  let armedUntil = performance.now() + ARMED;   // the first page after the Hub opens comes in too

  /* ---------- the stretching marker ---------- */
  const lastBy = {};   // "sub"/"side" -> the marker's last edges, [left, right] (or [top, bottom] in the sidebar)
  function slide(box, active, key, vertical) {
    if (!box || !active) return;
    let ink = box.querySelector(":scope > .mo-ink");
    if (!ink) { ink = document.createElement("i"); ink.className = "mo-ink"; box.prepend(ink); }
    box.classList.add("mo-has-ink");
    const b = box.getBoundingClientRect(), a = active.getBoundingClientRect();
    const to = vertical ? [a.top - b.top + box.scrollTop, a.bottom - b.top + box.scrollTop] : [a.left - b.left + box.scrollLeft, a.right - b.left + box.scrollLeft];
    const cross = vertical ? [a.left - b.left, a.width] : [a.top - b.top, a.height];
    const from = lastBy[key];
    lastBy[key] = to;
    const put = (s, e) => {
      ink.style.cssText = vertical ? `top:${s}px;height:${e - s}px;left:${cross[0]}px;width:${cross[1]}px`
        : `left:${s}px;width:${e - s}px;top:${cross[0]}px;height:${cross[1]}px`;
    };
    if (!from || (from[0] === to[0] && from[1] === to[1])) { put(to[0], to[1]); return; }
    const fwd = to[0] > from[0], t0 = performance.now();
    put(from[0], from[1]);
    const step = (now) => {
      const t = now - t0, lead = out3(Math.min(1, t / LEAD)), trail = inout3(Math.min(1, t / TRAIL));
      const ks = fwd ? trail : lead, ke = fwd ? lead : trail;
      put(from[0] + (to[0] - from[0]) * ks, from[1] + (to[1] - from[1]) * ke);
      if (t < TRAIL && ink.isConnected) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  const subtabs = () => { const nav = view.querySelector(":scope > .subtabs"); if (nav) slide(nav, nav.querySelector("a.on"), "sub", false); };
  const sidebar = () => { if (tabs) slide(tabs, tabs.querySelector(".side-link.active"), "side", true); };

  /* ---------- numbers counting up ---------- */
  const NUM = /\d[\d\u00a0\u202f .,]*\d|\d/;
  function countUp(el) {
    if (el.dataset.moCounted) return;
    el.dataset.moCounted = "1";
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!node.data.trim()) continue;
      const m = node.data.match(NUM);
      if (!m) return;   // the figure is words («Sem dados»): nothing to count
      const tok = m[0], head = node.data.slice(0, m.index), tail = node.data.slice(m.index + tok.length);
      if (/\d:\d|\d\/\d/.test(node.data) || /h\d/.test(node.data)) return;   // times and dates stay as they are
      const dec = tok.match(/[.,](\d{1,2})$/), sep = dec ? tok[tok.length - dec[1].length - 1] : null;
      const places = dec && !(sep === "." && /,/.test(tok)) && !(dec[1].length === 3) ? dec[1].length : 0;
      const plain = tok.replace(/[\u00a0\u202f ]/g, "").replace(places ? (sep === "," ? /\./g : /,/g) : /[.,]/g, "").replace(",", ".");
      const value = Number(plain);
      if (!isFinite(value) || value === 0) return;
      const group = (tok.match(/\d([\u00a0\u202f .,])\d{3}(?!\d)/) || [])[1];
      const show = (v) => {
        let s = v.toFixed(places);
        let [i, f] = s.split(".");
        if (group && (!places || group !== sep)) i = i.replace(/\B(?=(\d{3})+(?!\d))/g, group);
        return head + i + (places ? sep + f : "") + tail;
      };
      const t0 = performance.now() + Number(el.dataset.moDelay || 0);
      const txt = node;
      txt.data = show(0);
      el.classList.add("mo-counting");
      const step = (now) => {
        const k = Math.max(0, Math.min(1, (now - t0) / COUNT));
        txt.data = k >= 1 ? head + tok + tail : show(value * outExpo(k));
        if (k < 1 && txt.isConnected) requestAnimationFrame(step);
        else { el.classList.remove("mo-counting"); el.classList.add("mo-counted"); }
      };
      requestAnimationFrame(step);
      return;   // the first number of the element only
    }
  }

  /* ---------- a page coming in ---------- */
  // the page's own blocks: through the wrappers a page puts everything in (Início is one <div class="page">)
  function blocksOf(root) {
    let el = root;
    for (let i = 0; i < 4; i++) {
      const kids = [...el.children].filter((k) => !k.matches(".subtabs, script, style, template, .mo-ink"));
      if (kids.length !== 1 || !kids[0].children.length) break;
      el = kids[0];
    }
    return el;
  }

  // what comes in one by one: a row of cards (grid or flex) comes in card by card, anything else as one block
  function pieces(el) {
    const kids = [...el.children].filter((k) => k.offsetParent !== null);
    const d = getComputedStyle(el).display;
    if (kids.length >= 2 && kids.length <= 12 && /grid|flex/.test(d) && !el.matches(".subtabs, .pn-row, .pn-foot, header")) {
      return kids.flatMap((k) => (k.children.length && /grid|flex/.test(getComputedStyle(k).display) && k.getBoundingClientRect().height > 160 ? pieces(k) : [k]));
    }
    return [el];
  }

  function enter(root) {
    const free = (el) => getComputedStyle(el).animationName === "none";   // a block with its own animation keeps it (the news bar floats)
    const blocks = [...root.children].filter((el) => !el.matches(".subtabs, .mo-in, .mo-ink, script, style, template") && el.offsetParent !== null && free(el));
    const vh = innerHeight;
    let n = 0;
    for (const block of blocks) {
      for (const el of pieces(block)) {
        if (el.classList.contains("mo-in") || !free(el)) continue;
        const top = el.getBoundingClientRect().top;
        if (top > vh * 1.3) { el.classList.add("mo-in", "mo-quiet"); continue; }   // far below the fold: no wait, no show
        el.style.setProperty("--mo-d", `${Math.min(n, 14) * 60}ms`);
        el.classList.add("mo-in");
        n++;
      }
    }
    let i = 0;
    root.querySelectorAll(".pn-kpi .pn-row > div, .tile b, .stats .stat > b, [data-count], .pn-gauge text, .pn-gauge b, .gauge b").forEach((el) => {
      if (el.dataset.moCounted) return;
      el.dataset.moDelay = 180 + i++ * 70;
      countUp(el);
    });
    root.querySelectorAll(".pn-trend path.line").forEach((p) => {
      try { const len = p.getTotalLength(); p.style.setProperty("--mo-len", len); p.classList.add("mo-draw"); } catch (e) { /* not laid out */ }
    });
    root.querySelectorAll(".pn-bars > div").forEach((el, k) => { el.style.setProperty("--mo-b", `${250 + k * 45}ms`); el.classList.add("mo-grow"); });
    root.querySelectorAll(".pn-trend path.area, .pn-viz").forEach((el) => el.classList.add("mo-grow"));
  }

  /* ---------- the page going: a picture of it blurs and lifts away over the new one ---------- */
  function leave() {
    if (!view.firstElementChild || view.querySelectorAll("*").length > 4000) return;
    const r = view.getBoundingClientRect();
    const ghost = view.cloneNode(true);
    ghost.removeAttribute("id");
    ghost.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));   // the new page must find its own elements, not these
    ghost.querySelectorAll(".subtabs").forEach((el) => el.remove());
    const src = view.querySelectorAll("canvas"), dst = ghost.querySelectorAll("canvas");
    dst.forEach((c, k) => { try { c.getContext("2d").drawImage(src[k], 0, 0); } catch (e) { /* webgl: stays blank for 0.26 s */ } });
    ghost.className += " mo-ghost";
    const cs = getComputedStyle(view);   // what #view's own rules gave it (the copy has no id, so no #view rules)
    ghost.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;margin:0;overflow:hidden;pointer-events:none;z-index:5;`
      + `box-sizing:border-box;padding:${cs.padding};display:${cs.display};flex-direction:${cs.flexDirection};gap:${cs.gap};grid-template-columns:${cs.gridTemplateColumns};font:${cs.font};color:${cs.color}`;
    document.body.appendChild(ghost);
    ghost.scrollTop = view.scrollTop;
    ghost.animate([{ opacity: 1, filter: "blur(0px)", transform: "none" },
      { opacity: 0, filter: "blur(14px)", transform: "translateY(-14px) scale(.985)" }],
      { duration: LEAVE, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" }).onfinish = () => ghost.remove();
  }

  // a page arrives in pieces (its frame, then «a carregar», then the data): each piece that lands while the page is new comes
  // in; what was already in stays. A page redrawing itself later with fresh data is not armed, and costs one comparison.
  let queued = false;
  new MutationObserver(() => {
    subtabs();
    if (queued || performance.now() > armedUntil) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; enter(blocksOf(view)); });
  }).observe(view, { childList: true, subtree: true });

  if (tabs) new MutationObserver(() => requestAnimationFrame(sidebar)).observe(tabs, { childList: true });
  window.addEventListener("hashchange", () => {
    armedUntil = performance.now() + ARMED;
    try { leave(); } catch (e) { /* a page that cannot be pictured simply changes */ }
  }, true);   // before app.js redraws the page, so the new page counts as arrived
  window.addEventListener("resize", () => { delete lastBy.sub; delete lastBy.side; subtabs(); sidebar(); });
  requestAnimationFrame(() => { subtabs(); sidebar(); });
})();
