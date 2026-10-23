// The cars of the Batcave's garage (crew.js), modelled in 3D and rendered once into the cave's picture.
// A body is lofted: along its length it has stations, and each station is a cross-section (the sill, the widest point,
// the shoulder, the top of the wing or fender, the edge of the roof, the roof) whose numbers come from keyframes taken
// off the real car (length, width, height, wheelbase, where the windscreen starts and ends). Between stations the
// surface is small quads; each quad knows what it is (paint, glass, carbon, trim) from where it sits, the wheel arches
// are cut out of it, and wheels (tyres turned on a lathe, rims with their own spokes, discs, calipers), lights, grilles,
// vents, mirrors and wings are added on. Every face is lit like a studio: an overhead softbox made of light bars, a fill
// from the front, a blue rim from the cave, a clear coat that reflects more at a grazing angle. Faces that look away
// are not drawn; the rest are painted far to near.
window.CrewCars = (function () {
  const ZS = 15;                                        // pixels per metre, upwards (the cave's people are ~24 px)
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const VIEW = norm([1, 1, 16 / ZS]);                   // towards the viewer: the direction the projection flattens
  const L1 = norm([-.25, .3, 1]), L2 = norm([1, .45, .55]), L3 = norm([-1, -.7, .3]);
  const lin = (hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.pow(v / 255, 2.2)); };
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  // ------------------------------------------------------------------ materials
  // base: colour (linear); metal: how much the reflection takes the colour; refl: clear coat; gloss: highlights
  const MAT = {
    glass: { base: lin("#05090f"), metal: 0, refl: 1.35, gloss: 1.4, F0: .1, diff: .4 },
    chrome: { base: lin("#d8dce2"), metal: 1, refl: 1.15, gloss: 1.6, F0: .75, diff: .3 },
    trim: { base: lin("#0c0d10"), metal: 0, refl: .35, gloss: .45, F0: .04, diff: 1 },
    carbon: { base: lin("#16181c"), metal: .25, refl: .75, gloss: .9, F0: .06, diff: 1, weave: true },
    rubber: { base: lin("#0b0b0d"), metal: 0, refl: .1, gloss: .12, F0: .03, diff: 1 },
    well: { base: lin("#030304"), metal: 0, refl: 0, gloss: 0, F0: 0, diff: .4 },
    disc: { base: lin("#5d6168"), metal: .7, refl: .6, gloss: .6, F0: .4, diff: .8 },
    head: { emit: lin("#eef7ff") }, drl: { emit: lin("#ffffff") }, tail: { emit: lin("#ff1a2a") }, tailDim: { emit: lin("#8a0710") },
    amber: { emit: lin("#ffb03a") }, lamp: { base: lin("#0d1016"), metal: .3, refl: 1.2, gloss: 1.4, F0: .3, diff: .6 },
    plate: { base: lin("#e9ecef"), metal: 0, refl: .3, gloss: .4, F0: .04, diff: 1 },
    yellow: { base: lin("#f2c21b"), metal: .1, refl: .8, gloss: .9, F0: .05, diff: 1 },
  };
  const paint = (hex, metal = .18) => ({ base: lin(hex), metal, refl: 1, gloss: 1.15, F0: .05, diff: 1 });

  // the studio, as the paint sees it: light bars overhead, the cave's blue at the horizon, a dark floor
  function env(r) {
    const up = r[2];
    const bars = Math.pow(Math.max(0, Math.sin(r[0] * 6.5 - r[1] * 2.5)), 5);
    const sky = smooth(.35, .92, up) * (.22 + .8 * bars) * 1.85;
    const hz = Math.exp(-Math.pow((up - .05) / .22, 2));
    const yel = Math.exp(-Math.pow((up - .25) / .15, 2)) * smooth(.3, .9, -r[0] - r[1] * .2) * .55;    // the yellow signal on one side
    const floor = up < -.05 ? .012 : 0;
    return [sky + hz * .05 + yel * .9 + floor, sky + hz * .11 + yel * .65 + floor, sky * 1.04 + hz * .26 + yel * .08 + floor * 1.4];
  }
  function shade(m, n, seed) {
    if (m.emit) return toCss(m.emit.map((v) => v * 1.4));
    const ndv = Math.max(0, dot(n, VIEW));
    const r = [2 * ndv * n[0] - VIEW[0], 2 * ndv * n[1] - VIEW[1], 2 * ndv * n[2] - VIEW[2]];
    const F = m.F0 + (1 - m.F0) * Math.pow(1 - ndv, 5);
    const diff = (.12 + .62 * Math.max(0, dot(n, L1)) + .3 * Math.max(0, dot(n, L2))) * m.diff;
    const rim = .45 * Math.pow(Math.max(0, dot(n, L3)), 2);
    const e = env(r);
    const spec = Math.pow(Math.max(0, dot(r, L1)), 70) * 3 + Math.pow(Math.max(0, dot(r, L2)), 40) * .9;
    let base = m.base;
    if (m.weave) base = base.map((v) => v * (seed % 2 ? 1.35 : .8));
    const tint = (i) => m.metal * base[i] + (1 - m.metal);
    const out = [0, 1, 2].map((i) => base[i] * diff * (1 - m.metal * .7) + (e[i] * m.refl * (m.metal ? Math.max(F, .55) : F) + spec * m.gloss) * tint(i)
      + rim * [.18, .32, .6][i]);
    return toCss(out);
  }
  function toCss(c) {
    const v = c.map((x) => Math.round(255 * Math.pow(1 - Math.exp(-x * 1.25), 1 / 2.2)));
    return `rgb(${v[0]},${v[1]},${v[2]})`;
  }

  // ------------------------------------------------------------------ the cars, from the real ones
  // keys: [u (metres from the back), sill, shoulder, top, half-width, half-width of the top, how far the wings rise over
  // the shoulder]. glass: side windows (u ranges), screen (windscreen), back (rear window). wheels: [u, radius, width].
  const MODELS = {
    // Mercedes-AMG G 63 (W463): 4.87 × 1.98 × 1.97 m, wheelbase 2.89 m, 22-inch wheels
    g63: { L: 4.87, keys: [
      [0, .42, 1.1, 1.92, .955, .9, 0], [.05, .38, 1.1, 1.95, .975, .9, 0], [.4, .3, 1.12, 1.96, .99, .9, .02], [2.95, .3, 1.12, 1.96, .99, .9, .02],
      [3.05, .3, 1.12, 1.9, .99, .88, .02], [3.4, .3, 1.12, 1.24, .99, .8, .03], [4.55, .32, 1.08, 1.17, .99, .8, .03], [4.75, .36, 1.02, 1.1, .985, .82, .02],
      [4.87, .4, .98, 1.04, .97, .84, 0]],
      glass: { side: [[.3, 1.05], [1.25, 2.2], [2.38, 3]], screen: [3.06, 3.38], back: null }, roof: [.05, 3.05], lower: "paint", box: true, plan: [.1, .1],
      wheels: [[1.23, .41, .3], [4.12, .41, .3]], rim: { kind: "twin", n: 7, color: "#c3c8cf", dark: "#2a2d33" }, caliper: "#d0182f" },
    // Porsche 911 GT3 RS (992): 4.57 × 1.90 × 1.32 m, wheelbase 2.46 m, 20/21-inch
    gt3: { L: 4.57, keys: [
      [0, .24, .62, .74, .86, .8, 0], [.1, .2, .7, .92, .92, .84, .02], [.45, .18, .74, .95, .95, .8, .04], [1.2, .16, .78, 1.1, .95, .62, .06],
      [1.95, .15, .8, 1.3, .93, .58, .05], [2.4, .15, .8, 1.32, .92, .58, .04], [2.75, .15, .8, 1.25, .91, .6, .05], [3.15, .15, .74, .96, .92, .66, .1],
      [3.62, .16, .66, .8, .93, .56, .16], [4.2, .18, .58, .68, .9, .5, .12], [4.45, .2, .5, .58, .85, .45, .06], [4.57, .24, .42, .48, .78, .4, 0]],
      glass: { side: [[1.45, 1.75], [1.88, 2.92]], screen: [2.76, 3.14], back: [1.22, 1.93] }, roof: [1.95, 2.75], roofMat: "carbon", lower: "trim", plan: [.22, .62],
      wheels: [[1.16, .37, .34], [3.62, .35, .28]], rim: { kind: "spokes", n: 10, color: "#2a2c31", dark: "#0c0d0f", nut: "#d0182f" }, caliper: "#f2c21b" },
    // Lamborghini Aventador SVJ: 4.94 × 2.10 × 1.14 m, wheelbase 2.70 m
    svj: { L: 4.94, keys: [
      [0, .24, .74, .86, .98, .86, 0], [.15, .2, .8, .94, 1.02, .88, .02], [.7, .16, .8, .98, 1.04, .62, .04], [1.5, .14, .8, 1.06, 1.05, .56, .03],
      [2.05, .13, .8, 1.13, 1.04, .54, .02], [2.55, .13, .8, 1.14, 1.03, .55, .02], [2.85, .13, .78, 1.08, 1.02, .58, .03], [3.55, .13, .7, .84, 1, .66, .06],
      [3.85, .13, .64, .76, 1, .66, .08], [4.4, .14, .55, .64, .96, .6, .06], [4.8, .16, .44, .52, .92, .55, .03], [4.94, .18, .36, .44, .86, .5, 0]],
      glass: { side: [[1.95, 2.95]], screen: [2.86, 3.54], back: null }, roof: [2.05, 2.85], roofMat: "carbon", lower: "carbon", plan: [.22, .2],
      wheels: [[1.14, .37, .36], [3.84, .35, .3]], rim: { kind: "y", n: 5, color: "#3a3d43", dark: "#0b0c0e" }, caliper: "#121214" },
    // Ferrari SF90 Stradale: 4.71 × 1.97 × 1.19 m, wheelbase 2.65 m
    sf90: { L: 4.71, keys: [
      [0, .22, .78, .92, .92, .82, 0], [.12, .18, .84, .98, .95, .86, .02], [.6, .16, .84, 1, .98, .7, .03], [1.35, .15, .84, 1.08, .985, .56, .05],
      [1.95, .14, .84, 1.18, .98, .52, .04], [2.45, .14, .84, 1.19, .97, .54, .03], [2.8, .14, .82, 1.1, .96, .58, .05], [3.4, .14, .74, .86, .95, .64, .1],
      [3.71, .15, .66, .76, .95, .62, .14], [4.3, .16, .54, .62, .92, .52, .1], [4.62, .19, .44, .5, .86, .46, .04], [4.71, .22, .38, .44, .8, .42, 0]],
      glass: { side: [[1.98, 2.92]], screen: [2.81, 3.39], back: [1.37, 1.93] }, roof: [1.95, 2.8], lower: "trim", plan: [.4, .3],
      wheels: [[1.06, .36, .33], [3.71, .34, .28]], rim: { kind: "twin", n: 5, color: "#cfd3d9", dark: "#2a2c30" }, caliper: "#f2c21b" },
  };

  // monotone cubic through the keyframes: no bulges between them, flats stay flat
  function curve(keys, col) {
    const xs = keys.map((k) => k[0]), ys = keys.map((k) => k[col]), n = xs.length;
    const d = xs.slice(1).map((x, i) => (ys[i + 1] - ys[i]) / (x - xs[i]));
    const m = xs.map((_, i) => (i === 0 ? d[0] : i === n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2));
    for (let i = 0; i < n - 1; i++) {
      if (!d[i]) { m[i] = m[i + 1] = 0; continue; }
      const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
      if (s > 9) { const tt = 3 / Math.sqrt(s); m[i] = tt * a * d[i]; m[i + 1] = tt * b * d[i]; }
    }
    return (x) => {
      let i = 0;
      while (i < n - 2 && x > xs[i + 1]) i++;
      const h = xs[i + 1] - xs[i], tt = Math.max(0, Math.min(1, (x - xs[i]) / h)), t2 = tt * tt, t3 = t2 * tt;
      return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + tt) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
    };
  }
  // centripetal Catmull–Rom through the section's control points: round where it should be, no loops
  const SUB = 4;
  function spline(pts) {
    const out = [], P = [pts[0], ...pts, pts[pts.length - 1]];
    const tj = (ti, a, b) => ti + Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-4, .5);
    for (let i = 1; i < P.length - 2; i++) {
      const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
      const t0 = 0, t1 = tj(t0, p0, p1), t2 = tj(t1, p1, p2), t3 = tj(t2, p2, p3);
      for (let s = 0; s < SUB; s++) {
        const t = t1 + (t2 - t1) * (s / SUB);
        const L = (a, b, ta, tb) => [0, 1].map((k) => ((tb - t) / (tb - ta)) * a[k] + ((t - ta) / (tb - ta)) * b[k]);
        const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3);
        const B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3);
        out.push(L(B1, B2, t1, t2));
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }
  // the right half of the cross-section at a station, from the middle underneath to the middle of the top. A sports
  // car tucks in at the sill and rounds its shoulder; the G is a box with its edges just broken.
  const ROLE = ["under", "lower", "side", "side", "shoulder", "house", "top", "top"];
  function section(p, box) {
    const [zb, zs, zt, ws, wt, bulge] = p, rim = zt - Math.min(.08, Math.max(.01, (zt - zs) * .18));
    return spline(box
      ? [[0, zb], [ws * .95, zb], [ws, zb + .05], [ws, (zb + zs) / 2], [ws * .995, zs], [ws * .96, zs + bulge], [wt, zt - .03], [wt * .5, zt], [0, zt]]
      : [[0, zb], [ws * .78, zb], [ws * .97, zb + (zs - zb) * .28], [ws, zb + (zs - zb) * .62], [ws * .965, zs], [ws * .86, zs + bulge], [wt, rim], [wt * .5, zt], [0, zt]]);
  }

  // ------------------------------------------------------------------ building a car
  const built = {};
  function build(spec) {
    const key = spec.id;
    if (built[key]) return built[key];
    const M = MODELS[spec.model], L = M.L, faces = [];
    const cols = [1, 2, 3, 4, 5, 6].map((c) => curve(M.keys, c));
    const [rcR, rcF] = M.plan || [.1, .1];
    const round = (d, rc) => (d >= rc ? 0 : rc - Math.sqrt(Math.max(0, rc * rc - (rc - d) * (rc - d))));
    const at = (u) => {                                                         // the numbers at u, the corners rounded in plan
      const p = cols.map((f) => f(u)), cut = Math.max(round(u, rcR), round(L - u, rcF));
      p[3] = Math.max(.08, p[3] - cut); p[4] = Math.max(.05, Math.min(p[4], p[3] * .98) - cut * .8);
      return p;
    };
    const N = 96, stations = [], us = [];
    for (let i = 0; i <= N; i++) { const u = (L * i) / N; us.push(u); stations.push(section(at(u), M.box)); }
    const MP = stations[0].length;
    const dir = spec.dir, base = spec.baseZ || 0;
    // local (u along, v across, h up, metres) to the world (x, y in tiles, z in px)
    const W = (u, v, h) => [spec.cx + (u - L / 2) * dir, spec.cy + v * dir, base + h * ZS];
    const Wn = (n) => norm([n[0] * dir, n[1] * dir, n[2]]);
    const add = (pts, n, mat, bias = 0, seed = 0) => faces.push({ p: pts.map((q) => W(...q)), n: Wn(n), mat, bias, seed });
    const inR = (u, r) => r && u >= r[0] && u <= r[1];
    const paintMat = paint(spec.color, spec.metal ?? .18);
    const arches = M.wheels.map(([uw, r]) => ({ uw, r, R: r * 1.15 }));
    const inArch = (u, h) => arches.some((a) => Math.pow((u - a.uw) / a.R, 2) + Math.pow((h - a.r - .03) / a.R, 2) < 1);
    const matAt = (u, role, h, p) => {
      if (role === "lower") return MAT[M.lower] || paintMat;
      if (role === "house") {
        if (M.glass.side.some((r) => inR(u, r)) && h > p[1] + .05 && h < p[2] - .04) return MAT.glass;
        return paintMat;
      }
      if (role === "top") {
        if (inR(u, M.glass.screen) || inR(u, M.glass.back)) return MAT.glass;
        if (inR(u, M.roof) && M.roofMat) return MAT[M.roofMat];
      }
      return paintMat;
    };
    // the skin
    for (let i = 0; i < N; i++) {
      const A = stations[i], B = stations[i + 1], ua = us[i], ub = us[i + 1], pm = at((ua + ub) / 2);
      for (let j = 0; j < MP - 1; j++) {
        const role = ROLE[Math.min(ROLE.length - 1, Math.floor(j / SUB))];
        if (role === "under") continue;                                         // underneath: never seen
        const hc = (A[j][1] + A[j + 1][1] + B[j][1] + B[j + 1][1]) / 4, uc = (ua + ub) / 2;
        if ((role === "lower" || role === "side" || role === "shoulder") && inArch(uc, hc)) continue;   // the wheel arches
        const m = matAt(uc, role, hc, pm);
        for (const s of [1, -1]) {
          const q = [[ua, A[j][0] * s, A[j][1]], [ua, A[j + 1][0] * s, A[j + 1][1]], [ub, B[j + 1][0] * s, B[j + 1][1]], [ub, B[j][0] * s, B[j][1]]];
          let n = norm(cross(sub(q[1], q[0]), sub(q[3], q[0])));
          if (s < 0) n = n.map((x) => -x);
          add(q, n, m, 0, i + j);
        }
      }
    }
    // the two ends
    for (const [st, u, nu] of [[stations[0], 0, -1], [stations[N], L, 1]]) {
      const ring = [...st.map(([v, h]) => [u, v, h]), ...st.slice().reverse().map(([v, h]) => [u, -v, h])];
      add(ring, [nu, 0, 0], paintMat);
    }
    // helpers for what goes on the skin
    const pAt = (u) => at(Math.max(0, Math.min(L, u)));
    const secAt = (u) => section(pAt(u), M.box);
    const sideV = (u, h) => {                                                   // how wide the body is at a height
      const s = secAt(u);
      for (let j = SUB; j < SUB * 6; j++) { const [v0, h0] = s[j], [v1, h1] = s[j + 1]; if ((h - h0) * (h - h1) <= 0 && h1 !== h0) return v0 + (v1 - v0) * ((h - h0) / (h1 - h0)); }
      return pAt(u)[3];
    };
    const topH = (u, v) => {                                                    // how high the top is, across
      const s = secAt(u);
      for (let j = s.length - 1; j > SUB * 4; j--) { const [v0, h0] = s[j], [v1, h1] = s[j - 1]; if (v >= v0 && v <= v1) return h0 + (h1 - h0) * ((v - v0) / ((v1 - v0) || 1)); }
      return pAt(u)[2];
    };
    const onSide = (pts, m, bias = .02, out = .006) => { for (const s of [1, -1]) add(pts.map(([u, h]) => [u, (sideV(u, h) + out) * s, h]), [0, s, 0], m, bias); };
    const onTop = (pts, m, bias = .02) => add(pts.map(([u, v]) => [u, v, topH(u, Math.abs(v)) + .006]), [0, 0, 1], m, bias);
    const onEnd = (front, pts, m, bias = .02) => add(pts.map(([v, h]) => [front ? L + .006 : -.006, v, h]), [front ? 1 : -1, 0, 0], m, bias);
    const disc = (cu, cv, ch, r, axis, m, bias = .02, n = 18, squash = 1) => {
      const pts = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2, c = Math.cos(a) * r, sn = Math.sin(a) * r * squash;
        pts.push(axis === "u" ? [cu, cv + c, ch + sn] : axis === "v" ? [cu + c, cv, ch + sn] : [cu + c, cv + sn, ch]);
      }
      add(pts, axis === "u" ? [Math.sign(cu - L / 2) || 1, 0, 0] : axis === "v" ? [0, Math.sign(cv) || 1, 0] : [0, 0, 1], m, bias);
    };
    const boxL = (u0, u1, v0, v1, h0, h1, m, bias = .01) => {                    // a box in the car's own axes
      const c = (u, v, h) => [u, v, h];
      add([c(u0, v0, h1), c(u1, v0, h1), c(u1, v1, h1), c(u0, v1, h1)], [0, 0, 1], m, bias);
      add([c(u0, v1, h0), c(u1, v1, h0), c(u1, v1, h1), c(u0, v1, h1)], [0, 1, 0], m, bias);
      add([c(u0, v0, h0), c(u0, v0, h1), c(u1, v0, h1), c(u1, v0, h0)], [0, -1, 0], m, bias);
      add([c(u1, v0, h0), c(u1, v0, h1), c(u1, v1, h1), c(u1, v1, h0)], [1, 0, 0], m, bias);
      add([c(u0, v0, h0), c(u0, v1, h0), c(u0, v1, h1), c(u0, v0, h1)], [-1, 0, 0], m, bias);
    };
    const both = (fn) => { fn(1); fn(-1); };
    // the wheels: the well, the tyre, the rim and what is behind it
    for (const [uw, r, tw] of M.wheels) {
      const vo = sideV(uw, r) * .985;
      for (const s of [1, -1]) {
        const vc = (vo - tw / 2) * s;
        const well = [];                                                        // the dark inside of the arch
        for (let i = 0; i <= 14; i++) { const a = Math.PI * (i / 14); well.push([uw + Math.cos(a) * r * 1.15, (vo - .04) * s, r + .03 + Math.sin(a) * r * 1.15]); }
        well.push([uw - r * 1.15, (vo - .04) * s, .08], [uw + r * 1.15, (vo - .04) * s, .08]);
        add(well, [0, s, 0], MAT.well, -.25);
        const prof = [[.7, .5], [.93, .5], [1, .36], [1, -.36], [.93, -.5], [.7, -.5]];
        const T = 32;
        for (let a = 0; a < T; a++) {
          const a0 = (a / T) * Math.PI * 2, a1 = ((a + 1) / T) * Math.PI * 2;
          for (let p = 0; p < prof.length - 1; p++) {
            const P0 = prof[p], P1 = prof[p + 1];
            const pt = (ang, q) => [uw + Math.cos(ang) * r * q[0], vc + q[1] * tw * s, r + Math.sin(ang) * r * q[0]];
            const quad = [pt(a0, P0), pt(a0, P1), pt(a1, P1), pt(a1, P0)];
            let n = norm(cross(sub(quad[1], quad[0]), sub(quad[3], quad[0])));
            const mid = (a0 + a1) / 2, radial = [Math.cos(mid), 0, Math.sin(mid)];
            const outward = [radial[0] * (P0[0] + P1[0]) + 0, s * (P0[1] + P1[1]) * 2, radial[2] * (P0[0] + P1[0])];
            if (dot(n, outward) < 0) n = n.map((x) => -x);
            add(quad, n, MAT.rubber, 0, a);
          }
        }
        // the rim's face, on the outside of the tyre
        const vf = vc + (tw / 2 - .025) * s, R = r * .7;
        const ring = (r0, r1, a0, a1, m, bias, n = 10) => {
          const pts = [];
          for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * (i / n); pts.push([uw + Math.cos(a) * r1, vf, r + Math.sin(a) * r1]); }
          for (let i = n; i >= 0; i--) { const a = a0 + (a1 - a0) * (i / n); pts.push([uw + Math.cos(a) * r0, vf, r + Math.sin(a) * r0]); }
          add(pts, [0, s, 0], m, bias);
        };
        disc(uw, vf - .06 * s, r, R, "v", { ...MAT.trim, base: lin(M.rim.dark) }, .01, 24);
        disc(uw, vf - .05 * s, r, R * .8, "v", MAT.disc, .02, 24);
        for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; ring(R * .45, R * .78, a, a + .06, { ...MAT.trim }, .025, 1); }
        ring(R * .5, R * .82, Math.PI * .15, Math.PI * .55, paint(M.caliper, .1), .03, 6);   // the caliper, behind the spokes
        const rimMat = { ...MAT.chrome, base: lin(M.rim.color), metal: .85 };
        const spokes = M.rim.kind === "twin" ? M.rim.n * 2 : M.rim.n;
        for (let i = 0; i < spokes; i++) {
          let a = (i / spokes) * Math.PI * 2;
          if (M.rim.kind === "twin") a = Math.floor(i / 2) * (Math.PI * 2 / M.rim.n) + (i % 2 ? .13 : -.13);
          const w0 = M.rim.kind === "y" ? .12 : .07, w1 = M.rim.kind === "y" ? .05 : M.rim.kind === "spokes" ? .1 : .085;
          const p = (rad, da) => [uw + Math.cos(a + da) * rad, vf, r + Math.sin(a + da) * rad];
          add([p(R * .16, -w0), p(R * .95, -w1), p(R * .95, w1), p(R * .16, w0)], [0, s, 0], rimMat, .04, i);
          if (M.rim.kind === "y") {
            add([p(R * .6, 0), p(R * .95, w1 + .28), p(R * .95, w1 + .4), p(R * .62, .12)], [0, s, 0], rimMat, .04, i);
          }
        }
        ring(R * .92, R * 1.02, 0, Math.PI * 2, rimMat, .05, 28);                // the lip
        disc(uw, vf + .004 * s, r, R * .2, "v", rimMat, .06, 14);                // the hub
        disc(uw, vf + .008 * s, r, R * .09, "v", M.rim.nut ? paint(M.rim.nut, .2) : MAT.trim, .07, 10);
      }
    }
    // ---------------------------------------------------------------- what makes each one itself
    const g = { L, onSide, onTop, onEnd, disc, boxL, both, sideV, topH, add, paintMat, pAt };
    DETAILS[spec.model](g, spec);
    // mirrors, on all of them: a body-coloured shell on a black arm at the foot of the windscreen
    const um = M.glass.screen[0] - .02, hm = pAt(um)[1] + .12;
    both((s) => {
      const v0 = sideV(um, hm) * s, span = (a, b) => [Math.min(v0 + a * s, v0 + b * s), Math.max(v0 + a * s, v0 + b * s)];
      boxL(um - .04, um + .01, ...span(-.02, .08), hm - .015, hm + .015, MAT.trim);
      boxL(um - .13, um, ...span(.06, .19), hm - .01, hm + .09, paintMat);
      boxL(um - .005, um + .003, ...span(.07, .18), hm, hm + .08, MAT.glass);
    });
    return (built[key] = { faces, spec });
  }

  // ------------------------------------------------------------------ the details, car by car
  const DETAILS = {
    g63({ L, onSide, onEnd, onTop, disc, boxL, both }, spec) {
      // the front: bumper, the Panamericana grille, the round lamps, the star
      onEnd(true, [[-.86, .41], [.86, .41], [.86, .64], [-.86, .64]], MAT.trim);
      onEnd(true, [[-.5, .44], [.5, .44], [.5, .58], [-.5, .58]], MAT.well, .03);
      for (let i = 0; i < 8; i++) onEnd(true, [[-.46 + i * .13, .46], [-.43 + i * .13, .46], [-.43 + i * .13, .56], [-.46 + i * .13, .56]], MAT.trim, .04);
      onEnd(true, [[-.27, .47], [.27, .47], [.27, .55], [-.27, .55]], MAT.plate, .045);
      onEnd(true, [[-.45, .67], [.45, .67], [.45, 1.0], [-.45, 1.0]], MAT.well, .03);
      for (let i = 0; i < 15; i++) onEnd(true, [[-.42 + i * .06, .69], [-.405 + i * .06, .69], [-.405 + i * .06, .98], [-.42 + i * .06, .98]], MAT.chrome, .04);
      disc(L + .01, 0, .835, .12, "u", MAT.chrome, .06, 20);
      disc(L + .012, 0, .835, .1, "u", MAT.trim, .07, 20);
      for (const a of [Math.PI / 2, Math.PI / 2 + 2.09, Math.PI / 2 + 4.19]) onEnd(true, [[0, .835], [Math.cos(a - .14) * .025, .835 + Math.sin(a - .14) * .025], [Math.cos(a) * .1, .835 + Math.sin(a) * .1], [Math.cos(a + .14) * .025, .835 + Math.sin(a + .14) * .025]], MAT.chrome, .08);
      for (const s of [1, -1]) {
        disc(L + .01, .66 * s, .86, .15, "u", MAT.chrome, .05, 22);
        disc(L + .012, .66 * s, .86, .13, "u", MAT.lamp, .06, 22);
        disc(L + .014, .66 * s, .86, .11, "u", MAT.drl, .07, 22);
        disc(L + .016, .66 * s, .86, .085, "u", MAT.lamp, .08, 22);
        disc(L + .018, .66 * s, .86, .035, "u", MAT.head, .09, 12);
        onEnd(true, [[.56 * s, .66], [.8 * s, .66], [.8 * s, .7], [.56 * s, .7]], MAT.amber, .05);
      }
      // the indicators on the wings, the G's own
      both((s) => boxL(L - .3, L - .06, Math.min(.8 * s, .95 * s), Math.max(.8 * s, .95 * s), 1.08, 1.15, MAT.amber));
      // flares, the rubbing strip, the door seams and handles, the exhausts out of the sills
      for (const uw of [1.23, 4.12]) {
        const pts = [];
        for (let i = 0; i <= 12; i++) { const a = Math.PI * (i / 12); pts.push([uw + Math.cos(a) * .47, .44 + Math.sin(a) * .47]); }
        for (let i = 12; i >= 0; i--) { const a = Math.PI * (i / 12); pts.push([uw + Math.cos(a) * .57, .44 + Math.sin(a) * .57]); }
        onSide(pts, MAT.trim, .03, .02);
      }
      onSide([[.25, .86], [4.7, .86], [4.7, .93], [.25, .93]], MAT.trim, .02, .01);
      for (const u of [1.18, 2.24, 3.02]) onSide([[u, .42], [u + .012, .42], [u + .012, 1.86], [u, 1.86]], MAT.trim, .025);
      for (const u of [1.32, 2.42]) onSide([[u, 1.0], [u + .14, 1.0], [u + .14, 1.04], [u, 1.04]], MAT.chrome, .03);
      for (const s of [1, -1]) for (const u0 of [1.92, 2.08]) boxL(u0, u0 + .12, s > 0 ? .96 : -1.04, s > 0 ? 1.04 : -.96, .32, .41, MAT.chrome);
      void onTop;
    },
    gt3({ onSide, onEnd, onTop, boxL, both, topH }) {
      // the back: the light strip right across, the lettering band, the diffuser, the titanium pipes
      onEnd(false, [[-.6, .64], [.6, .64], [.6, .7], [-.6, .7]], MAT.tail, .03);
      onEnd(false, [[-.57, .665], [.57, .665], [.57, .675], [-.57, .675]], { emit: lin("#ffd0d4") }, .04);
      onEnd(false, [[-.6, .25], [.6, .25], [.6, .44], [-.6, .44]], MAT.carbon, .02);
      for (let i = 0; i < 6; i++) onEnd(false, [[-.5 + i * .2, .24], [-.48 + i * .2, .24], [-.48 + i * .2, .42], [-.5 + i * .2, .42]], MAT.trim, .03);
      onEnd(false, [[-.25, .48], [.25, .48], [.25, .57], [-.25, .57]], MAT.plate, .03);
      for (const v of [-.11, .11]) { add2(onEnd, v); }
      function add2(fn, v) { fn(false, Array.from({ length: 12 }, (_, i) => [v + Math.cos((i / 12) * Math.PI * 2) * .05, .36 + Math.sin((i / 12) * Math.PI * 2) * .04]), { base: lin("#8a7fb0"), metal: .9, refl: 1, gloss: 1.2, F0: .6, diff: .4 }, .04); }
      // the engine lid's slats, the vents in the bonnet and over the front wheels
      for (let i = 0; i < 7; i++) onTop([[.22 + i * .06, -.4], [.25 + i * .06, -.4], [.25 + i * .06, .4], [.22 + i * .06, .4]], MAT.trim);
      for (const s of [1, -1]) {
        onTop([[3.95, .1 * s], [4.25, .1 * s], [4.25, .42 * s], [3.95, .42 * s]], MAT.well);
        for (let i = 0; i < 5; i++) onTop([[3.42 + i * .08, .68 * s], [3.46 + i * .08, .68 * s], [3.46 + i * .08, .88 * s], [3.42 + i * .08, .88 * s]], MAT.trim);
      }
      onSide([[1.55, .56], [1.85, .58], [1.85, .78], [1.6, .76]], MAT.well, .03, .01);
      for (const u of [1.88, 2.95]) onSide([[u, .3], [u + .012, .3], [u + .012, 1.24], [u, 1.24]], MAT.trim, .025);
      // the swan-neck wing
      const wh = 1.36;
      boxL(.02, .44, -.86, .86, wh, wh + .035, MAT.carbon, .05);
      boxL(.02, .2, -.86, .86, wh + .05, wh + .075, MAT.carbon, .06);
      for (const s of [1, -1]) boxL(0, .46, s > 0 ? .86 : -.89, s > 0 ? .89 : -.86, wh - .12, wh + .09, MAT.carbon, .07);
      both((s) => { const v0 = .3 * s, h0 = topH(.32, .3); boxL(.29, .35, Math.min(v0, v0 + .03 * s), Math.max(v0, v0 + .03 * s), h0, wh + .1, MAT.trim, .055); boxL(.16, .35, Math.min(v0, v0 + .03 * s), Math.max(v0, v0 + .03 * s), wh + .075, wh + .1, MAT.trim, .065); });
    },
    svj({ L, onSide, onEnd, onTop, boxL, both, topH }) {
      // the front: the big black intakes, the splitter, the Y in each lamp
      for (const s of [1, -1]) {
        onEnd(true, [[.3 * s, .2], [.64 * s, .2], [.6 * s, .38], [.36 * s, .4]], MAT.well, .02);
        for (let i = 0; i < 3; i++) onEnd(true, [[(.36 + i * .1) * s, .22], [(.38 + i * .1) * s, .22], [(.38 + i * .1) * s, .38], [(.36 + i * .1) * s, .38]], MAT.carbon, .03);
        onTop([[4.45, .56 * s], [4.86, .68 * s], [4.84, .9 * s], [4.5, .94 * s]], MAT.lamp);
        onTop([[4.52, .7 * s], [4.82, .76 * s], [4.81, .79 * s], [4.53, .74 * s]], MAT.drl, .04);
        onTop([[4.6, .72 * s], [4.66, .86 * s], [4.64, .88 * s], [4.58, .74 * s]], MAT.drl, .04);
      }
      onEnd(true, [[-.22, .2], [.22, .2], [.22, .3], [-.22, .3]], MAT.well, .02);
      onEnd(true, [[-.64, .17], [.64, .17], [.64, .21], [-.64, .21]], MAT.carbon, .025);
      for (const s of [1, -1]) onTop([[3.7, .18 * s], [4.6, .2 * s], [4.6, .22 * s], [3.7, .2 * s]], { ...MAT.trim, refl: .6 }, .015);
      // the engine under glass, the louvres, the side intakes, the doors
      onTop([[.85, -.32], [1.42, -.36], [1.42, .36], [.85, .32]], MAT.glass);
      for (let i = 0; i < 5; i++) onTop([[.25 + i * .1, -.5], [.29 + i * .1, -.5], [.29 + i * .1, .5], [.25 + i * .1, .5]], MAT.trim);
      onSide([[1.5, .46], [2.05, .7], [2.05, .78], [1.62, .8], [1.45, .6]], MAT.well, .03, .01);
      onSide([[1.6, .5], [1.98, .7], [1.98, .73], [1.6, .55]], MAT.carbon, .04, .012);
      for (const u of [1.95, 2.98]) onSide([[u, .3], [u + .012, .3], [u + .012, 1.06], [u, 1.06]], MAT.trim, .025);
      // the wing, on two pylons
      const wh = 1.24;
      boxL(.05, .46, -.95, .95, wh, wh + .035, MAT.carbon, .05);
      for (const s of [1, -1]) boxL(.02, .5, s > 0 ? .95 : -.98, s > 0 ? .98 : -.95, wh - .1, wh + .08, MAT.carbon, .07);
      both((s) => { const v0 = .36 * s, h0 = topH(.3, .36); boxL(.22, .32, Math.min(v0, v0 + .04 * s), Math.max(v0, v0 + .04 * s), h0, wh, MAT.carbon, .055); });
      void L;
    },
    sf90({ L, onSide, onEnd, onTop }) {
      // the front: slim lamps along the bonnet's edge, the grille, the splitter
      for (const s of [1, -1]) {
        onTop([[4.22, .5 * s], [4.62, .62 * s], [4.6, .74 * s], [4.25, .82 * s]], MAT.lamp);
        onTop([[4.26, .62 * s], [4.58, .66 * s], [4.57, .69 * s], [4.27, .7 * s]], MAT.drl, .04);
        onEnd(true, [[.3 * s, .25], [.48 * s, .27], [.46 * s, .36], [.32 * s, .36]], MAT.well, .02);
      }
      onEnd(true, [[-.26, .23], [.26, .23], [.23, .36], [-.23, .36]], MAT.well, .02);
      for (let i = 0; i < 5; i++) onEnd(true, [[-.2 + i * .1, .25], [-.185 + i * .1, .25], [-.185 + i * .1, .34], [-.2 + i * .1, .34]], MAT.trim, .03);
      onEnd(true, [[-.48, .18], [.48, .18], [.48, .22], [-.48, .22]], MAT.carbon, .025);
      // the scoop ahead of the back wheel, the shield on the wing, the door
      onSide([[1.42, .52], [1.88, .58], [1.88, .8], [1.5, .74]], MAT.well, .03, .01);
      onSide([[3.95, .6], [4.05, .6], [4.05, .69], [3.95, .69]], MAT.yellow, .04, .012);
      onSide([[3.985, .625], [4.015, .625], [4.015, .665], [3.985, .665]], MAT.trim, .05, .014);
      for (const u of [1.96, 2.95]) onSide([[u, .3], [u + .012, .3], [u + .012, 1.1], [u, 1.1]], MAT.trim, .025);
      void L;
    },
  };

  // ------------------------------------------------------------------ drawing
  // project(x, y, zpx) → [sx, sy] on the target; opts.mirror: the car seen in the glossy floor under it
  function draw(g, spec, project, opts = {}) {
    const car = build(spec), base = spec.baseZ || 0;
    const list = [];
    for (const f of car.faces) {
      const pts = opts.mirror ? f.p.map(([x, y, z]) => [x, y, 2 * base - z]) : f.p;
      const n = opts.mirror ? [f.n[0], f.n[1], -f.n[2]] : f.n;
      if (dot(n, VIEW) <= 0.002 && !f.mat.emit) continue;
      if (f.mat.emit && dot(n, VIEW) < -.2) continue;
      let depth = 0;
      for (const [x, y, z] of pts) depth += x * VIEW[0] + y * VIEW[1] + (z / ZS) * VIEW[2];
      list.push({ pts, n, f, depth: depth / pts.length + f.bias });
    }
    list.sort((a, b) => a.depth - b.depth);
    g.save();
    g.lineJoin = "round";
    for (const it of list) {
      const col = it.f.css && !opts.mirror ? it.f.css : shade(it.f.mat, it.n, it.f.seed);
      if (!opts.mirror) it.f.css = col;
      g.beginPath();
      it.pts.forEach((q, i) => { const [sx, sy] = project(q[0], q[1], q[2]); i ? g.lineTo(sx, sy) : g.moveTo(sx, sy); });
      g.closePath();
      g.fillStyle = col; g.fill();
      g.strokeStyle = col; g.lineWidth = opts.seam || .6; g.stroke();          // closes the hairline between neighbours
    }
    g.restore();
  }
  // where the car is on the small canvas (for hover and clicks), from its own faces
  function bounds(spec, P) {
    const car = build(spec);
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const f of car.faces) for (const [x, y, z] of f.p) { const [sx, sy] = P(x, y, z); x0 = Math.min(x0, sx); y0 = Math.min(y0, sy); x1 = Math.max(x1, sx); y1 = Math.max(y1, sy); }
    return [x0, y0, x1, y1];
  }
  // where each light of a car is, for the glow painted over it
  function lamps(spec) {
    const car = build(spec), out = [];
    for (const f of car.faces) if (f.mat === MAT.head || f.mat === MAT.tail || f.mat === MAT.drl) {
      if (dot(f.n, VIEW) <= 0) continue;
      const c = f.p.reduce((a, q) => [a[0] + q[0] / f.p.length, a[1] + q[1] / f.p.length, a[2] + q[2] / f.p.length], [0, 0, 0]);
      out.push({ at: c, color: f.mat === MAT.tail ? "#ff2a3a" : "#e4f2ff" });
    }
    return out;
  }
  const length = (model) => MODELS[model].L;
  return { draw, bounds, lamps, length, ZS };
})();
