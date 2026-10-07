// The crew of My Niggaz (crew.js), drawn at twice the detail of the cave: every cell here is half a pixel of the cave,
// so there is room for eyes and brows, lapels and tie knots, the folds of a cape, buttons, gloves and the shine on a
// shoe. Light comes from the left of the screen, every part is shaded, and each frame gets a dark outline so the
// characters read on the dark floor. A frame is drawn once and kept: sprite() caches it by costume, pose and step.
window.CrewPeople = (function () {
  const GW = 20, GH = 48, MX = 6, MY = 12;             // the 20 × 48 grid, and the room around it in a frame
  const FW = GW + 2 * MX, FH = GH + MY + 2;
  const memo = {};
  function sh(hex, f) {
    const id = hex + f;
    if (memo[id]) return memo[id];
    const n = parseInt(hex.slice(1), 16);
    const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f));
    return (memo[id] = "#" + c.map((v) => v.toString(16).padStart(2, "0")).join(""));
  }
  const INK = "#07080b";

  // ------------------------------------------------------------------ one figure
  // dir: se/sw face us (sw is se mirrored), ne/nw turn their back. pose: stand, walk, sit, sleep, desk, deskWait,
  // deskDone, train, think, phone, drink, play, look. f: the step of the pose's animation. seat: height of the seat, px.
  function draw(g, L, o) {
    const back = o.dir === "ne" || o.dir === "nw", flip = o.dir === "sw" || o.dir === "nw";
    const pose = o.pose, f = o.f || 0;
    const sitting = /^(sit|sleep|desk)/.test(pose);
    const walk = pose === "walk";
    let up = sitting ? (7 - (o.seat || 7)) * 2 : 0;
    if (walk && f % 2) up -= 1;
    if (pose === "desk" && f === 2) up += 1;
    up += o.hop || 0;
    const R = (cx, cy, w, h, c, fixed) => {
      if (!c || w <= 0 || h <= 0) return;
      g.fillStyle = c;
      g.fillRect(flip ? MX + GW - cx - w : MX + cx, MY + cy + (fixed ? (o.hop || 0) : up), w, h);
    };
    const lit = (cx, w) => (flip ? cx + w - 1 : cx), dim = (cx, w) => (flip ? cx : cx + w - 1);
    // a block with light on the screen-left edge and shade on the other
    const S = (cx, cy, w, h, c, fixed) => {
      R(cx, cy, w, h, c, fixed);
      if (w > 2) { R(lit(cx, w), cy, 1, h, sh(c, .18), fixed); R(dim(cx, w), cy, 1, h, sh(c, -.28), fixed); }
      if (h > 3) R(cx, cy + h - 1, w, 1, sh(c, -.2), fixed);
    };
    const skin = L.skin, skinD = sh(skin, -.2), skinDD = sh(skin, -.38), skinL = sh(skin, .14);
    const suit = L.suit, suitD = sh(suit, -.3), suitDD = sh(suit, -.5), suitL = sh(suit, .16);
    const sleeve = L.sleeves || suit, sleeveD = sh(sleeve, -.3), sleeveL = sh(sleeve, .16);
    const hands = L.hands || skin, pants = L.pants, pantsD = sh(pants, -.3), pantsL = sh(pants, .12);
    const sleepy = pose === "sleep";
    const hx = sleepy ? 1 : 0, hy = sleepy ? 2 : 0;
    const H = (cx, cy, w, h, c) => R(cx + hx, cy + hy, w, h, c);
    const sway = walk ? (f === 1 ? 1 : f === 3 ? -1 : 0) : 0;

    // ---- the cape seen from the front: its lining down both sides
    if (L.cape && !back) {
      const c = L.capeIn || L.cape, long = sitting ? 14 : 25;
      R(0, 20, 2, long, sh(c, -.15)); R(18, 20, 2, long + (sway > 0 ? 2 : 0), sh(c, -.25));
      R(1, 20, 1, long, c); R(18, 21, 1, long - 2, c);
    }
    // ---- legs and shoes
    if (!sitting) {
      const la = walk && f === 1 ? 2 : 0, lb = walk && f === 3 ? 2 : 0, boot = L.cape || L.cowl ? 6 : L.coat ? 0 : 0;
      S(4, 34, 6, 12 - la, pants, true); S(10, 34, 6, 12 - lb, pantsD, true);
      R(9, 36, 1, 10, sh(pants, -.45), true);                                  // the seam between the legs
      if (L.coat) { R(4, 34, 12, 3, suit, true); R(4, 34, 12, 1, suitL, true); R(9, 34, 2, 3, suitD, true); }
      if (boot) { S(4, 46 - la - boot, 6, boot, L.shoes, true); S(10, 46 - lb - boot, 6, boot, sh(L.shoes, -.1), true); }
      // shoes: a sole, a toe that points the way we face, a shine
      R(3, 46 - la, 7, 2, L.shoes, true); R(10, 46 - lb, 7, 2, sh(L.shoes, -.12), true);
      R(3, 47 - la, 7, 1, INK, true); R(10, 47 - lb, 7, 1, INK, true);
      R(back ? 4 : 7, 46 - la, 2, 1, sh(L.shoes, .45), true); R(back ? 11 : 14, 46 - lb, 2, 1, sh(L.shoes, .4), true);
    } else if (!back) {
      S(4, 32, 14, 4, pants);                                                   // the lap, towards us
      R(4, 32, 14, 1, pantsL);
      S(11, 36 + up, 3, 10 - up, pants, true); S(14, 36 + up, 3, 10 - up, pantsD, true);
      R(10, 46, 4, 2, L.shoes, true); R(14, 46, 5, 2, sh(L.shoes, -.12), true); R(16, 46, 2, 1, sh(L.shoes, .45), true);
    }
    // ---- the body
    S(4, 20, 12, 14, suit);
    if (!back) {
      R(5, 22, 2, 2, suitL); R(13, 22, 2, 2, suitD);                           // shoulders catching the light
      if (L.tie || L.bowtie) {                                                  // the jacket open over a shirt
        R(7, 20, 6, 5, L.shirt); R(6, 20, 1, 3, sh(L.shirt, -.15)); R(13, 20, 1, 3, sh(L.shirt, -.25));
        R(6, 23, 1, 4, suitD); R(13, 23, 1, 4, suitDD); R(7, 25, 1, 2, suitD); R(12, 25, 1, 2, suitDD);   // lapels
        if (L.tie) { R(9, 21, 2, 2, sh(L.tie, -.25)); R(9, 23, 2, 9, L.tie); R(10, 23, 1, 9, sh(L.tie, -.2)); R(9, 25, 2, 1, sh(L.tie, .25)); R(9, 28, 2, 1, sh(L.tie, .25)); R(9, 31, 2, 1, sh(L.tie, -.35)); }
        if (L.bowtie) { R(7, 21, 6, 2, L.bowtie); R(9, 21, 2, 2, "#000000"); R(7, 21, 1, 1, sh(L.bowtie, .3)); R(9, 25, 1, 1, "#9aa1ab"); R(9, 28, 1, 1, "#9aa1ab"); if (L.vestUnder) R(7, 24, 6, 6, L.vestUnder); }
        R(5, 27, 2, 1, "#f4f4f4");                                              // the pocket square
        R(13, 29, 1, 1, sh(suit, .35)); R(13, 32, 1, 1, sh(suit, .35));          // buttons
      }
      if (L.vest) {                                                            // the Joker: green waistcoat over an orange shirt
        R(8, 20, 4, 3, L.shirt); R(7, 23, 6, 9, L.vest); R(7, 23, 1, 9, sh(L.vest, .2)); R(12, 23, 1, 9, sh(L.vest, -.3));
        for (const yy of [25, 28, 31]) R(9, yy, 2, 1, "#e9d06a");
        R(7, 21, 2, 2, sh(L.vest, -.2)); R(11, 21, 2, 2, sh(L.vest, -.2));
        R(5, 23, 1, 2, "#e0b83a");                                              // a flower in the lapel
      }
      if (L.emblem === "bat") {                                                // the bat across the chest
        R(9, 22, 2, 1, INK); R(5, 23, 10, 1, INK); R(4, 24, 3, 1, INK); R(13, 24, 3, 1, INK); R(8, 24, 4, 1, INK); R(6, 25, 2, 1, INK); R(12, 25, 2, 1, INK); R(9, 25, 2, 2, INK);
        R(6, 27, 3, 3, suitL); R(11, 27, 3, 3, suitD);                          // the chest, under the bat
      }
      if (L.emblem === "robin") { R(5, 22, 5, 5, "#ffd23f"); R(5, 22, 5, 1, "#fff2a6"); R(6, 23, 1, 3, INK); R(7, 23, 2, 1, INK); R(8, 24, 1, 1, INK); R(7, 25, 1, 1, INK); R(8, 26, 1, 1, INK); R(14, 22, 1, 10, sh(suit, -.3)); }
      if (L.zip) { R(9, 20, 1, 13, "#8a909c"); R(9, 20, 1, 1, "#d4d8de"); }
      if (L.sheen) { R(6, 22, 1, 8, L.sheen); R(13, 24, 1, 6, sh(L.sheen, -.3)); }
      if (L.coat) { R(4, 30, 12, 2, suitD); R(9, 30, 2, 2, "#c9a24a"); R(6, 20, 1, 9, suitD); R(13, 20, 1, 9, suitDD); }
      if (!L.tie && !L.bowtie && !L.vest && !L.cowl && !L.cape && !L.zip) R(8, 20, 4, 2, skinD);
    } else {
      R(9, 21, 2, 11, suitD);                                                   // the back seam
      if (L.coat) { R(4, 30, 12, 2, suitD); R(9, 32, 2, 2, suitDD); }
      if (L.tie || L.bowtie) R(7, 20, 6, 1, L.shirt);                          // the collar
    }
    if (L.belt) { R(4, 31, 12, 3, L.belt); R(4, 31, 12, 1, sh(L.belt, .35)); R(9, 31, 2, 3, sh(L.belt, .5)); R(5, 32, 2, 2, sh(L.belt, -.25)); R(13, 32, 2, 2, sh(L.belt, -.25)); }

    // ---- arms
    const hand = (cx, cy) => { R(cx, cy, 2, 2, hands); R(cx, cy, 1, 1, sh(hands, .2)); };
    const arm = (side, cy, h) => {
      const cx = side ? 16 : 2;
      R(cx, cy, 2, h, side ? sleeveD : sleeveL); R(side ? cx + 1 : cx, cy, 1, h, side ? sh(sleeve, -.45) : sleeve);
      R(cx, cy + h - 2, 2, 1, sh(sleeve, -.2));                                 // the cuff
      hand(cx, cy + h);
    };
    switch (pose) {
      case "walk": arm(0, 22 + (f === 1 ? 2 : f === 3 ? -2 : 0), 10); arm(1, 22 + (f === 3 ? 2 : f === 1 ? -2 : 0), 10); break;
      case "desk":
        R(0, 24 - (f % 2) * 2, 4, 4, sleeveD); R(16, 22 + (f % 2) * 2, 4, 4, sleeveL); hand(0, 28 - (f % 2) * 2); hand(18, 26 + (f % 2) * 2);
        break;
      case "deskWait": R(0, 10, 4, 4, sleeveD); R(16, 10, 4, 4, sleeveL); R(2, 14, 2, 8, sleeveD); R(16, 14, 2, 8, sleeveL); break;
      case "deskDone": R(0, 4, 2, 18, sleeveD); R(18, 4, 2, 18, sleeveL); hand(0, 2); hand(18, 2); break;
      case "train":
        if (f % 2) { R(16, 16, 4, 6, sleeveL); hand(18, 14); R(0, 24, 4, 4, sleeveD); hand(0, 22); }
        else { R(0, 16, 4, 6, sleeveD); hand(0, 14); R(16, 24, 4, 4, sleeveL); hand(18, 22); }
        break;
      case "think": arm(0, 22, 10); R(16, 22, 2, 4, sleeveL); R(14, 20, 2, 2, sleeveL); hand(12, 18); break;
      case "phone":
        R(2, 22, 2, 6, sleeveL); R(16, 22, 2, 6, sleeveD); R(4, 28, 4, 2, sleeveL); R(12, 28, 4, 2, sleeveD);
        R(8, 26, 4, 6, "#0b0d12"); R(8, 26, 4, 5, "#1d4a7a"); R(9, 27, 2, 1, "#9fe3ff"); hand(6, 29); hand(12, 29);
        break;
      case "drink":
        arm(0, 22, 10);
        if (f % 2) { R(16, 16, 2, 8, sleeveL); hand(14, 15); R(13, 13, 3, 4, "#f4f4f4"); R(13, 13, 3, 1, "#5a3a22"); }
        else { R(16, 22, 2, 6, sleeveL); hand(16, 28); R(16, 25, 3, 4, "#f4f4f4"); R(16, 25, 3, 1, "#5a3a22"); }
        break;
      case "play": R(0, 24 - (f % 2) * 2, 4, 4, sleeveD); R(16, 22 + (f % 2) * 2, 4, 4, sleeveL); break;
      case "sit": case "sleep": arm(0, 24, 6); arm(1, 24, 6); break;
      default: arm(0, 22, 10); arm(1, 22, 10);
    }
    // ---- the cape seen from behind: over the back and the arms, folds, a scalloped hem
    if (L.cape && back) {
      const c = L.cape, long = sitting ? 15 : 25;
      R(1, 20, 18, long, c); R(1, 20, 18, 2, sh(c, .25));
      for (const fx of [4, 9, 14]) { R(fx, 23, 1, long - 4, sh(c, .14)); R(fx + 1, 23, 1, long - 4, sh(c, -.35)); }
      if (!sitting) for (let i = 0; i < 5; i++) R(1 + i * 4 + (sway > 0 ? 1 : 0), 45, 2, 2, c);
    }

    // ---- the head
    H(3, 5, 14, 15, skin); H(2, 7, 16, 11, skin);
    H(2, 7, 1, 11, skinL); H(15, 6, 2, 13, skinD); H(4, 19, 12, 1, skinD); H(6, 20, 8, 0, skinD);
    if (L.cowl) {
      const c = L.cowl, cL = sh(c, .3), cLL = sh(c, .5);
      if (back) { H(3, 4, 14, 16, c); H(2, 6, 16, 12, c); H(5, 5, 4, 2, cL); }
      else {
        H(3, 4, 14, 10, c); H(2, 6, 16, 8, c); H(2, 14, 3, 5, c); H(15, 14, 3, 5, c);          // over the head, down the cheeks
        H(4, 5, 5, 1, cLL); H(3, 6, 2, 4, cL);
        H(5, 10, 4, 1, sh(c, .2)); H(11, 10, 4, 1, sh(c, .2));                                // the brow ridge
        if (!sleepy) { H(6, 11, 3, 1, "#eaf2ff"); H(12, 11, 3, 1, "#eaf2ff"); H(6, 12, 1, 1, "#9fb4d6"); }
        H(5, 15, 10, 4, skin); H(5, 15, 2, 4, skinL); H(13, 15, 2, 4, skinD);
        H(8, 17, 4, 1, L.lips || skinDD); if (!L.lips) { H(7, 18, 1, 1, skinDD); H(12, 18, 1, 1, skinDD); }
      }
      if (L.ears === "bat") { H(4, 0, 2, 5, c); H(4, 0, 1, 1, cL); H(14, 0, 2, 5, c); H(5, -1, 1, 1, c); H(14, -1, 1, 1, c); }
      if (L.ears === "cat") { H(3, 1, 4, 3, c); H(4, 0, 2, 1, c); H(4, -1, 1, 1, c); H(13, 1, 4, 3, c); H(14, 0, 2, 1, c); H(15, -1, 1, 1, c); H(4, 2, 1, 1, cL); }
      if (L.goggles) {
        H(2, 7, 16, 2, "#26262e");
        H(4, 6, 5, 4, L.goggles); H(11, 6, 5, 4, L.goggles); H(5, 7, 2, 1, "#ffd0da"); H(12, 7, 2, 1, "#ffd0da");
        H(4, 9, 5, 1, sh(L.goggles, -.4)); H(11, 9, 5, 1, sh(L.goggles, -.4));
      }
    } else {
      hair(H, L, back, skin);
      if (!back) {
        H(3, 11, 2, 3, skinD); H(3, 12, 1, 1, skinDD);                           // the ear
        const ey = pose === "phone" ? 13 : 12;
        if (L.mask) {
          H(5, 10, 11, 4, L.mask); H(5, 10, 11, 1, sh(L.mask, .3));
          H(6, 11, 3, 2, "#f4f6fb"); H(12, 11, 3, 2, "#f4f6fb");
        } else if (sleepy) { H(6, 13, 3, 1, skinDD); H(12, 13, 3, 1, skinDD); }
        else {
          const brow = L.brow || L.hair || skinDD;
          H(6, ey - 2, 3, 1, brow); H(12, ey - 2, 3, 1, brow);
          H(6, ey, 3, 2, "#f4f6fb"); H(12, ey, 3, 2, "#f4f6fb");
          H(8, ey, 1, 2, L.eyes || "#1a1410"); H(14, ey, 1, 2, L.eyes || "#1a1410"); H(8, ey, 1, 1, "#000000"); H(14, ey, 1, 1, "#000000");
          if (L.smile) { H(5, ey + 2, 4, 1, "#4d5a4b"); H(11, ey + 2, 4, 1, "#4d5a4b"); H(5, ey - 1, 1, 1, "#4d5a4b"); }  // the Joker's tired eyes
        }
        if (L.glasses) {
          H(5, 11, 5, 4, "#2a2d34"); H(11, 11, 5, 4, "#2a2d34"); H(10, 12, 1, 1, "#2a2d34");
          H(6, 12, 3, 2, "#cfe3ff"); H(12, 12, 3, 2, "#cfe3ff"); H(6, 12, 1, 1, "#ffffff"); H(12, 12, 1, 1, "#ffffff");
          H(8, 13, 1, 1, "#34404f"); H(14, 13, 1, 1, "#34404f");
        }
        H(15, 13, 2, 3, skinD); H(15, 15, 1, 1, skinDD);                         // the nose, towards where we look
        if (L.beard) { H(4, 16, 12, 4, L.beard); H(3, 14, 2, 5, L.beard); H(15, 14, 2, 5, L.beard); H(8, 17, 4, 1, skinDD); H(5, 18, 2, 1, sh(L.beard, .25)); }
        if (L.mustache) { H(7, 16, 7, 2, L.mustache); H(7, 16, 7, 1, sh(L.mustache, .25)); H(6, 17, 1, 1, L.mustache); }
        if (L.smile) {                                                            // the grin, ear to ear
          H(4, 16, 12, 3, L.smile); H(3, 15, 1, 2, L.smile); H(16, 15, 1, 2, L.smile);
          H(5, 17, 10, 1, "#fbfbf4"); H(7, 17, 1, 1, "#c9c9c0"); H(10, 17, 1, 1, "#c9c9c0"); H(13, 17, 1, 1, "#c9c9c0");
        } else if (!L.beard && !L.mustache) { H(8, 17, 5, 1, skinDD); H(9, 18, 3, 1, skinD); }
        else if (!L.beard) H(8, 18, 5, 1, skinDD);
      } else {
        H(2, 11, 2, 3, skinD); H(16, 11, 2, 3, skinD);                          // ears, from behind
      }
      if (L.hat) {                                                              // the bowler, with its question mark
        const c = L.hat;
        H(3, -1, 14, 7, c); H(4, -2, 12, 1, c); H(4, -1, 4, 3, sh(c, .25)); H(5, -2, 3, 1, sh(c, .35));
        H(3, 4, 14, 2, L.hatBand); H(1, 6, 18, 2, sh(c, -.25)); H(1, 6, 18, 1, sh(c, .1));
        if (!back) { H(9, 0, 3, 1, L.hatBand); H(11, 1, 1, 1, L.hatBand); H(10, 2, 1, 1, L.hatBand); H(10, 4, 1, 0, L.hatBand); }
      }
    }
    const crown = L.hat ? -2 : L.ears ? -1 : L.style === "spiky" ? -1 : L.style === "slick" ? 0 : 3;
    return MY + crown + up + hy;
  }

  function hair(H, L, back, skin) {
    const c = L.hair, hl = sh(c, .3), dk = sh(c, -.3);
    switch (L.style) {
      case "slick":   // the Joker: green, combed back, far too much of it
        H(3, 1, 14, 8, c); H(2, 3, 2, 10, c); H(16, 3, 2, 6, c); H(1, 5, 2, 6, c);
        for (const x of [4, 7, 10, 13]) H(x, 2, 1, 6, hl);
        H(5, 1, 6, 1, sh(c, .45)); H(15, 8, 2, 3, dk);
        if (back) { H(2, 6, 16, 12, c); for (const x of [4, 8, 12, 15]) H(x, 7, 1, 10, hl); H(3, 16, 14, 2, dk); }
        break;
      case "spiky":   // Robin
        H(3, 2, 14, 6, c); H(2, 5, 2, 6, c); H(16, 5, 2, 4, c);
        H(4, 0, 2, 2, c); H(8, -1, 2, 3, c); H(12, 0, 2, 2, c); H(15, 1, 2, 2, c); H(6, 3, 4, 1, hl); H(11, 2, 3, 1, hl);
        if (back) { H(2, 6, 16, 10, c); H(4, 7, 3, 1, hl); H(10, 9, 4, 1, hl); }
        break;
      case "balding":  // Alfred: grey at the sides, the crown bare and shining
        H(5, 4, 8, 3, sh(skin, .1)); H(6, 5, 3, 1, sh(skin, .35));
        H(2, 7, 2, 7, c); H(16, 7, 2, 7, c); H(3, 6, 2, 2, c); H(15, 6, 2, 2, c); H(2, 8, 1, 4, hl);
        H(6, 10, 3, 1, c); H(12, 10, 3, 1, c);
        if (back) { H(2, 8, 16, 10, c); H(4, 9, 12, 1, hl); }
        break;
      case "short":
        H(3, 2, 14, 5, c); H(2, 4, 2, 6, c); H(16, 4, 2, 4, c); H(6, 2, 1, 4, hl); H(9, 2, 6, 1, hl); H(7, 3, 1, 1, dk);
        if (back) { H(2, 5, 16, 11, c); H(5, 6, 8, 1, hl); H(3, 14, 14, 1, dk); }
        break;
      case "side":     // under the Riddler's hat
        H(2, 8, 2, 5, c); H(16, 8, 2, 5, c); H(2, 8, 1, 3, hl);
        if (back) H(2, 8, 16, 9, c);
        break;
    }
  }

  // ------------------------------------------------------------------ frames, with an outline, kept
  const cache = new Map();
  function frame(L, id, o) {
    const key = `${id}|${o.dir}|${o.pose}|${o.f || 0}|${o.seat || 0}|${o.hop || 0}`;
    let fr = cache.get(key);
    if (fr) return fr;
    const c = document.createElement("canvas"); c.width = FW; c.height = FH;
    const g = c.getContext("2d");
    const top = draw(g, L, o);
    // the outline: the figure's shape, one cell wider all round, in near-black under it
    const out = document.createElement("canvas"); out.width = FW; out.height = FH;
    const q = out.getContext("2d");
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) q.drawImage(c, dx, dy);
    q.globalCompositeOperation = "source-in"; q.fillStyle = "rgba(4,5,8,.92)"; q.fillRect(0, 0, FW, FH);
    q.globalCompositeOperation = "source-over"; q.drawImage(c, 0, 0);
    fr = { c: out, ax: MX + GW / 2, ay: MY + GH, top };
    if (cache.size > 900) cache.clear();
    cache.set(key, fr);
    return fr;
  }
  // which step of its animation a pose is at, from the agent's clock
  function step(pose, tm) {
    switch (pose) {
      case "walk": return Math.floor(tm * 9) % 4;
      case "desk": return Math.floor(tm * 11) % 2 + (Math.floor(tm * 1.3) % 5 === 0 ? 2 : 0);
      case "train": case "play": return Math.floor(tm * 4.5) % 2;
      case "drink": return tm % 3 < 1 ? 1 : 0;
      default: return 0;
    }
  }
  // the figure for an agent now: { c, ax, ay } with (ax, ay) the feet, in half-pixels of the cave; top: the head
  function sprite(L, id, o) {
    const hop = o.hop > 0 ? -Math.round(Math.sin((o.hop / .35) * Math.PI) * 8) : 0;
    return frame(L, id, { dir: o.dir, pose: o.pose, f: step(o.pose, o.tm), seat: o.seat, hop });
  }
  // a still for the lists and the panel: from the waist up, or the whole figure
  function portrait(L, id, full) {
    const fr = frame(L, id, { dir: "se", pose: "stand", f: 0, seat: 0, hop: 0 });
    const c = document.createElement("canvas");
    c.width = FW - 4; c.height = full ? FH - 4 : 40;
    c.getContext("2d").drawImage(fr.c, -2, full ? -4 : -6);
    return c.toDataURL();
  }
  return { sprite, portrait, frame };
})();
