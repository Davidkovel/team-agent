// Empresa AMG (formerly My Niggaz): the crew's Batcave (docs/empresa-amg.md, the 2D phase with characters). Two rooms side by side in one
// isometric world, seen through a camera that pans between them:
// - the office, where the crew lives: eight Batman characters (crew-people.js), four of them in suit and tie. With
//   nothing to do they hang around the lounge (the sofa, the Batcomputer, the suit in its case, Alfred's coffee, the
//   punching bag, chess) or go and look at the cars; when work comes in (a task sent from here or from the board, a
//   Claude working on one of the three PCs, a subagent it launched) the bat-signal lights up and one of them walks to a
//   free computer and works there until it is done. Clicking one opens their mission panel. Each of them is their own
//   Claude conversation on the agent (backend/app/crew.py, agent/.../core/agent.py);
// - the garage, a Batcave showroom: four cars modelled in 3D (crew-cars.js) on mirror-black stands, each waiting to
//   stand for a project (CARS[].project);
// - around them the cave is an island over an abyss (MAP): an underground river with its bridge between the two, the
//   vault (every mission completed is a gold bar on its floor; click it for the numbers), the bar terrace and the lookout,
//   whose searchlight sweeps the cave and throws the bat-signal when a mission comes in.
// It only reads /api/tasks, /api/office and /api/memory, and creates tasks (POST /api/tasks with `crew`).
// Its own files, fetched the first time the page opens (lazyView in ui.js). Weight rules: it only animates while the
// page is open, on screen and in the front tab (12 frames a second, 26 while somebody walks or the camera moves); the
// cave, the stands and the cars are drawn once per size into one picture the camera crops.
(function () {
  // ================================================================ the world, in tiles
  // x runs to the right and down, y to the left and down; z is height in pixels. P() is where a point lands on the small
  // canvas (LW × LH); the camera shows a piece of it blown up. The cave is not a rectangle: it is an island of rock over an
  // abyss, and MAP says what each tile is. o the office · ~ the underground river · b the bridge over it · g the garage ·
  // v the vault · t the bar terrace · p the lookout · . nothing (the drop). Walls stand only along y = 0 and x = 0; every
  // other edge is a drop with a light along it. A new wing: letters here, then its furniture, its spots and its blocked tiles.
  const MAP = [
    "oooooooooooooooo~gggggggggggggg",
    "oooooooooooooooo~gggggggggggggg",
    "oooooooooooooooo~gggggggggggggg",
    "oooooooooooooooo~gggggggggggggg",
    "oooooooooooooooobgggggggggggggg",
    "oooooooooooooooobgggggggggggggg",
    "oooooooooooooooo~gggggggggggggg",
    "oooooooooooooooo~gggggggggggggg",
    "oooooooooooooooo~gggggggggggggg",
    "oooooooooooooooo~gggggggggggggg",
    "oooooooooooooooobgggggggggggggg",
    "vvvvvvv.ttttttt.........ppppppp",
    "vvvvvvv.ttttttt.........ppppppp",
    "vvvvvvv..ttttt...........ppppp.",
    "vvvvvvv...ttt.............ppp..",
    "vvvvvv.........................",
    "vvvv...........................",
  ];
  const W = MAP[0].length, D = MAP.length, WALL = 64, OFFICE_W = 17, GD = 11;   // GD: how deep the office and the garage are
  const tile = (x, y) => (x >= 0 && y >= 0 && x < W && y < D ? MAP[y][x] : ".");
  const BRIDGES = [[4.06, 5.94], [10.06, 10.94]];   // the two bridges over the river, from y to y (they are the "b" tiles)
  const solid = (x, y) => tile(x, y) !== ".";
  const OX = D * 16 + 10, OY = WALL + 40;
  const LW = (W + D) * 16 + 20, LH = OY + (W + D) * 8 + 24;
  const P = (x, y, z = 0) => [OX + (x - y) * 16, OY + (x + y) * 8 - z];
  const ASPECT = 468 / 334, WS = 2;                     // WS: the moving world is drawn at twice the cave's pixels
  const VIEWS = { office: { x: 40, y: 34, w: 512 }, vault: { x: -26, y: 104, w: 312 }, garage: { x: 354, y: 150, w: 438 }, all: { x: -8, y: -30, w: 806 } };
  const NEON = { cyan: "#7fe3ff", blue: "#4fb4ff", yellow: "#ffd23f", red: "#ff2d4f", green: "#4dff9a", amber: "#ffbf3c", violet: "#a66bff", white: "#eef5ff", pink: "#ff4fa3" };
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
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ================================================================ the crew
  // role: the task's agent_role when none is chosen (the Hub does the same, crew.py); kinds: the Claude Code subagents
  // each one stands for; look: their costume, drawn by crew-people.js.
  const CREW = [
    { id: "batman", name: "Batman", full: "Bruce Wayne", what: "Código", role: "developer", kinds: ["general-purpose"], color: "#4fb4ff",
      bio: "Desenvolvedor principal. Mudanças pequenas, testadas, nada deixado a meio.",
      look: { skin: "#c99a76", suit: "#454c59", pants: "#3d4350", shoes: "#0f1115", hands: "#0f1115", cowl: "#0f1115", ears: "bat", cape: "#0d0f13", belt: "#e8b923", emblem: "bat" } },
    { id: "lucius", name: "Lucius", full: "Lucius Fox", what: "Engenharia", role: "developer", kinds: ["explorador", "Explore"], color: "#c9d3df",
      bio: "O engenheiro. Encontra onde vive cada coisa no código e constrói as ferramentas dos outros.",
      look: { skin: "#5a3a27", suit: "#5b626f", pants: "#464c57", shoes: "#15171b", shirt: "#f1f3f5", tie: "#8c1c30", hair: "#cfd3d8", style: "short", beard: "#cfd3d8", glasses: true, brow: "#b9bdc3" } },
    { id: "riddler", name: "Riddler", full: "Edward Nygma", what: "Pesquisa", role: "research", kinds: ["pesquisador", "claude-code-guide"], color: "#3ddc6e",
      bio: "O pesquisador. Procura factos na web e nos documentos, confirma duas vezes e dá as fontes.",
      look: { skin: "#ecc6a2", suit: "#1e7a3c", pants: "#196530", shoes: "#14161a", shirt: "#f1f3f5", tie: "#6b2fa0", hair: "#c0622b", style: "side", hat: "#1b6b35", hatBand: "#6b2fa0", mask: "#4a2380" } },
    { id: "catwoman", name: "Catwoman", full: "Selina Kyle", what: "Design", role: "custom", kinds: ["designer-hub"], color: "#ff4fa3",
      bio: "A designer. Páginas e ecrãs com gosto, no acabamento AMG do Hub. Entrega HTML e CSS a funcionar.",
      look: { skin: "#e2b08c", suit: "#1b1b22", sheen: "#4a4a5c", pants: "#1b1b22", shoes: "#0b0b0f", hands: "#1b1b22", cowl: "#1b1b22", ears: "cat", goggles: "#ff3b5c", lips: "#d01b3c", zip: true } },
    { id: "joker", name: "Joker", full: "Joker", what: "Marketing", role: "marketing", kinds: ["marketing"], color: "#a66bff",
      bio: "O marketing. Textos, anúncios e campanhas com ousadia. Tudo fica em rascunho até ser aprovado.",
      look: { skin: "#eceee6", suit: "#6a2c91", pants: "#5e2782", shoes: "#2a1238", vest: "#2f9e4f", shirt: "#f08a1c", hair: "#3bd14a", style: "slick", smile: "#d0122a", brow: "#2f8a3a" } },
    { id: "alfred", name: "Alfred", full: "Alfred Pennyworth", what: "Revisão", role: "custom", kinds: ["revisor-hub"], color: "#e9d6a6",
      bio: "O revisor. Revê cada mudança antes de ir para todos: erros, riscos e o que falta.",
      look: { skin: "#efcfb0", suit: "#17181d", pants: "#17181d", shoes: "#0b0b0e", hands: "#f4f4f4", shirt: "#f4f4f4", bowtie: "#0b0b0e", vestUnder: "#5a5f69", hair: "#b9bec6", style: "balding", mustache: "#b9bec6" } },
    { id: "robin", name: "Robin", full: "Dick Grayson", what: "Testes", role: "testing", kinds: [], color: "#ff3b4f",
      bio: "O tester. Corre os testes, tenta os casos difíceis e diz exatamente o que falhou.",
      look: { skin: "#e6b994", suit: "#c8102e", sleeves: "#1f8a3a", pants: "#1f6f35", shoes: "#0f3d1f", hands: "#1f8a3a", cape: "#111216", capeIn: "#ffd23f", belt: "#ffd23f", emblem: "robin", mask: "#0b0b0e", hair: "#121212", style: "spiky" } },
    { id: "gordon", name: "Gordon", full: "Jim Gordon", what: "Operações", role: "custom", kinds: ["Plan"], color: "#ffb84d",
      bio: "As operações. Pega no que vier: organizar, planear, pequenas correções, fechar pontas soltas.",
      look: { skin: "#eecbad", suit: "#8b6b45", coat: true, pants: "#3b2f25", shoes: "#1a1410", shirt: "#f1f3f5", tie: "#2b2f38", hair: "#b8743a", style: "short", mustache: "#b8743a", glasses: true } },
  ];
  const crewById = (id) => agents.find((a) => a.id === id);

  // ================================================================ the garage: the stands and the cars. project: what each will stand for.
  const STAND = { hx: 2.85, hy: 1.42, r: .6, h: 6 };   // half length and half width (tiles), corner radius, height (px)
  const CARS = [
    { id: "g63", maker: "Mercedes-AMG", name: "G 63", model: "g63", cx: 20.6, cy: 2.3, dir: 1, color: "#14161b", metal: .45, accent: "#d0182f",
      specs: [["Motor", "V8 4.0 biturbo"], ["Potência", "585 cv"], ["0–100 km/h", "4,5 s"], ["Velocidade máx.", "220 km/h"]], project: null },
    { id: "gt3", maker: "Porsche", name: "911 GT3 RS", model: "gt3", cx: 27.6, cy: 2.3, dir: -1, color: "#1b6fe4", metal: .25, accent: "#ff3b30",
      specs: [["Motor", "6 cil. boxer 4.0"], ["Potência", "525 cv"], ["0–100 km/h", "3,2 s"], ["Velocidade máx.", "296 km/h"]], project: null },
    { id: "svj", maker: "Lamborghini", name: "Aventador SVJ", model: "svj", cx: 20.6, cy: 7.6, dir: 1, color: "#f2b705", metal: .15, accent: "#ffd23f",
      specs: [["Motor", "V12 6.5"], ["Potência", "770 cv"], ["0–100 km/h", "2,8 s"], ["Velocidade máx.", "350 km/h"]], project: null },
    { id: "sf90", maker: "Ferrari", name: "SF90 Stradale", model: "sf90", cx: 27.6, cy: 7.6, dir: 1, color: "#c4060e", metal: .15, accent: "#ff2d4f",
      specs: [["Motor", "V8 híbrido 4.0"], ["Potência", "1000 cv"], ["0–100 km/h", "2,5 s"], ["Velocidade máx.", "340 km/h"]], project: null },
  ];
  const carSpec = (c) => ({ id: c.id, model: c.model, cx: c.cx, cy: c.cy, dir: c.dir, baseZ: STAND.h, color: c.color, metal: c.metal });
  // the outline of a stand, as points on the floor (a rounded rectangle)
  function standOutline(c, grow = 0) {
    const pts = [], hx = STAND.hx + grow, hy = STAND.hy + grow, r = STAND.r + grow;
    for (const [qx, qy, a0] of [[1, 1, 0], [-1, 1, Math.PI / 2], [-1, -1, Math.PI], [1, -1, Math.PI * 1.5]]) {
      const ccx = c.cx + qx * (hx - r), ccy = c.cy + qy * (hy - r);
      for (let i = 0; i <= 6; i++) { const a = a0 + (i / 6) * (Math.PI / 2); pts.push([ccx + Math.cos(a) * r, ccy + Math.sin(a) * r]); }
    }
    return pts;
  }

  // ================================================================ office furniture and where people go
  // one post per sector, always in the same place, two tiles wide, with the sector's name on the floor in front of it
  // (docs/batcave-redesenho.md). Each agent works at their own; whoever covers for a busy colleague works at their own too.
  const DESKS = [["batman", 5, 2], ["lucius", 8, 2], ["riddler", 11, 2], ["catwoman", 14, 2], ["joker", 5, 6], ["alfred", 8, 6], ["robin", 11, 6], ["gordon", 14, 6]]
    .map(([crew, x, y], i) => ({ i, crew, x, y, deco: ["batarang", "mug", "cowl", "phones", "mug", "mug", "batarang", "phones"][i], agent: null, boot: -9 }));
  const deskOf = (a) => DESKS.find((d) => d.crew === a.id);
  const SOFA = [4, 5, 6];
  const ROCKS = [[0, 0], [0, 10]];
  const CHAIRS = [[3, 4], [3, 7]];
  const SPOTS = [
    ...SOFA.map((y) => ({ x: 0, y, at: [.62, y + .5], pose: "sit", dir: "se", seat: 7, sofa: true, word: "no sofá" })),
    ...CHAIRS.map(([x, y]) => ({ x, y, at: [x + .45, y + .5], pose: "sit", dir: "nw", seat: 6, chair: true, word: "no Batcomputador" })),
    { x: 2, y: 1, pose: "look", dir: "ne", word: "a ver o fato" },
    { x: 4, y: 1, pose: "drink", dir: "ne", word: "no café" },
    { x: 1, y: 8, pose: "look", dir: "nw", word: "a vigiar Gotham" },
    { x: 2, y: 4, pose: "think", dir: "sw", word: "no xadrez" },
    { x: 3, y: 9, pose: "phone", dir: "sw", word: "no telemóvel" },
    { x: 5, y: 9, pose: "phone", dir: "se", word: "no telemóvel" },
    { x: 18, y: 10, at: [18.6, 10.35], pose: "look", dir: "ne", word: "a ver o Aventador SVJ", far: true },
    { x: 25, y: 10, at: [25.6, 10.35], pose: "look", dir: "ne", word: "a ver o SF90", far: true },
    { x: 3, y: 13, pose: "look", dir: "sw", word: "a contar o ouro" },
    { x: 10, y: 12, at: [10.5, 12.3], pose: "drink", dir: "ne", bar: true, word: "no bar" },
    { x: 12, y: 12, at: [12.5, 12.3], pose: "drink", dir: "ne", bar: true, word: "no bar" },
    { x: 12, y: 13, pose: "phone", dir: "se", word: "na varanda" },
    { x: 26, y: 12, at: [26.4, 12.6], pose: "look", dir: "se", word: "no miradouro", far: true },
  ];
  // what stands on the new wings: the vault's gold, its cart and its counter; the bar and its table; the searchlight and the telescope
  const FIXED = [[1, 12], [2, 12], [3, 12], [4, 13], [5, 13], [4, 14], [5, 14], [1, 14], [2, 14], [3, 14], [1, 15], [2, 15], [3, 15], [5, 11], [6, 11],
    [9, 11], [10, 11], [11, 11], [12, 11], [13, 11], [11, 13], [27, 13], [25, 11]];
  const blocked = new Set([
    ...DESKS.flatMap((d) => [k2(d.x, d.y), k2(d.x + 1, d.y), k2(d.x, d.y + 1), k2(d.x + 1, d.y + 1)]), ...SOFA.map((y) => k2(0, y)), ...CHAIRS.map(([x, y]) => k2(x, y)),
    ...ROCKS.map(([x, y]) => k2(x, y)), k2(2, 0), k2(4, 0), k2(2, 5), ...FIXED.map(([x, y]) => k2(x, y)),
  ]);
  for (let x = 0; x < W; x++) for (let y = 0; y < D; y++) if (!"ogvtpb".includes(tile(x, y))) blocked.add(k2(x, y)); // the drop and the water
  for (const c of CARS) for (let x = OFFICE_W; x < W; x++) for (let y = 0; y < D; y++) {
    if (x + 1 > c.cx - STAND.hx && x < c.cx + STAND.hx && y + 1 > c.cy - STAND.hy && y < c.cy + STAND.hy) blocked.add(k2(x, y));
  }

  // ================================================================ drawing helpers (small canvas)
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
  const mat = (hex) => [hex, sh(hex, -.3), sh(hex, -.5)];

  // the +y face of something (a screen) filled pixel by pixel; returns a painter in face pixels
  function face(g, x0, x1, y, z0, z1, bg) {
    const [tx, ty] = P(x0, y, z1), wpx = Math.round((x1 - x0) * 16), hpx = Math.round(z1 - z0);
    g.fillStyle = bg;
    for (let u = 0; u < wpx; u++) g.fillRect(Math.round(tx + u), Math.round(ty + u / 2), 1, hpx);
    return {
      wpx, hpx,
      px(u, v, c, w = 1) { g.fillStyle = c; for (let i = 0; i < w; i++) g.fillRect(Math.round(tx + u + i), Math.round(ty + v + (u + i) / 2), 1, 1); },
    };
  }
  // drawing flat on a wall: (u, v) on the wall, v down. The back wall (y = 0) runs right-down; the left wall (x = 0) is read
  // from its far end (largest y) towards the corner. k: the canvas's own scale.
  const onBackWall = (g, x, z, k = g.k || 1) => { const [sx, sy] = P(x, 0, z); g.setTransform(k, .5 * k, 0, k, sx * k, sy * k); };
  const onLeftWall = (g, y, z, k = g.k || 1) => { const [sx, sy] = P(0, y, z); g.setTransform(k, -.5 * k, 0, k, sx * k, sy * k); };

  // 5 × 5 pixel glyphs for the bubbles and the screens
  const GLYPH = {
    "!": ["..#..", "..#..", "..#..", ".....", "..#.."],
    "?": [".###.", "#...#", "..##.", ".....", "..#.."],
    check: [".....", "....#", "...#.", "#.#..", ".#..."],
    x: ["#...#", ".#.#.", "..#..", ".#.#.", "#...#"],
    pause: [".#.#.", ".#.#.", ".#.#.", ".#.#.", "....."],
    dots: [".....", ".....", "#.#.#", ".....", "....."],
    z: ["####.", "..#..", ".#...", "####.", "....."],
    bat: [".....", "#.#.#", "#####", ".#.#.", "....."],
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
  // the bat: wing tips, ears, the scalloped hem. Used for the emblems, the rug and the signal.
  const BAT = [[-1, -.2], [-.55, -.42], [-.25, -.3], [-.12, -.5], [-.06, -.33], [.06, -.33], [.12, -.5], [.25, -.3], [.55, -.42], [1, -.2],
    [.8, 0], [.62, -.06], [.5, .15], [.32, .07], [.18, .2], [.06, .44], [0, .5], [-.06, .44], [-.18, .2], [-.32, .07], [-.5, .15], [-.62, -.06], [-.8, 0]];
  function batPath(g, cx, cy, w, h, keep) {
    if (!keep) g.beginPath();
    BAT.forEach(([x, y], i) => (i ? g.lineTo(cx + x * w, cy + y * h) : g.moveTo(cx + x * w, cy + y * h)));
    g.closePath();
  }
  // the emblem: the bat in a yellow oval
  function emblem(g, cx, cy, rx, ry, glowPx) {
    g.save();
    if (glowPx) { g.shadowColor = NEON.yellow; g.shadowBlur = glowPx; }
    g.fillStyle = "#f2c418"; g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.fill();
    g.restore();
    g.lineWidth = rx * .06; g.strokeStyle = "#0a0b0e"; g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.stroke();
    g.fillStyle = "#0a0b0e"; batPath(g, cx, cy + ry * .04, rx * .85, ry * 1.35); g.fill();
  }

  // ================================================================ office furniture
  const LEG = mat("#1a1f2a"), TOP = ["#272e3d", "#161b26", "#10141c"], METAL = mat("#4a5366"), CHAIR = mat("#1d2028"), STITCH = "rgba(255,60,80,.85)";
  const LEATHER = mat("#24272e");
  let clock = 0;

  // a post: a carbon top two tiles wide with a chrome edge, three screens, and a strip under the edge that says the state
  // (green working, amber waiting, red needing help)
  const CARBON = ["#1c1f26", "#0d0f13", "#08090c"], BEZEL = ["#2c323d", "#0b0e14", "#161a22"];
  function desk(g, d) {
    const { x, y } = d, a = d.agent && d.agent.seated ? d.agent : null, mode = deskMode(d);
    for (const [lx, ly] of [[.08, .14], [1.87, .14], [.08, .8], [1.87, .8]]) box(g, x + lx, y + ly, .05, .05, 0, 11, LEG);
    box(g, x + .04, y + .1, 1.92, .8, 11, 2, CARBON);
    seg(g, P(x + .04, y + .9, 12.6), P(x + 1.96, y + .9, 12.6), "#c3cbd6", .5);
    seg(g, P(x + 1.96, y + .1, 12.6), P(x + 1.96, y + .9, 12.6), "#7d8693", .5);
    seg(g, P(x + .12, y + .9, 10.6), P(x + 1.88, y + .9, 10.6), mode === "off" ? "rgba(200,212,226,.16)" : LIGHT[mode], .6);
    [[.08, .66], [.71, 1.29], [1.34, 1.92]].forEach(([s0, s1], k) => {
      const mid = (s0 + s1) / 2;
      box(g, x + mid - .1, y + .22, .2, .12, 13, 1, METAL);
      box(g, x + mid - .03, y + .25, .06, .05, 14, 4, METAL);
      box(g, x + s0, y + .23, s1 - s0, .06, 17, 14, BEZEL);
      screen(g, d, x + s0, x + s1, y + .29, 17, 31, k);
    });
    box(g, x + .72, y + .54, .56, .16, 13, 1, ["#151922", "#0b0d12", "#08090d"]);
    for (let i = 0; i < 4; i++) seg(g, P(x + .75, y + .58 + i * .03, 14.05), P(x + 1.25, y + .58 + i * .03, 14.05), "rgba(150,165,185,.25)", .25);
    if (a && a.mode === "work" && a.job && a.job.state === "work") {
      const n = Math.floor(clock * 12) + d.i * 7, [kx, ky] = P(x + .76 + rnd(n) * .46, y + .57 + rnd(n + .3) * .1, 14);
      g.fillStyle = "#eef4fb"; g.fillRect(kx, ky, 1, .5);
    }
    box(g, x + 1.38, y + .6, .07, .1, 13, 1, ["#232834", "#111111", "#0b0b0b"]);
    decoration(g, { ...d, x: x + .9, y: y + .3 });
  }

  function decoration(g, d) {
    const { x, y } = d;
    switch (d.deco) {
      case "mug": box(g, x + .76, y + .26, .1, .1, 13, 4, ["#f2f2f2", "#d5d7db", "#b4b8bf"]); dot(g, ...P(x + .81, y + .31, 17), "#4a2a18"); break;
      case "batarang": { const [cx, cy] = P(x + .8, y + .34, 13); g.fillStyle = "#0b0c10"; batPath(g, cx, cy - .5, 4, 3); g.fill(); g.strokeStyle = "rgba(160,180,210,.5)"; g.lineWidth = .4; g.stroke(); break; }
      case "cowl": { const [cx, cy] = P(x + .8, y + .32, 13); dot(g, cx - 2, cy - 5, "#101216", 5, 5); dot(g, cx - 2, cy - 7, "#101216", 1, 2); dot(g, cx + 2, cy - 7, "#101216", 1, 2); dot(g, cx - 1, cy - 3, "#e8f0ff"); dot(g, cx + 1, cy - 3, "#e8f0ff"); break; }
      case "phones": {
        const [cx, cy] = P(x + .8, y + .32, 13);
        dot(g, cx, cy - 8, "#3a4357", 1, 8); dot(g, cx - 2, cy - 9, "#111318", 5, 1); dot(g, cx - 3, cy - 8, "#111318", 2, 3); dot(g, cx + 2, cy - 8, "#111318", 2, 3); dot(g, cx - 3, cy - 7, NEON.blue);
        break;
      }
    }
  }

  const SCREEN_BG = { off: "#05070b", work: "#06132a", start: "#06132a", wait: "#1f1504", help: "#220610", pause: "#101318", done: "#04200f", fail: "#220610" };
  const CODE = [NEON.cyan, NEON.yellow, "#c9d4e6", NEON.green, NEON.blue, NEON.violet, "#c9d4e6"];
  function deskMode(d) {
    const a = d.agent && d.agent.seated ? d.agent : null;
    if (!a) return "off";
    if (a.mode === "done") return a.done === "ok" ? "done" : "fail";
    return a.job ? a.job.state : "off";
  }
  function screen(g, d, x0, x1, y, z0, z1, k = 0) {
    const mode = deskMode(d), since = clock - d.boot - k * .12;
    if (k) d = { i: d.i + k * 17 };
    const flash = mode !== "off" && since < .35;
    const f = face(g, x0 + .07, x1 - .07, y, z0 + 1, z1 - 1, flash ? "#dfe9ff" : SCREEN_BG[mode]);
    if (mode === "off") { glyphOn(f, "bat", "#10161f"); f.px(f.wpx - 2, f.hpx - 2, Math.floor(clock * .8) % 3 ? "#0a2238" : NEON.blue); return; }
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
    const x = d.x + .5, Y = d.y + 1, a = d.agent && d.agent.seated ? d.agent : null;
    poly(g, [P(x + .2, Y + .42), P(x + .5, Y + .14), P(x + .8, Y + .42), P(x + .5, Y + .7)], "#05070a");
    for (const [wx, wy] of [[.24, .42], [.5, .17], [.76, .42], [.5, .67]]) dot(g, ...P(x + wx, Y + wy, 1), "#2a2f3a", 2, 1);
    box(g, x + .47, Y + .39, .06, .06, 1, 6, CHAIR);
    box(g, x + .24, Y + .14, .54, .52, 7, 2, CHAIR);
    if (a) drawAgent(g, a);
    box(g, x + .34, Y + .66, .58, .06, 9, a ? 4 : 8, CHAIR);
    seg(g, P(x + .36, Y + .72, a ? 12.5 : 16.5), P(x + .9, Y + .72, a ? 12.5 : 16.5), STITCH, .5);
  }

  // the Chesterfield: black leather, buttoned
  function sofa(g, y) {
    const first = y === SOFA[0], last = y === SOFA[SOFA.length - 1];
    box(g, .06, y + .02, .3, .96, 0, 19, LEATHER);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) { const [bx, by] = P(.36, y + .14 + i * .24, 12 + j * 4); g.fillStyle = "#0c0d10"; g.fillRect(bx, by, .8, .8); }
    if (first) box(g, .06, y, .88, .16, 0, 11, LEATHER);
    box(g, .32, y + (first ? .16 : .03), .62, first || last ? .81 : .94, 0, 7, mat("#2b2f37"));
    seg(g, P(.36, y + .5, 7.5), P(.92, y + .5, 7.5), "rgba(0,0,0,.35)", .5);
    seg(g, P(.33, y + .1, 7.2), P(.93, y + .1, 7.2), "rgba(255,255,255,.07)", .5);
    if (last) box(g, .06, y + .84, .88, .16, 0, 11, LEATHER);
  }

  // the armchairs facing the Batcomputer; whoever sits in one is drawn inside it, between the seat and the back
  function armchair(g, x, y) {
    const sitter = agents.find((a) => a.chairAt === k2(x, y) && !a.path.length);
    box(g, x + .15, y + .06, .74, .14, 0, 10, LEATHER);
    box(g, x + .15, y + .2, .6, .6, 0, 6, mat("#2b2f37"));
    if (sitter) drawAgent(g, sitter);
    box(g, x + .72, y + .14, .18, .74, 0, 17, LEATHER);
    for (let i = 0; i < 2; i++) dot(g, ...P(x + .9, y + .35 + i * .3, 13), "#0c0d10");
    box(g, x + .15, y + .78, .74, .14, 0, 10, LEATHER);
  }

  function rock(g, x, y) {
    const [cx, cy] = P(x + .5, y + .5);
    const spikes = [[-6, 26, "#2a313d"], [3, 34, "#323a48"], [8, 18, "#262c37"], [-2, 14, "#3a4352"]];
    for (const [dx, h, c] of spikes) {
      poly(g, [[cx + dx - 5, cy + 1], [cx + dx + 5, cy + 1], [cx + dx + 1, cy - h], [cx + dx - 1, cy - h]], c);
      poly(g, [[cx + dx - 5, cy + 1], [cx + dx - 2, cy + 1], [cx + dx - 1, cy - h]], "rgba(150,175,215,.08)");
      seg(g, [cx + dx + 1, cy - h + 1], [cx + dx + 4, cy], "rgba(140,170,210,.18)", .5);
    }
  }

  // the suit in its glass case, lit from above
  function suitCase(g) {
    const x = 2, y = 0;
    box(g, x + .12, y + .08, .76, .66, 0, 4, mat("#1f242e"));
    const fr = window.CrewPeople.frame(CREW[0].look, "case", { dir: "sw", pose: "stand", f: 0, seat: 0, hop: 0 }), [fx, fy] = P(x + .5, y + .42, 4);
    g.drawImage(fr.c, fx - fr.ax / WS, fy - fr.ay / WS, fr.c.width / WS, fr.c.height / WS);
    box(g, x + .12, y + .08, .76, .66, 4, 32, [null, "rgba(150,205,255,.12)", "rgba(150,205,255,.08)"]);
    poly(g, [P(x + .2, y + .74, 34), P(x + .45, y + .74, 34), P(x + .3, y + .74, 8), P(x + .2, y + .74, 14)], "rgba(255,255,255,.07)");
    box(g, x + .1, y + .06, .8, .7, 36, 3, mat("#1f242e"));
    for (const [ex, ey] of [[.12, .74], [.88, .74], [.88, .08]]) seg(g, P(x + ex, y + ey, 4), P(x + ex, y + ey, 36), "rgba(200,225,255,.35)", .5);
  }

  function coffee(g) {
    const x = 4, y = 0;
    box(g, x + .04, y + .1, .92, .62, 0, 14, mat("#2b2119"));
    box(g, x + .02, y + .08, .96, .66, 14, 1, ["#e6e9ee", "#b9bfc8", "#9aa1ab"]);
    box(g, x + .14, y + .14, .4, .34, 15, 13, ["#e3e7ec", "#a9b0ba", "#7d8591"]);
    box(g, x + .2, y + .46, .28, .05, 19, 4, ["#1a1d24", "#0b0d11", "#0b0d11"]);
    dot(g, ...P(x + .26, y + .48, 25), Math.floor(clock * 2) % 2 ? NEON.red : "#5a0d18");
    dot(g, ...P(x + .4, y + .48, 25), NEON.green);
    box(g, x + .66, y + .38, .1, .1, 15, 3, ["#ffffff", "#e3e3e3", "#c7c7c7"]);
    box(g, x + .8, y + .3, .1, .1, 15, 3, ["#ffffff", "#e3e3e3", "#c7c7c7"]);
  }

  function table(g) {
    const x = 2, y = 5;
    for (const [lx, ly] of [[.16, .2], [.8, .2], [.16, .76], [.8, .76]]) box(g, x + lx, y + ly, .05, .05, 0, 5, LEG);
    box(g, x + .1, y + .12, .8, .76, 5, 1, mat("#2b2119"));
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
      const s = .075, a = P(x + .2 + i * s, y + .22 + j * s, 6.2), b = P(x + .2 + (i + 1) * s, y + .22 + j * s, 6.2), c = P(x + .2 + (i + 1) * s, y + .22 + (j + 1) * s, 6.2), dd = P(x + .2 + i * s, y + .22 + (j + 1) * s, 6.2);
      poly(g, [a, b, c, dd], (i + j) % 2 ? "#e9e2cf" : "#3a2c22");
    }
    for (const [i, j, c] of [[1, 1, "#f4f4f4"], [3, 2, "#111"], [2, 5, "#f4f4f4"], [5, 3, "#111"], [0, 6, "#111"], [6, 6, "#f4f4f4"]]) {
      const [px, py] = P(x + .24 + i * .075, y + .26 + j * .075, 6.2);
      g.fillStyle = c; g.fillRect(px - .75, py - 3, 1.5, 3); g.fillRect(px - 1, py - .5, 2, .5);
    }
  }

  // the Batcomputer: three screens on the left wall, over the sofa. The middle one shows the missions running now.
  function batcomputer(g) {
    const panels = [[6.9, 5.55], [5.45, 4.1], [4.0, 2.65]];
    g.save();
    for (const [y1, y0] of panels) {
      const w = Math.round((y1 - y0) * 16);
      onLeftWall(g, y1, 50);
      g.fillStyle = "#1a1f29"; g.fillRect(-1, -1, w + 2, 26);
      g.fillStyle = "#020812"; g.fillRect(0, 0, w, 24);
    }
    onLeftWall(g, 6.9, 50);
    { const cx = 10.5, cy = 12, a = clock * 1.8, busy = agents.filter((x) => x.job && x.mode !== "done");
      g.strokeStyle = "rgba(79,180,255,.35)"; g.lineWidth = .5;
      g.beginPath(); g.arc(cx, cy, 9, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(cx, cy, 5, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = NEON.cyan; g.lineWidth = .7; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * 9, cy + Math.sin(a) * 9); g.stroke();
      busy.forEach((x, i) => { const b = rnd(i + x.i) * 6.28, r = 3 + rnd(i + 4) * 6; g.fillStyle = x.color; g.fillRect(cx + Math.cos(b) * r - .5, cy + Math.sin(b) * r - .5, 1.2, 1.2); }); }
    onLeftWall(g, 5.45, 50);
    { g.fillStyle = NEON.yellow; g.beginPath(); g.ellipse(10.5, 4.5, 5.5, 3, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#05070b"; batPath(g, 10.5, 4.6, 4.5, 4); g.fill();
      const busy = agents.filter((x) => x.job && x.mode !== "done").slice(0, 5);
      busy.forEach((x, r) => {
        const p = x.job.type === "task" && x.job.progress ? x.job.progress / 100 : .3 + .25 * (Math.sin(clock * 1.5 + r) + 1);
        g.fillStyle = "rgba(127,227,255,.15)"; g.fillRect(4, 10 + r * 3, 15, 2);
        g.fillStyle = x.color; g.fillRect(1, 10 + r * 3, 2, 2); g.fillRect(4, 10 + r * 3, Math.max(1, 15 * p), 2);
      });
      if (!busy.length) for (let r = 0; r < 4; r++) { const len = 4 + Math.floor(rnd(Math.floor(clock * 2) + r) * 14); g.fillStyle = "rgba(127,227,255,.45)"; g.fillRect(2, 11 + r * 3, len, 1); } }
    onLeftWall(g, 4.0, 50);
    { g.strokeStyle = NEON.green; g.lineWidth = .7; g.beginPath();
      for (let u = 0; u <= 21; u += .5) { const v = 12 + Math.sin(u * .7 + clock * 4) * 4 * Math.sin(clock * 1.3 + u * .15); u ? g.lineTo(u, v) : g.moveTo(u, v); }
      g.stroke(); g.fillStyle = "rgba(77,255,154,.18)"; for (let u = 0; u < 21; u += 4) g.fillRect(u, 1, .5, 22); }
    g.restore();
  }

  // the waterfall at the back of the garage: a strip of falling water scrolled down the wall, and the pool at its foot
  const FALL = { x0: 16.08, x1: 16.92, tex: null };   // over the head of the river, between the office and the garage
  function waterfall(g) {
    const w = Math.round((FALL.x1 - FALL.x0) * 16), h = WALL;
    if (!FALL.tex) {
      const tx = FALL.tex = document.createElement("canvas"); tx.width = w * 2; tx.height = 192;
      const q = tx.getContext("2d");
      for (let u = 0; u < w * 2; u++) for (let v = 0; v < 192; v += 2) {
        const n = rnd(u * 7.3 + Math.floor((v + rnd(u) * 60) / 9));
        q.fillStyle = `rgba(${190 + (n * 50) | 0},${222 + (n * 30) | 0},255,${(.14 + n * .55).toFixed(2)})`; q.fillRect(u, v, 1, 2);
      }
    }
    g.save();
    onBackWall(g, FALL.x0, h);
    g.beginPath(); g.rect(0, 0, w, h); g.clip();
    const off = (clock * 46) % 96;
    g.drawImage(FALL.tex, 0, off - 96, w, 96); g.drawImage(FALL.tex, 0, off, w, 96);
    g.restore();
    poly(g, [P(FALL.x0, 0, -2.5), P(FALL.x1, 0, -2.5), P(FALL.x1, .82, -2.5), P(FALL.x0, .82, -2.5)], "rgba(90,170,225,.5)");
    for (let i = 0; i < 8; i++) { const n = Math.floor(clock * 6) + i * 13, [px, py] = P(FALL.x0 + rnd(n) * (FALL.x1 - FALL.x0), .1 + rnd(n + 1) * .6, -2); g.fillStyle = "rgba(230,245,255,.8)"; g.fillRect(px, py, 1.5, .5); }
  }

  // bats, flying loops over the cave
  const BATS = Array.from({ length: 11 }, (_, i) => ({ cx: 50 + rnd(i) * (LW - 100), cy: 30 + rnd(i + 9) * 110, ax: 30 + rnd(i + 3) * 80, ay: 8 + rnd(i + 5) * 22, w: .22 + rnd(i + 7) * .3, ph: rnd(i + 11) * 6 }));
  const BAT_UP = ["#.....#", "##...##", ".##.##.", "..###.."], BAT_DOWN = [".......", "..###..", ".#####.", "#.....#"];
  function bats(g) {
    for (const b of BATS) {
      const tt = clock * b.w + b.ph, x = b.cx + Math.sin(tt) * b.ax, y = b.cy + Math.sin(tt * 2) * b.ay;
      const rows = Math.floor(clock * 9 + b.ph * 3) % 2 ? BAT_UP : BAT_DOWN;
      g.fillStyle = "rgba(150,185,235,.3)";
      rows.forEach((r, j) => { for (let i = 0; i < 7; i++) if (r[i] === "#") g.fillRect(x + i - 3, y + j - 2.5, 1, 1); });
      g.fillStyle = "#05060a";
      rows.forEach((r, j) => { for (let i = 0; i < 7; i++) if (r[i] === "#") g.fillRect(x + i - 3, y + j - 2, 1, 1); });
    }
  }

  // ================================================================ the vault, the bar, the lookout, the river (moving layer)
  // The vault (v): the strongroom's door stands open on the left wall, lit gold from inside, and on its floor lies the team's
  // gold: every mission completed is a bar (two pallets of thirty), this week's are bundles of notes on the cart. Lasers guard
  // its door and switch off for whoever walks in; the marquee over the door says the numbers; a click opens them all.
  let vaultMemo = null, vaultOpen = false, vaultFlash = -9, hoverVault = false, vaultPlate = null;
  function vaultStats() {
    if (vaultMemo && vaultMemo.ref === tasks) return vaultMemo;
    const done = tasks.filter((x) => x.status === "COMPLETED" && x.trash_reason !== "mistake");
    const day = new Date(); day.setHours(0, 0, 0, 0);
    const week = new Date(day); week.setDate(week.getDate() - ((week.getDay() + 6) % 7));
    const month = new Date(day.getFullYear(), day.getMonth(), 1);
    const at = (x) => Date.parse(x.completed_at || x.updated_at || x.created_at);
    const since = (d) => done.filter((x) => at(x) >= +d).length;
    return (vaultMemo = { ref: tasks, done, total: done.length, today: since(day), week: since(week), month: since(month) });
  }
  // a piece of furniture that only changes with its numbers is drawn once into its own picture
  const sprites = new Map();
  function cachedDraw(g, key, area, paint) {
    let s = sprites.get(key);
    if (!s) {
      const [x0, y0, x1, y1, h] = area, l = P(x0, y1)[0] - 3, r = P(x1, y0)[0] + 3, tp = P(x0, y0, h)[1] - 3, bt = P(x1, y1)[1] + 3;
      const c = document.createElement("canvas"); c.width = Math.ceil((r - l) * WS); c.height = Math.ceil((bt - tp) * WS);
      const q = c.getContext("2d"); q.k = WS; q.imageSmoothingEnabled = false; q.setTransform(WS, 0, 0, WS, -l * WS, -tp * WS);
      paint(q);
      if (sprites.size > 200) sprites.clear();
      sprites.set(key, (s = { c, l, t: tp }));
    }
    g.drawImage(s.c, s.l, s.t, s.c.width / WS, s.c.height / WS);
  }
  const GOLD = ["#ffd86b", "#c9922a", "#a8741c"], CASH = ["#5fae6e", "#2f6b3c", "#24552f"], BAND = ["#efe6c8", "#c9bf9f", "#b3a988"];
  const PYRAMID = [[4, 4], [3, 3], [2, 2], [1, 1]];   // bars along x and along y, each layer, from the pallet up
  const backToFront = (nx, ny) => { const out = []; for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) out.push([i, j]); return out.sort((p, q) => p[0] + p[1] - (q[0] + q[1])); };
  function goldPile(g, cx, cy, n) {
    box(g, cx - .85, cy - .47, 1.7, .94, 0, 3, mat("#3a2a1a"));
    for (let i = 0; i < 3; i++) seg(g, P(cx - .85, cy - .3 + i * .3, 1.5), P(cx + .85, cy - .3 + i * .3, 1.5), "rgba(0,0,0,.35)", .4);
    let left = n, z = 3;
    for (const [nx, ny] of PYRAMID) {
      if (left <= 0) break;
      const x0 = cx - nx * .19, y0 = cy - ny * .1;
      for (const [i, j] of backToFront(nx, ny)) {
        if (left-- <= 0) break;
        const x = x0 + i * .38, y = y0 + j * .2;
        box(g, x, y, .34, .17, z, 2.2, GOLD);
        seg(g, P(x + .04, y + .03, z + 2.25), P(x + .3, y + .03, z + 2.25), "rgba(255,250,220,.8)", .4);
      }
      z += 2.2;
    }
  }
  function cashPile(g, cx, cy, n) {
    box(g, cx - .8, cy - .45, 1.6, .9, 2, 2, mat("#2a2f38"));                      // the steel cart
    for (const [wx, wy] of [[-.68, -.33], [.68, -.33], [-.68, .33], [.68, .33]]) oval(g, ...P(cx + wx, cy + wy, 1), 1.2, .8, "#0b0c10");
    let left = Math.min(24, n), z = 4;
    for (let L = 0; L < 2 && left > 0; L++, z += 2.6) {
      for (const [i, j] of backToFront(4, 3)) {
        if (left-- <= 0) break;
        const x = cx - .72 + i * .37, y = cy - .38 + j * .26;
        box(g, x, y, .34, .24, z, 2.6, CASH);
        box(g, x + .14, y - .005, .06, .25, z, 2.65, BAND);
      }
    }
  }
  // the counting desk at the door: a machine with its green figures and the bundles waiting their turn
  function counter(g) {
    const x = 5.15, y = 11.2, w = 1.6, d = .62;
    for (const [lx, ly] of [[.08, .08], [w - .12, .08], [.08, d - .12], [w - .12, d - .12]]) box(g, x + lx, y + ly, .05, .05, 0, 10, LEG);
    box(g, x, y, w, d, 10, 1.5, ["#2b2f37", "#15181e", "#101318"]);
    box(g, x + .2, y + .12, .5, .38, 11.5, 5, ["#cfd5dc", "#8d96a3", "#6b7380"]);
    const f = face(g, x + .25, x + .65, y + .5, 12, 15.5, "#03120a");
    for (let u = 1; u < f.wpx - 1; u += 2) f.px(u, 1, rnd(u + Math.floor(clock * 5)) > .35 ? NEON.green : "#0b3a1a");
    box(g, x + .9, y + .18, .32, .22, 11.5, 2.4, CASH); box(g, x + .9, y + .18, .32, .22, 13.9, 2.4, CASH);
    box(g, x + .98, y + .17, .06, .24, 11.5, 4.85, BAND);
  }
  // one stretch of the laser fence across the vault's door (the line y = GD), with the posts at its two ends
  function laser(g, x) {
    if (x === 0 || x === 6) {
      const px = x === 0 ? .1 : 6.9;
      box(g, px - .06, GD - .06, .12, .12, 0, 20, ["#e9edf2", "#9aa2ab", "#6b7380"]);
      for (const z of [5, 11, 17]) dot(g, ...P(px, GD + .07, z), vaultOpen ? NEON.green : NEON.red, 1, 1);
    }
    if (vaultOpen) return;
    const a0 = x === 0 ? .1 : x, a1 = x === 6 ? 6.9 : x + 1, fl = .62 + Math.sin(clock * 37 + x * 1.7) * .14;
    for (const z of [5, 11, 17]) {
      seg(g, P(a0, GD, z), P(a1, GD, z), `rgba(255,40,70,${(fl * .35).toFixed(2)})`, 1.4);
      seg(g, P(a0, GD, z), P(a1, GD, z), `rgba(255,130,150,${fl.toFixed(2)})`, .35);
    }
  }

  // The bar (t): a dark wood bar with a marble top and a light under its lip, bottles along the back, three lamps hanging
  // on long cords from the dark. It is drawn in slices one tile wide, each sorted where it stands, so whoever stands at
  // the bar and whoever walks behind it are both drawn right.
  const BOTTLES = ["#c46a1a", "#2f7a3c", "#d9e6f0", "#7a1a2a", "#e0b040", "#3a6fd0", "#e8e0d0"];
  const BAR = { x0: 9.15, x1: 13.85, y: 11.15, d: .62, lamps: [10, 11.5, 13] };
  function barSlice(g, x0, x1) {
    const { y, d } = BAR, first = x0 <= BAR.x0, last = x1 >= BAR.x1;
    box(g, x0, y, x1 - x0, d, 0, 12, ["#2a2420", "#17120f", last ? "#100c0a" : null]);
    box(g, x0 - (first ? .05 : 0), y - .05, x1 - x0 + (first ? .05 : 0) + (last ? .05 : 0), d + .1, 12, 1.2, ["#d9d4c8", "#9a948a", last ? "#7d776e" : null]);
    seg(g, P(x0, y + d + .06, 3), P(x1, y + d + .06, 3), "rgba(255,191,60,.95)", .6);
    for (let i = 0; i < 13; i++) {
      const bx = 9.25 + i * .37;
      if (bx < x0 || bx >= x1) continue;
      const c = BOTTLES[i % BOTTLES.length], hgt = 6 + (i % 3) * 1.5;
      box(g, bx, y + .06, .1, .1, 13.2, hgt, [sh(c, .25), c, sh(c, -.45)]);
      box(g, bx + .03, y + .09, .04, .04, 13.2 + hgt, 2.5, ["#e9edf2", "#9aa2ab", "#7d8591"]);
    }
    if (x0 <= 10.6 && x1 > 10.6) box(g, 10.55, y + .4, .08, .08, 13.2, 2.2, ["rgba(220,240,255,.6)", "rgba(200,220,240,.35)", "rgba(200,220,240,.3)"]);
    if (x0 <= 12.4 && x1 > 12.4) box(g, 12.35, y + .38, .1, .1, 13.2, 3.4, mat("#c9ced6"));
    for (const v of BAR.lamps) {
      if (v < x0 || v >= x1) continue;
      seg(g, P(v, y + .3, 130), P(v, y + .3, 37), "rgba(40,44,52,.9)", .4);
      const [lx, ly] = P(v, y + .3, 37);
      poly(g, [[lx - 1, ly], [lx + 1, ly], [lx + 3, ly + 3], [lx - 3, ly + 3]], "#1d2129");
      oval(g, lx, ly + 3, 3, 1, "#ffe2a8");
    }
  }
  // the high table at the prow of the terrace: marble top, champagne on ice, two flutes
  function cocktailTable(g) {
    const cx = 11.5, cy = 13.5;
    oval(g, ...P(cx, cy), 5, 2, "rgba(0,0,0,.4)");
    box(g, cx - .05, cy - .05, .1, .1, 0, 13, METAL);
    poly(g, Array.from({ length: 24 }, (_, i) => P(cx + Math.cos(i / 24 * Math.PI * 2) * .42, cy + Math.sin(i / 24 * Math.PI * 2) * .42, 12)), "#7d776e");
    poly(g, Array.from({ length: 24 }, (_, i) => P(cx + Math.cos(i / 24 * Math.PI * 2) * .42, cy + Math.sin(i / 24 * Math.PI * 2) * .42, 13)), "#d9d4c8");
    box(g, cx - .13, cy - .13, .26, .26, 13, 4, mat("#c9ced6"));
    box(g, cx - .04, cy - .06, .07, .07, 17, 4, ["#1f3a24", "#13261a", "#0d1a12"]);
    dot(g, ...P(cx - .01, cy - .03, 21.5), "#e8c55a", 1, 1);
    for (const [fx, fy] of [[.25, .1], [.12, .28]]) box(g, cx + fx, cy + fy, .04, .04, 13, 3.4, ["rgba(255,236,170,.75)", "rgba(220,200,140,.45)", "rgba(220,200,140,.4)"]);
  }

  // The lookout (p): a landing ring, a telescope, and the searchlight. It sweeps the back of the cave slowly; when a
  // mission comes in it swings round and throws the bat-signal on the office wall.
  const LAMP = { x: 27.5, y: 13.5, aim: [14, 0, 58], gold: 0 };
  const BEACONS = [[24.05, 11.2], [24.05, 12.9], [25.05, 13.9], [26.05, 14.9], [28.95, 14.9], [29.95, 13.9], [30.95, 12.9]];
  function searchlight(g) {
    const { x, y } = LAMP;
    oval(g, ...P(x, y), 7, 3, "rgba(0,0,0,.45)");
    box(g, x - .3, y - .3, .6, .6, 0, 3, mat("#2a2f38"));
    const a = Math.atan2(LAMP.aim[1] - y, LAMP.aim[0] - x), ca = Math.cos(a), sa = Math.sin(a);
    for (const s of [-1, 1]) box(g, x - sa * .27 * s - .04, y + ca * .27 * s - .04, .08, .08, 3, 10, METAL);
    for (let i = 3; i >= -3; i--) {
      const [px, py] = P(x + ca * i * .05, y + sa * i * .05, 11 + i * .9);
      oval(g, px, py, 3.6, 3.6, i === 3 ? "#fff3cf" : i === -3 ? "#5b626f" : sh("#2f353f", -i * .03));
    }
    const [cx, cy] = P(x - ca * .15, y - sa * .15, 8.3);
    g.strokeStyle = "rgba(220,228,238,.55)"; g.lineWidth = .4; g.beginPath(); g.ellipse(cx, cy, 3.6, 3.6, 0, 0, Math.PI * 2); g.stroke();
  }
  function telescope(g) {
    const x = 25.6, y = 11.6;
    for (const [lx, ly] of [[-.22, .16], [.22, .12], [0, -.24]]) seg(g, P(x, y, 11), P(x + lx, y + ly, 0), "#6b7380", .6);
    seg(g, P(x - .18, y - .18, 12.5), P(x + .32, y + .32, 15.5), "#1d2129", 2.6);
    seg(g, P(x - .18, y - .18, 12.5), P(x + .32, y + .32, 15.5), "#c9ced6", 1.2);
    dot(g, ...P(x + .33, y + .33, 15.6), NEON.cyan, 1, 1);
  }

  // glass along the drops of the vault, the terrace and the lookout: one pane per tile edge, sorted where it stands
  const RAIL = { v: ["rgba(255,207,90,.11)", "rgba(255,226,150,.9)"], t: ["rgba(150,205,255,.12)", "rgba(235,242,250,.85)"], p: ["rgba(255,60,80,.09)", "rgba(220,226,235,.85)"] };
  function pane(g, a, b, h, tint, edge, z0 = 0) {
    const A = P(a[0], a[1], z0), B = P(b[0], b[1], z0), C = P(b[0], b[1], z0 + h), E = P(a[0], a[1], z0 + h);
    poly(g, [A, B, C, E], tint);
    seg(g, E, C, edge, .6);
    seg(g, A, E, "rgba(200,210,225,.45)", .4); seg(g, B, C, "rgba(200,210,225,.45)", .4);
  }
  const bridgeRail = (g, y) => pane(g, [15.75, y], [17.25, y], 8, "rgba(150,205,255,.13)", "rgba(235,242,250,.9)", 2);

  // the river: light running down the water (not under the bridge), and where it pours over the edge into the abyss
  function riverFlow(g) {
    g.save(); g.beginPath();
    for (const [y0, y1] of [[.85, 4.0], [6.0, 10.0]]) {
      const pts = [P(16.12, y0, -3), P(16.86, y0, -3), P(16.86, y1, -3), P(16.12, y1, -3)];
      g.moveTo(...pts[0]); pts.slice(1).forEach((p) => g.lineTo(...p)); g.closePath();
    }
    g.clip();
    for (let i = 0; i < 16; i++) {
      const lane = .14 + (i % 4) * .17, y = (clock * 1.7 + rnd(i) * GD) % GD, len = .3 + rnd(i + 2) * .45;
      seg(g, P(16.08 + lane, y, -3), P(16.08 + lane, y + len, -3), `rgba(170,225,255,${(.22 + rnd(i + 5) * .3).toFixed(2)})`, .5);
    }
    g.restore();
  }
  function mouthFall(g) {
    if (!FALL.tex) return;
    const w = Math.round((FALL.x1 - FALL.x0) * 16), h = 46, [sx, sy] = P(FALL.x0, GD, 0);
    g.save();
    g.setTransform(g.k, .5 * g.k, 0, g.k, sx * g.k, sy * g.k);
    g.beginPath(); g.rect(0, 0, w, h); g.clip();
    const off = (clock * 64) % 96;
    g.drawImage(FALL.tex, 0, off - 96, w, 96); g.drawImage(FALL.tex, 0, off, w, 96);
    const fade = g.createLinearGradient(0, 0, 0, h); fade.addColorStop(0, "rgba(0,0,0,0)"); fade.addColorStop(1, "rgba(0,0,0,1)");
    g.globalCompositeOperation = "destination-out"; g.fillStyle = fade; g.fillRect(0, 0, w, h);
    g.restore();
  }

  // ================================================================ the cave that never moves (drawn once per size)
  function rockWall(b, pts, base, seed) {
    poly(b, pts, base);
    b.save(); b.beginPath(); pts.forEach(([x, y], i) => (i ? b.lineTo(x, y) : b.moveTo(x, y))); b.closePath(); b.clip();
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    for (let i = 0; i < 180; i++) {
      const x = x0 + rnd(seed + i) * (x1 - x0), y = y0 + rnd(seed + i + .5) * (y1 - y0), s = 3 + rnd(seed + i + .7) * 9;
      const light = rnd(seed + i + .9);
      b.fillStyle = light > .55 ? `rgba(150,175,215,${(.03 + light * .05).toFixed(3)})` : `rgba(0,0,0,${(.08 + light * .18).toFixed(3)})`;
      b.beginPath(); b.moveTo(x, y - s); b.lineTo(x + s * .9, y - s * .2); b.lineTo(x + s * .4, y + s * .7); b.lineTo(x - s * .7, y + s * .4); b.closePath(); b.fill();
    }
    b.strokeStyle = "rgba(0,0,0,.35)"; b.lineWidth = 1;
    for (let i = 0; i < 30; i++) { const x = x0 + rnd(seed * 3 + i) * (x1 - x0), y = y0 + rnd(seed * 3 + i + .4) * (y1 - y0); b.beginPath(); b.moveTo(x, y); b.lineTo(x + (rnd(i + seed) - .5) * 14, y + 4 + rnd(i) * 8); b.stroke(); }
    b.restore();
  }
  function grain(b, strength) {
    const img = b.getImageData(0, 0, LW, LH), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      const p = i >> 2, n = (rnd(p * .37) - .5) * strength + (rnd(Math.floor((p % LW) / 5) * 7 + Math.floor(p / LW / 4) * 131) - .5) * strength * .9;
      d[i] = clamp(d[i] + n, 0, 255); d[i + 1] = clamp(d[i + 1] + n, 0, 255); d[i + 2] = clamp(d[i + 2] + n * 1.15, 0, 255);
    }
    b.putImageData(img, 0, 0);
  }
  const wallTop = (ts, along) => ts.map((tt, i) => along(tt, WALL + (i % 3 === 0 ? 6 : 0) + rnd(tt * 9.1) * 9 - 3));

  // how far the rock drops under a point of an edge: the same for the two tiles that share it, so the drops join up
  const dropAt = (x, y) => 22 + rnd(x * 3.7 + y * 5.3 + 1) * 16 + (rnd(x * 1.3 + y * 7.1) > .78 ? 10 + rnd(x + y) * 14 : 0);
  function drop(b, x, y, side, water) {
    const n = 4, at = (i) => (side === "front" ? [x + i / n, y + 1] : [x + 1, y + i / n]), pts = [];
    for (let i = 0; i <= n; i++) pts.push(P(...at(i), 0));
    for (let i = n; i >= 0; i--) { const [px, py] = at(i); pts.push(P(px, py, -dropAt(px, py))); }
    const [, top] = P(...at(0), 0), c = water ? ["#123049", "#081626", "#020509"] : side === "front" ? ["#171d28", "#0a0d13", "#030406"] : ["#10141c", "#07090e", "#020304"];
    const grad = b.createLinearGradient(0, top - 4, 0, top + 50);
    grad.addColorStop(0, c[0]); grad.addColorStop(.45, c[1]); grad.addColorStop(1, c[2]);
    poly(b, pts, grad);
    for (let s = 1; s < 4; s++) seg(b, P(...at(0), -s * 6 - rnd(x + y + s) * 3), P(...at(n), -s * 6 - rnd(x + y + s + 1) * 3), "rgba(150,175,215,.05)", .6);
    if (!water && rnd(x * 2.1 + y * 3.9 + (side === "front" ? 0 : 50)) > .5) {     // a stalactite under this stretch
      const [px, py] = at(1 + Math.floor(rnd(x + y * 9) * 3)), len = 8 + rnd(px * 7 + py) * 18, [sx, sy] = P(px, py, -dropAt(px, py) + 2);
      poly(b, [[sx - 2.5, sy - 2], [sx + 2.5, sy - 2], [sx, sy + len]], c[2]);
      seg(b, [sx - 1.5, sy - 1], [sx, sy + len - 2], "rgba(150,175,215,.08)", .5);
    }
  }
  function floorTile(b, x, y, c) {
    const odd = (x + y) % 2;
    const color = c === "g" ? ((Math.floor(x / 2) + Math.floor(y / 2)) % 2 ? "#15181e" : "#13161b")
      : c === "v" ? (odd ? "#18150e" : "#120f0a") : c === "t" ? (odd ? "#1b1713" : "#17130f") : c === "p" ? (odd ? "#181c23" : "#14181e")
      : x >= 6 ? (odd ? "#111827" : "#0f1522") : (odd ? "#171b22" : "#14181f");
    poly(b, [P(x, y), P(x + 1, y), P(x + 1, y + 1), P(x, y + 1)], color);
    if (c === "v") { seg(b, P(x, y + 1), P(x + 1, y + 1), "rgba(201,162,39,.3)", .5); seg(b, P(x + 1, y), P(x + 1, y + 1), "rgba(201,162,39,.3)", .5); }
    else if (c === "t") for (let i = 1; i < 4; i++) seg(b, P(x + i / 4, y), P(x + i / 4, y + 1), "rgba(0,0,0,.28)", .5);
    else if (c === "p") for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) dot(b, ...P(x + .2 + i * .3, y + .2 + j * .3), "rgba(170,185,210,.1)");
  }
  // the river's channel: the near bank (the office side) and the water a little below the floor
  function water(b, x, y) {
    poly(b, [P(x, y, 0), P(x, y + 1, 0), P(x, y + 1, -4), P(x, y, -4)], "#0a0f17");
    const [, top] = P(x, y, -3), gr = b.createLinearGradient(0, top - 8, 0, top + 16);
    gr.addColorStop(0, "#16588f"); gr.addColorStop(1, "#0a2c4c");
    poly(b, [P(x, y, -3), P(x + 1, y, -3), P(x + 1, y + 1, -3), P(x, y + 1, -3)], gr);
    seg(b, P(x + .05, y, -3), P(x + .05, y + 1, -3), "rgba(150,220,255,.25)", .5);
  }
  function room(b) {
    const order = [];
    for (let y = 0; y < D; y++) for (let x = 0; x < W; x++) if (solid(x, y)) order.push([x, y]);
    order.sort((p, q) => p[0] + p[1] - (q[0] + q[1]) || p[0] - q[0]);
    for (const [x, y] of order) {
      const c = tile(x, y);
      if (c === "~" || c === "b") water(b, x, y); else floorTile(b, x, y, c);
      if (!solid(x, y + 1)) drop(b, x, y, "front", c === "~" || c === "b");
      if (!solid(x + 1, y)) drop(b, x, y, "right", false);
    }
    for (let x = OFFICE_W; x <= W; x += 2) seg(b, P(x, 0, 0), P(x, GD, 0), "rgba(0,0,0,.3)");
    for (let y = 0; y <= GD; y += 2) seg(b, P(OFFICE_W, y, 0), P(W, y, 0), "rgba(0,0,0,.3)");
    poly(b, [P(1, 3), P(5, 3), P(5, 9), P(1, 9)], "#2c2410");
    poly(b, [P(1.12, 3.12), P(4.88, 3.12), P(4.88, 8.88), P(1.12, 8.88)], "#0d0e12");
    poly(b, [P(1.3, 3.3), P(4.7, 3.3), P(4.7, 8.7), P(1.3, 8.7)], "#b38f1a");
    poly(b, [P(1.36, 3.36), P(4.64, 3.36), P(4.64, 8.64), P(1.36, 8.64)], "#101116");
    b.save();
    const [rx, ry] = P(3, 6);
    b.setTransform(1, 0, 0, .5, rx, ry); b.rotate(Math.PI / 4);
    b.fillStyle = "#c9a227"; b.beginPath(); b.ellipse(0, 0, 30, 17, 0, 0, Math.PI * 2); b.fill();
    b.strokeStyle = "#0d0e12"; b.lineWidth = 2; b.stroke();
    b.fillStyle = "#0d0e12"; batPath(b, 0, .5, 24, 20); b.fill();
    b.restore();
    const leftTop = wallTop([...Array(D * 2 + 1).keys()].map((i) => i * .5), (y, z) => P(0, y, z));
    const backTop = wallTop([...Array(63).keys()].map((i) => i * .5), (x, z) => P(x, 0, z));
    rockWall(b, [P(0, 0), P(0, D), ...leftTop.slice().reverse()], "#121722", 11);
    rockWall(b, [P(0, 0), P(W, 0), ...backTop.slice().reverse()], "#161c28", 23);
    for (let i = 0; i < backTop.length; i += 2) {
      const [x, y] = backTop[i], len = 6 + rnd(i * 2.7) * 16;
      if (rnd(i * 4.1) < .45) poly(b, [[x - 3, y + 2], [x + 3, y + 3], [x, y + len]], "#1b2230");
    }
    for (let i = 1; i < leftTop.length; i += 2) {
      const [x, y] = leftTop[i], len = 6 + rnd(i * 3.3) * 14;
      if (rnd(i * 5.7) < .45) poly(b, [[x - 3, y + 3], [x + 3, y + 2], [x, y + len]], "#171d29");
    }
    poly(b, [P(0, 0), P(W, 0), P(W, .8), P(.8, .8)], "rgba(0,0,0,.22)");
    poly(b, [P(0, 0), P(.8, .8), P(.8, D), P(0, D)], "rgba(0,0,0,.22)");
    // the bridges' decks over the river, planks across
    for (const [y0, y1] of BRIDGES) {
      box(b, 15.75, y0, 1.5, y1 - y0, 0, 2, ["#2a303b", "#11151c", "#0d1016"]);
      for (let x = 15.85; x < 17.25; x += .2) seg(b, P(x, y0, 2), P(x, y1, 2), "rgba(0,0,0,.35)", .4);
    }
    for (const [x, y] of BEACONS) dot(b, ...P(x, y, .5), "#5a0d18", 1.5, 1);
  }
  // on top of the grain: the Gotham feed
  function roomDetails(b) {
    b.save();
    onLeftWall(b, 10.1, 50, 1);
    const w = 37, h = 34;
    b.fillStyle = "#1a1f29"; b.fillRect(-2, -2, w + 4, h + 4);
    const sky = b.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, "#0a1020"); sky.addColorStop(.7, "#1c2540"); sky.addColorStop(1, "#33405e");
    b.fillStyle = sky; b.fillRect(0, 0, w, h);
    b.fillStyle = "rgba(255,240,170,.18)"; b.beginPath(); b.moveTo(30, h); b.lineTo(15, 4); b.lineTo(22, 4); b.closePath(); b.fill();
    b.fillStyle = "#f2e7b0"; b.beginPath(); b.ellipse(17, 7, 7, 4, 0, 0, Math.PI * 2); b.fill();
    b.fillStyle = "#0a1020"; batPath(b, 17, 7.2, 5.5, 5); b.fill();
    for (let i = 0, x = 0; x < w; i++) {
      const bw = 3 + Math.floor(rnd(i * 3 + 1) * 5), bh = 6 + Math.floor(rnd(i * 5 + 2) * 16);
      b.fillStyle = i % 2 ? "#070a14" : "#0b0f1c"; b.fillRect(x, h - bh, bw, bh);
      for (let k = 0; k < 5; k++) if (rnd(i * 17 + k) > .55) { b.fillStyle = rnd(k + i) > .5 ? "#ffd27a" : "#7ae8ff"; b.fillRect(x + 1 + Math.floor(rnd(k * 3 + i) * (bw - 1)), h - bh + 2 + Math.floor(rnd(k + i * 7) * (bh - 3)), 1, 1); }
      x += bw;
    }
    b.restore();
  }

  // ================================================================ the showroom (drawn sharp, once per size, over the cave)
  // A stand: a mirror-black plinth with a light along its edge and the bat on its front; the car stands on it and is
  // seen again in its top; ropes on chrome posts in front of the front row.
  function showroom(g) {
    const Q = (x, y, z = 0) => P(x, y, z).map((v) => v * BS);
    const path = (pts, z) => { g.beginPath(); pts.forEach(([x, y], i) => { const [sx, sy] = Q(x, y, z); i ? g.lineTo(sx, sy) : g.moveTo(sx, sy); }); g.closePath(); };
    for (const c of CARS) {
      const out = standOutline(c), H = STAND.h;
      // the glow it throws on the floor
      g.save(); g.filter = `blur(${6 * BS}px)`; path(standOutline(c, .25), 0); g.fillStyle = "rgba(79,180,255,.28)"; g.fill(); g.restore();
      // its sides: the outline on the floor, then the top over it
      path(out, 0);
      const [sx0, sy0] = Q(c.cx, c.cy + STAND.hy, 0), [, sy1] = Q(c.cx, c.cy + STAND.hy, H);
      const side = g.createLinearGradient(0, sy1, 0, sy0);
      side.addColorStop(0, "#2b313c"); side.addColorStop(.5, "#141820"); side.addColorStop(1, "#090b0f");
      g.fillStyle = side; g.fill();
      path(out, H);
      const [tx, ty] = Q(c.cx, c.cy, H), top = g.createRadialGradient(tx - 40 * BS, ty - 10 * BS, 0, tx, ty, 90 * BS);
      top.addColorStop(0, "#1c222c"); top.addColorStop(.5, "#0b0d12"); top.addColorStop(1, "#050608");
      g.fillStyle = top; g.fill();
      // the car in the black glass of the top
      g.save(); path(out, H); g.clip(); g.globalAlpha = .24;
      window.CrewCars.draw(g, carSpec(c), Q, { mirror: true, seam: .4 * BS });
      g.restore();
      // the contact shadow
      g.save(); g.filter = `blur(${3 * BS}px)`; g.fillStyle = "rgba(0,0,0,.75)";
      const L = window.CrewCars.length(c.model) / 2 - .15;
      path([[c.cx - L, c.cy - .82], [c.cx + L, c.cy - .82], [c.cx + L, c.cy + .82], [c.cx - L, c.cy + .82]], H); g.fill(); g.restore();
      // the light along the edge, and a chrome line
      g.save(); path(out, H); g.strokeStyle = NEON.blue; g.lineWidth = 1.1 * BS; g.shadowColor = NEON.blue; g.shadowBlur = 10 * BS; g.stroke(); g.restore();
      g.save(); path(out, H - .8); g.strokeStyle = "rgba(220,235,255,.35)"; g.lineWidth = .5 * BS; g.stroke(); g.restore();
      // the bat on the front of the stand
      g.save(); const [ex, ey] = P(c.cx - .55, c.cy + STAND.hy, H * .52);
      g.setTransform(BS, BS * .5, 0, BS, ex * BS, ey * BS); emblem(g, 9, 0, 5.2, 2.1, 6 * BS); g.restore();
      // the car itself
      window.CrewCars.draw(g, carSpec(c), Q, { seam: .55 * BS });
    }
    // the ropes in front of the front row
    for (const c of CARS.filter((cc) => cc.cy > 5)) {
      const ys = c.cy + STAND.hy + .5, posts = [c.cx - 2.5, c.cx - .8, c.cx + .8, c.cx + 2.5];
      for (let i = 0; i < posts.length - 1; i++) {
        const [ax, ay] = Q(posts[i], ys, 11), [bx, by] = Q(posts[i + 1], ys, 11), [mx, my] = Q((posts[i] + posts[i + 1]) / 2, ys, 6);
        g.beginPath(); g.moveTo(ax, ay); g.quadraticCurveTo(mx, my, bx, by); g.strokeStyle = "#8e0f1f"; g.lineWidth = 1.2 * BS; g.stroke();
        g.strokeStyle = "rgba(255,120,130,.35)"; g.lineWidth = .4 * BS; g.stroke();
      }
      for (const px of posts) {
        const [a0, a1] = Q(px, ys, 0), [, b1] = Q(px, ys, 12);
        g.fillStyle = "#0a0b0e"; g.beginPath(); g.ellipse(a0, a1, 2.2 * BS, 1.1 * BS, 0, 0, Math.PI * 2); g.fill();
        const gr = g.createLinearGradient(a0 - BS, 0, a0 + BS, 0); gr.addColorStop(0, "#f4f6f8"); gr.addColorStop(.5, "#8d96a3"); gr.addColorStop(1, "#e3e7ec");
        g.fillStyle = gr; g.fillRect(a0 - .6 * BS, b1, 1.2 * BS, a1 - b1);
        g.fillStyle = "#e9edf2"; g.beginPath(); g.arc(a0, b1, 1.1 * BS, 0, Math.PI * 2); g.fill();
      }
    }
  }

  // ================================================================ the crew, walking, sitting, working
  let agents = [], particles = [], jobs = [], queue = [], office = { sessions: [] }, tasks = [], memoryNotes = null, firstLoad = true;
  const SPEED = 2.7; // tiles a second

  function makeAgent(c, i) {
    return { ...c, i, x: 2.5, y: 4.5, dir: "se", pose: "stand", path: [], mode: "idle", spot: null, lastSpot: null, job: null, desk: null,
      seated: false, chairAt: null, timer: 0, wait: 0, bubble: null, hop: 0, phase: rnd(i) * 10, idleFor: rnd(i + 3) * 30, done: null, head: null, box: null,
      label: null, onArrive: null, brewUntil: 0, emit: 0, portrait: window.CrewPeople.portrait(c.look, c.id), figure: window.CrewPeople.portrait(c.look, c.id, true) };
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
  function release(a) { if (a.spot && a.spot.taken === a) a.spot.taken = null; a.spot = null; a.chairAt = null; }
  function settle(a, s) {
    a.dir = s.dir; a.pose = s.pose; a.timer = 8 + Math.random() * 14;
    a.chairAt = s.chair ? k2(s.x, s.y) : null;
    if (s.pose === "drink" && !s.bar) a.brewUntil = clock + 3;
    if (s.sofa && a.idleFor > 45 && Math.random() < .55) { a.pose = "sleep"; a.timer += 12; }
  }
  function wander(a, prefer) {
    release(a);
    // the garage is a treat: not every time
    const free = SPOTS.filter((s) => !s.taken && s !== a.lastSpot && (!s.far || Math.random() < .35));
    const s = prefer && !prefer.taken ? prefer : free[Math.floor(Math.random() * free.length)];
    if (!s) { a.timer = 3; return; }
    s.taken = a; a.spot = s; a.lastSpot = s; a.mode = "idle"; a.seated = false;
    goTo(a, s, () => settle(a, s));
  }
  function placeIdle(a) {
    const free = SPOTS.filter((s) => !s.taken && !s.far);
    const s = free[(a.i * 5 + 3) % free.length];
    s.taken = a; a.spot = s; a.lastSpot = s;
    const at = s.at || [s.x + .5, s.y + .5];
    a.x = at[0]; a.y = at[1]; settle(a, s); a.timer = 2 + rnd(a.i) * 10;
  }

  let signal = -99; // when the bat-signal last went up (a mission came in)
  function assign(a, job, d, instant) {
    release(a);
    a.job = job; a.desk = d; d.agent = a; a.mode = "toDesk"; a.idleFor = 0; a.done = null; a.seated = false;
    const seat = { x: d.x, y: d.y + 1, at: [d.x + 1, d.y + 1.42] };
    if (instant) { a.x = seat.at[0]; a.y = seat.at[1]; a.path = []; sit(a); d.boot = -9; return; }
    signal = clock;
    a.bubble = { g: "!", until: clock + 1.2, c: NEON.amber }; a.hop = .35; a.wait = .75; a.path = []; a.pose = "stand";
    if (a.dir === "ne" || a.dir === "nw") a.dir = "se";
    goTo(a, seat, () => sit(a));
  }
  function sit(a) { a.mode = "work"; a.seated = true; a.dir = "ne"; a.pose = "desk"; a.desk.boot = clock; panelFollows(a); }
  // the mission panel says what the agent is doing now, as they sit down, finish and leave
  function panelFollows(a) { if (panel && panel.kind === "agent" && panel.ref === a) refreshPanel(false); }
  function finish(a, ok) {
    a.done = ok ? "ok" : "bad"; a.mode = "done"; a.timer = 2.6;
    a.bubble = { g: ok ? "check" : "x", until: clock + 2.6, c: ok ? NEON.green : NEON.red };
    if (ok) { confetti(a); deposit(a); }
    panelFollows(a);
  }
  function leaveDesk(a) {
    if (a.desk && a.desk.agent === a) a.desk.agent = null;
    a.desk = null; a.job = null; a.done = null; a.seated = false; a.mode = "idle"; a.idleFor = 0;
    const coffee = SPOTS.find((s) => s.pose === "drink");
    wander(a, Math.random() < .6 ? coffee : null);
    paintLists();
    panelFollows(a);
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

  // ================================================================ particles: sleep, coffee, confetti, the mist of the fall
  let mistAt = 0;
  function emit(kind, x, y, o) { if (particles.length < 160) particles.push({ kind, x, y, vx: 0, vy: -8, life: 2, age: 0, c: "#fff", grav: 0, ...o }); }
  function confetti(a) {
    if (!a.head) return;
    const cols = [NEON.yellow, NEON.blue, NEON.green, NEON.amber, NEON.violet, "#ffffff"];
    for (let i = 0; i < 40; i++) emit("bit", a.head[0], a.head[1] - 2, { vx: (Math.random() - .5) * 60, vy: -28 - Math.random() * 40, life: 1.3 + Math.random() * .7, c: cols[i % cols.length], grav: 80 });
  }
  // a mission done: seven coins fly from the agent's head to the vault, and it flashes gold when they land
  function deposit(a) {
    if (!a.head) return;
    const [ex, ey] = P(2.5, 12.55, 13);
    for (let i = 0; i < 7; i++) particles.push({ kind: "coin", x: a.head[0], y: a.head[1], sx: a.head[0] + (Math.random() - .5) * 6, sy: a.head[1] - 2,
      ex: ex + (Math.random() - .5) * 8, ey: ey + (Math.random() - .5) * 3, age: -i * .08, life: 1.25, vx: 0, vy: 0, grav: 0, c: "#ffd86b" });
  }
  // where the motes rise from: under every drop of the island, gold under the vault
  const EDGES = [];
  for (let y = 0; y < D; y++) for (let x = 0; x < W; x++) {
    if (!solid(x, y)) continue;
    const c = tile(x, y) === "v" ? "rgba(255,214,130,.6)" : "rgba(150,195,255,.45)";
    if (!solid(x, y + 1)) EDGES.push([x + .5, y + 1, c]);
    if (!solid(x + 1, y)) EDGES.push([x + 1, y + .5, c]);
  }
  let moteAt = 0;
  function tickParticles(dt) {
    mistAt += dt;
    if (mistAt > .2) {
      mistAt = 0;
      const [mx, my] = P(FALL.x0 + Math.random() * (FALL.x1 - FALL.x0), .5, 2);
      emit("bit", mx, my, { vx: (Math.random() - .5) * 6, vy: -6 - Math.random() * 6, life: 1.6, c: "rgba(220,240,255,.45)" });
    }
    for (const a of agents) {
      if (a.path.length || !a.head) continue;
      a.emit += dt;
      if (a.pose === "sleep" && a.emit > 1.5) { a.emit = 0; emit("z", a.head[0] + 3, a.head[1] - 2, { vx: 3, vy: -6, life: 2.4, c: "#cfd8ff" }); }
      if (a.pose === "drink" && a.mode === "idle" && a.emit > .45 && !(a.spot && a.spot.bar)) { a.emit = 0; const [sx, sy] = clock < a.brewUntil ? P(4.34, .48, 22) : [a.head[0] + 2, a.head[1] + 6]; emit("bit", sx, sy, { vx: (Math.random() - .5) * 2, vy: -7, life: 1.1, c: "rgba(255,255,255,.55)" }); }
    }
    moteAt += dt;
    if (moteAt > .35) {
      moteAt = 0;
      const e = EDGES[Math.floor(Math.random() * EDGES.length)], [mx, my] = P(e[0], e[1], -26 - Math.random() * 34);
      emit("bit", mx, my, { vx: (Math.random() - .5) * 2, vy: -2.5 - Math.random() * 2.5, life: 5 + Math.random() * 3, c: e[2] });
    }
    for (const p of particles) {
      p.age += dt;
      if (p.kind === "coin") {
        const u = clamp(p.age / p.life, 0, 1), cx = (p.sx + p.ex) / 2, cy = Math.min(p.sy, p.ey) - 46;
        p.x = (1 - u) * (1 - u) * p.sx + 2 * (1 - u) * u * cx + u * u * p.ex;
        p.y = (1 - u) * (1 - u) * p.sy + 2 * (1 - u) * u * cy + u * u * p.ey;
        if (u >= 1 && !p.landed) {
          p.landed = true; vaultFlash = clock;
          for (let i = 0; i < 6; i++) emit("bit", p.ex, p.ey, { vx: (Math.random() - .5) * 30, vy: -10 - Math.random() * 20, life: .7, c: "#ffe9a0", grav: 60 });
        }
        continue;
      }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.grav * dt;
    }
    particles = particles.filter((p) => p.age < p.life);
  }
  function drawParticles(g) {
    for (const p of particles) {
      if (p.kind === "coin") {
        if (p.age < 0) continue;
        g.globalAlpha = 1; g.fillStyle = "#ffd86b"; g.fillRect(p.x - 1, p.y - .5, 2, 1.2); g.fillStyle = "#fff6d0"; g.fillRect(p.x - 1, p.y - .5, 1, .5);
        continue;
      }
      g.globalAlpha = Math.max(0, Math.min(1, (1 - p.age / p.life) * 1.6));
      if (p.kind === "bit") { g.fillStyle = p.c; g.fillRect(p.x, p.y, p.grav ? 1 : .5, p.grav && Math.floor(p.age * 12) % 2 ? 1.5 : .5); }
      else glyph(g, p.kind, Math.round(p.x), Math.round(p.y), p.c);
    }
    g.globalAlpha = 1;
  }

  // ================================================================ what there is to do, from the Hub
  // a Claude prompt can be a machine message (<task-notification>…, paths): keep the words a person would read
  function cleanPrompt(text) {
    const raw = String(text || ""), summary = raw.match(/<summary>([\s\S]*?)(<\/summary>|$)/);
    if (summary && summary[1].trim()) return summary[1].trim();
    if (/^\s*</.test(raw)) return "";
    return raw.replace(/<[^>]*>?/g, " ").replace(/[A-Z]:\\[^\s]+|\/[\w./-]{12,}/g, " ").replace(/\b(?=\w*\d)\w{10,}\b/g, " ").replace(/\s+/g, " ").trim();
  }
  const TASK_STATE = { IN_PROGRESS: "work", WAITING_APPROVAL: "wait", NEEDS_HELP: "help", PAUSED: "pause" };
  const FRESH = 30 * 60e3, STILL_WAITING = 20 * 60e3;
  function taskJob(x, state) {
    return { key: "t" + x.id, type: "task", id: x.id, title: x.title, who: nameOf(x.assignee), state, progress: x.progress || 0, crew: x.crew || "",
      action: x.current_action || "", last: x.last_action || "", next: x.next_action || "", status: x.status, role: x.agent_role || "",
      since: x.started_at || x.created_at, project: x.project_name || x.company || x.project || "", description: x.description || "",
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
        out.push({ key: "c" + s.id, type: "claude", title: cleanPrompt(s.prompt) || t("Claude a trabalhar em {p}", { p: s.project }), who: s.name, state: s.state === "working" ? "work" : "wait",
          action: s.state === "working" ? s.action || "" : "", since: s.since, project: s.project, model: s.model, tokens: s.tokens,
          subagents: (s.agents || []).map((x) => ({ kind: x.kind, state: x.state, description: x.description })), skills: s.skills || [], href: "#/escritorio" });
      }
      for (const ag of s.agents || []) if (ag.state === "working") {
        out.push({ key: "a" + ag.id, type: "sub", kind: ag.kind, title: ag.description || ag.kind, who: s.name, state: "work", action: ag.action || "",
          since: ag.started_at, project: s.project, model: ag.model, skills: ag.skills || [], href: "#/escritorio" });
      }
    }
    const rank = { work: 0, help: 1, start: 2, wait: 3, pause: 4 };
    return out.sort((p, q) => rank[p.state] - rank[q.state] || String(q.since).localeCompare(String(p.since)));
  }
  // Who goes where, always by the same rule (docs/batcave-redesenho.md): a subagent by its kind, a request by its words,
  // anything else to Operations. If that sector's agent is busy, the most alike free colleague; nobody free, the queue.
  const word = (s) => new RegExp(`(?<![\\p{L}\\d])(${s})(?![\\p{L}\\d])`, "iu");
  const WORDS = [
    ["catwoman", word("design\\p{L}*|página\\p{L}*|pagina\\p{L}*|cor|cores|layout|ecrã\\p{L}*|visual|ícone\\p{L}*|logo\\p{L}*|estilo\\p{L}*|css")],
    ["riddler", word("pesquis\\p{L}*|preço\\p{L}*|preco\\p{L}*|procur\\p{L}*|concorr\\p{L}*|fornecedor\\p{L}*")],
    ["robin", word("test\\p{L}*")],
    ["alfred", word("rever|revê|revisão|revisao|revis[ae]\\p{L}*|review")],
    ["joker", word("anúncio\\p{L}*|anuncio\\p{L}*|posts?|campanha\\p{L}*|instagram|tiktok|marketing|legenda\\p{L}*")],
    ["batman", word("erro\\p{L}*|bug\\p{L}*|código|codigo|corrig\\p{L}*|implement\\p{L}*|script\\p{L}*")],
    ["lucius", word("onde está|onde esta|onde fica|explic\\p{L}*|como funciona")],
  ];
  const ROLE_CREW = { developer: "batman", research: "riddler", marketing: "joker", testing: "robin" };
  const NEAR = { batman: ["lucius", "robin", "alfred"], lucius: ["batman", "riddler", "alfred"], riddler: ["lucius", "joker", "gordon"],
    catwoman: ["joker", "batman", "robin"], joker: ["catwoman", "riddler", "gordon"], alfred: ["robin", "lucius", "batman"],
    robin: ["alfred", "batman", "lucius"], gordon: ["alfred", "lucius", "riddler"] };
  const byWords = (text) => (WORDS.find(([, re]) => re.test(text)) || [])[0];
  function sectorOf(j) {
    if (j.crew && NEAR[j.crew]) return j.crew;
    const kind = j.kind && CREW.find((c) => c.kinds.includes(j.kind));
    if (kind) return kind.id;
    return byWords(`${j.title || ""} ${j.description || ""}`) || ROLE_CREW[j.role] || "gordon";
  }
  // the agent who would take it now: { home: whose sector it is, a: who goes (null: nobody free) }
  function routeOf(j) {
    const home = sectorOf(j), free = agents.filter((a) => !a.job && a.mode !== "done");
    if (j.crew) return { home, a: free.find((a) => a.id === j.crew) || null };   // asked for by name: that one, or the queue
    for (const id of [home, ...NEAR[home]]) { const a = free.find((x) => x.id === id); if (a) return { home, a }; }
    return { home, a: free[0] || null };
  }
  const pick = (j) => routeOf(j).a;
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
      const a = pick(j), d = a && deskOf(a);
      if (!a || !d) { queue.push(j); continue; }
      assign(a, j, d, instant);
    }
  }

  // ================================================================ the screen: camera, background, lights
  let stage = null, cv = null, g2 = null, world = null, wg = null, bg = null, sign = null, S = 1, BS = 1, dpr = 1, star = null;
  let LS = 1; // labels shrink with a small room
  let timer = 0, raf = 0, last = 0, onScreen = true, ro = null, io = null, hovered = null, focus = null, hoverCar = null, vignette = null;
  let panel = null; // what the mission panel shows: { kind: "agent" | "car", ref }
  let view = sessionStorage.getItem("crew.view") || "office";
  if (!VIEWS[view]) view = "office";
  const cam = { ...VIEWS[view], h: VIEWS[view].w / ASPECT }, camAnim = { from: null, to: null, t: 0 };
  const SX = (x) => (x - cam.x) * S, SY = (y) => (y - cam.y) * S;

  function buildBg() {
    const base = document.createElement("canvas"); base.width = LW; base.height = LH;
    const b = base.getContext("2d", { willReadFrequently: true });
    b.k = 1;
    room(b); grain(b, 13); roomDetails(b);
    BS = Math.min(4, cv.width / VIEWS.garage.w);
    bg = document.createElement("canvas"); bg.width = Math.round(LW * BS); bg.height = Math.round(LH * BS);
    const g = bg.getContext("2d");
    const sky = g.createRadialGradient(bg.width * .45, bg.height * .35, 0, bg.width * .45, bg.height * .4, bg.width * .75);
    sky.addColorStop(0, "#0d1424"); sky.addColorStop(.6, "#070a12"); sky.addColorStop(1, "#030407");
    g.fillStyle = sky; g.fillRect(0, 0, bg.width, bg.height);
    abyss(g);
    g.imageSmoothingEnabled = false;
    g.drawImage(base, 0, 0, bg.width, bg.height);
    g.imageSmoothingEnabled = true;
    lightsStatic(g);
    sectorFloor(g);
    showroom(g);
    beams(g);
    sign = buildSign();
    vignette = g2.createRadialGradient(cv.width / 2, cv.height * .5, cv.height * .35, cv.width / 2, cv.height * .5, cv.width * .72);
    vignette.addColorStop(0, "rgba(0,0,0,0)"); vignette.addColorStop(1, "rgba(0,0,0,.55)");
    for (const c of CARS) c.bounds = window.CrewCars.bounds(carSpec(c), P);
  }
  const QB = (x, y, z) => P(x, y, z).map((v) => v * BS);
  // the name of each sector, written flat on the floor in front of its post
  function sectorFloor(g) {
    g.save();
    for (const d of DESKS) {
      const c = CREW.find((x) => x.id === d.crew), [sx, sy] = P(d.x + 1, d.y + 2.3);
      g.setTransform(BS, .5 * BS, -BS, .5 * BS, sx * BS, sy * BS);
      g.strokeStyle = "rgba(200,212,226,.22)"; g.lineWidth = .4; g.beginPath(); g.moveTo(-15, -6.4); g.lineTo(15, -6.4); g.stroke();
      g.font = `700 4.6px ${DISPLAY}`; g.textAlign = "center"; g.textBaseline = "alphabetic";
      if ("letterSpacing" in g) g.letterSpacing = ".9px";
      g.fillStyle = "rgba(214,224,236,.55)"; g.fillText(t(c.what).toUpperCase(), 0, 0);
    }
    g.restore();
  }
  // light that never moves, painted sharp over the pixel cave
  function lightsStatic(g) {
    const tube = (a, b, c, w = 1.2) => {
      g.save(); g.lineCap = "round";
      g.strokeStyle = c; g.lineWidth = w * BS; g.shadowColor = c; g.shadowBlur = 12 * BS;
      g.beginPath(); g.moveTo(...QB(...a)); g.lineTo(...QB(...b)); g.stroke(); g.stroke();
      g.shadowBlur = 2 * BS; g.globalAlpha = .7; g.strokeStyle = "#ffffff"; g.lineWidth = w * BS * .35; g.stroke();
      g.restore();
    };
    tube([0, 0, 1.5], [W, 0, 1.5], NEON.blue);
    tube([0, 0, 1.5], [0, D, 1.5], NEON.blue);
    for (const x of [1.15, 6.7, 15.82, 17.18, 22.6, 30.6]) tube([x, 0, 8], [x, 0, 46], "rgba(79,180,255,.75)", .9);
    for (const y of [1.7, 10.5, 16.85]) tube([0, y, 8], [0, y, 46], "rgba(79,180,255,.75)", .9);
    tube([6, 1.3, .2], [6, GD - .4, .2], "rgba(127,227,255,.45)", .6);
    // every edge of the island has a light along it, the colour of the wing it belongs to
    const EDGE = { v: "rgba(255,207,90,.75)", t: "rgba(255,191,60,.65)", p: "rgba(255,45,79,.6)" };
    for (let y = 0; y < D; y++) for (let x = 0; x < W; x++) {
      if (!solid(x, y)) continue;
      const c = EDGE[tile(x, y)] || "rgba(79,180,255,.55)";
      if (!solid(x, y + 1)) tube([x, y + 1, 0], [x + 1, y + 1, 0], c, .7);
      if (!solid(x + 1, y)) tube([x + 1, y, 0], [x + 1, y + 1, 0], c, .7);
      if (x > 0 && !solid(x - 1, y)) tube([x, y, 0], [x, y + 1, 0], c, .7);
      if (y > 0 && !solid(x, y - 1)) tube([x, y, 0], [x + 1, y, 0], c, .7);
    }
    // the river's banks; the bridge: glass on its far side, a light under its near edge
    for (const [y0, y1] of [[0, 4.06], [5.94, 10.06]]) { tube([16, y0, 0], [16, y1, 0], "rgba(127,227,255,.4)", .5); tube([17, y0, 0], [17, y1, 0], "rgba(127,227,255,.4)", .5); }
    for (const [y0, y1] of BRIDGES) {
      tube([15.75, y1 + .03, 1.2], [17.25, y1 + .03, 1.2], "rgba(127,227,255,.8)", .6);
      const A = QB(15.75, y0, 2), B = QB(17.25, y0, 2), C = QB(17.25, y0, 10), E = QB(15.75, y0, 10);
      g.fillStyle = "rgba(150,205,255,.1)"; g.beginPath(); g.moveTo(...A); g.lineTo(...B); g.lineTo(...C); g.lineTo(...E); g.closePath(); g.fill();
      g.strokeStyle = "rgba(235,242,250,.8)"; g.lineWidth = .5 * BS; g.beginPath(); g.moveTo(...E); g.lineTo(...C); g.stroke();
    }
    vaultWall(g);
    // the lookout's landing ring with the bat in it
    { g.save(); const [lx, ly] = QB(27.4, 12.7, 0);
      g.setTransform(BS, 0, 0, BS * .5, lx, ly); g.rotate(Math.PI / 4);
      g.strokeStyle = "rgba(255,210,80,.5)"; g.lineWidth = 1.4; g.beginPath(); g.arc(0, 0, 38, 0, Math.PI * 2); g.stroke();
      g.lineWidth = .6; g.beginPath(); g.arc(0, 0, 33, 0, Math.PI * 2); g.stroke();
      g.fillStyle = "rgba(255,210,80,.2)"; batPath(g, 0, .6, 24, 20); g.fill();
      g.restore(); }
    g.save(); g.globalCompositeOperation = "lighter";
    const pool = (x, y, r, c, a) => {
      const [cx, cy] = QB(x, y, 0), gr = g.createRadialGradient(cx, cy, 0, cx, cy, r * BS);
      gr.addColorStop(0, c); gr.addColorStop(1, "rgba(0,0,0,0)");
      g.globalAlpha = a; g.fillStyle = gr; g.save(); g.translate(cx, cy); g.scale(1, .5); g.translate(-cx, -cy);
      g.beginPath(); g.arc(cx, cy, r * BS, 0, Math.PI * 2); g.fill(); g.restore();
    };
    pool(11, 5, 120, "#2a5bb8", .2); pool(3, 6, 80, "#c9a227", .08); pool(1, 9, 50, "#8fa8ff", .1);
    for (const c of CARS) pool(c.cx, c.cy, 70, "#9fc4ff", .2);
    pool(3.2, 14, 95, "#ffb84d", .2); pool(11.4, 12.4, 70, "#ffbf3c", .12); pool(27.5, 12.6, 70, "#ff4f6a", .07); pool(16.5, 5.5, 80, "#3fa9ff", .12);
    g.restore();
    // the bat thrown on the garage floor by a lamp, between the four stands
    g.save(); g.globalCompositeOperation = "lighter"; g.globalAlpha = .16;
    const [bx, by] = QB(24.1, 5, 0);
    g.setTransform(BS, 0, 0, BS * .5, bx, by); g.rotate(Math.PI / 4);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, 34); gr.addColorStop(0, "#ffe9a0"); gr.addColorStop(1, "rgba(255,233,160,0)");
    g.fillStyle = gr; g.beginPath(); g.ellipse(0, 0, 34, 20, 0, 0, Math.PI * 2); batPath(g, 0, .6, 24, 22, true); g.fill("evenodd");
    g.restore();
    // on the garage's back wall: the big emblem, the name in chrome with AMG's stripes, the star
    g.save(); const [ex, ey] = P(18.6, 0, 50);
    g.setTransform(BS, BS * .5, 0, BS, ex * BS, ey * BS);
    emblem(g, 28, 0, 22, 10, 22 * BS);
    g.restore();
    g.save(); const [gx, gy] = P(26.0, 0, 55);
    g.setTransform(BS, BS * .5, 0, BS, gx * BS, gy * BS);
    chromeText(g, "GARAGEM", 0, 0, `700 9px ${DISPLAY}`, NEON.blue, 1);
    g.fillStyle = "#c9ced6"; for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(52 + i * 5, -7); g.lineTo(55 + i * 5, -7); g.lineTo(52 + i * 5, 0); g.lineTo(49 + i * 5, 0); g.closePath(); g.fill(); }
    g.fillStyle = NEON.red; g.beginPath(); g.moveTo(67, -7); g.lineTo(70, -7); g.lineTo(67, 0); g.lineTo(64, 0); g.closePath(); g.fill();
    g.restore();
    if (star) {
      g.save(); const [sx, sy] = P(25.2, 0, 57);
      g.setTransform(BS, BS * .5, 0, BS, sx * BS, sy * BS);
      g.shadowColor = "rgba(230,240,255,.9)"; g.shadowBlur = 10 * BS;
      g.drawImage(star, 0, -10, 12, 12); g.restore();
    }
  }
  // ================================================================ the vault on the left wall, and the abyss (sharp, once per size)
  // u runs along the wall from VAULT.y1 towards the corner, v down from VAULT.z1, in the cave's pixels. The hole is the
  // strongroom going back into the rock, shelves of gold lit from the end; its door is swung open flat against the wall
  // beside it: a steel disc as thick as a wheel, its bolts out, the wheel in the middle.
  const VAULT = { y1: 16.9, z1: 62, hole: [31, 35, 19.5], door: [71, 35, 19.5] };
  function chromeRing(g, cx, cy, r0, r1, bolts) {
    const gr = g.createLinearGradient(cx, cy - r1, cx, cy + r1);
    gr.addColorStop(0, "#f7f8fa"); gr.addColorStop(.38, "#c4cbd4"); gr.addColorStop(.52, "#6f7a88"); gr.addColorStop(.7, "#dfe3e7"); gr.addColorStop(1, "#8d96a3");
    g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r1, 0, Math.PI * 2); g.moveTo(cx + r0, cy); g.arc(cx, cy, r0, 0, Math.PI * 2, true); g.fill();
    g.strokeStyle = "rgba(10,12,16,.6)"; g.lineWidth = .3;
    for (const r of [r0, r1]) { g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke(); }
    for (let i = 0; i < bolts; i++) { const a = (i / bolts) * Math.PI * 2, m = (r0 + r1) / 2; g.fillStyle = "#3a404b"; g.beginPath(); g.arc(cx + Math.cos(a) * m, cy + Math.sin(a) * m, .55, 0, Math.PI * 2); g.fill(); }
  }
  function vaultWall(g) {
    const [ox, oy] = P(0, VAULT.y1, VAULT.z1);
    g.save(); g.setTransform(BS, -.5 * BS, 0, BS, ox * BS, oy * BS);
    rr(g, 3, 0, 88, 9, 2); g.fillStyle = "#050608"; g.fill(); g.lineWidth = .7; g.strokeStyle = "#8d96a3"; g.stroke();   // the marquee's housing
    const [hu, hv, r] = VAULT.hole, [du, dv, dr] = VAULT.door, T = 5.6;   // T: how far the open door stands out of the wall
    g.save(); g.beginPath(); g.arc(hu, hv, r, 0, Math.PI * 2); g.clip();
    const tunnel = g.createRadialGradient(hu + 2, hv + 1, 0, hu, hv, r);
    tunnel.addColorStop(0, "#fff2b8"); tunnel.addColorStop(.22, "#ffcf5a"); tunnel.addColorStop(.6, "#6b4a12"); tunnel.addColorStop(1, "#120b02");
    g.fillStyle = tunnel; g.fillRect(hu - r, hv - r, 2 * r, 2 * r);
    for (let k = 3; k >= 0; k--) {        // the shelves, smaller the further back
      const s = 1 - k * .2, rk = r * s, cx = hu + k * .7, cy = hv + k * .35;
      for (const dd of [-7, 0, 7]) {
        const y = cy + dd * s, x0 = cx - rk * .72, x1 = cx + rk * .72;
        g.fillStyle = `rgba(28,18,4,${(.85 - k * .12).toFixed(2)})`; g.fillRect(x0, y + 1.7 * s, x1 - x0, .9 * s);
        for (let bx = x0 + .4, i = 0; bx < x1 - 2.4 * s; bx += 2.8 * s, i++) {
          g.fillStyle = i % 3 ? "#ffd86b" : "#e8b44a"; g.fillRect(bx, y, 2.3 * s, 1.7 * s);
          g.fillStyle = "rgba(255,250,220,.7)"; g.fillRect(bx, y, 2.3 * s, .35 * s);
        }
      }
      g.strokeStyle = `rgba(40,26,6,${(.6 - k * .1).toFixed(2)})`; g.lineWidth = 1.1 * s; g.beginPath(); g.arc(cx, cy, rk, 0, Math.PI * 2); g.stroke();
    }
    g.restore();
    chromeRing(g, hu, hv, r, r + 3.4, 18);
    for (let o = 0; o < T; o += .6) { g.fillStyle = o < .7 ? "#0b0d11" : sh("#5b626f", -.45 + o * .04); g.beginPath(); g.arc(du + o, dv + o, dr, 0, Math.PI * 2); g.fill(); }
    const fu = du + T, fv = dv + T;
    g.fillStyle = "#a9b1bc";                // the hinges, back to the frame
    for (const s of [-9, 9]) { g.beginPath(); g.moveTo(hu + r + 2.8, hv + s - 1.6); g.lineTo(fu - dr + 2.5, fv + s - 1.6); g.lineTo(fu - dr + 2.5, fv + s + 1.6); g.lineTo(hu + r + 2.8, hv + s + 1.6); g.closePath(); g.fill(); }
    for (let i = 0; i < 16; i++) {          // the locking bolts, out of its edge
      g.save(); g.translate(fu, fv); g.rotate((i / 16) * Math.PI * 2);
      g.fillStyle = "#d9dee5"; g.fillRect(dr - 1.5, -.8, 3.8, 1.6); g.fillStyle = "#6f7a88"; g.fillRect(dr - 1.5, .25, 3.8, .55);
      g.restore();
    }
    const face = g.createRadialGradient(fu - 6, fv - 7, 2, fu, fv, dr);
    face.addColorStop(0, "#f4f6f8"); face.addColorStop(.45, "#b9c1cb"); face.addColorStop(.82, "#7d8794"); face.addColorStop(1, "#4a5260");
    g.fillStyle = face; g.beginPath(); g.arc(fu, fv, dr, 0, Math.PI * 2); g.fill();
    for (const k of [.93, .76, .57, .34]) {
      g.lineWidth = .35; g.strokeStyle = "rgba(20,24,30,.38)"; g.beginPath(); g.arc(fu, fv, dr * k, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = "rgba(255,255,255,.28)"; g.beginPath(); g.arc(fu - .25, fv - .25, dr * k, Math.PI * .9, Math.PI * 1.6); g.stroke();
    }
    for (let i = 0; i < 3; i++) {           // the wheel
      const a = (i / 3) * Math.PI * 2 - Math.PI / 2, ex = fu + Math.cos(a) * 9.5, ey = fv + Math.sin(a) * 9.5;
      g.strokeStyle = "#2a2f38"; g.lineWidth = 1.9; g.beginPath(); g.moveTo(fu, fv); g.lineTo(ex, ey); g.stroke();
      g.strokeStyle = "#eef1f4"; g.lineWidth = 1.1; g.beginPath(); g.moveTo(fu, fv); g.lineTo(ex, ey); g.stroke();
      g.fillStyle = "#f7f8fa"; g.beginPath(); g.arc(ex, ey, 1.5, 0, Math.PI * 2); g.fill();
    }
    const hub = g.createRadialGradient(fu - 1, fv - 1, 0, fu, fv, 3); hub.addColorStop(0, "#ffffff"); hub.addColorStop(1, "#7d8794");
    g.fillStyle = hub; g.beginPath(); g.arc(fu, fv, 3, 0, Math.PI * 2); g.fill();
    const cu = fu + 9.5, cv = fv - 9.5;     // the combination dial
    g.fillStyle = "#1d2129"; g.beginPath(); g.arc(cu, cv, 3.2, 0, Math.PI * 2); g.fill();
    g.strokeStyle = "#c9ced6"; g.lineWidth = .5; g.stroke();
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; g.beginPath(); g.moveTo(cu + Math.cos(a) * 2.2, cv + Math.sin(a) * 2.2); g.lineTo(cu + Math.cos(a) * 2.9, cv + Math.sin(a) * 2.9); g.stroke(); }
    g.fillStyle = NEON.red; g.fillRect(cu - .25, cv - 3.2, .5, 1);
    g.font = `700 3.1px ${DISPLAY}`; g.textAlign = "center";
    g.fillStyle = "rgba(20,24,30,.5)"; g.fillText("AGENTE AMG", fu, fv + 15.5);
    g.fillStyle = "rgba(255,255,255,.35)"; g.fillText("AGENTE AMG", fu - .2, fv + 15.3);
    g.textAlign = "left";
    g.restore();
  }
  // under the island: stalagmites rising out of the dark far below, and fog over them
  function abyss(g) {
    const pillars = [[20, 15, 118], [22.5, 18.5, 150], [15, 17.5, 132], [32, 14.5, 120], [8.5, 19.5, 104], [27, 20, 160], [34, 9, 140], [12, 21, 120]];
    for (const [x, y, h] of pillars) {
      const [bx, by] = QB(x, y, -170), [tx, ty] = QB(x, y, -170 + h), w = (7 + rnd(x * y) * 7) * BS;
      const gr = g.createLinearGradient(0, ty, 0, by); gr.addColorStop(0, "#152036"); gr.addColorStop(.55, "#0a1120"); gr.addColorStop(1, "rgba(4,6,10,0)");
      g.fillStyle = gr; g.beginPath(); g.moveTo(bx - w, by); g.lineTo(tx - w * .18, ty + 3 * BS); g.lineTo(tx, ty); g.lineTo(tx + w * .22, ty + 4 * BS); g.lineTo(bx + w, by); g.closePath(); g.fill();
      g.strokeStyle = "rgba(127,180,255,.08)"; g.lineWidth = .6 * BS; g.beginPath(); g.moveTo(tx, ty); g.lineTo(bx - w, by); g.stroke();
    }
    g.save(); g.globalCompositeOperation = "lighter";
    for (const [x, y, z, r, c, a] of [[16, 16, -50, 230, "#1d4f8f", .22], [4, 19, -60, 150, "#8a6a1d", .14], [27, 17, -60, 170, "#1d4f8f", .16], [16.5, 12, -40, 60, "#3fa9ff", .18], [22, 22, -120, 260, "#0f2d5a", .2]]) {
      const [cx, cy] = QB(x, y, z), gr = g.createRadialGradient(cx, cy, 0, cx, cy, r * BS);
      gr.addColorStop(0, c); gr.addColorStop(1, "rgba(0,0,0,0)"); g.globalAlpha = a; g.fillStyle = gr; g.fillRect(cx - r * BS, cy - r * BS, 2 * r * BS, 2 * r * BS);
    }
    g.restore();
  }
  // over the stands: a beam from the dark onto each car, and the glow of the cars' own lamps
  function beams(g) {
    g.save(); g.globalCompositeOperation = "lighter";
    for (const c of CARS) {
      const [tx, ty] = QB(c.cx, c.cy, 30);
      const gr = g.createLinearGradient(0, 0, 0, ty);
      gr.addColorStop(0, "rgba(190,215,255,0)"); gr.addColorStop(.45, "rgba(190,215,255,.035)"); gr.addColorStop(1, "rgba(190,215,255,.075)");
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(tx - 5 * BS, 0); g.lineTo(tx + 5 * BS, 0); g.lineTo(tx + 40 * BS, ty + 20 * BS); g.lineTo(tx - 40 * BS, ty + 20 * BS); g.closePath(); g.fill();
      for (const l of window.CrewCars.lamps(carSpec(c))) {
        const [lx, ly] = QB(...l.at), r = 7 * BS, lg = g.createRadialGradient(lx, ly, 0, lx, ly, r);
        lg.addColorStop(0, l.color); lg.addColorStop(1, "rgba(0,0,0,0)");
        g.globalAlpha = .28; g.fillStyle = lg; g.fillRect(lx - r, ly - r, 2 * r, 2 * r); g.globalAlpha = 1;
      }
    }
    g.restore();
  }
  function chromeText(g, text, x, y, font, glowColor, strength) {
    g.font = font; g.textBaseline = "alphabetic"; g.lineJoin = "round";
    const hgt = parseFloat(font.match(/(\d+(\.\d+)?)px/)[1]);
    g.save(); g.shadowColor = glowColor; g.shadowBlur = 16 * BS * strength; g.strokeStyle = glowColor; g.globalAlpha = .7 * strength; g.lineWidth = 2.2; g.strokeText(text, x, y); g.restore();
    const gr = g.createLinearGradient(0, y - hgt, 0, y + 1);
    gr.addColorStop(0, "#ffffff"); gr.addColorStop(.42, "#cdd6e2"); gr.addColorStop(.5, "#6f7a88"); gr.addColorStop(.72, "#e9eef5"); gr.addColorStop(1, "#ffffff");
    g.lineWidth = 1.2; g.strokeStyle = "#0a0d12"; g.strokeText(text, x, y);
    g.fillStyle = gr; g.fillText(text, x, y);
  }
  // the crew's sign on the office wall: the bat in its yellow oval, the name in chrome lit blue from behind
  function buildSign() {
    const x0 = 6.7, x1 = 15.4, z0 = 14, z1 = 60;
    const [ax, ay] = P(x0, 0, z1), [bx2, by2] = P(x1, 0, z0);
    const area2 = { x: ax - 4, y: ay - 4, w: bx2 - ax + 8, h: by2 - ay + 8 };
    const c = document.createElement("canvas"); c.width = Math.round(area2.w * BS); c.height = Math.round(area2.h * BS);
    const g = c.getContext("2d");
    const [sx, sy] = P(7.0, 0, 32);
    g.setTransform(BS, BS * .5, 0, BS, (sx - area2.x) * BS, (sy - area2.y) * BS);
    emblem(g, 8, -7, 8.5, 5.2, 12 * BS);
    chromeText(g, "EMPRESA AMG", 20, 0, `700 17px ${DISPLAY}`, COLD, .8);
    g.font = `600 5.4px ${FONT}`; if ("letterSpacing" in g) g.letterSpacing = "2.4px";
    g.shadowColor = COLD; g.shadowBlur = 5 * BS; g.fillStyle = "#c9d3df";
    g.fillText("OS AGENTES  ·  BATCAVE", 21, 9);
    return { c, box: area2 };
  }

  const glowCache = {};
  function glow(g, x, y, r, c, alpha) {
    let s = glowCache[c];
    if (!s) {
      s = glowCache[c] = document.createElement("canvas"); s.width = s.height = 64;
      const q = s.getContext("2d"), gr = q.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, c); gr.addColorStop(1, "rgba(0,0,0,0)"); q.fillStyle = gr; q.fillRect(0, 0, 64, 64);
    }
    g.globalAlpha = alpha; g.drawImage(s, SX(x - r), SY(y - r), 2 * r * S, 2 * r * S); g.globalAlpha = 1;
  }
  // the vault's marquee: the text turned into LEDs once (each pixel of a 7 px line becomes a dot), scrolled along the wall
  const ledCache = { text: "", c: null, w: 0 };
  function ledStrip(text) {
    if (ledCache.text === text) return ledCache;
    const font = "700 7px Arial, sans-serif", m = document.createElement("canvas").getContext("2d");
    m.font = font; const w = Math.ceil(m.measureText(text).width) + 2;
    const src = document.createElement("canvas"); src.width = w; src.height = 7;
    const s = src.getContext("2d", { willReadFrequently: true });
    s.font = font; s.textBaseline = "top"; s.fillStyle = "#fff"; s.fillText(text, 1, 0);
    const d = s.getImageData(0, 0, w, 7).data, K = 6, c = document.createElement("canvas"); c.width = w * K; c.height = 7 * K;
    const q = c.getContext("2d");
    for (let y = 0; y < 7; y++) for (let x = 0; x < w; x++) {
      const on = d[(y * w + x) * 4 + 3] > 110;
      q.fillStyle = on ? "#ffc35a" : "rgba(255,170,60,.07)";
      q.beginPath(); q.arc(x * K + K / 2, y * K + K / 2, on ? K * .42 : K * .3, 0, Math.PI * 2); q.fill();
    }
    return Object.assign(ledCache, { text, c, w });
  }
  function marquee(g, vs) {
    const text = `${t("Cofre da equipa")}  ·  ${t("{n} barras de ouro", { n: vs.total })}  ·  ${t("{n} esta semana", { n: vs.week })}  ·  ${t("{n} hoje", { n: vs.today })}  ·  ${t("Cada missão concluída é uma barra")}  ·  `;
    const led = ledStrip(text.toUpperCase()), [sx, sy] = P(0, VAULT.y1, VAULT.z1);
    g.save(); g.setTransform(S, -.5 * S, 0, S, SX(sx), SY(sy));
    g.beginPath(); g.rect(4, 1, 86, 7); g.clip();
    const off = (clock * 12) % led.w;
    g.drawImage(led.c, 4 - off, 1, led.w, 7); g.drawImage(led.c, 4 - off + led.w, 1, led.w, 7);
    g.restore();
  }
  // a star of light on a gold bar now and then
  function glints(g, vs) {
    if (!vs.total) return;
    const n = Math.floor(clock * 1.3), a = 1 - ((clock * 1.3) % 1);
    for (let i = 0; i < 2; i++) {
      const k = n * 2 + i, onB = vs.total > 30 && rnd(k) > .5;
      const [px, py] = P(onB ? 4.85 + (rnd(k + 1) - .5) * 1 : 2.5 + (rnd(k + 1) - .5) * 1.2, onB ? 13.7 : 12.5, 5 + rnd(k + 2) * 6);
      const X = SX(px), Y = SY(py), r = 3.2 * S * a;
      g.globalAlpha = a * .9; g.strokeStyle = "#fff6d0"; g.lineWidth = .5 * S;
      g.beginPath(); g.moveTo(X - r, Y); g.lineTo(X + r, Y); g.moveTo(X, Y - r); g.lineTo(X, Y + r); g.stroke();
    }
    g.globalAlpha = 1;
  }
  // the searchlight: it follows its aim softly; when a mission comes in it swings to the office wall and turns gold
  function beamGoal() {
    if (clock - signal < 3.4) return [3.7, 0, 50];
    const s = Math.sin(clock * .21) * .5 + .5;
    return [7 + s * 23, 0, 56 + Math.sin(clock * .5) * 4];
  }
  function stepBeam(dt) {
    const lit = clock - signal < 3.4, goal = beamGoal(), k = 1 - Math.exp(-dt * (lit ? 6 : 1.5));
    LAMP.aim = LAMP.aim.map((v, i) => v + (goal[i] - v) * k);
    LAMP.gold += ((lit ? 1 : 0) - LAMP.gold) * k;
  }
  function searchBeam(g) {
    const [lx, ly] = P(LAMP.x, LAMP.y, 13), [tx, ty] = P(...LAMP.aim);
    const X0 = SX(lx), Y0 = SY(ly), X1 = SX(tx), Y1 = SY(ty), len = Math.hypot(X1 - X0, Y1 - Y0) || 1;
    const nx = -(Y1 - Y0) / len, ny = (X1 - X0) / len, w0 = 2.2 * S, w1 = 28 * S;
    const c = LAMP.gold > .5 ? "255,226,140" : "195,218,255", a = .17 + LAMP.gold * .17;
    const gr = g.createLinearGradient(X0, Y0, X1, Y1);
    gr.addColorStop(0, `rgba(${c},${a.toFixed(3)})`); gr.addColorStop(.85, `rgba(${c},${(a * .3).toFixed(3)})`); gr.addColorStop(1, `rgba(${c},0)`);
    g.fillStyle = gr; g.beginPath();
    g.moveTo(X0 + nx * w0, Y0 + ny * w0); g.lineTo(X1 + nx * w1, Y1 + ny * w1); g.lineTo(X1 - nx * w1, Y1 - ny * w1); g.lineTo(X0 - nx * w0, Y0 - ny * w0);
    g.closePath(); g.fill();
    glow(g, tx, ty, 22, LAMP.gold > .5 ? "#ffe28c" : "#c3daff", a * 1.4);
    glow(g, lx, ly, 7, "#ffffff", .55);
  }
  const LIGHT = { work: NEON.green, start: "#dfe8f2", wait: NEON.amber, help: NEON.red, pause: "#7d8590", done: NEON.green, fail: NEON.red };
  const COLD = "#dfe8f2";   // the bunker's light: cold white, colour only for the states and the partners
  function lights(g) {
    g.globalCompositeOperation = "lighter";
    for (const d of DESKS) {
      const mode = deskMode(d);
      if (mode === "off") continue;
      glow(g, ...P(d.x + 1, d.y + .45, 24), 30, COLD, .26 + Math.sin(clock * 6 + d.i) * .03);
      glow(g, ...P(d.x + 1, d.y + 1.1, 0), 24, LIGHT[mode], .2);
    }
    glow(g, ...P(.1, 4.8, 38), 34, COLD, .16 + (Math.floor(clock * 2) % 2) * .03);
    glow(g, ...P(.1, 9, 30), 26, "#ffe9a0", .12 + Math.sin(clock * .7) * .03);
    glow(g, ...P(2.5, .4, 30), 20, "#dbe9ff", .22);
    glow(g, ...P((FALL.x0 + FALL.x1) / 2, .2, 26), 28, "#9fd8ff", .18 + Math.sin(clock * 3) * .02);
    // the stands: a light running round each edge
    CARS.forEach((c, ci) => {
      const out = standOutline(c), n = out.length, on = hoverCar === c || (panel && panel.ref === c);
      const head = Math.floor(((clock * .35 + ci * .25) % 1) * n);
      g.strokeStyle = on ? "#ffffff" : c.accent; g.lineWidth = (on ? 2.2 : 1.6) * S; g.globalAlpha = on ? .9 : .65; g.lineCap = "round";
      g.beginPath();
      for (let i = 0; i < 9; i++) { const [x, y] = out[(head + i) % n], [px, py] = P(x, y, STAND.h); i ? g.lineTo(SX(px), SY(py)) : g.moveTo(SX(px), SY(py)); }
      g.stroke();
      if (on) { g.globalAlpha = .45; g.lineWidth = 1.2 * S; g.beginPath(); out.forEach(([x, y], i) => { const [px, py] = P(x, y, STAND.h); i ? g.lineTo(SX(px), SY(py)) : g.moveTo(SX(px), SY(py)); }); g.closePath(); g.stroke(); }
      g.globalAlpha = 1;
    });
    // the vault: gold from the strongroom on the wall and the floor, the gold on the pallets, the marquee, a glint now and then
    const vs = vaultStats(), hot = hoverVault || (panel && panel.kind === "vault"), dep = clock - vaultFlash;
    const gold = .3 + Math.sin(clock * 1.7) * .05 + (dep < 1.4 ? .4 * (1 - dep / 1.4) : 0) + (hot ? .14 : 0);
    glow(g, ...P(.2, 14.95, 27), 36, "#ffcf5a", gold);
    glow(g, ...P(1.5, 14.6, 0), 30, "#ffb84d", gold * .5);
    if (vs.total) glow(g, ...P(2.5, 12.55, 8), 20, "#ffcf5a", .14 + Math.min(.12, vs.total / 300));
    if (vs.total > 30) glow(g, ...P(4.85, 13.75, 8), 18, "#ffcf5a", .14);
    marquee(g, vs);
    glints(g, vs);
    for (const x of [.1, 6.9]) glow(g, ...P(x, GD, 12), 9, vaultOpen ? NEON.green : NEON.red, .45);
    // the bar's light under its lip and its lamps; the river glowing from below; the lookout's beacons and its searchlight
    for (const x of BAR.lamps) { glow(g, ...P(x, 11.9, 2), 13, NEON.amber, .2); glow(g, ...P(x, 11.45, 33), 16, "#ffe2a8", .3); }
    for (let y = 1; y < GD; y += 2) glow(g, ...P(16.5, y, -3), 12, "#3fa9ff", .1 + Math.sin(clock * 2 + y) * .025);
    glow(g, ...P(16.5, GD, -38), 24, "#9fd8ff", .15);
    BEACONS.forEach(([x, y], i) => { if (Math.floor(clock * 1.4 + i * .5) % 2) glow(g, ...P(x, y, 1), 6, NEON.red, .75); });
    searchBeam(g);
    // the bat-signal, thrown on the office wall by the searchlight when a mission comes in
    const since = clock - signal;
    if (since < 3.4) {
      const a = Math.min(1, since / .35) * Math.min(1, (3.4 - since) / .8) * (Math.floor(since * 14) % 7 === 0 ? .6 : 1);
      const [sx, sy] = P(1.6, 0, 58);
      g.save(); g.globalAlpha = a;
      g.setTransform(S, S * .5, 0, S, SX(sx), SY(sy));
      const gr = g.createRadialGradient(34, 8, 0, 34, 8, 30); gr.addColorStop(0, "rgba(255,240,170,.85)"); gr.addColorStop(.7, "rgba(255,220,110,.45)"); gr.addColorStop(1, "rgba(255,210,80,0)");
      g.fillStyle = gr; g.beginPath(); g.ellipse(34, 8, 30, 15, 0, 0, Math.PI * 2); batPath(g, 34, 8.5, 22, 20, true); g.fill("evenodd");
      g.restore();
    }
    for (const a of agents) {
      if (!a.head) continue;
      const [fx, fy] = P(a.x, a.y), on = a === hovered || a === focus || (panel && panel.ref === a), busy = a.job && a.mode !== "done";
      if ((a.seated || a.chairAt) && !on) continue;
      g.globalAlpha = on ? .95 : busy ? .6 : .3;
      g.strokeStyle = a.color; g.lineWidth = (on ? 1.6 : 1.1) * S;
      g.beginPath(); g.ellipse(SX(fx), SY(fy), 7.5 * S, 3.2 * S, 0, 0, Math.PI * 2); g.stroke();
      g.globalAlpha = 1;
    }
    g.globalCompositeOperation = "source-over";
  }

  // ================================================================ labels (sharp, on the big canvas)
  const WORD = { work: ["a trabalhar", NEON.green], start: ["a começar", NEON.cyan], wait: ["à tua espera", NEON.amber], help: ["precisa de ajuda", NEON.red],
    pause: ["em pausa", "#9aa2ab"], go: ["vai trabalhar", NEON.cyan], done: ["feito", NEON.green], fail: ["falhou", NEON.red] };
  const idleWord = (a) => (a.path.length ? "a caminho" : a.pose === "sleep" ? "a dormir" : a.spot ? a.spot.word : "livre");
  function stateOf(a) { return !a.job ? "idle" : a.mode === "done" ? (a.done === "ok" ? "done" : "fail") : a.mode === "toDesk" ? "go" : a.job.state; }
  // each partner has a quiet colour of their own, apart from the colours of the states
  const PARTNERS = [["kovel", "Kovel", "#a99bff"], ["marco", "Marco", "#69b4ff"], ["david", "David", "#f28fb8"]];
  function partnerOf(name) {
    const low = String(name || "").toLowerCase(), p = PARTNERS.find(([k]) => low.includes(k));
    return p ? { id: p[0], name: p[1], color: p[2] } : { id: "", name: name || "", color: "#c9d1dc" };
  }
  const shortModel = (m) => { const x = String(m || "").match(/opus|sonnet|haiku|fable/i); return x ? x[0][0].toUpperCase() + x[0].slice(1).toLowerCase() : ""; };
  const kTokens = (n) => (n > 0 ? (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.max(1, Math.round(n / 1e3))}k`) + " tok" : "");
  function labelOf(a) {
    if (!a.job) return { pill: true, name: a.name, word: t(idleWord(a)), color: a.color };
    const st = stateOf(a), [word, color] = WORD[st], j = a.job;
    const chips = [...(j.skills || []).map((s) => "/" + s), ...(j.subagents || []).filter((x) => x.state === "working").map((x) => x.kind), ...(j.type === "sub" ? [j.kind] : [])];
    return { name: a.name, sector: t(a.what), word: t(st === j.state && j.word ? j.word : word), color, title: j.title, now: j.action || "",
      ask: partnerOf(j.who), meta: [j.project, j.since ? ago(j.since) : "", shortModel(j.model), kTokens(j.tokens)].filter(Boolean).join(" · "),
      chips: [...new Set(chips.filter(Boolean))], progress: j.type === "task" && j.progress > 0 ? j.progress : null };
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
    const id = `${dpr * LS}|${L.pill ? 1 : 0}|${L.name}|${L.word}|${L.title || ""}|${L.now || ""}|${L.ask ? L.ask.name : ""}|${L.meta || ""}|${(L.chips || []).join(",")}|${L.progress ?? ""}`;
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
    const maxW = 200 * k, pad = 10 * k, inner = maxW - 2 * pad;
    g.font = `500 ${10.5 * k}px ${FONT}`; const lines = wrap(g, L.title, inner, 2);
    const tw = Math.max(...lines.map((s) => g.measureText(s).width));
    g.font = `700 ${11 * k}px ${FONT}`; const nw = g.measureText(L.name).width;
    g.font = `500 ${9 * k}px ${FONT}`; const sw = g.measureText(` · ${L.sector}`).width;
    g.font = `700 ${8.5 * k}px ${FONT}`; const ww = g.measureText(L.word.toUpperCase()).width;
    g.font = `500 ${9.5 * k}px ${FONT}`; const now = L.now ? clip(g, `↳ ${L.now}`, inner) : "", nowW = now ? g.measureText(now).width : 0;
    g.font = `700 ${9.5 * k}px ${FONT}`; const aw = g.measureText(L.ask.name).width + 9 * k;
    g.font = `500 ${9.5 * k}px ${FONT}`; const meta = L.meta ? clip(g, ` · ${L.meta}`, inner - aw) : "", mw = meta ? g.measureText(meta).width : 0;
    // the skills and subagents in use: as many pills as fit on one line, then "+n"
    g.font = `600 ${8.5 * k}px ${FONT}`;
    const chips = [];
    let cw = 0;
    for (let i = 0; i < L.chips.length; i++) {
      const w = g.measureText(L.chips[i]).width + 10 * k, more = i < L.chips.length - 1 ? g.measureText(`+${L.chips.length - i}`).width + 10 * k : 0;
      if (cw + w + (more ? more + 4 * k : 0) > inner && i < L.chips.length - 1) { const tail = `+${L.chips.length - i}`; chips.push({ s: tail, w: g.measureText(tail).width + 10 * k, more: true }); cw += chips[chips.length - 1].w; break; }
      chips.push({ s: L.chips[i], w }); cw += w + 4 * k;
    }
    const w = Math.ceil(Math.min(maxW, Math.max(tw, nw + sw + ww + 20 * k, nowW, aw + mw, cw) + 2 * pad));
    const h = Math.round((27 + lines.length * 13.5 + (now ? 13 : 0) + 14 + (chips.length ? 16 : 0) + (L.progress != null ? 7 : 0) + 4) * k);
    return { w, h, lines, now, meta, aw, chips, nw, ww };
  }
  function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); }
  function paintLabel(g, it, m, x, y) {
    const k = dpr * LS, L = it.L;
    g.strokeStyle = L.pill ? "rgba(255,255,255,.16)" : L.color; g.globalAlpha = L.pill ? 1 : .55; g.lineWidth = k;
    g.beginPath(); g.moveTo(it.ax, y + m.h); g.lineTo(it.ax, it.ay); g.stroke(); g.globalAlpha = 1;
    if (L.pill) {
      rr(g, x, y, m.w, m.h, m.h / 2); g.fillStyle = "rgba(6,8,13,.8)"; g.fill();
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
    rr(g, x, y, m.w, m.h, 9 * k); g.fillStyle = "rgba(6,8,13,.94)"; g.fill();
    g.strokeStyle = L.color; g.globalAlpha = .55; g.lineWidth = k; g.stroke(); g.globalAlpha = 1;
    g.fillStyle = L.color; g.fillRect(x + pad, y + 6 * k, 14 * k, 2 * k);
    g.textBaseline = "alphabetic";
    g.font = `700 ${11 * k}px ${FONT}`; g.fillStyle = "#ffffff"; g.fillText(L.name, x + pad, y + 22 * k);
    g.font = `500 ${9 * k}px ${FONT}`; g.fillStyle = "#8b939e"; g.fillText(` · ${L.sector}`, x + pad + m.nw, y + 22 * k);
    g.font = `700 ${8.5 * k}px ${FONT}`; g.fillStyle = L.color; g.textAlign = "right";
    g.fillText(L.word.toUpperCase(), x + m.w - pad, y + 21.5 * k);
    g.textAlign = "left";
    g.font = `500 ${10.5 * k}px ${FONT}`; g.fillStyle = "#e3e8ef";
    m.lines.forEach((s, i) => g.fillText(s, x + pad, y + (37 + i * 13.5) * k));
    let my = y + (37 + m.lines.length * 13.5 + 1) * k;
    g.font = `500 ${9.5 * k}px ${FONT}`;
    if (m.now) { g.fillStyle = "#a9b6c6"; g.fillText(m.now, x + pad, my); my += 13 * k; }
    // who asked, in their colour, then where, since when, the model and the tokens
    g.fillStyle = L.ask.color; g.beginPath(); g.arc(x + pad + 2.5 * k, my - 3.3 * k, 2.5 * k, 0, Math.PI * 2); g.fill();
    g.font = `700 ${9.5 * k}px ${FONT}`; g.fillText(L.ask.name, x + pad + 9 * k, my);
    g.font = `500 ${9.5 * k}px ${FONT}`; g.fillStyle = "#7f8894"; g.fillText(m.meta, x + pad + m.aw, my);
    if (m.chips.length) {
      let cx = x + pad;
      const cy = my + 5 * k;
      g.font = `600 ${8.5 * k}px ${FONT}`; g.textBaseline = "middle";
      for (const c of m.chips) {
        rr(g, cx, cy, c.w, 12 * k, 6 * k); g.fillStyle = c.more ? "rgba(255,255,255,.04)" : "rgba(220,230,242,.08)"; g.fill();
        g.strokeStyle = "rgba(220,230,242,.22)"; g.lineWidth = k * .8; g.stroke();
        g.fillStyle = "#cfd8e3"; g.fillText(c.s, cx + 5 * k, cy + 6.5 * k);
        cx += c.w + 4 * k;
      }
      g.textBaseline = "alphabetic";
      my += 16 * k;
    }
    if (L.progress != null) {
      const bw = m.w - 2 * pad, by = my + 6 * k;
      rr(g, x + pad, by, bw, 3 * k, 2 * k); g.fillStyle = "rgba(255,255,255,.08)"; g.fill();
      rr(g, x + pad, by, Math.max(3 * k, bw * Math.min(1, L.progress / 100)), 3 * k, 2 * k); g.fillStyle = L.color; g.fill();
    }
  }
  function labels(g) {
    const list = [];
    for (const a of agents) if (a.head) list.push({ a, L: labelOf(a), ax: SX(a.head[0]), ay: SY(a.head[1] - 2) });
    list.sort((p, q) => (p.L.pill ? 1 : 0) - (q.L.pill ? 1 : 0) || q.ay - p.ay);
    const placed = [], k = dpr * LS;
    carPlates(g, placed);
    for (const it of list) {
      it.a.label = null;
      if (it.ax < -40 * k || it.ax > cv.width + 40 * k || it.ay < -20 * k || it.ay > cv.height + 60 * k) continue;
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
      if (it.L.pill && home - y > 26 * k && it.a !== hovered && it.a !== focus) continue;
      placed.push({ x, y, w: m.w, h: m.h });
      it.a.label = { x, y, w: m.w, h: m.h };
      paintLabel(g, it, m, x, y);
    }
  }
  // the cars' plates: what each one is, and the project it stands for
  function carPlates(g, placed) {
    const k = dpr * LS;
    for (const c of CARS) {
      const back = c.cy < 5;
      const [px, py] = back ? P(c.cx, 0, 30) : P(c.cx + 1.1, c.cy + STAND.hy, -1);
      const x = SX(px), y = SY(py);
      if (x < -120 * k || x > cv.width + 120 * k || y < -30 * k || y > cv.height + 40 * k) { c.plate = null; continue; }
      g.font = `700 ${11 * k}px ${DISPLAY}`; const nw = g.measureText(c.name).width;
      g.font = `700 ${7.5 * k}px ${FONT}`; const mw = g.measureText(c.maker.toUpperCase()).width;
      const proj = c.project ? c.project : t("projeto por atribuir");
      g.font = `500 ${9 * k}px ${FONT}`; const pw = g.measureText(proj).width;
      const w = Math.ceil(Math.max(nw, mw + 8 * k, pw) + 26 * k), h = Math.round(46 * k), bx = Math.round(x - w / 2), by = Math.round(back ? y - h : y + 4 * k);
      const on = hoverCar === c || (panel && panel.ref === c);
      g.save(); g.shadowColor = c.accent; g.shadowBlur = (on ? 18 : 8) * k;
      rr(g, bx, by, w, h, 8 * k); g.fillStyle = "rgba(6,8,13,.9)"; g.fill(); g.restore();
      const edge = g.createLinearGradient(bx, by, bx + w, by);
      edge.addColorStop(0, "rgba(255,255,255,.08)"); edge.addColorStop(.5, "rgba(255,255,255,.55)"); edge.addColorStop(1, "rgba(255,255,255,.08)");
      rr(g, bx, by, w, h, 8 * k); g.strokeStyle = edge; g.lineWidth = k; g.stroke();
      g.fillStyle = c.accent; g.fillRect(bx + 12 * k, by + 7 * k, 3 * k, 8 * k);
      g.textBaseline = "alphabetic";
      g.font = `700 ${7.5 * k}px ${FONT}`; g.fillStyle = "#9aa2ab"; g.fillText(c.maker.toUpperCase(), bx + 19 * k, by + 14 * k);
      g.font = `700 ${11 * k}px ${DISPLAY}`; g.fillStyle = "#ffffff"; g.fillText(c.name, bx + 12 * k, by + 28 * k);
      g.font = `500 ${9 * k}px ${FONT}`; g.fillStyle = c.project ? NEON.green : "#7f8894"; g.fillText(proj, bx + 12 * k, by + 40 * k);
      c.plate = { x: bx, y: by, w, h };
      placed.push(c.plate);
    }
    const vs = vaultStats(), [vx, vy] = P(1.6, 17.2, -24);
    vaultPlate = plateAt(g, SX(vx), SY(vy), t("Agente AMG"), t("Cofre"), t("{n} barras · {w} esta semana", { n: vs.total, w: vs.week }), hoverVault || (panel && panel.kind === "vault"));
    if (vaultPlate) placed.push(vaultPlate);
  }
  // a plate hanging under a point (x, y on the big canvas): small capitals, a name, a gold line
  function plateAt(g, x, y, maker, name, line, on) {
    const k = dpr * LS, accent = "#ffcf5a";
    if (x < -140 * k || x > cv.width + 140 * k || y < -40 * k || y > cv.height + 40 * k) return null;
    g.font = `700 ${11 * k}px ${DISPLAY}`; const nw = g.measureText(name).width;
    g.font = `700 ${7.5 * k}px ${FONT}`; const mw = g.measureText(maker.toUpperCase()).width;
    g.font = `500 ${9 * k}px ${FONT}`; const lw = g.measureText(line).width;
    const w = Math.ceil(Math.max(nw, mw + 8 * k, lw) + 26 * k), h = Math.round(46 * k), bx = Math.round(x - w / 2), by = Math.round(y + 4 * k);
    g.save(); g.shadowColor = accent; g.shadowBlur = (on ? 18 : 8) * k;
    rr(g, bx, by, w, h, 8 * k); g.fillStyle = "rgba(10,8,4,.92)"; g.fill(); g.restore();
    const edge = g.createLinearGradient(bx, by, bx + w, by);
    edge.addColorStop(0, "rgba(255,207,90,.1)"); edge.addColorStop(.5, "rgba(255,226,150,.7)"); edge.addColorStop(1, "rgba(255,207,90,.1)");
    rr(g, bx, by, w, h, 8 * k); g.strokeStyle = edge; g.lineWidth = k; g.stroke();
    g.fillStyle = accent; g.fillRect(bx + 12 * k, by + 7 * k, 3 * k, 8 * k);
    g.textBaseline = "alphabetic";
    g.font = `700 ${7.5 * k}px ${FONT}`; g.fillStyle = "#b9a46a"; g.fillText(maker.toUpperCase(), bx + 19 * k, by + 14 * k);
    g.font = `700 ${11 * k}px ${DISPLAY}`; g.fillStyle = "#ffffff"; g.fillText(name, bx + 12 * k, by + 28 * k);
    g.font = `500 ${9 * k}px ${FONT}`; g.fillStyle = accent; g.fillText(line, bx + 12 * k, by + 40 * k);
    return { x: bx, y: by, w, h };
  }

  // ================================================================ one frame
  const FURN = [];
  const furn = (x, y, draw) => FURN.push({ k: x + y + 1, x, draw });
  // the wings: k is the x + y of the point that decides what covers what (a wide piece is cut in slices, one per tile)
  const item = (k, x, draw) => FURN.push({ k, x, draw });
  // a post is two tiles wide: ordered by its middle, so whoever walks behind it is drawn first and whoever is in front, after
  DESKS.forEach((d) => { item(d.x + d.y + 2, d.x + 1, (g) => desk(g, d)); item(d.x + d.y + 2.6, d.x + 1, (g) => chair(g, d)); });
  // what never changes is drawn once into its own picture (the area: x0, y0, x1, y1 on the floor and how high it goes)
  const still = (key, area, paint) => (g) => cachedDraw(g, key, area, paint);
  SOFA.forEach((y) => furn(0, y, still("sofa" + y, [0, y, 1, y + 1, 22], (q) => sofa(q, y))));
  CHAIRS.forEach(([x, y]) => furn(x, y, (g) => armchair(g, x, y)));
  ROCKS.forEach(([x, y]) => furn(x, y, still(`rock${x},${y}`, [x, y, x + 1, y + 1, 38], (q) => rock(q, x, y))));
  furn(2, 0, still("suit", [2, 0, 3, 1, 42], suitCase)); furn(4, 0, coffee);
  furn(2, 5, still("chess", [2, 5, 3, 6, 12], table));
  item(15.95, 2.5, (g) => { const n = Math.min(30, vaultStats().total); cachedDraw(g, "goldA" + n, [1.6, 12.05, 3.4, 13.05, 16], (q) => goldPile(q, 2.5, 12.55, n)); });
  item(19.5, 4.85, (g) => { const n = clamp(vaultStats().total - 30, 0, 30); cachedDraw(g, "goldB" + n, [3.95, 13.25, 5.75, 14.25, 16], (q) => goldPile(q, 4.85, 13.75, n)); });
  item(18.3, 2.4, (g) => { const n = Math.min(24, vaultStats().week); cachedDraw(g, "cash" + n, [1.55, 14.5, 3.25, 15.5, 14], (q) => cashPile(q, 2.4, 15, n)); });
  item(18, 5.9, counter);
  for (let x = 0; x < 7; x++) item(x + .5 + GD + .02, x + .5, (g) => laser(g, x));
  for (let i = 0; i < 5; i++) { const x0 = i ? 9 + i : BAR.x0, x1 = i === 4 ? BAR.x1 : 10 + i; item((x0 + x1) / 2 + 11.5, (x0 + x1) / 2, still("bar" + i, [x0 - .1, 11, x1 + .1, 11.9, 134], (q) => barSlice(q, x0, x1))); }
  item(25.5, 11.5, still("champagne", [11, 13, 12, 14, 24], cocktailTable));
  item(41.5, 27.5, searchlight);
  item(37.7, 25.6, telescope);
  for (const [, y1] of BRIDGES) item(16.5 + y1 + .3, 16.5, (g) => bridgeRail(g, y1));
  for (let y = 0; y < D; y++) for (let x = 0; x < W; x++) {
    const c = tile(x, y), r = RAIL[c];
    if (!r) continue;
    const add = (a, b) => item((a[0] + b[0]) / 2 + (a[1] + b[1]) / 2 + .02, (a[0] + b[0]) / 2,
      still(`pane${a},${b}`, [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), 11], (q) => pane(q, a, b, c === "p" ? 6 : 9, r[0], r[1])));
    if (!solid(x, y + 1)) add([x, y + 1], [x + 1, y + 1]);
    if (!solid(x + 1, y)) add([x + 1, y], [x + 1, y + 1]);
    if (x > 0 && !solid(x - 1, y)) add([x, y], [x, y + 1]);
    if (y > 0 && !solid(x, y - 1)) add([x, y], [x + 1, y]);
  }

  function drawAgent(g, a) {
    const [fx, fy] = P(a.x, a.y, tile(Math.floor(a.x), Math.floor(a.y)) === "b" ? 2 : 0);   // on the bridge they walk on its deck
    let pose = a.path.length && !a.wait ? "walk" : a.pose, dir = a.dir;
    let seat = 0;
    if (a.seated) {
      seat = 9; dir = "ne";
      pose = a.mode === "done" ? (a.done === "ok" ? "deskDone" : "deskWait") : !a.job || a.job.state === "work" || a.job.state === "start" ? "desk" : "deskWait";
    } else if (!a.path.length && a.spot && a.spot.seat && (pose === "sit" || pose === "sleep")) seat = a.spot.seat;
    if (pose === "drink") { if (clock < a.brewUntil) { pose = "play"; dir = "ne"; } else dir = "sw"; }
    if (!seat) oval(g, fx, fy, 5, 2, "rgba(0,0,0,.45)");
    const fr = window.CrewPeople.sprite(a.look, a.id, { dir, pose, tm: a.phase, hop: a.hop, seat });
    const x = Math.round(fx * WS) / WS - fr.ax / WS, y = Math.round(fy * WS) / WS - fr.ay / WS;
    g.drawImage(fr.c, x, y, fr.c.width / WS, fr.c.height / WS);
    a.head = [fx, y + fr.top / WS];
    a.box = [fx - 7, a.head[1] - 2, fx + 7, fy + 1];
  }
  const DIAMOND = { work: NEON.green, go: NEON.green, start: COLD, wait: NEON.amber, help: NEON.red, pause: "#7d8590", done: NEON.green, fail: NEON.red, idle: "#7d8794" };
  function bubbles(g) {
    for (const a of agents) {
      if (!a.head) continue;
      { const c = DIAMOND[stateOf(a)], cx = a.head[0], cy = a.head[1] - 5 + Math.sin(clock * 2.2 + a.i) * .6;
        g.fillStyle = c; g.beginPath(); g.moveTo(cx, cy - 2.6); g.lineTo(cx + 1.6, cy); g.lineTo(cx, cy + 2.6); g.lineTo(cx - 1.6, cy); g.closePath(); g.fill();
        g.fillStyle = "rgba(255,255,255,.55)"; g.beginPath(); g.moveTo(cx, cy - 2.6); g.lineTo(cx + 1.6, cy); g.lineTo(cx, cy); g.closePath(); g.fill(); }
      let b = a.bubble && a.bubble.until > clock ? a.bubble : null;
      if (!b && a.seated && a.mode === "work" && a.job) {
        b = { wait: { g: "?", c: NEON.amber }, help: { g: "!", c: NEON.red }, start: { g: "dots", c: NEON.cyan }, pause: { g: "pause", c: "#6b7380" } }[a.job.state];
        if (b && (a.job.state === "wait" || a.job.state === "help") && Math.floor(clock * 2) % 4 === 3) b = null;
      }
      if (b) bubble(g, a.head[0] + 5, a.head[1] + 5, b.g, b.c);
    }
  }
  const flicker = () => { const c = clock % 13; return (c > 11.6 && c < 11.72) || (c > 11.84 && c < 11.9); };

  function draw() {
    const g = wg;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, world.width, world.height);
    g.setTransform(WS, 0, 0, WS, 0, 0);
    g.imageSmoothingEnabled = false;
    batcomputer(g); g.setTransform(WS, 0, 0, WS, 0, 0);
    waterfall(g); g.setTransform(WS, 0, 0, WS, 0, 0);
    mouthFall(g); g.setTransform(WS, 0, 0, WS, 0, 0);
    riverFlow(g);
    vaultOpen = agents.some((a) => a.x < 7.6 && Math.abs(a.y - GD) < 1.3);
    const items = FURN.slice();
    for (const a of agents) if (!a.seated && !(a.chairAt && !a.path.length)) items.push({ k: a.x + a.y, x: a.x + .01, draw: () => drawAgent(g, a) });
    items.sort((p, q) => p.k - q.k || p.x - q.x);
    for (const it of items) it.draw(g);
    drawParticles(g);
    bubbles(g);
    bats(g);
    g2.globalCompositeOperation = "source-over";
    g2.fillStyle = "#030407"; g2.fillRect(0, 0, cv.width, cv.height);
    g2.imageSmoothingEnabled = cam.w * BS > cv.width * 1.02;
    g2.drawImage(bg, cam.x * BS, cam.y * BS, cam.w * BS, cam.h * BS, 0, 0, cv.width, cv.height);
    g2.globalAlpha = flicker() ? .45 : 1;
    g2.drawImage(sign.c, SX(sign.box.x), SY(sign.box.y), sign.box.w * S, sign.box.h * S);
    g2.globalAlpha = 1;
    g2.imageSmoothingEnabled = false;
    g2.drawImage(world, cam.x * WS, cam.y * WS, cam.w * WS, cam.h * WS, 0, 0, cv.width, cv.height);
    lights(g2);
    g2.fillStyle = vignette; g2.fillRect(0, 0, cv.width, cv.height);
    labels(g2);
  }

  const ease = (x) => (x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  function stepCamera(dt) {
    if (!camAnim.to) return;
    camAnim.t = Math.min(1, camAnim.t + dt / .9);
    const e = ease(camAnim.t), f = camAnim.from, to = camAnim.to;
    cam.x = f.x + (to.x - f.x) * e; cam.y = f.y + (to.y - f.y) * e; cam.w = f.w + (to.w - f.w) * e; cam.h = cam.w / ASPECT;
    S = cv.width / cam.w;
    if (camAnim.t >= 1) camAnim.to = null;
  }
  function frame(now) {
    raf = 0;
    if (!stage || !stage.isConnected) { stop(); return; }
    if (document.hidden || !onScreen) { last = 0; return; }
    const dt = last ? Math.min(.25, (now - last) / 1000) : 0;
    last = now; clock += dt;
    stepCamera(dt);
    stepBeam(dt);
    for (const a of agents) step(a, dt);
    tickParticles(dt);
    if (bg) draw();
    const busy = camAnim.to || agents.some((a) => a.path.length || a.hop > 0) || particles.some((p) => p.grav || p.kind === "coin") || clock - signal < 3.4;
    timer = setTimeout(() => { timer = 0; raf = requestAnimationFrame(frame); }, busy ? 1000 / 26 : 1000 / 12);
  }
  function wake() {
    if (raf || !stage || !stage.isConnected) return;
    clearTimeout(timer); timer = 0; last = 0;
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    clearTimeout(timer); timer = 0; if (raf) cancelAnimationFrame(raf); raf = 0;
    clearInterval(panelTimer); panelTimer = 0; clearTimeout(resizeLater);
    if (ro) ro.disconnect(); if (io) io.disconnect(); ro = io = null;
    document.removeEventListener("visibilitychange", wake);
    document.removeEventListener("keydown", onKey);
  }
  function goView(name) {
    if (!VIEWS[name]) return;
    view = name; sessionStorage.setItem("crew.view", name);
    camAnim.from = { x: cam.x, y: cam.y, w: cam.w }; camAnim.to = { ...VIEWS[name] }; camAnim.t = 0;
    stage.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("on", b.dataset.view === name));
    wake();
  }

  // a new size redraws the cave and the cars: wait until the window stops changing
  let resizeLater = 0;
  function resize(now) {
    if (!stage || !stage.isConnected) return;
    if (!now && bg) { clearTimeout(resizeLater); resizeLater = setTimeout(() => resize(true), 160); return; }
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = cv.clientWidth || stage.clientWidth;
    if (!cssW) return;
    const w = Math.round(cssW * dpr), h = Math.round((cssW / ASPECT) * dpr);
    if (cv.width === w && cv.height === h && bg) return;
    cv.width = w; cv.height = h; cv.style.height = `${Math.round(cssW / ASPECT)}px`;
    S = w / cam.w;
    LS = Math.max(.8, Math.min(1, cssW / 1000));
    buildBg();
    draw();
    wake();
  }

  // ================================================================ hover, click, drag
  function toLocal(e) {
    const r = cv.getBoundingClientRect();
    return [(e.clientX - r.left) * (cv.width / r.width), (e.clientY - r.top) * (cv.height / r.height)];
  }
  function hitTest(e) {
    const [mx, my] = toLocal(e);
    for (const a of agents) { const b = a.label; if (b && mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) return { agent: a }; }
    const front = [...agents].sort((p, q) => q.x + q.y - (p.x + p.y));
    for (const a of front) { const b = a.box; if (b && mx >= SX(b[0]) && mx <= SX(b[2]) && my >= SY(b[1]) && my <= SY(b[3])) return { agent: a }; }
    for (const c of [...CARS].reverse()) {
      const p = c.plate; if (p && mx >= p.x && mx <= p.x + p.w && my >= p.y && my <= p.y + p.h) return { car: c };
      const b = c.bounds; if (b && mx >= SX(b[0]) && mx <= SX(b[2]) && my >= SY(b[1]) && my <= SY(b[3])) return { car: c };
    }
    const vp = vaultPlate;
    if ((vp && mx >= vp.x && mx <= vp.x + vp.w && my >= vp.y && my <= vp.y + vp.h) || inVault(mx, my)) return { vault: true };
    return {};
  }
  // a point of the canvas on the vault: its floor (looked at a little above, where the gold is) or its wall
  function inVault(mx, my) {
    const sx = mx / S + cam.x, sy = my / S + cam.y, wy = (OX - sx) / 16, wz = OY + 8 * wy - sy;
    if (wy >= GD && wy <= D && wz >= 0 && wz <= WALL) return true;
    for (const h of [0, 8, 16]) {
      const u = (sx - OX) / 16, v = (sy + h - OY) / 8;
      if (tile(Math.floor((u + v) / 2), Math.floor((v - u) / 2)) === "v") return true;
    }
    return false;
  }
  const row = (label, value) => `<div><dt>${esc(t(label))}</dt><dd>${esc(value)}</dd></div>`;
  function tipHtml(hit) {
    if (hit.vault) {
      const vs = vaultStats();
      return `<div class="cr-tip-h"><div><span>${esc(t("Agente AMG"))}</span><b>${esc(t("Cofre"))}</b></div></div>
        <p class="cr-tip-idle"><i style="--c:#ffcf5a"></i>${esc(t("{n} barras de ouro · {w} esta semana", { n: vs.total, w: vs.week }))}</p><small>${esc(t("Clica para abrir o cofre"))}</small>`;
    }
    if (hit.car) {
      const c = hit.car;
      return `<div class="cr-tip-h"><div><span>${esc(c.maker)}</span><b>${esc(c.name)}</b></div></div>
        <p class="cr-tip-idle"><i style="--c:${c.accent}"></i>${esc(c.project || t("Ainda sem projeto"))}</p><small>${esc(t("Clica para ver o carro"))}</small>`;
    }
    const a = hit.agent;
    const head = `<div class="cr-tip-h"><img class="cr-px" src="${a.portrait}" alt=""><div><b>${esc(a.name)}</b><span>${esc(t(a.what))}</span></div></div>`;
    if (!a.job) return `${head}<p class="cr-tip-idle"><i style="--c:${a.color}"></i>${esc(t("À espera de trabalho"))} · ${esc(t(idleWord(a)))}</p><small>${esc(t("Clica para lhe dar uma missão"))}</small>`;
    const j = a.job, L = labelOf(a);
    return `${head}<em class="cr-tip-st" style="--c:${L.color}">${esc(L.word)}</em><p class="cr-tip-t">${esc(j.title)}</p>
      <dl>${row("Para", j.who)}${j.project ? row("Onde", j.project) : ""}${j.action ? row("Agora", j.action) : ""}${j.since ? row("Desde", fmt.ago(j.since)) : ""}</dl>
      <small>${esc(t("Clica para abrir a missão"))}</small>`;
  }
  let drag = null;
  function onMove(e) {
    if (drag) {
      const [mx, my] = toLocal(e), dx = mx - drag.mx, dy = my - drag.my;
      if (Math.abs(dx) + Math.abs(dy) > 6 * dpr) drag.moved = true;
      if (drag.moved) {
        camAnim.to = null;
        cam.x = clamp(drag.cx - dx / S, -40, LW + 40 - cam.w); cam.y = clamp(drag.cy - dy / S, -60, LH + 40 - cam.h);
        stage.classList.add("dragging"); $("cr-tip").hidden = true; wake();
        return;
      }
    }
    const hit = hitTest(e), tip = $("cr-tip"), target = hit.agent || hit.car || hit.vault || null;
    hovered = hit.agent || null; hoverCar = hit.car || null; hoverVault = !!hit.vault;
    stage.classList.toggle("point", !!target);
    if (!target) { tip.hidden = true; return; }
    tip.innerHTML = tipHtml(hit); tip.hidden = false;
    const r = stage.getBoundingClientRect();
    let x = e.clientX - r.left + 16, y = e.clientY - r.top + 14;
    if (x + tip.offsetWidth > r.width - 8) x = e.clientX - r.left - tip.offsetWidth - 16;
    if (y + tip.offsetHeight > r.height - 8) y = Math.max(8, r.height - tip.offsetHeight - 8);
    tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }
  function onDown(e) {
    if (e.button !== 0 || e.target !== cv) return;
    const [mx, my] = toLocal(e);
    drag = { mx, my, cx: cam.x, cy: cam.y, moved: false };
    try { cv.setPointerCapture(e.pointerId); } catch { /* not every pointer can be captured */ }
  }
  function onUp(e) {
    const was = drag; drag = null; stage.classList.remove("dragging");
    if (!was || was.moved) return;
    const hit = hitTest(e);
    if (hit.agent) openPanel({ kind: "agent", ref: hit.agent });
    else if (hit.car) openPanel({ kind: "car", ref: hit.car });
    else if (hit.vault) openPanel({ kind: "vault", ref: "vault" });
    else closePanel();
  }
  function onKey(e) { if (e.key === "Escape" && panel) closePanel(); }

  // ================================================================ the mission panel (AMG)
  let panelTimer = 0, panelTask = null;
  const pad2 = (n) => String(n).padStart(2, "0");
  function elapsed(iso) {
    if (!iso) return "—";
    const s = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
    return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor(s / 60) % 60)}:${pad2(s % 60)}`;
  }
  // a rev counter for the progress: 0–100 on a 240° dial, the last fifth in red. Without a figure the needle revs.
  function gauge(pct, color, live) {
    const pt = (deg, r) => [60 + Math.cos(deg * Math.PI / 180) * r, 60 + Math.sin(deg * Math.PI / 180) * r];
    const ticks = Array.from({ length: 11 }, (_, i) => {
      const deg = -210 + i * 24, [x1, y1] = pt(deg, i % 5 ? 41 : 37), [x2, y2] = pt(deg, 46);
      return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="${i >= 8 ? "red" : ""}"/>`;
    }).join("");
    const arc = (from, to, r) => { const [ax, ay] = pt(-210 + from * 2.4, r), [bx, by] = pt(-210 + to * 2.4, r); return `M${ax.toFixed(1)} ${ay.toFixed(1)} A${r} ${r} 0 ${(to - from) * 2.4 > 180 ? 1 : 0} 1 ${bx.toFixed(1)} ${by.toFixed(1)}`; };
    const p = Math.max(0, Math.min(100, pct || 0));
    return `<svg class="cp-gauge ${live ? "live" : ""}" viewBox="0 0 120 120" style="--c:${color};--a:${(-120 + p * 2.4).toFixed(1)}deg" aria-hidden="true">
      <circle cx="60" cy="60" r="56" class="bezel"/><circle cx="60" cy="60" r="50" class="face"/>
      <path d="${arc(80, 100, 47)}" class="redzone"/>${ticks}
      ${live ? "" : `<path d="${arc(0, Math.max(.6, p), 52)}" class="fill"/>`}
      <g class="needle"><line x1="60" y1="64" x2="60" y2="18"/></g><circle cx="60" cy="60" r="5" class="hub"/>
      <text x="60" y="90" class="val">${live ? "LIVE" : `${Math.round(p)}%`}</text></svg>`;
  }
  const stripes = () => `<div class="cp-stripes"><i></i><i></i><i></i></div>`;
  const doneBy = (a) => tasks.filter((x) => x.crew === a.id && x.status === "COMPLETED").sort((p, q) => String(q.completed_at).localeCompare(String(p.completed_at)));
  function memoryLine() {
    if (!memoryNotes) return t("A ler a Memória da equipa…");
    const done = memoryNotes.filter((m) => m.category === "TAREFAS").length;
    return t("Lê {n} notas da Memória antes de cada missão · {d} tarefas da equipa já lá estão", { n: memoryNotes.length, d: done });
  }
  function agentPanel(a) {
    const j = a.job, st = stateOf(a), color = st === "idle" ? a.color : (WORD[st] || [0, a.color])[1];
    const word = st === "idle" ? t("À espera de trabalho") : labelOf(a).word, done = doneBy(a);
    const head = `<header class="cp-head" style="--c:${a.color}">
        <div class="cp-portrait"><img class="cr-px" src="${a.figure}" alt=""></div>
        <div class="cp-id"><small>${esc(t("Agente"))} · ${esc(t(a.what))}</small><h3>${esc(a.name)}</h3><span class="cp-real">${esc(a.full)}${done.length ? ` · ${esc(t(done.length === 1 ? "1 missão feita" : "{n} missões feitas", { n: done.length }))}` : ""}</span>
          <span class="cp-state" style="--s:${color}"><i></i>${esc(word)}</span></div>
        <button class="cp-x" data-close aria-label="${esc(t("Fechar"))}">${icon("x")}</button></header>${stripes()}`;
    const own = !j || j.type === "task";
    const mind = own ? `<div class="cp-mind">${icon("bolt")}<div><b>${esc(t("Conversa própria do Claude"))}</b><span>${esc(memoryLine())}</span></div></div>`
      : `<div class="cp-mind">${icon("bot")}<div><b>${esc(t(j.type === "sub" ? "Subagente de um Claude" : "Janela do Claude Code"))}</b><span>${esc(t("De {w}, vista ao vivo pelos hooks do Hub.", { w: j.who }))}</span></div></div>`;
    if (!j) {
      return `${head}<section class="cp-sec"><small class="cp-k">${esc(t("Quem é"))}</small><p class="cp-bio">${esc(t(a.bio))}</p></section>
        <section class="cp-sec"><small class="cp-k">${esc(t("Nova missão"))}</small>
          <form class="cp-send" data-crew="${a.id}"><input name="title" maxlength="200" placeholder="${esc(t("O que é para o {n} fazer?", { n: a.name }))}" autocomplete="off">
          <button class="btn primary">${esc(t("Mandar"))}${icon("arrow")}</button></form></section>
        ${mind}
        <section class="cp-sec"><small class="cp-k">${esc(t("Últimas missões"))}</small>${done.length ? done.slice(0, 4).map((x) => `<button class="cp-done" data-href="#task-${x.id}"><i></i><div><b>${esc(x.title)}</b><span>${esc(x.result || t("Concluída"))}</span></div></button>`).join("")
          : `<p class="cp-empty">${esc(t("Ainda nenhuma. A primeira fica aqui e na Memória da equipa."))}</p>`}</section>`;
    }
    const tk = panelTask && panelTask.id === j.id ? panelTask : null;
    const pct = j.type === "task" ? (tk ? tk.progress : j.progress) || 0 : null;
    const events = tk ? (tk.events || []).slice(-6).reverse() : [];
    const status = tk ? tk.status : j.status;
    const ctl = j.type === "task" ? (["IN_PROGRESS", "WAITING_APPROVAL", "NEEDS_HELP"].includes(status) ? [["pause", "Pausar", "pause"], ["stop", "Parar", "stop"]] : status === "PAUSED" ? [["resume", "Retomar", "play"], ["stop", "Parar", "stop"]] : []) : [];
    const cost = tk && tk.ai_cost_usd != null ? `≈ $${tk.ai_cost_usd.toFixed(2)}` : j.tokens ? `${fmt.tokens(j.tokens)} tokens` : "—";
    const text = (tk && tk.description) || j.description;
    return `${head}<section class="cp-sec cp-mission"><small class="cp-k">${esc(t(j.type === "task" ? "Missão" : j.type === "sub" ? "Missão de subagente" : "Pedido ao Claude"))}</small>
        <h4>${esc(j.title)}</h4>${text ? `<p>${esc(text.slice(0, 280))}</p>` : ""}</section>
      <section class="cp-tele">${gauge(pct, color, pct == null)}
        <div class="cp-stats">
          <div><small>${esc(t("Tempo"))}</small><b class="mono" data-elapsed="${esc(j.since || "")}">${elapsed(j.since)}</b></div>
          <div><small>${esc(t("Para"))}</small><b>${esc(j.who)}</b></div>
          <div><small>${esc(t("Onde"))}</small><b>${esc(j.project || "—")}</b></div>
          <div><small>${esc(t(j.type === "task" ? "Custo IA" : "Uso"))}</small><b class="mono">${esc(cost)}</b></div></div></section>
      <section class="cp-sec cp-now">
        <div><small>${esc(t("Agora"))}</small><p>${esc((tk && tk.current_action) || j.action || t("a pensar…"))}</p></div>
        ${(tk && tk.last_action) || j.last ? `<div><small>${esc(t("Último"))}</small><p>${esc((tk && tk.last_action) || j.last)}</p></div>` : ""}
        ${(tk && tk.next_action) || j.next ? `<div><small>${esc(t("A seguir"))}</small><p>${esc((tk && tk.next_action) || j.next)}</p></div>` : ""}</section>
      ${j.subagents && j.subagents.length ? `<section class="cp-sec"><small class="cp-k">${esc(t("Subagentes"))}</small>${j.subagents.map((s) => `<div class="cp-sub ${s.state === "working" ? "on" : ""}"><i></i><b>${esc(s.kind)}</b><span>${esc(s.description || "")}</span></div>`).join("")}</section>` : ""}
      ${events.length ? `<section class="cp-sec"><small class="cp-k">${esc(t("Registo"))}</small><div class="cp-log">${events.map((e) => `<div class="cp-ev ${esc(e.kind)}"><time>${esc(fmt.hhmm(e.created_at))}</time><span>${esc(e.message)}</span></div>`).join("")}</div></section>` : ""}
      ${mind}
      <footer class="cp-foot">${j.href ? `<button class="btn primary" data-href="${esc(j.href)}">${icon("arrow")}${esc(t(j.type === "task" ? "Abrir a tarefa" : "Ver no Escritório"))}</button>` : ""}
        ${ctl.map(([act, label, ic]) => `<button class="btn ${act === "stop" ? "danger" : ""}" data-control="${act}">${icon(ic)}${esc(t(label))}</button>`).join("")}</footer>`;
  }
  // the vault, opened: the missions as gold, who filled it most, the shop's sales and what the AI cost
  let vaultExtra = null, vaultExtraAt = 0;
  function fetchVaultExtra() {
    if (Date.now() - vaultExtraAt < 60e3) return;
    vaultExtraAt = Date.now();
    Promise.all([api("/api/store/summary").catch(() => null), api("/api/usage/summary").catch(() => null)])
      .then(([store, usage]) => { vaultExtra = { store, usage }; if (panel && panel.kind === "vault") refreshPanel(false); });
  }
  const money = (n, cur) => { try { return new Intl.NumberFormat("pt-PT", { style: "currency", currency: cur || "EUR", maximumFractionDigits: 0 }).format(n || 0); } catch { return `${Math.round(n || 0)} ${cur || "EUR"}`; } };
  const INGOT = `<svg class="cp-ingot" viewBox="0 0 64 40" aria-hidden="true"><defs><linearGradient id="cp-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3c4"/>
    <stop offset=".45" stop-color="#ffcf5a"/><stop offset=".56" stop-color="#c9922a"/><stop offset="1" stop-color="#ffe29a"/></linearGradient></defs>
    <path d="M14 6h36l12 28H2z" fill="url(#cp-gold)" stroke="#7a5212" stroke-width="1.4"/><path d="M14 6h36l-4 9H18z" fill="#fff6d6" opacity=".5"/>
    <text x="32" y="29" text-anchor="middle" font-size="7" font-weight="700" fill="#7a5212" letter-spacing="1">999.9</text></svg>`;
  function vaultPanel() {
    const vs = vaultStats(), people = {};
    for (const x of vs.done) { const who = nameOf(x.completed_by || x.assignee); people[who] = (people[who] || 0) + 1; }
    const top = Object.entries(people).sort((p, q) => q[1] - p[1]), max = top.length ? top[0][1] : 1;
    const crewTop = agents.map((a) => [a, vs.done.filter((x) => x.crew === a.id).length]).filter(([, n]) => n).sort((p, q) => q[1] - p[1]);
    const shop = vaultExtra && vaultExtra.store && vaultExtra.store.shopify, usage = vaultExtra && vaultExtra.usage, live = shop && shop.source === "live";
    const busy = agents.filter((a) => a.job && a.mode !== "done").length;
    return `<header class="cp-head car" style="--c:#ffcf5a">
        <div class="cp-id"><small>${esc(t("Agente AMG · Batcave"))}</small><h3>${esc(t("Cofre"))}</h3>
          <span class="cp-state" style="--s:#ffcf5a"><i></i>${esc(t(vs.total === 1 ? "1 barra de ouro" : "{n} barras de ouro", { n: vs.total }))}</span></div>
        <button class="cp-x" data-close aria-label="${esc(t("Fechar"))}">${icon("x")}</button></header>${stripes()}
      <div class="cp-vault">${INGOT}<div><b>${vs.total}</b><span>${esc(t("Missões concluídas, desde sempre"))}</span></div></div>
      <section class="cp-specs">${[["Hoje", vs.today], ["Esta semana", vs.week], ["Este mês", vs.month], ["Em missão agora", busy]]
        .map(([k, v]) => `<div><small>${esc(t(k))}</small><b>${v}</b></div>`).join("")}</section>
      <section class="cp-sec"><small class="cp-k">${esc(t("Quem mais encheu o cofre"))}</small>${top.length
        ? top.slice(0, 5).map(([who, n]) => `<div class="cp-who"><b>${esc(who)}</b><span class="cp-who-bar"><i style="width:${Math.max(4, (n / max) * 100).toFixed(0)}%"></i></span><em>${n}</em></div>`).join("")
        : `<p class="cp-empty">${esc(t("Ainda vazio. A primeira missão concluída deposita a primeira barra."))}</p>`}
        ${crewTop.length ? `<div class="cp-crewtop">${crewTop.slice(0, 4).map(([a, n]) => `<span style="--c:${a.color}"><img class="cr-px" src="${a.portrait}" alt="">${esc(a.name)}<b>${n}</b></span>`).join("")}</div>` : ""}</section>
      <section class="cp-sec"><small class="cp-k">${esc(t("Loja BareDesk"))}</small>${live
        ? `<div class="cp-money">${[["Hoje", shop.today], ["7 dias", shop.week], ["30 dias", shop.month]].map(([k, w]) => `<div><small>${esc(t(k))}</small><b>${esc(money(w && w.revenue, shop.currency))}</b><span>${esc(t(w && w.orders === 1 ? "1 encomenda" : "{n} encomendas", { n: (w && w.orders) || 0 }))}</span></div>`).join("")}</div>`
        : `<p class="cp-bio">${esc(t(vaultExtra ? "A Shopify ainda não está ligada ao Hub. Quando estiver, as vendas da loja entram aqui ao lado do ouro." : "A ler a loja…"))}</p>`}</section>
      <section class="cp-sec"><small class="cp-k">${esc(t("O que a IA custou · 7 dias"))}</small>
        <p class="cp-bio">${usage && usage.cost_usd != null ? `<b class="cp-cost">≈ $${usage.cost_usd.toFixed(2)}</b> ${esc(t("em {n} sessões (estimativa do SDK, não é fatura)", { n: usage.runs }))}` : esc(t(vaultExtra ? "Sem uso de IA registado nos últimos 7 dias." : "A ler…"))}</p></section>
      <div class="cp-mind">${icon("bolt")}<div><b>${esc(t("Cada missão concluída é uma barra de ouro"))}</b><span>${esc(t("As notas no carrinho são as desta semana. Quando um agente acaba uma missão, as moedas voam para o cofre."))}</span></div></div>`;
  }
  function carPanel(c) {
    return `<header class="cp-head car" style="--c:${c.accent}">
        <div class="cp-id"><small>${esc(c.maker)}</small><h3>${esc(c.name)}</h3><span class="cp-state" style="--s:${c.project ? NEON.green : "#9aa2ab"}"><i></i>${esc(c.project || t("Projeto por atribuir"))}</span></div>
        <button class="cp-x" data-close aria-label="${esc(t("Fechar"))}">${icon("x")}</button></header>${stripes()}
      <div class="cp-car" style="--c:${c.accent}"><img src="${carImage(c)}" alt="${esc(c.maker)} ${esc(c.name)}"></div>
      <section class="cp-specs">${c.specs.map(([k, v]) => `<div><small>${esc(t(k))}</small><b>${esc(v)}</b></div>`).join("")}</section>
      <section class="cp-sec"><small class="cp-k">${esc(t("Projeto"))}</small>
        <p class="cp-bio">${esc(c.project ? c.project : t("Este carro ainda não representa nenhum projeto. Cada carro da garagem vai ficar com um projeto da equipa; quando o escolherem, aparece aqui e na placa ao lado dele."))}</p></section>`;
  }
  // the car alone, rendered big and sharp for its panel
  const carImages = {};
  function carImage(c) {
    if (carImages[c.id]) return carImages[c.id];
    const K = 5, [x0, y0, x1, y1] = c.bounds;
    const cnv = document.createElement("canvas"); cnv.width = Math.ceil((x1 - x0 + 8) * K); cnv.height = Math.ceil((y1 - y0 + 8) * K);
    const g = cnv.getContext("2d");
    window.CrewCars.draw(g, carSpec(c), (x, y, z) => { const [px, py] = P(x, y, z); return [(px - x0 + 4) * K, (py - y0 + 4) * K]; }, { seam: .6 * K });
    return (carImages[c.id] = cnv.toDataURL());
  }
  async function refreshPanel(fetchTask) {
    const el = $("cr-panel");
    if (!el || !panel) return;
    if (panel.kind === "agent" && panel.ref.job && panel.ref.job.type === "task" && fetchTask) {
      try { panelTask = await api(`/api/tasks/${panel.ref.job.id}`); } catch { panelTask = null; }
      if (!panel) return;
    }
    const keep = el.querySelector(".cp-send input");
    const typed = keep ? keep.value : "", focused = keep && document.activeElement === keep;
    paint(el, `<div class="cp-in">${panel.kind === "car" ? carPanel(panel.ref) : panel.kind === "vault" ? vaultPanel() : agentPanel(panel.ref)}</div>`);
    const input = el.querySelector(".cp-send input");
    if (input && typed) input.value = typed;
    if (input && focused) input.focus();
  }
  function openPanel(p) {
    const el = $("cr-panel");
    panel = p; panelTask = null;
    el.hidden = false; requestAnimationFrame(() => el.classList.add("open"));
    $("cr-tip").hidden = true;
    refreshPanel(true);
    if (p.kind === "vault") fetchVaultExtra();
    if (!memoryNotes) api("/api/memory").then((m) => { memoryNotes = m; refreshPanel(false); }).catch(() => {});
    clearInterval(panelTimer);
    panelTimer = setInterval(() => { document.querySelectorAll("#cr-panel [data-elapsed]").forEach((b) => (b.textContent = elapsed(b.dataset.elapsed))); }, 1000);
    wake();
  }
  function closePanel() {
    const el = $("cr-panel");
    panel = null; clearInterval(panelTimer); panelTimer = 0;
    if (!el) return;
    el.classList.remove("open");
    setTimeout(() => { if (!panel) el.hidden = true; }, 260);
  }
  async function panelClick(e) {
    if (e.target.closest("[data-close]")) { closePanel(); return; }
    const link = e.target.closest("[data-href]");
    if (link) { location.hash = link.dataset.href; return; }
    const ctl = e.target.closest("[data-control]");
    if (ctl && panel && panel.ref.job) {
      const act = ctl.dataset.control;
      if (act === "stop" && !window.confirm(t("Parar esta missão? O agente deixa a tarefa onde está."))) return;
      ctl.disabled = true;
      try { await api(`/api/tasks/${panel.ref.job.id}/control`, { method: "POST", body: { action: act } }); flash(t({ pause: "Missão em pausa.", resume: "Missão retomada.", stop: "Missão parada." }[act])); }
      catch (err) { flash(err.message); }
      ctl.disabled = false; lastLoad = 0; load();
    }
  }
  async function panelSubmit(e) {
    const form = e.target.closest(".cp-send");
    if (!form) return;
    e.preventDefault();
    const input = form.querySelector("input"), title = input.value.trim();
    if (!title) { input.focus(); return; }
    if (await sendTask(title, form.dataset.crew, form.querySelector("button"))) { const now = $("cr-panel").querySelector(".cp-send input"); if (now) now.value = ""; }
  }

  // ================================================================ the page around it
  const ago = (iso) => (iso ? fmt.ago(iso) : "");
  function stat(n, label, c) { return `<div class="cr-stat ${n ? "lit" : ""}" style="--c:${c}"><i></i><b>${n}</b><span>${esc(t(label))}</span></div>`; }
  function jobRow(a) {
    const j = a.job, L = labelOf(a);
    return `<button class="cr-job" data-agent="${a.i}" style="--c:${a.color}">
      <span class="cr-face"><img class="cr-px" src="${a.portrait}" alt=""></span>
      <div class="cr-job-t"><div><b>${esc(a.name)}</b><span class="cr-sec">${esc(t(a.what))}</span><em style="--s:${L.color}">${esc(L.word)}</em></div><p>${esc(j.title)}</p>
        <small><span class="cr-ask" style="--p:${partnerOf(j.who).color}">${esc(j.who)}</span>${j.project ? ` · ${esc(j.project)}` : ""}${j.since ? ` · ${esc(ago(j.since))}` : ""}</small>
        ${L.progress != null ? `<span class="cr-bar"><i style="width:${Math.min(100, L.progress)}%"></i></span>` : ""}</div>
      <span class="cr-go-ic">${icon("chevron")}</span></button>`;
  }
  function queueRow(j) {
    const named = j.crew && crewById(j.crew) ? crewById(j.crew).name : "";
    const why = j.stale ? t("à espera do agente automático de {n}", { n: j.who }) : named ? t("{c} está ocupado", { c: named }) : t("estão todos ocupados");
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
      const st = !a.job || a.mode === "done" ? "idle" : a.job.state === "work" || a.job.state === "start" ? "work" : "wait", done = doneBy(a).length;
      return `<button class="cr-mate st-${st}" data-mate="${a.i}" style="--c:${a.color}" title="${esc(a.name)} · ${esc(t(a.what))}${done ? ` · ${esc(t("{n} missões feitas", { n: done }))}` : ""}"><img class="cr-px" src="${a.portrait}" alt=""><i></i>${done ? `<b class="cr-medal">${done}</b>` : ""}<span>${esc(a.name)}</span></button>`;
    }).join(""));
    const order = { work: 0, help: 1, start: 2, wait: 3, pause: 4 };
    paint($("cr-jobs"), busy.length ? busy.sort((p, q) => order[p.job.state] - order[q.job.state]).map(jobRow).join("")
      : `<p class="cr-quiet">${esc(t("Ninguém em missão agora. Escreve lá em cima o que é para fazer, ou clica num agente e dá-lhe uma missão."))}</p>`);
    paint($("cr-queue"), fila.length ? fila.map(queueRow).join("") : `<p class="cr-quiet">${esc(t("Nada na fila."))}</p>`);
    if (panel && panel.kind === "agent") refreshPanel(false);
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
    if (panel && panel.kind === "agent" && panel.ref.job && panel.ref.job.type === "task") refreshPanel(true);
    if (panel && panel.kind === "vault") refreshPanel(false);
  }

  async function sendTask(title, crewId, button) {
    const who = $("cr-who") ? $("cr-who").value : me.username;
    if (button) button.disabled = true;
    try {
      const task = await api("/api/tasks", { method: "POST", body: { title, assignee: who, crew: crewId || "", for_ai: true } });
      tasks = [task, ...tasks.filter((x) => x.id !== task.id)];
      jobs = jobsOf();
      reconcile(jobs, false);
      paintLists();
      const a = agents.find((x) => x.job && x.job.key === `t${task.id}`);
      const named = crewId && crewById(crewId);
      flash(a ? t("{n} já vai para o computador.", { n: a.name }) : named ? t("{n} está ocupado: a missão fica na fila.", { n: named.name }) : t("Mandado. Fica na fila até haver um computador livre."));
      if (a && view !== "office") goView("office");
      if (a && panel && panel.kind === "agent" && panel.ref === a) refreshPanel(true);
      wake();
      return true;
    } catch (err) {
      flash(err.message);
      return false;
    } finally {
      if (button) button.disabled = false;
    }
  }
  async function send(e) {
    e.preventDefault();
    const input = $("cr-title"), title = input.value.trim();
    if (!title) { input.focus(); return; }
    const crewId = (document.querySelector('input[name="cr-crew"]:checked') || {}).value || autoCrew(title);
    if (await sendTask(title, crewId, $("cr-go"))) { input.value = ""; routeHint(); }
    input.focus();
  }
  // "Automático": who would take it, said while it is being written, and sent already with that character
  function autoCrew(title) { const r = routeOf({ title }); return (r.a || crewById(r.home)).id; }
  const art = (a) => (a.id === "catwoman" ? "a" : "o");
  function routeHint() {
    const el = $("cr-route"), title = $("cr-title").value.trim(), chosen = (document.querySelector('input[name="cr-crew"]:checked') || {}).value;
    if (!el) return;
    if (!title || chosen) { el.textContent = ""; el.hidden = true; return; }
    const r = routeOf({ title }), home = crewById(r.home);
    el.hidden = false;
    el.style.setProperty("--c", (r.a || home).color);
    el.textContent = !r.a ? t("Fica na fila: estão todos ocupados. Vai para {a} {n} · {s} quando acabar.", { a: art(home), n: home.name, s: t(home.what) })
      : r.a === home ? t("Vai para {a} {n} · {s}", { a: art(home), n: home.name, s: t(home.what) })
      : t("Vai para {a} {n} · {s} ({h} está ocupado)", { a: art(r.a), n: r.a.name, s: t(r.a.what), h: home.name });
  }

  function mount() {
    stop();
    stage = $("cr-stage"); cv = $("cr-canvas"); g2 = cv.getContext("2d");
    if (!world) { world = document.createElement("canvas"); world.width = LW * WS; world.height = LH * WS; wg = world.getContext("2d"); wg.k = WS; }
    if (!star) {
      const img = new Image();
      img.onload = () => { star = img; if (cv && cv.width && stage && stage.isConnected) { buildBg(); draw(); } };
      img.src = "assets/mercedes-star.svg";
    }
    bg = null; cv.width = 0;
    const v = camAnim.to || VIEWS[view];
    Object.assign(cam, { x: v.x, y: v.y, w: v.w, h: v.w / ASPECT }); camAnim.to = null;
    stage.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("on", b.dataset.view === view));
    ro = new ResizeObserver(() => resize()); ro.observe(stage);
    io = new IntersectionObserver(([en]) => { onScreen = en.isIntersecting; if (onScreen) wake(); }); io.observe(stage);
    document.addEventListener("visibilitychange", wake);
    document.addEventListener("keydown", onKey);
    stage.onpointermove = onMove;
    stage.onpointerdown = onDown;
    stage.onpointerup = onUp;
    stage.onpointerleave = () => { if (!drag) { $("cr-tip").hidden = true; hovered = null; hoverCar = null; hoverVault = false; stage.classList.remove("point"); } };
    stage.querySelector(".cr-views").onclick = (e) => { const b = e.target.closest("[data-view]"); if (b) goView(b.dataset.view); };
    const el = $("cr-panel");
    el.onclick = panelClick; el.onsubmit = panelSubmit;
    for (const type of ["pointerdown", "pointerup", "pointermove"]) el.addEventListener(type, (e) => e.stopPropagation());
    $("cr-send").onsubmit = send;
    $("cr-title").oninput = routeHint;
    $("cr-send").onchange = routeHint;
    $("cr-jobs").onclick = (e) => { const b = e.target.closest("[data-agent]"); if (b) { if (view !== "office") goView("office"); openPanel({ kind: "agent", ref: agents[Number(b.dataset.agent)] }); } };
    $("cr-queue").onclick = (e) => { const b = e.target.closest("[data-href]"); if (b) location.hash = b.dataset.href; };
    const crew = $("cr-crew");
    crew.onmouseover = (e) => { const b = e.target.closest("[data-mate]"); focus = b ? agents[Number(b.dataset.mate)] : null; };
    crew.onmouseleave = () => { focus = null; };
    crew.onclick = (e) => { const b = e.target.closest("[data-mate]"); if (b) { if (view !== "office") goView("office"); openPanel({ kind: "agent", ref: agents[Number(b.dataset.mate)] }); } };
    for (const type of ["pointerdown", "pointerup"]) crew.addEventListener(type, (e) => e.stopPropagation());
    stage.querySelector(".cr-views").addEventListener("pointerup", (e) => e.stopPropagation());
    if (panel) { const p = panel; panel = null; openPanel(p); }
    resize(true);
  }

  HUB_VIEWS.empresa = async function () {
    await Promise.all([lazyFile("hub/crew-people.js"), lazyFile("hub/crew-cars.js")]);
    const users = me.lead ? await api("/api/users").catch(() => []) : [];
    if (!agents.length) { agents = CREW.map(makeAgent); agents.forEach(placeIdle); }
    page(`${ui.head("Agentes", "Empresa AMG", t("A Batcave da equipa: oito agentes, cada um com o seu posto e o seu setor. Escreve a missão e ela vai sozinha para o setor certo; por cima de cada posto vês quem pediu, o que está a fazer e com que skills. Clica num agente para ver a missão. No cofre, cada missão concluída é uma barra de ouro."))}
      <form class="cr-send" id="cr-send" autocomplete="off">
        <label class="cr-in">${icon("bolt")}<input id="cr-title" maxlength="200" placeholder="${esc(t("Qual é a missão?"))}"></label>
        <div class="cr-pick" role="radiogroup" aria-label="${esc(t("Quem faz"))}">
          <label title="${esc(t("Vai para o setor do pedido: design, pesquisa, testes, revisão, marketing, código, engenharia; o resto, Operações"))}"><input type="radio" name="cr-crew" value="" checked><span class="any">${icon("bolt")}${esc(t("Automático"))}</span></label>
          ${agents.map((a) => `<label title="${esc(a.name)} · ${esc(t(a.what))}"><input type="radio" name="cr-crew" value="${a.id}"><span style="--c:${a.color}"><img class="cr-px" src="${a.portrait}" alt="">${esc(a.name)}</span></label>`).join("")}</div>
        ${users.length ? `<label class="cr-who">${icon("users")}<select id="cr-who" title="${esc(t("No agente automático de quem"))}">${options(users.map((u) => [u.username, u.display_name]), me.username)}</select></label>` : ""}
        <button class="btn primary cr-go" id="cr-go">${t("Mandar")}${icon("arrow")}</button>
        <p class="cr-route" id="cr-route" aria-live="polite" hidden></p>
      </form>
      <section class="cr-stage" id="cr-stage"><canvas id="cr-canvas" aria-label="${esc(t("A Batcave dos agentes"))}"></canvas>
        <div class="cr-hud"><div class="cr-live"><i></i>${t("Ao vivo")}</div><div class="cr-stats" id="cr-stats"></div></div>
        <div class="cr-crew" id="cr-crew"></div>
        <div class="cr-views" role="tablist">${[["office", "Escritório"], ["vault", "Cofre"], ["garage", "Stand"], ["all", "Tudo"]].map(([v, l]) => `<button type="button" data-view="${v}">${esc(t(l))}</button>`).join("")}</div>
        <div class="cr-tip" id="cr-tip" hidden></div>
        <aside class="cr-panel" id="cr-panel" hidden></aside></section>
      <div class="cr-lists">
        <section><div class="cr-h">${icon("bolt")}<b>${t("Em missão")}</b></div><div id="cr-jobs">${ui.skeleton(3)}</div></section>
        <section><div class="cr-h">${icon("inbox")}<b>${t("Na fila")}</b></div><div id="cr-queue"></div></section>
      </div>`);
    mount();
    lastLoad = 0;
    await load();
  };
  onLive(["task", "office", "tick"], () => load());
})();
