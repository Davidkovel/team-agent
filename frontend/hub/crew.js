// My Niggaz: the crew room (docs/empresa-amg.md, the 2D phase with characters; the look comes from the isometric
// neon office in the @tentando.ia01 reel). Eight agents in pixel art in a room with neon on the walls. With nothing to
// do they hang around the lounge (sofa, coffee, the arcade, music, the window, the phone). When work comes in (a task
// sent from here or from the board, a Claude working on one of the three PCs, a subagent that Claude launched) one of
// them gets up, walks to a free computer and works there until it is done, with what was asked above their head.
// It only reads /api/tasks and /api/office; nothing is stored.
// Its own file, fetched the first time the page opens (lazyView in ui.js). Weight rules: it only animates while the
// page is open, on screen and in the front tab (12 frames a second, 24 while somebody walks); the floor, the walls and
// the sign are drawn once per size, and the rest is a small canvas blown up.
(function () {
  // ---------------------------------------------------------------- the room, in tiles
  // x runs to the right and down, y to the left and down; z is height in pixels. P() is where a point lands on the
  // small canvas (LW × LH), which the screen shows blown up, pixel by pixel.
  const W = 17, D = 11, WALL = 60;
  const OX = D * 16 + 10, OY = WALL + 34;
  const LW = (W + D) * 16 + 20, LH = OY + (W + D) * 8 + 16;
  const P = (x, y, z = 0) => [OX + (x - y) * 16, OY + (x + y) * 8 - z];
  const NEON = { cyan: "#38f3ff", pink: "#ff3cac", red: "#ff2d4f", violet: "#9a5cff", green: "#4dff9a", amber: "#ffbf3c", lime: "#c6ff3d", white: "#eef5ff" };
  const FONT = '"Inter", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';
  const DISPLAY = '"Space Grotesk", "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif';

  const memo = {};
  // a hex colour made lighter (f > 0) or darker (f < 0)
  function sh(hex, f) {
    const id = hex + f;
    if (memo[id]) return memo[id];
    const n = parseInt(hex.slice(1), 16);
    const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f));
    return (memo[id] = `rgb(${c[0]},${c[1]},${c[2]})`);
  }
  const rnd = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const hash = (s) => { let h = 7; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h); };
  const k2 = (x, y) => x + "," + y;

  // ---------------------------------------------------------------- the crew
  // role: the task's agent_role they take first; kinds: the Claude Code subagents they stand for.
  const CREW = [
    { id: "dev", name: "Dev", what: "Código", role: "developer", kinds: ["general-purpose"], color: NEON.cyan,
      look: { skin: "#7a4a2c", hair: "#121214", style: "top", top: "#2b303b", accent: "#ff2d4f", pants: "#1d2028", shoes: "#f2f2f2", phones: 1 } },
    { id: "explorador", name: "Explorador", what: "Encontra tudo no código", kinds: ["explorador", "Explore"], color: NEON.green,
      look: { skin: "#a8714a", hair: "#1b1410", style: "cap", cap: "#d4202e", top: "#e9ecf1", pants: "#2c3e63", shoes: "#16181d", chain: 1 } },
    { id: "pesquisador", name: "Pesquisador", what: "Pesquisa na web e nos documentos", role: "research", kinds: ["pesquisador", "claude-code-guide"], color: NEON.violet,
      look: { skin: "#e0b48f", hair: "#5a3720", style: "curly", top: "#1f8a8a", pants: "#3b3f4a", shoes: "#c9ccd2", glasses: 1 } },
    { id: "designer", name: "Designer", what: "Desenha as páginas", kinds: ["designer-hub"], color: NEON.pink,
      look: { skin: "#5b3720", hair: "#16100c", style: "afro", top: "#c2257a", pants: "#1b1d22", shoes: "#ff3cac" } },
    { id: "marketing", name: "Marketing", what: "Textos, anúncios e ideias", role: "marketing", kinds: ["marketing"], color: NEON.amber,
      look: { skin: "#4a2c1a", hair: "#0f0b08", style: "dreads", top: "#6a3fd1", pants: "#2a2d34", shoes: "#ffbf3c", chain: 1 } },
    { id: "revisor", name: "Revisor", what: "Revê antes de ir para todos", kinds: ["revisor-hub"], color: NEON.white,
      look: { skin: "#3a2316", hair: "#0d0a08", style: "bald", top: "#9aa2ab", pants: "#16181c", shoes: "#0c0c0e", glasses: 1, beard: 1 } },
    { id: "tester", name: "Tester", what: "Testa tudo antes de sair", role: "testing", kinds: [], color: NEON.lime,
      look: { skin: "#8c5a36", hair: "#1a120c", style: "braids", top: "#1f9d55", accent: "#eceef1", pants: "#1f9d55", shoes: "#f5f5f5" } },
    { id: "faztudo", name: "Faz-tudo", what: "Pega no que vier", role: "custom", kinds: ["Plan"], color: NEON.red,
      look: { skin: "#603a22", hair: "#0d0a08", style: "durag", rag: "#2350d8", top: "#ff6a1a", pants: "#2a2d34", shoes: "#16181d", chain: 1 } },
  ];
  // what the send box offers: the agent_role of the task (models.AGENT_ROLES)
  const ROLES = [["", "Qualquer um"], ["developer", "Dev"], ["research", "Pesquisa"], ["marketing", "Marketing"], ["testing", "Testes"]];

  // ---------------------------------------------------------------- furniture and where people go
  const DESKS = [[7, 2], [10, 2], [13, 2], [8, 6], [11, 6], [14, 6]]
    .map(([x, y], i) => ({ i, x, y, deco: ["mug", "can", "plant", "duck", "mug", "phones"][i], agent: null, boot: -9 }));
  const SOFA = [4, 5, 6];
  const PLANTS = [[0, 0], [0, 10], [16, 10], [6, 0]];
  const BAGS = [[3, 4, "#ff3cac"], [3, 7, "#38f3ff"]];
  const SPOTS = [
    ...SOFA.map((y) => ({ x: 0, y, at: [.62, y + .5], pose: "sit", dir: "se", seat: 7, sofa: true, word: "no sofá" })),
    ...BAGS.map(([x, y]) => ({ x, y, at: [x + .5, y + .5], pose: "sit", dir: "nw", seat: 4, word: "a ver televisão" })),
    { x: 2, y: 1, pose: "play", dir: "ne", word: "a jogar" },
    { x: 4, y: 1, pose: "drink", dir: "ne", word: "no café" },
    { x: 1, y: 8, pose: "look", dir: "nw", word: "à janela" },
    { x: 1, y: 2, pose: "dance", dir: "se", word: "a dançar" },
    { x: 4, y: 6, pose: "dance", dir: "sw", word: "a dançar" },
    { x: 5, y: 3, pose: "phone", dir: "sw", word: "no telemóvel" },
    { x: 5, y: 9, pose: "phone", dir: "se", word: "no telemóvel" },
  ];
  const blocked = new Set([
    ...DESKS.flatMap((d) => [k2(d.x, d.y), k2(d.x, d.y + 1)]), ...SOFA.map((y) => k2(0, y)), ...BAGS.map(([x, y]) => k2(x, y)),
    ...PLANTS.map(([x, y]) => k2(x, y)), k2(2, 0), k2(4, 0), k2(5, 0), k2(2, 5), k2(16, 0),
  ]);

  // ---------------------------------------------------------------- drawing helpers (small canvas)
  function poly(g, pts, fill) {
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath(); g.fillStyle = fill; g.fill();
  }
  // a box standing at (x, y, z): w along x, d along y, h up. c = [top, the face towards +y, the face towards +x]
  function box(g, x, y, w, d, z, h, c) {
    const t0 = P(x, y, z + h), t1 = P(x + w, y, z + h), t2 = P(x + w, y + d, z + h), t3 = P(x, y + d, z + h);
    const b1 = P(x + w, y, z), b2 = P(x + w, y + d, z), b3 = P(x, y + d, z);
    if (c[1]) poly(g, [t3, t2, b2, b3], c[1]);
    if (c[2]) poly(g, [t2, t1, b1, b2], c[2]);
    if (c[0]) poly(g, [t0, t1, t2, t3], c[0]);
  }
  function seg(g, a, b, color, w = 1) {
    g.strokeStyle = color; g.lineWidth = w; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
  }
  const oval = (g, x, y, rx, ry, c) => { g.fillStyle = c; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill(); };
  const dot = (g, x, y, c, w = 1, h = 1) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), w, h); };
  const mat = (hex) => [hex, sh(hex, -.28), sh(hex, -.48)];

  // the +y face of something (a screen, an arcade screen) filled pixel by pixel; returns a painter in face pixels
  function face(g, x0, x1, y, z0, z1, bg) {
    const [tx, ty] = P(x0, y, z1), wpx = Math.round((x1 - x0) * 16), hpx = Math.round(z1 - z0);
    g.fillStyle = bg;
    for (let u = 0; u < wpx; u++) g.fillRect(Math.round(tx + u), Math.round(ty + u / 2), 1, hpx);
    return {
      wpx, hpx,
      px(u, v, c, w = 1) { g.fillStyle = c; for (let i = 0; i < w; i++) g.fillRect(Math.round(tx + u + i), Math.round(ty + v + (u + i) / 2), 1, 1); },
    };
  }

  // 5 × 5 pixel glyphs for the bubbles, the screens and the floating notes
  const GLYPH = {
    "!": ["..#..", "..#..", "..#..", ".....", "..#.."],
    "?": [".###.", "#...#", "..##.", ".....", "..#.."],
    check: [".....", "....#", "...#.", "#.#..", ".#..."],
    x: ["#...#", ".#.#.", "..#..", ".#.#.", "#...#"],
    pause: [".#.#.", ".#.#.", ".#.#.", ".#.#.", "....."],
    dots: [".....", ".....", "#.#.#", ".....", "....."],
    note: ["..##.", "..#.#", "..#..", "##...", "##..."],
    z: ["####.", "..#..", ".#...", "####.", "....."],
    heart: [".#.#.", "#####", "#####", ".###.", "..#.."],
  };
  function glyph(g, name, x, y, c) {
    g.fillStyle = c;
    GLYPH[name].forEach((row, j) => { for (let i = 0; i < 5; i++) if (row[i] === "#") g.fillRect(x + i, y + j, 1, 1); });
  }
  function glyphOn(f, name, c) {
    const u0 = Math.floor((f.wpx - 5) / 2), v0 = Math.floor((f.hpx - 5) / 2);
    GLYPH[name].forEach((row, j) => { for (let i = 0; i < 5; i++) if (row[i] === "#") f.px(u0 + i, v0 + j, c); });
  }
  function bubble(g, x, y, name, c) {
    const bx = Math.round(x), by = Math.round(y) - 11;
    g.fillStyle = "#07090e"; g.fillRect(bx + 1, by, 7, 9); g.fillRect(bx, by + 1, 9, 7); g.fillRect(bx + 1, by + 9, 2, 2);
    g.fillStyle = "#f5f7fb"; g.fillRect(bx + 1, by + 1, 7, 7); g.fillRect(bx + 2, by + 8, 1, 1);
    glyph(g, name, bx + 2, by + 2, c);
  }

  // ---------------------------------------------------------------- people
  // One sprite, drawn from rectangles: 10 px wide, 24 tall, a big head. dir: se/sw look at us (sw is se mirrored),
  // ne/nw turn their back (nw mirrored). Returns the top of the head, where bubbles and labels go.
  function person(g, L, o) {
    const back = o.dir === "ne" || o.dir === "nw", flip = o.dir === "sw" || o.dir === "nw";
    const pose = o.pose, tm = o.tm;
    const sitting = /^(sit|sleep|desk)/.test(pose);
    const walk = pose === "walk", ph = walk ? Math.floor(tm * 9) % 4 : 0;
    const beat = Math.floor(tm * 4) % 2, type = Math.floor(tm * 11) % 2;
    let up = sitting ? 7 - (o.seat || 7) : 0;
    if (walk && ph % 2) up -= 1;
    if (pose === "dance" && beat) up -= 1;
    if (pose === "desk" && Math.floor(tm * 1.3) % 5 === 0) up += 1;            // leans in now and then
    const hop = o.hop > 0 ? -Math.round(Math.sin((o.hop / .35) * Math.PI) * 4) : 0;
    const x0 = Math.round(o.x) - 5, y0 = Math.round(o.y) - 24 + hop;
    const R = (cx, cy, w, h, c, fixed) => {
      if (!c) return;
      g.fillStyle = c;
      g.fillRect(flip ? x0 + 10 - cx - w : x0 + cx, y0 + cy + (fixed ? 0 : up), w, h);
    };
    const skin = L.skin, skinD = sh(skin, -.24), top = L.top, topD = sh(top, -.32), topL = sh(top, .16), pants = L.pants, pantsD = sh(pants, -.3);
    const sleepy = pose === "sleep";
    const hx = sleepy ? 1 : 0, hy = sleepy ? 1 : 0;
    const H = (cx, cy, w, h, c) => R(cx + hx, cy + hy, w, h, c);

    // legs
    if (!sitting) {
      const la = walk && ph === 1 ? 1 : 0, lb = walk && ph === 3 ? 1 : 0;
      R(2, 17, 3, 6 - la, pants, true); R(5, 17, 3, 6 - lb, pantsD, true);
      R(2, 23 - la, 3, 1, L.shoes, true); R(5, 23 - lb, 3, 1, L.shoes, true);
    } else if (!back) {
      R(2, 16, 7, 2, pants);                                                    // the lap, towards us
      R(5, 18 + up, 2, 5 - up, pants, true); R(7, 18 + up, 2, 5 - up, pantsD, true);
      R(5, 23, 2, 1, L.shoes, true); R(7, 23, 3, 1, L.shoes, true);
    }
    // body
    R(2, 10, 6, 7, top); R(2, 10, 1, 7, topD); R(7, 10, 1, 7, topL);
    if (L.accent) R(2, 14, 6, 1, L.accent);
    if (!back) {
      R(4, 10, 2, 1, skinD);
      if (L.chain) { R(3, 11, 4, 1, "#f2c94c"); R(4, 12, 2, 1, "#ffe08a"); }
    }
    // arms
    const arm = (side, cy, h) => { const cx = side ? 8 : 1; R(cx, cy, 1, h, side ? topL : topD); R(cx, cy + h, 1, 1, skin); };
    switch (pose) {
      case "walk": arm(0, 11 + (ph === 1 ? 1 : ph === 3 ? -1 : 0), 5); arm(1, 11 + (ph === 3 ? 1 : ph === 1 ? -1 : 0), 5); break;
      case "desk": case "play": R(0, 12 - type, 2, 2, topD); R(8, 11 + type, 2, 2, topL); R(0, 14 - type, 1, 1, skin); R(9, 13 + type, 1, 1, skin); break;
      case "deskWait": R(0, 5, 2, 2, topD); R(8, 5, 2, 2, topL); R(1, 7, 1, 4, topD); R(8, 7, 1, 4, topL); break;   // hands behind the head
      case "deskDone": R(0, 2, 1, 9, topD); R(9, 2, 1, 9, topL); R(0, 1, 1, 1, skin); R(9, 1, 1, 1, skin); break;     // both arms up
      case "dance":
        if (beat) { R(0, 4, 1, 7, topD); R(0, 3, 1, 1, skin); arm(1, 11, 5); } else { arm(0, 11, 5); R(9, 4, 1, 7, topL); R(9, 3, 1, 1, skin); }
        break;
      case "phone": R(1, 11, 1, 3, topD); R(8, 11, 1, 3, topL); R(2, 14, 2, 1, topD); R(6, 14, 2, 1, topL); R(4, 13, 2, 3, "#0b0d12"); R(4, 13, 1, 1, NEON.cyan); break;
      case "drink":
        arm(0, 11, 5);
        if (tm % 3 < 1) { R(8, 8, 1, 4, topL); R(7, 7, 2, 2, "#f4f4f4"); } else { R(8, 11, 1, 3, topL); R(8, 13, 2, 2, "#f4f4f4"); }
        break;
      case "sit": case "sleep": arm(0, 12, 3); arm(1, 12, 3); break;
      default: arm(0, 11, 5); arm(1, 11, 5);
    }
    // head
    H(1, 2, 8, 8, skin); H(1, 2, 1, 8, skinD);
    if (!back) {
      const ey = pose === "phone" ? 7 : 6;
      if (sleepy) { H(4, 7, 1, 1, skinD); H(7, 7, 1, 1, skinD); }
      else if (L.glasses) { H(3, 6, 5, 1, "#07080b"); H(3, 5, 2, 1, "#2b3140"); H(6, 5, 2, 1, "#2b3140"); }
      else { H(4, ey, 1, 1, "#0b0b0e"); H(7, ey, 1, 1, "#0b0b0e"); }
      H(2, 6, 1, 1, skinD);
      if (L.beard) { H(2, 8, 7, 2, L.hair); H(5, 8, 2, 1, skinD); } else H(5, 8, 2, 1, skinD);
    }
    hair(H, L, back, tm);
    if (L.phones) { H(1, 1, 8, 1, "#0d0f14"); H(0, 4, 2, 3, "#0d0f14"); H(8, 4, 2, 3, "#0d0f14"); H(0, 5, 1, 1, NEON.red); H(9, 5, 1, 1, NEON.red); }
    const crown = L.style === "afro" ? -3 : L.style === "top" ? -1 : 1;
    return [Math.round(o.x), y0 + up + hy + crown];
  }

  function hair(H, L, back, tm) {
    const c = L.hair, hl = sh(c, .28), dk = sh(c, -.3);
    switch (L.style) {
      case "top":
        H(2, -1, 6, 3, c); H(1, 2, 8, 2, c); H(3, -1, 3, 1, hl);
        if (back) H(1, 4, 8, 4, c); else H(1, 4, 1, 2, c);
        break;
      case "cap": {
        const k = L.cap, kd = sh(k, -.32);
        H(1, 1, 8, 3, k); H(2, 1, 5, 1, sh(k, .22));
        if (back) { H(1, 4, 8, 4, c); H(3, 3, 3, 1, kd); } else { H(6, 4, 4, 1, kd); H(1, 4, 1, 2, c); }
        break;
      }
      case "curly":
        H(1, 1, 8, 3, c); H(0, 2, 1, 4, c); H(9, 2, 1, 3, c);
        for (const [x, y] of [[2, 1], [5, 1], [7, 2], [3, 3], [0, 4]]) H(x, y, 1, 1, hl);
        if (back) { H(0, 4, 10, 4, c); H(2, 5, 1, 1, hl); H(6, 6, 1, 1, hl); }
        break;
      case "afro":
        H(1, -3, 8, 1, c); H(0, -2, 10, 5, c); H(-1, 0, 1, 3, c); H(10, 0, 1, 3, c); H(0, 3, 1, 3, c); H(9, 3, 1, 3, c);
        H(2, -2, 2, 1, hl); H(6, -1, 1, 1, hl); H(8, 1, 1, 1, hl);
        if (back) H(0, 3, 10, 5, c);
        break;
      case "dreads":
        H(1, 1, 8, 3, c);
        for (const x of back ? [0, 2, 4, 6, 8] : [0, 8]) { H(x, 3, 2, 9, x % 4 ? c : dk); H(x, 12, 2, 1, "#f2c94c"); }
        break;
      case "bald": H(3, 2, 3, 1, sh(L.skin, .2)); break;
      case "braids":
        H(1, 1, 8, 3, c); for (const x of [2, 4, 6]) H(x, 1, 1, 3, hl);
        if (back) { H(1, 4, 8, 5, c); for (const x of [2, 4, 6]) H(x, 4, 1, 5, hl); H(3, 9, 1, 3, c); H(6, 9, 1, 3, c); }
        break;
      case "durag": {
        const k = L.rag, kd = sh(k, -.32);
        H(1, 1, 8, 3, k); H(3, 1, 2, 1, sh(k, .4)); H(1, 4, 8, 1, kd);
        if (back) { H(1, 4, 8, 4, k); H(4 + Math.round(Math.sin(tm * 3)), 9, 2, 5, kd); }
        break;
      }
    }
  }

  // a portrait for the lists: the same sprite, from the waist up, as an image
  function portrait(L) {
    const c = document.createElement("canvas"); c.width = 14; c.height = 22;
    person(c.getContext("2d"), L, { x: 7, y: 28, dir: "se", pose: "stand", tm: 0, hop: 0, seat: 0 });
    return c.toDataURL();
  }

  // ---------------------------------------------------------------- furniture
  const LEG = mat("#1d2330"), TOP = ["#2a3346", "#181e2b", "#11151e"], METAL = mat("#4a5366"), CHAIR = mat("#262b38"), SEAT = mat("#d0183a");
  const SOFA_C = mat("#a3172f"), SOFA_B = mat("#86122a");
  let clock = 0;

  function desk(g, d) {
    const { x, y } = d, a = d.agent && d.agent.seated ? d.agent : null;
    for (const [lx, ly] of [[.1, .14], [.86, .14], [.1, .8], [.86, .8]]) box(g, x + lx, y + ly, .05, .05, 0, 11, LEG);
    box(g, x + .06, y + .1, .88, .78, 11, 2, TOP);
    seg(g, P(x + .1, y + .88, 11.5), P(x + .92, y + .88, 11.5), a ? "rgba(56,243,255,.95)" : "rgba(56,243,255,.28)");
    box(g, x + .4, y + .22, .22, .14, 13, 1, METAL);           // foot
    box(g, x + .48, y + .25, .06, .05, 14, 4, METAL);          // neck
    box(g, x + .12, y + .23, .78, .06, 17, 14, ["#3a4357", "#0b0e14", "#1a1f2a"]);
    screen(g, d, x + .12, x + .9, y + .29, 17, 31);
    box(g, x + .22, y + .54, .48, .16, 13, 1, ["#151922", "#0b0d12", "#08090d"]);   // keyboard
    if (a && a.mode === "work" && a.job && a.job.state === "work") {
      const n = Math.floor(clock * 12) + d.i * 7, [kx, ky] = P(x + .26 + rnd(n) * .4, y + .57 + rnd(n + .3) * .1, 14);
      dot(g, kx, ky, NEON.cyan);
    }
    box(g, x + .76, y + .6, .07, .1, 13, 1, ["#232834", "#111", "#0b0b0b"]);         // mouse
    decoration(g, d);
  }

  function decoration(g, d) {
    const { x, y } = d;
    switch (d.deco) {
      case "mug": box(g, x + .76, y + .26, .1, .1, 13, 4, ["#f2f2f2", "#d5d7db", "#b4b8bf"]); dot(g, ...P(x + .81, y + .31, 17), "#4a2a18"); break;
      case "can": box(g, x + .78, y + .28, .08, .08, 13, 5, ["#ff4d6d", "#d0183a", "#9a0f2a"]); break;
      case "plant": {
        box(g, x + .74, y + .26, .14, .14, 13, 3, ["#e3e7ec", "#aeb5be", "#848c97"]);
        const [cx, cy] = P(x + .81, y + .33, 16);
        oval(g, cx, cy - 1, 3, 2, "#24914f"); oval(g, cx + 1, cy - 3, 2, 2, "#3fd17a");
        break;
      }
      case "duck": {
        const [cx, cy] = P(x + .8, y + .32, 13);
        dot(g, cx - 2, cy - 3, "#ffd23c", 4, 3); dot(g, cx, cy - 5, "#ffd23c", 2, 2); dot(g, cx + 2, cy - 4, "#ff8a1a"); dot(g, cx + 1, cy - 5, "#111");
        break;
      }
      case "phones": {
        const [cx, cy] = P(x + .8, y + .32, 13);
        dot(g, cx, cy - 8, "#3a4357", 1, 8); dot(g, cx - 2, cy - 9, "#111318", 5, 1); dot(g, cx - 3, cy - 8, "#111318", 2, 3); dot(g, cx + 2, cy - 8, "#111318", 2, 3); dot(g, cx - 3, cy - 7, NEON.red);
        break;
      }
    }
  }

  const SCREEN_BG = { off: "#05070b", work: "#071425", start: "#071425", wait: "#1f1504", help: "#220610", pause: "#101318", done: "#04200f", fail: "#220610" };
  const CODE = [NEON.cyan, NEON.pink, "#c9d4e6", NEON.green, NEON.amber, NEON.violet, "#c9d4e6"];
  function deskMode(d) {
    const a = d.agent && d.agent.seated ? d.agent : null;
    if (!a) return "off";
    if (a.mode === "done") return a.done === "ok" ? "done" : "fail";
    return a.job ? a.job.state : "off";
  }
  function screen(g, d, x0, x1, y, z0, z1) {
    const mode = deskMode(d), since = clock - d.boot;
    const flash = mode !== "off" && since < .35;
    const f = face(g, x0 + .07, x1 - .07, y, z0 + 1, z1 - 1, flash ? "#dfe9ff" : SCREEN_BG[mode]);
    if (mode === "off") { f.px(1, 1, "rgba(255,255,255,.07)", 4); f.px(f.wpx - 2, f.hpx - 2, Math.floor(clock * .8) % 3 ? "#3a0a14" : NEON.red); return; }
    if (flash) return;
    if (since < 1.1) { const w = f.wpx - 4, p = Math.floor((since - .35) / .75 * w); for (let u = 0; u < w; u++) f.px(2 + u, Math.floor(f.hpx / 2), u <= p ? NEON.white : "#1a2a40"); return; }
    if (mode === "work") {
      const scroll = Math.floor(clock * 2.6);
      for (let r = 0; r < 5; r++) {
        const n = scroll + r + d.i * 50, ind = Math.floor(rnd(n) * 3) + (rnd(n + .9) > .7 ? 2 : 0);
        const len = Math.min(2 + Math.floor(rnd(n + .5) * (f.wpx - 3)), f.wpx - 2 - ind);
        if (len > 0) f.px(1 + ind, 1 + r * 2, CODE[Math.floor(rnd(n + .7) * CODE.length)], len);
      }
      if (Math.floor(clock * 3) % 2) f.px(1, f.hpx - 2, "#ffffff", 2);
    } else if (mode === "start") {
      const w = f.wpx - 4, p = Math.floor((clock * 5) % w);
      for (let u = 0; u < w; u++) f.px(2 + u, Math.floor(f.hpx / 2), Math.abs(u - p) < 2 ? NEON.cyan : "#16304a");
      glyphOn({ ...f, hpx: f.hpx - 6 }, "dots", NEON.cyan);
    } else {
      const blink = (mode === "wait" || mode === "help") && Math.floor(clock * 2) % 2;
      if (!blink) glyphOn(f, { wait: "?", help: "!", pause: "pause", done: "check", fail: "x" }[mode], { wait: NEON.amber, help: NEON.red, pause: "#9aa2ab", done: NEON.green, fail: NEON.red }[mode]);
    }
  }

  function chair(g, d) {
    const x = d.x, Y = d.y + 1, a = d.agent && d.agent.seated ? d.agent : null;
    poly(g, [P(x + .2, Y + .42), P(x + .5, Y + .14), P(x + .8, Y + .42), P(x + .5, Y + .7)], "#06080b");
    for (const [wx, wy] of [[.24, .42], [.5, .17], [.76, .42], [.5, .67]]) dot(g, ...P(x + wx, Y + wy, 1), "#2a2f3a", 2, 1);
    box(g, x + .47, Y + .39, .06, .06, 1, 6, CHAIR);
    box(g, x + .24, Y + .14, .54, .52, 7, 2, CHAIR);
    if (a) drawAgent(g, a);
    box(g, x + .34, Y + .66, .58, .06, 9, a ? 4 : 8, SEAT);  // the back, on our side: low, so the one working still shows
    seg(g, P(x + .36, Y + .72, a ? 12.5 : 16.5), P(x + .9, Y + .72, a ? 12.5 : 16.5), "rgba(255,120,150,.85)");
  }

  function sofa(g, y) {
    const first = y === SOFA[0], last = y === SOFA[SOFA.length - 1];
    box(g, .06, y + .02, .3, .96, 0, 19, SOFA_B);
    if (first) box(g, .06, y, .88, .16, 0, 11, SOFA_C);
    box(g, .32, y + (first ? .16 : .03), .62, first ? .81 : last ? .81 : .94, 0, 7, SOFA_C);
    seg(g, P(.36, y + .5, 7.5), P(.92, y + .5, 7.5), "rgba(0,0,0,.25)");
    if (last) box(g, .06, y + .84, .88, .16, 0, 11, SOFA_C);
  }

  function bag(g, x, y, c) {
    const [cx, cy] = P(x + .5, y + .5);
    oval(g, cx, cy, 10, 4, "rgba(0,0,0,.35)");
    oval(g, cx, cy - 3, 10, 5, sh(c, -.5));
    oval(g, cx, cy - 5, 9, 5, sh(c, -.22));
    oval(g, cx - 2, cy - 7, 5, 2, c);
  }

  function plant(g, x, y) {
    box(g, x + .3, y + .3, .4, .4, 0, 8, ["#e3e7ec", "#aeb5be", "#848c97"]);
    const [cx, cy] = P(x + .5, y + .5, 8), sway = Math.round(Math.sin(clock * .8 + x) * .6);
    for (const [dx, dy, r, c] of [[0, -6, 6, "#1d6b3d"], [-4, -5, 5, "#24914f"], [4, -6, 5, "#2aa65a"], [sway, -12, 4, "#36c46b"], [-2 + sway, -9, 4, "#2fb862"], [3 + sway, -10, 3, "#4fe08a"]]) oval(g, cx + dx, cy + dy, r, r * .8, c);
  }

  function arcade(g) {
    const x = 2, y = 0;
    box(g, x + .14, y + .1, .72, .58, 0, 38, mat("#4a1f8a"));
    box(g, x + .12, y + .66, .76, .2, 13, 3, mat("#6a33c0"));
    const f = face(g, x + .22, x + .78, y + .68, 18, 31, "#06040f");
    // a tiny game: a ball between two paddles
    const tt = clock * 1.6, bu = 1 + Math.round((Math.sin(tt) * .5 + .5) * (f.wpx - 3)), bv = 1 + Math.round((Math.abs(Math.sin(tt * 1.7))) * (f.hpx - 3));
    f.px(0, Math.max(1, bv - 1), NEON.pink); f.px(0, bv, NEON.pink); f.px(f.wpx - 1, Math.max(1, f.hpx - bv - 1), NEON.cyan); f.px(f.wpx - 1, f.hpx - bv, NEON.cyan);
    f.px(bu, bv, "#ffffff");
    for (let v = 1; v < f.hpx; v += 3) f.px(Math.floor(f.wpx / 2), v, "#2a1f4a");
    const m = face(g, x + .18, x + .82, y + .68, 33, 37, Math.floor(clock * 1.5) % 2 ? NEON.pink : "#ff7ac8");
    m.px(2, 1, "#fff", m.wpx - 4);
    const [jx, jy] = P(x + .36, y + .78, 16);
    dot(g, jx, jy - 3, "#111", 1, 3); dot(g, jx - 1, jy - 4, NEON.red, 2, 2);
    dot(g, ...P(x + .6, y + .76, 16), NEON.cyan, 2, 1); dot(g, ...P(x + .72, y + .78, 16), NEON.amber, 2, 1);
  }

  function coffee(g) {
    const x = 4, y = 0;
    box(g, x + .04, y + .1, .92, .62, 0, 14, mat("#3b2c24"));
    box(g, x + .02, y + .08, .96, .66, 14, 1, ["#e6e9ee", "#b9bfc8", "#9aa1ab"]);
    box(g, x + .14, y + .14, .4, .34, 15, 13, ["#e3e7ec", "#a9b0ba", "#7d8591"]);
    box(g, x + .2, y + .46, .28, .05, 19, 4, ["#1a1d24", "#0b0d11", "#0b0d11"]);
    dot(g, ...P(x + .26, y + .48, 25), Math.floor(clock * 2) % 2 ? NEON.red : "#5a0d18");
    dot(g, ...P(x + .4, y + .48, 25), NEON.green);
    box(g, x + .66, y + .38, .1, .1, 15, 3, ["#ffffff", "#e3e3e3", "#c7c7c7"]);
    box(g, x + .8, y + .3, .1, .1, 15, 3, ["#ffffff", "#e3e3e3", "#c7c7c7"]);
  }

  function table(g) {
    const x = 2, y = 5, beat = Math.floor(clock * 2) % 2;
    for (const [lx, ly] of [[.16, .2], [.8, .2], [.16, .76], [.8, .76]]) box(g, x + lx, y + ly, .05, .05, 0, 5, LEG);
    box(g, x + .1, y + .12, .8, .76, 5, 1, ["rgba(140,210,255,.38)", "rgba(80,150,210,.45)", "rgba(60,110,170,.45)"]);
    box(g, x + .26, y + .4, .48, .2, 6, 6, mat("#323846"));
    const [s1x, s1y] = P(x + .38, y + .6, 9), [s2x, s2y] = P(x + .62, y + .6, 9);
    dot(g, s1x - 1, s1y - 1, beat ? NEON.pink : sh(NEON.pink, -.45), 3, 3);
    dot(g, s2x - 1, s2y - 1, beat ? sh(NEON.cyan, -.45) : NEON.cyan, 3, 3);
    seg(g, P(x + .34, y + .5, 13), P(x + .66, y + .5, 13), "#8a93a3");
  }

  function vending(g) {
    const x = 5, y = 0;
    box(g, x + .1, y + .12, .8, .6, 0, 40, mat("#16223d"));
    const f = face(g, x + .16, x + .62, y + .72, 12, 37, "#071a2c");
    const cans = [NEON.red, NEON.amber, NEON.green, NEON.cyan, NEON.pink, "#ffffff"];
    for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) { f.px(1 + c * 2, 2 + r * 4, cans[(r * 3 + c) % cans.length]); f.px(1 + c * 2, 3 + r * 4, sh(cans[(r * 3 + c) % cans.length], -.35)); }
    for (let u = 0; u < f.wpx; u++) f.px(u, 0, Math.floor(clock * 3 + u) % 7 ? NEON.cyan : "#ffffff");
    const side = face(g, x + .66, x + .84, y + .72, 14, 30, "#0b1220");
    side.px(1, 2, NEON.green); side.px(1, 5, "#3a4357", 2); side.px(1, 8, "#3a4357", 2);
    box(g, x + .2, y + .72, .38, .06, 4, 5, ["#05070b", "#05070b", "#05070b"]);
  }

  function rack(g) {
    const x = 16, y = 0, busy = agents.some((a) => a.seated && a.mode === "work");
    box(g, x + .1, y + .12, .8, .56, 0, 48, mat("#212736"));
    for (let r = 0; r < 9; r++) for (let c = 0; c < 4; c++) {
      if (rnd(r * 7 + c * 13 + Math.floor(clock * (busy ? 7 : 1.5) + c)) < .42) continue;
      const [px, py] = P(x + .2 + c * .17, y + .68, 6 + r * 4.6);
      dot(g, px, py, (r + c) % 5 === 0 ? NEON.amber : r % 3 ? NEON.green : NEON.cyan, 2, 1);
    }
  }

  // the television on the left wall, over the sofa: the music, as bars
  function tv(g) {
    const y0 = 3.2, y1 = 6.8, z0 = 26, z1 = 48;
    poly(g, [P(.04, y0 - .1, z1 + 2), P(.04, y1 + .1, z1 + 2), P(.04, y1 + .1, z0 - 2), P(.04, y0 - .1, z0 - 2)], "#20252f");
    poly(g, [P(.04, y0, z1), P(.04, y1, z1), P(.04, y1, z0), P(.04, y0, z0)], "#05060c");
    const n = 16;
    for (let i = 0; i < n; i++) {
      const yy = y1 - .16 - i * ((y1 - y0 - .3) / n), [sx, sy] = P(.04, yy, z0 + 2);
      const h = 2 + Math.round((Math.sin(clock * 5.3 + i * 1.7) * .5 + .5) * (Math.sin(clock * 2.1 + i * .6) * .5 + .5) * 17);
      for (let k = 0; k < h; k += 2) dot(g, sx - 2, sy - k - 1, k > 13 ? NEON.pink : k > 7 ? NEON.violet : NEON.cyan, 3, 1);
    }
    const [lx, ly] = P(.04, y0 + .3, z1 - 3);
    dot(g, lx - 1, ly, Math.floor(clock * 1.5) % 2 ? NEON.red : "#4a0a14", 2, 2);
  }

  // ---------------------------------------------------------------- the room that never moves (drawn once per size)
  function room(b) {
    poly(b, [P(0, D), P(W, D), P(W, D, -10), P(0, D, -10)], "#0b0e18");
    poly(b, [P(W, 0), P(W, D), P(W, D, -10), P(W, 0, -10)], "#070a11");
    for (let x = 0; x < W; x++) for (let y = 0; y < D; y++) {
      const work = x >= 6;
      poly(b, [P(x, y), P(x + 1, y), P(x + 1, y + 1), P(x, y + 1)], work ? ((x + y) % 2 ? "#111b35" : "#0f1830") : ((x + y) % 2 ? "#141a2a" : "#101523"));
      if (work) dot(b, ...P(x + .5, y + .5), "rgba(120,190,255,.07)");
    }
    // the rug in the lounge
    poly(b, [P(1, 3), P(5, 3), P(5, 9), P(1, 9)], "#3d1654");
    poly(b, [P(1.25, 3.25), P(4.75, 3.25), P(4.75, 8.75), P(1.25, 8.75)], "#2a0f3c");
    poly(b, [P(3, 4.2), P(4.3, 6), P(3, 7.8), P(1.7, 6)], "#461a61");
    poly(b, [P(3, 5.2), P(3.6, 6), P(3, 6.8), P(2.4, 6)], "#5a2079");
    // walls
    const lw = b.createLinearGradient(0, OY - WALL, 0, OY + D * 8);
    lw.addColorStop(0, "#161c30"); lw.addColorStop(1, "#0b0f1c");
    poly(b, [P(0, 0), P(0, D), P(0, D, WALL), P(0, 0, WALL)], lw);
    const rw = b.createLinearGradient(0, OY - WALL, 0, OY + W * 8);
    rw.addColorStop(0, "#1d243c"); rw.addColorStop(1, "#0e1324");
    poly(b, [P(0, 0), P(W, 0), P(W, 0, WALL), P(0, 0, WALL)], rw);
    for (let x = 2; x < W; x += 2) seg(b, P(x, 0, 0), P(x, 0, WALL), "rgba(255,255,255,.035)");
    for (let y = 2; y < D; y += 2) seg(b, P(0, y, 0), P(0, y, WALL), "rgba(255,255,255,.03)");
    poly(b, [P(0, 0, WALL), P(W, 0, WALL), P(W, -.25, WALL), P(-.25, -.25, WALL)], "#2b3555");
    poly(b, [P(0, 0, WALL), P(0, D, WALL), P(-.25, D, WALL), P(-.25, -.25, WALL)], "#242d48");
    poly(b, [P(W, 0, 0), P(W, -.25, 0), P(W, -.25, WALL), P(W, 0, WALL)], "#161c2e");
    poly(b, [P(0, D, 0), P(-.25, D, 0), P(-.25, D, WALL), P(0, D, WALL)], "#121828");
    // the window on the left wall: the city at night
    const wy0 = 7.7, wy1 = 9.9, wz0 = 16, wz1 = 48;
    poly(b, [P(0, wy0 - .1, wz1 + 3), P(0, wy1 + .1, wz1 + 3), P(0, wy1 + .1, wz0 - 3), P(0, wy0 - .1, wz0 - 3)], "#aeb6c2");
    const sky = b.createLinearGradient(0, P(0, wy0, wz1)[1], 0, P(0, wy1, wz0)[1]);
    sky.addColorStop(0, "#120e36"); sky.addColorStop(.6, "#32185a"); sky.addColorStop(1, "#7a2368");
    poly(b, [P(0, wy0, wz1), P(0, wy1, wz1), P(0, wy1, wz0), P(0, wy0, wz0)], sky);
    for (let i = 0; i < 22; i++) dot(b, ...P(0, wy0 + .1 + rnd(i) * (wy1 - wy0 - .2), wz0 + 16 + rnd(i + 9) * 15), "rgba(255,255,255,.75)");
    const [mx, my] = P(0, 8.35, 42);
    oval(b, mx, my, 3, 3, "#f6f0cf"); oval(b, mx + 1, my - 1, 2.4, 2.4, "#32185a");
    let yy = wy1;
    for (let i = 0; yy > wy0 + .05; i++) {
      const w = .16 + rnd(i * 3 + 1) * .28, h = 7 + rnd(i * 5 + 2) * 19, ya = Math.max(wy0, yy - w);
      poly(b, [P(0, yy, wz0), P(0, ya, wz0), P(0, ya, wz0 + h), P(0, yy, wz0 + h)], i % 2 ? "#0b0820" : "#140d2e");
      for (let k = 0; k < 7; k++) if (rnd(i * 17 + k) > .5) dot(b, ...P(0, ya + .03 + rnd(k + i * 3) * (yy - ya - .06), wz0 + 2 + rnd(k * 3 + i) * (h - 4)), rnd(k + i * 2) > .45 ? "#ffd27a" : "#7ae8ff");
      yy = ya - .03;
    }
    seg(b, P(0, (wy0 + wy1) / 2, wz0), P(0, (wy0 + wy1) / 2, wz1), "#aeb6c2");
    seg(b, P(0, wy0, (wz0 + wz1) / 2 + 6), P(0, wy1, (wz0 + wz1) / 2 + 6), "rgba(174,182,194,.6)");
    // floor shadows along the walls
    poly(b, [P(0, 0), P(W, 0), P(W, .8), P(.8, .8)], "rgba(0,0,0,.18)");
    poly(b, [P(0, 0), P(.8, .8), P(.8, D), P(0, D)], "rgba(0,0,0,.18)");
  }

  // ---------------------------------------------------------------- the crew, walking, sitting, working
  let agents = [], particles = [], jobs = [], queue = [], office = { sessions: [] }, tasks = [], firstLoad = true;
  const SPEED = 2.7; // tiles a second

  function makeAgent(c, i) {
    return { ...c, i, x: 2.5, y: 4.5, dir: "se", pose: "stand", path: [], mode: "idle", spot: null, lastSpot: null, job: null, desk: null,
      seated: false, timer: 0, wait: 0, bubble: null, hop: 0, phase: rnd(i) * 10, idleFor: rnd(i + 3) * 30, done: null, head: null, box: null,
      label: null, onArrive: null, brewUntil: 0, emit: 0, portrait: portrait(c.look) };
  }

  function route(fx, fy, tx, ty) {
    const sx = Math.min(W - 1, Math.max(0, Math.floor(fx))), sy = Math.min(D - 1, Math.max(0, Math.floor(fy)));
    if (sx === tx && sy === ty) return [];
    const prev = new Map([[k2(sx, sy), null]]), q = [[sx, sy]];
    while (q.length) {
      const [x, y] = q.shift();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, key = k2(nx, ny);
        if (nx < 0 || ny < 0 || nx >= W || ny >= D || prev.has(key)) continue;
        const target = nx === tx && ny === ty;
        if (blocked.has(key) && !target) continue;
        prev.set(key, [x, y]);
        if (target) {
          const path = [];
          for (let p = [nx, ny]; p && !(p[0] === sx && p[1] === sy); p = prev.get(k2(p[0], p[1]))) path.unshift(p);
          return path;
        }
        q.push([nx, ny]);
      }
    }
    return [[tx, ty]];
  }
  function goTo(a, spot, done) {
    const tiles = route(a.x, a.y, spot.x, spot.y), at = spot.at || [spot.x + .5, spot.y + .5];
    a.path = tiles.map(([x, y]) => ({ x: x + .5, y: y + .5 }));
    if (a.path.length) a.path[a.path.length - 1] = { x: at[0], y: at[1] }; else a.path = [{ x: at[0], y: at[1] }];
    a.onArrive = done;
  }
  function release(a) { if (a.spot && a.spot.taken === a) a.spot.taken = null; a.spot = null; }
  function settle(a, s) {
    a.dir = s.dir; a.pose = s.pose; a.timer = 8 + Math.random() * 14;
    if (s.pose === "drink") a.brewUntil = clock + 3;
    if (s.sofa && a.idleFor > 45 && Math.random() < .55) { a.pose = "sleep"; a.timer += 12; }
  }
  function wander(a, prefer) {
    release(a);
    const free = SPOTS.filter((s) => !s.taken && s !== a.lastSpot);
    const s = prefer && !prefer.taken ? prefer : free[Math.floor(Math.random() * free.length)];
    if (!s) { a.timer = 3; return; }
    s.taken = a; a.spot = s; a.lastSpot = s; a.mode = "idle"; a.seated = false;
    goTo(a, s, () => settle(a, s));
  }
  function placeIdle(a) {
    const free = SPOTS.filter((s) => !s.taken);
    const s = free[(a.i * 5 + 3) % free.length];
    s.taken = a; a.spot = s; a.lastSpot = s;
    const at = s.at || [s.x + .5, s.y + .5];
    a.x = at[0]; a.y = at[1]; settle(a, s); a.timer = 2 + rnd(a.i) * 10;
  }

  function assign(a, job, d, instant) {
    release(a);
    a.job = job; a.desk = d; d.agent = a; a.mode = "toDesk"; a.idleFor = 0; a.done = null; a.seated = false;
    const seat = { x: d.x, y: d.y + 1, at: [d.x + .5, d.y + 1.42] };
    if (instant) { a.x = seat.at[0]; a.y = seat.at[1]; a.path = []; sit(a); d.boot = -9; return; }
    a.bubble = { g: "!", until: clock + 1.2, c: NEON.amber }; a.hop = .35; a.wait = .75; a.path = []; a.pose = "stand";
    if (a.dir === "ne" || a.dir === "nw") a.dir = "se";
    goTo(a, seat, () => sit(a));
  }
  function sit(a) { a.mode = "work"; a.seated = true; a.dir = "ne"; a.pose = "desk"; a.desk.boot = clock; }
  function finish(a, ok) {
    a.done = ok ? "ok" : "bad"; a.mode = "done"; a.timer = 2.6;
    a.bubble = { g: ok ? "check" : "x", until: clock + 2.6, c: ok ? NEON.green : NEON.red };
    if (ok) confetti(a);
  }
  function leaveDesk(a) {
    if (a.desk && a.desk.agent === a) a.desk.agent = null;
    a.desk = null; a.job = null; a.done = null; a.seated = false; a.mode = "idle"; a.idleFor = 0;
    const coffee = SPOTS.find((s) => s.pose === "drink");
    wander(a, Math.random() < .6 ? coffee : null);
    paintLists();
  }

  function step(a, dt) {
    a.phase += dt;
    if (a.hop > 0) a.hop = Math.max(0, a.hop - dt);
    if (a.wait > 0) { a.wait -= dt; return; }
    if (a.path.length) {
      const n = a.path[0], dx = n.x - a.x, dy = n.y - a.y, dist = Math.hypot(dx, dy), v = SPEED * dt;
      if (Math.abs(dx) > Math.abs(dy)) a.dir = dx > 0 ? "se" : "nw"; else if (dy) a.dir = dy > 0 ? "sw" : "ne";
      if (dist <= v) {
        a.x = n.x; a.y = n.y; a.path.shift();
        if (!a.path.length && a.onArrive) { const f = a.onArrive; a.onArrive = null; f(); }
      } else { a.x += (dx / dist) * v; a.y += (dy / dist) * v; }
      return;
    }
    if (a.mode === "idle") { a.idleFor += dt; a.timer -= dt; if (a.timer <= 0) wander(a); }
    else if (a.mode === "done") { a.timer -= dt; if (a.timer <= 0) leaveDesk(a); }
  }

  // ---------------------------------------------------------------- particles: music, sleep, coffee, confetti
  let musicAt = 0;
  function emit(kind, x, y, o) { if (particles.length < 140) particles.push({ kind, x, y, vx: 0, vy: -8, life: 2, age: 0, c: "#fff", grav: 0, ...o }); }
  function confetti(a) {
    if (!a.head) return;
    const cols = [NEON.pink, NEON.cyan, NEON.green, NEON.amber, NEON.violet, "#ffffff"];
    for (let i = 0; i < 34; i++) emit("bit", a.head[0], a.head[1] - 2, { vx: (Math.random() - .5) * 60, vy: -28 - Math.random() * 40, life: 1.3 + Math.random() * .7, c: cols[i % cols.length], grav: 80 });
  }
  function tickParticles(dt) {
    musicAt += dt;
    if (musicAt > 1.25) {
      musicAt = 0;
      const [bx, by] = P(2.5, 5.5, 13);
      emit("note", bx - 2 + Math.random() * 4, by - 6, { vx: (Math.random() - .5) * 6, vy: -9, life: 2.6, c: Math.random() < .5 ? NEON.pink : NEON.cyan });
    }
    for (const a of agents) {
      if (a.path.length || !a.head) continue;
      a.emit += dt;
      if (a.pose === "sleep" && a.emit > 1.5) { a.emit = 0; emit("z", a.head[0] + 3, a.head[1] - 2, { vx: 3, vy: -6, life: 2.4, c: "#cfd8ff" }); }
      if (a.pose === "dance" && a.mode === "idle" && a.emit > 1.1) { a.emit = 0; emit("note", a.head[0] + 3, a.head[1] - 2, { vx: 5, vy: -8, life: 1.8, c: a.color }); }
      if (a.pose === "drink" && a.mode === "idle" && a.emit > .45) { a.emit = 0; const [sx, sy] = clock < a.brewUntil ? P(4.34, .48, 22) : [a.head[0] + 2, a.head[1] + 6]; emit("bit", sx, sy, { vx: (Math.random() - .5) * 2, vy: -7, life: 1.1, c: "rgba(255,255,255,.55)" }); }
    }
    for (const p of particles) { p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.grav * dt; }
    particles = particles.filter((p) => p.age < p.life);
  }
  function drawParticles(g) {
    for (const p of particles) {
      g.globalAlpha = Math.max(0, Math.min(1, (1 - p.age / p.life) * 1.6));
      if (p.kind === "bit") dot(g, p.x, p.y, p.c, 1, p.grav && Math.floor(p.age * 12) % 2 ? 2 : 1);
      else glyph(g, p.kind, Math.round(p.x), Math.round(p.y), p.c);
    }
    g.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- what there is to do, from the Hub
  const TASK_STATE = { IN_PROGRESS: "work", WAITING_APPROVAL: "wait", NEEDS_HELP: "help", PAUSED: "pause" };
  const FRESH = 30 * 60e3, STILL_WAITING = 20 * 60e3;
  function taskJob(x, state) {
    return { key: "t" + x.id, type: "task", id: x.id, title: x.title, who: nameOf(x.assignee), state, progress: x.progress || 0,
      action: x.current_action || "", role: x.agent_role || "", since: x.started_at || x.created_at, project: x.project_name || x.company || x.project || "",
      word: state === "wait" ? "à espera de aprovação" : "", href: `#task-${x.id}` };
  }
  function jobsOf() {
    const now = Date.now(), out = [];
    for (const x of tasks) {
      if (x.trashed_at) continue;
      const state = TASK_STATE[x.status] || (x.status === "ASSIGNED" && now - Date.parse(x.created_at) < FRESH ? "start" : null);
      if (state) out.push(taskJob(x, state));
    }
    for (const s of office.sessions || []) {
      if (s.state === "working" || (s.state === "waiting" && now - Date.parse(s.since) < STILL_WAITING)) {
        out.push({ key: "c" + s.id, type: "claude", title: s.prompt || t("Claude aberto em {p}", { p: s.project }), who: s.name, state: s.state === "working" ? "work" : "wait",
          action: s.state === "working" ? s.action || "" : "", since: s.since, project: s.project, href: "#/escritorio" });
      }
      for (const ag of s.agents || []) if (ag.state === "working") {
        out.push({ key: "a" + ag.id, type: "sub", kind: ag.kind, title: ag.description || ag.kind, who: s.name, state: "work", action: ag.action || "",
          since: ag.started_at, project: s.project, href: "#/escritorio" });
      }
    }
    const rank = { work: 0, help: 1, start: 2, wait: 3, pause: 4 };
    return out.sort((p, q) => rank[p.state] - rank[q.state] || String(q.since).localeCompare(String(p.since)));
  }
  function pick(j) {
    const free = agents.filter((a) => !a.job && a.mode !== "done");
    if (!free.length) return null;
    return free.find((a) => (j.role && a.role === j.role) || (j.kind && a.kinds.includes(j.kind)))
      || (j.type === "task" && !j.role ? free.find((a) => a.id === "faztudo") : null)
      || free[hash(j.key) % free.length];
  }
  function nearestDesk(a) {
    const free = DESKS.filter((d) => !d.agent);
    return free.sort((p, q) => Math.abs(p.x - a.x) + Math.abs(p.y + 1 - a.y) - (Math.abs(q.x - a.x) + Math.abs(q.y + 1 - a.y)))[0] || null;
  }
  function outcome(j) {
    if (j.type !== "task") return true;
    const x = tasks.find((y) => y.id === j.id);
    return !x || !["FAILED", "STOPPED"].includes(x.status);
  }
  function reconcile(list, instant) {
    const want = new Map(list.map((j) => [j.key, j]));
    for (const a of agents) {
      if (!a.job || a.mode === "done") continue;
      if (!want.has(a.job.key)) {
        if (a.seated) finish(a, outcome(a.job));
        else { if (a.desk) a.desk.agent = null; a.desk = null; a.job = null; wander(a); }
        continue;
      }
      const j = want.get(a.job.key);
      if (j.state !== a.job.state && a.seated) {
        if (j.state === "work") a.bubble = { g: "!", until: clock + 1, c: NEON.green };
        if (j.state === "help") a.hop = .35;
      }
      a.job = j;
    }
    queue = [];
    for (const j of list) {
      if (agents.some((a) => a.job && a.mode !== "done" && a.job.key === j.key)) continue;
      const a = pick(j), d = a && nearestDesk(a);
      if (!a || !d) { queue.push(j); continue; }
      assign(a, j, d, instant);
    }
  }

  // ---------------------------------------------------------------- the screen
  let stage = null, cv = null, g2 = null, world = null, wg = null, bgs = [], S = 1, dpr = 1, star = null;
  let LS = 1; // labels shrink with a small room
  let timer = 0, raf = 0, last = 0, onScreen = true, ro = null, io = null, hovered = null, focus = null, vignette = null;

  function buildBg() {
    const base = document.createElement("canvas"); base.width = LW; base.height = LH;
    room(base.getContext("2d"));
    bgs = [0, 1].map((dim) => {
      const c = document.createElement("canvas"); c.width = cv.width; c.height = cv.height;
      const g = c.getContext("2d");
      const sky = g.createRadialGradient(c.width * .52, c.height * .42, 0, c.width * .52, c.height * .45, c.width * .7);
      sky.addColorStop(0, "#160f2e"); sky.addColorStop(.55, "#090a16"); sky.addColorStop(1, "#040509");
      g.fillStyle = sky; g.fillRect(0, 0, c.width, c.height);
      for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(200,215,255,${.15 + rnd(i * 3) * .45})`; g.fillRect(rnd(i) * c.width, rnd(i + 50) * c.height, dpr, dpr); }
      g.imageSmoothingEnabled = false;
      g.drawImage(base, 0, 0, c.width, c.height);
      neon(g, dim);
      return c;
    });
    vignette = g2.createRadialGradient(cv.width / 2, cv.height * .5, cv.height * .35, cv.width / 2, cv.height * .5, cv.width * .72);
    vignette.addColorStop(0, "rgba(0,0,0,0)"); vignette.addColorStop(1, "rgba(0,0,0,.5)");
  }
  const Q = (x, y, z) => P(x, y, z).map((v) => v * S);
  function neon(g, dim) {
    const tube = (a, b, c, w = 1.3) => {
      g.save(); g.lineCap = "round";
      g.strokeStyle = c; g.lineWidth = w * S; g.shadowColor = c; g.shadowBlur = 12 * S;
      g.beginPath(); g.moveTo(...Q(...a)); g.lineTo(...Q(...b)); g.stroke(); g.stroke();
      g.shadowBlur = 2 * S; g.globalAlpha = .7; g.strokeStyle = "#ffffff"; g.lineWidth = w * S * .35; g.stroke();
      g.restore();
    };
    tube([0, 0, 1.5], [W, 0, 1.5], NEON.cyan);
    tube([0, 0, 1.5], [0, D, 1.5], NEON.pink);
    tube([0, 0, WALL - 2.5], [W, 0, WALL - 2.5], NEON.violet, .9);
    tube([0, 0, WALL - 2.5], [0, D, WALL - 2.5], NEON.cyan, .9);
    for (const [x, c] of [[1.15, NEON.violet], [6.7, NEON.cyan], [15.6, NEON.pink]]) tube([x, 0, 7], [x, 0, 53], c, 1.1);
    for (const [y, c] of [[1.7, NEON.cyan], [10.5, NEON.violet]]) tube([0, y, 7], [0, y, 53], c, 1.1);
    tube([0, D, 0], [W, D, 0], NEON.pink, .7);
    tube([W, 0, 0], [W, D, 0], NEON.cyan, .7);
    tube([6, 1.3, .2], [6, D - .4, .2], "rgba(56,243,255,.55)", .6);
    // light from the ceiling: soft pools on the floor
    g.save(); g.globalCompositeOperation = "lighter";
    for (const [x, y, r, c, a] of [[11, 5, 120, "#3a7bff", .16], [3, 6, 90, "#ff3cac", .12], [1.2, 8.8, 50, "#8fa8ff", .12], [14, 8.5, 70, "#38f3ff", .08]]) {
      const [cx, cy] = Q(x, y, 0), gr = g.createRadialGradient(cx, cy, 0, cx, cy, r * S);
      gr.addColorStop(0, c); gr.addColorStop(1, "rgba(0,0,0,0)");
      g.globalAlpha = a; g.fillStyle = gr; g.save(); g.translate(cx, cy); g.scale(1, .5); g.translate(-cx, -cy);
      g.beginPath(); g.arc(cx, cy, r * S, 0, Math.PI * 2); g.fill(); g.restore();
    }
    g.restore();
    sign(g, dim);
    if (star) {
      // the star over the coffee machine: AMG's, in chrome
      g.save(); const [sx, sy] = P(3.35, 0, 54);
      g.setTransform(S, S * .5, 0, S, sx * S, sy * S);
      g.shadowColor = "rgba(230,240,255,.9)"; g.shadowBlur = (dim ? 4 : 10) * S; g.globalAlpha = dim ? .55 : 1;
      g.drawImage(star, 0, 0, 17, 17); g.restore();
    }
  }
  function sign(g, dim) {
    const [sx, sy] = P(7.6, 0, 31);
    g.save();
    g.setTransform(S, S * .5, 0, S, sx * S, sy * S);
    g.font = `700 18px ${DISPLAY}`; g.textBaseline = "alphabetic"; g.lineJoin = "round";
    const text = "MY NIGGAZ";
    g.shadowColor = NEON.pink; g.shadowBlur = (dim ? 3 : 18) * S;
    g.strokeStyle = dim ? "#5b1d40" : NEON.pink; g.lineWidth = 2.6;
    g.strokeText(text, 0, 0); if (!dim) g.strokeText(text, 0, 0);
    g.shadowBlur = (dim ? 0 : 5) * S; g.fillStyle = dim ? "#2b1022" : "#ffe6f4"; g.fillText(text, 0, 0);
    g.font = `600 5.6px ${FONT}`; if ("letterSpacing" in g) g.letterSpacing = "2.4px";
    g.shadowColor = NEON.cyan; g.shadowBlur = (dim ? 2 : 8) * S; g.fillStyle = dim ? "#2a6f78" : "#bdfbff";
    g.fillText("AGENTE AMG  ·  CREW", 1.5, 10);
    g.restore();
  }

  const glowCache = {};
  function glow(g, x, y, r, c, alpha) {
    let s = glowCache[c];
    if (!s) {
      s = glowCache[c] = document.createElement("canvas"); s.width = s.height = 64;
      const q = s.getContext("2d"), gr = q.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, c); gr.addColorStop(1, "rgba(0,0,0,0)"); q.fillStyle = gr; q.fillRect(0, 0, 64, 64);
    }
    g.globalAlpha = alpha; g.drawImage(s, (x - r) * S, (y - r) * S, 2 * r * S, 2 * r * S); g.globalAlpha = 1;
  }
  const LIGHT = { work: NEON.cyan, start: NEON.cyan, wait: NEON.amber, help: NEON.red, pause: "#7d8590", done: NEON.green, fail: NEON.red };
  function lights(g) {
    g.globalCompositeOperation = "lighter";
    for (const d of DESKS) {
      const mode = deskMode(d);
      if (mode === "off") continue;
      glow(g, ...P(d.x + .4, d.y + .45, 24), 26, LIGHT[mode], .42 + Math.sin(clock * 6 + d.i) * .04);
      glow(g, ...P(d.x + .3, d.y + 1.1, 0), 22, LIGHT[mode], .16);
    }
    glow(g, ...P(5.4, .9, 22), 20, NEON.cyan, .22);
    for (const a of agents) {
      if (!a.head) continue;
      const [fx, fy] = P(a.x, a.y), on = a === hovered || a === focus, busy = a.job && a.mode !== "done";
      if (a.seated && !on) continue;
      g.globalAlpha = on ? .95 : busy ? .6 : .32;
      g.strokeStyle = a.color; g.lineWidth = (on ? 1.6 : 1.1) * S;
      g.beginPath(); g.ellipse(fx * S, fy * S, 7.5 * S, 3.2 * S, 0, 0, Math.PI * 2); g.stroke();
      g.globalAlpha = 1;
    }
    glow(g, ...P(.1, 5, 36), 30, NEON.cyan, .14 + (Math.floor(clock * 2) % 2) * .04);
    glow(g, ...P(2.5, .9, 25), 22, NEON.violet, .3);
    glow(g, ...P(2.5, 5.5, 10), 18, NEON.pink, .1 + (Math.floor(clock * 2) % 2) * .06);
    g.globalCompositeOperation = "source-over";
  }

  // ---------------------------------------------------------------- labels over the heads (sharp, on the big canvas)
  const WORD = { work: ["a trabalhar", NEON.green], start: ["a começar", NEON.cyan], wait: ["à tua espera", NEON.amber], help: ["precisa de ajuda", NEON.red],
    pause: ["em pausa", "#9aa2ab"], go: ["vai trabalhar", NEON.cyan], done: ["feito", NEON.green], fail: ["falhou", NEON.red] };
  const idleWord = (a) => (a.path.length ? "a caminho" : a.pose === "sleep" ? "a dormir" : a.spot ? a.spot.word : "livre");
  function labelOf(a) {
    if (!a.job) return { pill: true, name: a.name, word: t(idleWord(a)), color: a.color };
    const st = a.mode === "done" ? (a.done === "ok" ? "done" : "fail") : a.mode === "toDesk" ? "go" : a.job.state;
    const [word, color] = WORD[st];
    return { name: a.name, word: t(st === a.job.state && a.job.word ? a.job.word : word), color, title: a.job.title,
      meta: `${t("para")} ${a.job.who}${a.job.project ? ` · ${a.job.project}` : ""}`, progress: a.job.type === "task" && a.job.progress > 0 ? a.job.progress : null };
  }
  function clip(g, s, max) {
    s = String(s || "");
    if (g.measureText(s).width <= max) return s;
    while (s.length > 1 && g.measureText(s + "…").width > max) s = s.slice(0, -1);
    return s.trimEnd() + "…";
  }
  function wrap(g, text, max, n) {
    const words = String(text || "").replace(/\s+/g, " ").trim().split(" "), out = [];
    let cur = "";
    for (let i = 0; i < words.length; i++) {
      const next = cur ? `${cur} ${words[i]}` : words[i];
      if (g.measureText(next).width <= max) { cur = next; continue; }
      if (cur) out.push(cur);
      cur = words[i];
      if (out.length === n) { out[n - 1] = clip(g, `${out[n - 1]} ${words.slice(i).join(" ")}`, max); cur = ""; break; }
    }
    if (cur) out.push(clip(g, cur, max));
    return out.length ? out : [""];
  }
  const measured = new Map();
  function measure(g, L) {
    const id = `${dpr * LS}|${L.pill ? 1 : 0}|${L.name}|${L.word}|${L.title || ""}|${L.meta || ""}|${L.progress ?? ""}`;
    let m = measured.get(id);
    if (!m) { if (measured.size > 300) measured.clear(); measured.set(id, (m = measureNow(g, L))); }
    return m;
  }
  function measureNow(g, L) {
    const k = dpr * LS;
    if (L.pill) {
      g.font = `600 ${10.5 * k}px ${FONT}`; const nw = g.measureText(L.name).width;
      g.font = `500 ${9.5 * k}px ${FONT}`; const ww = g.measureText(L.word).width;
      return { w: Math.ceil(nw + ww + 30 * k), h: Math.round(19 * k), nw };
    }
    const maxW = 172 * k, pad = 10 * k;
    g.font = `500 ${10.5 * k}px ${FONT}`; const lines = wrap(g, L.title, maxW - 2 * pad, 2);
    const tw = Math.max(...lines.map((s) => g.measureText(s).width));
    g.font = `700 ${11 * k}px ${FONT}`; const nw = g.measureText(L.name).width;
    g.font = `700 ${8.5 * k}px ${FONT}`; const ww = g.measureText(L.word.toUpperCase()).width;
    g.font = `500 ${9.5 * k}px ${FONT}`; const meta = clip(g, L.meta, maxW - 2 * pad);
    const w = Math.ceil(Math.min(maxW, Math.max(tw, nw + ww + 26 * k, g.measureText(meta).width) + 2 * pad));
    const h = Math.round((27 + lines.length * 13.5 + 14 + (L.progress != null ? 7 : 0) + 4) * k);
    return { w, h, lines, meta, nw, ww };
  }
  function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); }
  function paintLabel(g, it, m, x, y) {
    const k = dpr * LS, L = it.L;
    // the stem: from the card down to the head
    g.strokeStyle = L.pill ? "rgba(255,255,255,.16)" : L.color; g.globalAlpha = L.pill ? 1 : .55; g.lineWidth = k;
    g.beginPath(); g.moveTo(it.ax, y + m.h); g.lineTo(it.ax, it.ay); g.stroke(); g.globalAlpha = 1;
    if (L.pill) {
      rr(g, x, y, m.w, m.h, m.h / 2); g.fillStyle = "rgba(7,9,15,.78)"; g.fill();
      g.strokeStyle = "rgba(255,255,255,.1)"; g.stroke();
      g.fillStyle = L.color; g.beginPath(); g.arc(x + 9.5 * k, y + m.h / 2, 2.6 * k, 0, Math.PI * 2); g.fill();
      g.textBaseline = "middle";
      g.font = `600 ${10.5 * k}px ${FONT}`; g.fillStyle = "#e9edf3"; g.fillText(L.name, x + 16 * k, y + m.h / 2 + .5 * k);
      g.font = `500 ${9.5 * k}px ${FONT}`; g.fillStyle = "#8b929c"; g.fillText(L.word, x + 21 * k + m.nw, y + m.h / 2 + .5 * k);
      return;
    }
    const pad = 10 * k;
    g.save(); g.shadowColor = L.color; g.shadowBlur = 14 * k; g.globalAlpha = .35;
    rr(g, x, y, m.w, m.h, 9 * k); g.fillStyle = "#000"; g.fill(); g.restore();
    rr(g, x, y, m.w, m.h, 9 * k); g.fillStyle = "rgba(7,9,15,.93)"; g.fill();
    g.strokeStyle = L.color; g.globalAlpha = .55; g.lineWidth = k; g.stroke(); g.globalAlpha = 1;
    g.fillStyle = L.color; g.fillRect(x + pad, y + 6 * k, 14 * k, 2 * k);   // a little bar of colour on top, like a tag
    g.textBaseline = "alphabetic";
    g.font = `700 ${11 * k}px ${FONT}`; g.fillStyle = "#ffffff"; g.fillText(L.name, x + pad, y + 22 * k);
    g.font = `700 ${8.5 * k}px ${FONT}`; g.fillStyle = L.color; g.textAlign = "right";
    g.fillText(L.word.toUpperCase(), x + m.w - pad, y + 21.5 * k);
    g.textAlign = "left";
    g.font = `500 ${10.5 * k}px ${FONT}`; g.fillStyle = "#d6dde8";
    m.lines.forEach((s, i) => g.fillText(s, x + pad, y + (37 + i * 13.5) * k));
    const my = y + (37 + m.lines.length * 13.5 + 1) * k;
    g.font = `500 ${9.5 * k}px ${FONT}`; g.fillStyle = "#7f8894"; g.fillText(m.meta, x + pad, my);
    if (L.progress != null) {
      const bw = m.w - 2 * pad, by = my + 6 * k;
      rr(g, x + pad, by, bw, 3 * k, 2 * k); g.fillStyle = "rgba(255,255,255,.08)"; g.fill();
      rr(g, x + pad, by, Math.max(3 * k, bw * Math.min(1, L.progress / 100)), 3 * k, 2 * k); g.fillStyle = L.color; g.fill();
    }
  }
  function labels(g) {
    const list = [];
    for (const a of agents) if (a.head) list.push({ a, L: labelOf(a), ax: a.head[0] * S, ay: (a.head[1] - 2) * S });
    list.sort((p, q) => (p.L.pill ? 1 : 0) - (q.L.pill ? 1 : 0) || q.ay - p.ay);
    const placed = [], k = dpr * LS;
    for (const it of list) {
      const m = measure(g, it.L);
      let x = Math.round(it.ax - m.w / 2), y = Math.round(it.ay - m.h - (it.L.pill ? 5 : 9) * k);
      const home = y;
      x = Math.max(4 * k, Math.min(cv.width - m.w - 4 * k, x));
      for (let i = 0; i < 12; i++) {
        const hit = placed.find((r) => x < r.x + r.w + 4 * k && x + m.w + 4 * k > r.x && y < r.y + r.h + 4 * k && y + m.h + 4 * k > r.y);
        if (!hit) break;
        y = hit.y - m.h - 5 * k;
      }
      y = Math.max(3 * k, y);
      // somebody free whose name would float far from their head stays quiet (the name shows on hover)
      if (it.L.pill && home - y > 26 * k && it.a !== hovered && it.a !== focus) { it.a.label = null; continue; }
      placed.push({ x, y, w: m.w, h: m.h });
      it.a.label = { x, y, w: m.w, h: m.h };
      paintLabel(g, it, m, x, y);
    }
  }

  // ---------------------------------------------------------------- one frame
  const FURN = [];
  const furn = (x, y, draw) => FURN.push({ k: x + y + 1, x, draw });
  DESKS.forEach((d) => { furn(d.x, d.y, (g) => desk(g, d)); furn(d.x, d.y + 1, (g) => chair(g, d)); });
  SOFA.forEach((y) => furn(0, y, (g) => sofa(g, y)));
  BAGS.forEach(([x, y, c]) => furn(x, y, (g) => bag(g, x, y, c)));
  PLANTS.forEach(([x, y]) => furn(x, y, (g) => plant(g, x, y)));
  furn(2, 0, arcade); furn(4, 0, coffee); furn(5, 0, vending); furn(2, 5, table); furn(16, 0, rack);

  function drawAgent(g, a) {
    const [fx, fy] = P(a.x, a.y);
    let pose = a.path.length && !a.wait ? "walk" : a.pose, dir = a.dir;
    let seat = 0;
    if (a.seated) {
      seat = 9; dir = "ne";
      pose = a.mode === "done" ? (a.done === "ok" ? "deskDone" : "deskWait") : !a.job || a.job.state === "work" || a.job.state === "start" ? "desk" : "deskWait";
    } else if (!a.path.length && a.spot && a.spot.seat && (pose === "sit" || pose === "sleep")) seat = a.spot.seat;
    if (pose === "drink") { if (clock < a.brewUntil) { pose = "play"; dir = "ne"; } else dir = "sw"; }
    if (!seat) oval(g, fx, fy, 5, 2, "rgba(0,0,0,.42)");
    a.head = person(g, a.look, { x: fx, y: fy, dir, pose, tm: a.phase, hop: a.hop, seat });
    a.box = [fx - 7, a.head[1] - 2, fx + 7, fy + 1];
  }
  function bubbles(g) {
    for (const a of agents) {
      if (!a.head) continue;
      let b = a.bubble && a.bubble.until > clock ? a.bubble : null;
      if (!b && a.seated && a.mode === "work" && a.job) {
        b = { wait: { g: "?", c: NEON.amber }, help: { g: "!", c: NEON.red }, start: { g: "dots", c: NEON.cyan }, pause: { g: "pause", c: "#6b7380" } }[a.job.state];
        if (b && (a.job.state === "wait" || a.job.state === "help") && Math.floor(clock * 2) % 4 === 3) b = null;
      }
      if (b) bubble(g, a.head[0] + 5, a.head[1] + 5, b.g, b.c);
    }
  }
  const flicker = () => { const c = clock % 11; return (c > 9.6 && c < 9.72) || (c > 9.84 && c < 9.9) || (c > 10.2 && c < 10.26); };

  function draw() {
    const g = wg;
    g.clearRect(0, 0, LW, LH);
    tv(g);
    const items = FURN.slice();
    for (const a of agents) if (!a.seated) items.push({ k: a.x + a.y, x: a.x + .01, draw: () => drawAgent(g, a) });
    items.sort((p, q) => p.k - q.k || p.x - q.x);
    for (const it of items) it.draw(g);
    drawParticles(g);
    bubbles(g);
    g2.globalCompositeOperation = "source-over";
    g2.drawImage(bgs[flicker() ? 1 : 0], 0, 0);
    g2.imageSmoothingEnabled = false;
    g2.drawImage(world, 0, 0, cv.width, cv.height);
    lights(g2);
    g2.fillStyle = vignette; g2.fillRect(0, 0, cv.width, cv.height);
    labels(g2);
  }

  function frame(now) {
    raf = 0;
    if (!stage || !stage.isConnected) { stop(); return; }
    if (document.hidden || !onScreen) { last = 0; return; }
    const dt = last ? Math.min(.25, (now - last) / 1000) : 0;
    last = now; clock += dt;
    for (const a of agents) step(a, dt);
    tickParticles(dt);
    if (bgs.length) draw();
    const busy = agents.some((a) => a.path.length || a.hop > 0) || particles.some((p) => p.kind === "bit" && p.grav);
    timer = setTimeout(() => { timer = 0; raf = requestAnimationFrame(frame); }, busy ? 1000 / 26 : 1000 / 12);
  }
  function wake() {
    if (raf || !stage || !stage.isConnected) return;
    clearTimeout(timer); timer = 0; last = 0;
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    clearTimeout(timer); timer = 0; if (raf) cancelAnimationFrame(raf); raf = 0;
    if (ro) ro.disconnect(); if (io) io.disconnect(); ro = io = null;
    document.removeEventListener("visibilitychange", wake);
  }

  function resize() {
    if (!stage || !stage.isConnected) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = stage.clientWidth;
    if (!cssW) return;
    const w = Math.round(cssW * dpr), h = Math.round((cssW * LH / LW) * dpr);
    if (cv.width === w && cv.height === h && bgs.length) return;
    cv.width = w; cv.height = h; cv.style.height = `${Math.round(cssW * LH / LW)}px`;
    S = w / LW;
    LS = Math.max(.8, Math.min(1, cssW / 1000));
    buildBg();
    draw();
    wake();
  }

  // ---------------------------------------------------------------- hover, click
  function hitTest(e) {
    const r = cv.getBoundingClientRect(), mx = (e.clientX - r.left) * (cv.width / r.width), my = (e.clientY - r.top) * (cv.height / r.height);
    for (const a of agents) { const b = a.label; if (b && mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) return a; }
    const front = [...agents].sort((p, q) => q.x + q.y - (p.x + p.y));
    for (const a of front) { const b = a.box; if (b && mx >= b[0] * S && mx <= b[2] * S && my >= b[1] * S && my <= b[3] * S) return a; }
    return null;
  }
  const row = (label, value) => `<div><dt>${esc(t(label))}</dt><dd>${esc(value)}</dd></div>`;
  function tipHtml(a) {
    const head = `<div class="cr-tip-h"><img class="cr-px" src="${a.portrait}" alt=""><div><b>${esc(a.name)}</b><span>${esc(t(a.what))}</span></div></div>`;
    if (!a.job) return `${head}<p class="cr-tip-idle"><i style="--c:${a.color}"></i>${esc(t("À espera de trabalho"))} · ${esc(t(idleWord(a)))}</p>`;
    const j = a.job, L = labelOf(a);
    return `${head}<em class="cr-tip-st" style="--c:${L.color}">${esc(L.word)}</em><p class="cr-tip-t">${esc(j.title)}</p>
      <dl>${row("Para", j.who)}${j.project ? row("Onde", j.project) : ""}${j.action ? row("Agora", j.action) : ""}${j.since ? row("Desde", fmt.ago(j.since)) : ""}${L.progress != null ? row("Feito", `${L.progress}%`) : ""}</dl>
      <small>${esc(t(j.type === "task" ? "Clica para abrir a tarefa" : "Clica para ver no Escritório"))}</small>`;
  }
  function onMove(e) {
    const a = hitTest(e), tip = $("cr-tip");
    stage.classList.toggle("point", !!(a && a.job));
    if (!a) { tip.hidden = true; hovered = null; return; }
    if (hovered !== a || tip.hidden) { tip.innerHTML = tipHtml(a); tip.hidden = false; hovered = a; }
    const r = stage.getBoundingClientRect();
    let x = e.clientX - r.left + 16, y = e.clientY - r.top + 14;
    if (x + tip.offsetWidth > r.width - 8) x = e.clientX - r.left - tip.offsetWidth - 16;
    if (y + tip.offsetHeight > r.height - 8) y = Math.max(8, r.height - tip.offsetHeight - 8);
    tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  // ---------------------------------------------------------------- the page around it
  const ago = (iso) => (iso ? fmt.ago(iso) : "");
  function stat(n, label, c) { return `<div class="cr-stat ${n ? "lit" : ""}" style="--c:${c}"><i></i><b>${n}</b><span>${esc(t(label))}</span></div>`; }
  function jobRow(a) {
    const j = a.job, L = labelOf(a);
    return `<button class="cr-job" data-href="${esc(j.href)}" style="--c:${a.color}">
      <span class="cr-face"><img class="cr-px" src="${a.portrait}" alt=""></span>
      <div class="cr-job-t"><div><b>${esc(a.name)}</b><em style="--s:${L.color}">${esc(L.word)}</em></div><p>${esc(j.title)}</p>
        <small>${esc(t("para"))} ${esc(j.who)}${j.project ? ` · ${esc(j.project)}` : ""}${j.since ? ` · ${esc(ago(j.since))}` : ""}</small>
        ${L.progress != null ? `<span class="cr-bar"><i style="width:${Math.min(100, L.progress)}%"></i></span>` : ""}</div>
      <span class="cr-go-ic">${icon("chevron")}</span></button>`;
  }
  function queueRow(j) {
    const why = j.stale ? t("à espera do agente automático de {n}", { n: j.who }) : t("à espera de um computador livre");
    return `<button class="cr-q" data-href="${esc(j.href)}"><i></i><div><p>${esc(j.title)}</p><small>${esc(t("para"))} ${esc(j.who)} · ${esc(why)}</small></div>${icon("chevron")}</button>`;
  }
  function paintLists() {
    if (!$("cr-stats")) return;
    const busy = agents.filter((a) => a.job && a.mode !== "done");
    const n = (f) => busy.filter((a) => f(a.job.state)).length;
    const stale = tasks.filter((x) => !x.trashed_at && x.status === "ASSIGNED" && !jobs.some((j) => j.key === `t${x.id}`)).map((x) => ({ ...taskJob(x, "start"), stale: true }));
    const fila = [...queue, ...stale];
    paint($("cr-stats"), stat(n((s) => s === "work" || s === "start"), "a trabalhar", NEON.green) + stat(n((s) => s === "wait" || s === "help" || s === "pause"), "à tua espera", NEON.amber)
      + stat(agents.length - busy.length, "à espera de trabalho", "#9aa2ab") + stat(fila.length, "na fila", NEON.violet));
    paint($("cr-crew"), agents.map((a) => {
      const st = !a.job || a.mode === "done" ? "idle" : a.job.state === "work" || a.job.state === "start" ? "work" : "wait";
      return `<button class="cr-mate st-${st}" data-mate="${a.i}" style="--c:${a.color}" title="${esc(a.name)} · ${esc(t(a.what))}"><img class="cr-px" src="${a.portrait}" alt=""><i></i><span>${esc(a.name)}</span></button>`;
    }).join(""));
    const order = { work: 0, help: 1, start: 2, wait: 3, pause: 4 };
    paint($("cr-jobs"), busy.length ? busy.sort((p, q) => order[p.job.state] - order[q.job.state]).map(jobRow).join("")
      : `<p class="cr-quiet">${esc(t("Ninguém a trabalhar agora. Escreve lá em cima o que é para fazer e um deles vai já para o computador."))}</p>`);
    paint($("cr-queue"), fila.length ? fila.map(queueRow).join("")
      : `<p class="cr-quiet">${esc(t("Nada na fila."))}</p>`);
  }

  let lastLoad = 0, later = null;
  async function load() {
    if (!stage || !stage.isConnected) return;
    const wait = 2500 - (Date.now() - lastLoad);
    if (wait > 0) { clearTimeout(later); later = setTimeout(load, wait); return; }
    lastLoad = Date.now();
    try {
      const [o, ts] = await Promise.all([api("/api/office"), api("/api/tasks")]);
      office = o; tasks = ts;
    } catch (e) {
      if (e.message !== "unauthorized" && $("cr-jobs") && firstLoad) $("cr-jobs").innerHTML = ui.error(e.message);
      return;
    }
    if (!stage || !stage.isConnected) return;
    jobs = jobsOf();
    reconcile(jobs, firstLoad);
    firstLoad = false;
    paintLists();
  }

  async function send(e) {
    e.preventDefault();
    const input = $("cr-title"), title = input.value.trim();
    if (!title) { input.focus(); return; }
    const role = (stage.parentElement.querySelector('input[name="cr-role"]:checked') || {}).value || "";
    const who = $("cr-who") ? $("cr-who").value : me.username;
    const go = $("cr-go");
    go.disabled = true;
    try {
      const task = await api("/api/tasks", { method: "POST", body: { title, assignee: who, agent_role: role, for_ai: true } });
      input.value = "";
      tasks = [task, ...tasks.filter((x) => x.id !== task.id)];
      jobs = jobsOf();
      reconcile(jobs, false);
      paintLists();
      const a = agents.find((x) => x.job && x.job.key === `t${task.id}`);
      flash(a ? t("{n} já vai para o computador.", { n: a.name }) : t("Mandado. Fica na fila até haver um computador livre."));
      wake();
    } catch (err) {
      flash(err.message);
    } finally {
      go.disabled = false; input.focus();
    }
  }

  function mount() {
    stop();
    stage = $("cr-stage"); cv = $("cr-canvas"); g2 = cv.getContext("2d");
    if (!world) { world = document.createElement("canvas"); world.width = LW; world.height = LH; wg = world.getContext("2d"); }
    if (!agents.length) { agents = CREW.map(makeAgent); agents.forEach(placeIdle); }
    if (!star) {
      const img = new Image();
      img.onload = () => { star = img; if (cv && cv.width && stage && stage.isConnected) buildBg(); };
      img.src = "assets/mercedes-star.svg";
    }
    bgs = []; cv.width = 0;
    ro = new ResizeObserver(() => resize()); ro.observe(stage);
    io = new IntersectionObserver(([en]) => { onScreen = en.isIntersecting; if (onScreen) wake(); }); io.observe(stage);
    document.addEventListener("visibilitychange", wake);
    stage.onmousemove = onMove;
    stage.onmouseleave = () => { $("cr-tip").hidden = true; hovered = null; stage.classList.remove("point"); };
    stage.onclick = (e) => { const a = hitTest(e); if (a && a.job && a.job.href) location.hash = a.job.href; };
    $("cr-send").onsubmit = send;
    const open = (e) => { const b = e.target.closest("[data-href]"); if (b) location.hash = b.dataset.href; };
    $("cr-jobs").onclick = open; $("cr-queue").onclick = open;
    const crew = $("cr-crew");
    crew.onmouseover = (e) => { const b = e.target.closest("[data-mate]"); focus = b ? agents[Number(b.dataset.mate)] : null; };
    crew.onmouseleave = () => { focus = null; };
    crew.onclick = (e) => { const b = e.target.closest("[data-mate]"), a = b && agents[Number(b.dataset.mate)]; if (a && a.job && a.job.href) location.hash = a.job.href; };
    resize();
  }

  HUB_VIEWS.niggaz = async function () {
    const users = me.lead ? await api("/api/users").catch(() => []) : [];
    page(`${ui.head("Agentes", "My Niggaz", t("A equipa de agentes. Sem trabalho ficam no lounge; manda uma tarefa e um deles vai para um computador fazê-la. Os Claudes a trabalhar nos três PCs também aparecem aqui."))}
      <form class="cr-send" id="cr-send" autocomplete="off">
        <label class="cr-in">${icon("bolt")}<input id="cr-title" maxlength="200" placeholder="${esc(t("O que é para fazer?"))}"></label>
        <div class="cr-roles" role="radiogroup" aria-label="${esc(t("Quem faz"))}">${ROLES.map(([v, l], i) => `<label><input type="radio" name="cr-role" value="${v}" ${i ? "" : "checked"}><span>${esc(t(l))}</span></label>`).join("")}</div>
        ${users.length ? `<label class="cr-who">${icon("users")}<select id="cr-who" title="${esc(t("Para quem"))}">${options(users.map((u) => [u.username, u.display_name]), me.username)}</select></label>` : ""}
        <button class="btn primary cr-go" id="cr-go">${t("Mandar")}${icon("arrow")}</button>
      </form>
      <section class="cr-stage" id="cr-stage"><canvas id="cr-canvas" aria-label="${esc(t("A sala dos agentes"))}"></canvas>
        <div class="cr-hud"><div class="cr-live"><i></i>${t("Ao vivo")}</div><div class="cr-stats" id="cr-stats"></div></div>
        <div class="cr-crew" id="cr-crew"></div>
        <div class="cr-tip" id="cr-tip" hidden></div></section>
      <div class="cr-lists">
        <section><div class="cr-h">${icon("bolt")}<b>${t("Em curso")}</b></div><div id="cr-jobs">${ui.skeleton(3)}</div></section>
        <section><div class="cr-h">${icon("inbox")}<b>${t("Na fila")}</b></div><div id="cr-queue"></div></section>
      </div>`);
    mount();
    lastLoad = 0;
    await load();
  };
  onLive(["task", "office", "tick"], () => load());
})();
