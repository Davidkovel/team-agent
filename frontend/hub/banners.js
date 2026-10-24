// The Hub's own banners, the way a Mac and an iPhone show a notification (Marco, 24 out: «melhora as notificações... tem que
// ser diferente quando é online... estilo MacBook e iOS, clean»). Two looks:
//   hubBanner(n)            a notification from the server: app icon (or who wrote, for a message), what it is and when,
//                           the title in bold, two lines of text. Top right on the computer, top of the screen on the phone.
//   hubPresence(name, on)   somebody came online or left: a small black pill at the top centre, like the iPhone's island.
// Up to three banners at once, one under the other; the rest wait. The mouse on a banner keeps it; a swipe on the phone (up or
// sideways) puts it away. Nothing is shown for the page that is already open: that page is the notification.
const BN_MAX = 3;
const BN_KIND = {
  task_new: ["tasks", "Tarefa nova"], task: ["tasks", "Tarefas"], task_completed: ["check", "Tarefa concluída", "ok"],
  approval_required: ["alert", "Pede aprovação", "warn"], approval_decided: ["check", "Aprovação"],
  agent_failed: ["alert", "Agente falhou", "bad"], agent_waiting: ["clock", "Agente à espera", "warn"],
  message: ["chat", "Mensagem"], market_alert: ["bolt", "Mercados"], market_investor: ["bolt", "Mercados"],
  market_insider: ["bolt", "Mercados"], sinal: ["bolt", "Sinal"], gap: ["bolt", "Gap da manhã"], etsy: ["bag", "Etsy"],
};
const bnQueue = [];
function bnBox() {
  let box = $("bn");
  if (!box) { box = Object.assign(document.createElement("div"), { id: "bn", className: "bn" }); box.setAttribute("aria-live", "polite"); document.body.append(box); }
  return box;
}
function bnHold(n) { return n.severity === "high" ? 9000 : n.severity === "medium" || n.directed ? 7000 : 5500; }

function hubBanner(n) {
  if (n.href && n.href === location.hash) return;   // already looking at it
  bnQueue.push(n);
  bnNext();
}
function hubBanners(list) {
  if (list.length > BN_MAX) {   // a computer that was asleep, catching up: one banner says how many, the bell has them all
    const talk = list.every((n) => n.kind === "message");
    return hubBanner({ kind: talk ? "message" : "", severity: list.some((n) => n.severity === "high") ? "high" : "info",
      title: t(talk ? "{n} mensagens novas" : "{n} notificações novas", { n: list.length }), body: list.slice(0, 3).map((n) => n.title).join(" · "),
      href: talk ? "#/mensagens" : "", created_at: new Date().toISOString(), many: true });
  }
  list.forEach(hubBanner);
}
function bnNext() {
  const box = bnBox();
  while (bnQueue.length && box.querySelectorAll(".bn-card:not(.out)").length < BN_MAX) bnShow(bnQueue.shift());
}
function bnShow(n) {
  const [ic, kind, tone] = BN_KIND[n.kind] || ["bell", "Agente AMG"];
  const msg = n.kind === "message" && !n.many, who = msg ? n.title.replace(/^Mensagem de /, "").replace(/ na Equipa$/, "") : "";
  const accent = tone || (n.severity === "high" && !msg ? "bad" : n.directed ? "warn" : "");
  // "Kovel mandou uma tarefa a Marco: Widget: horas" reads as "Tarefa nova · Kovel" over "Widget: horas", like a Mac would
  const p = !msg && !n.many && window.notifParts ? notifParts(n) : { who: "", title: n.title };
  const head = msg ? (n.title.endsWith("na Equipa") ? t("Equipa") : t("Mensagem")) : p.who ? `${t(kind)} · ${p.who}` : t(kind);
  const el = document.createElement("a");
  el.className = `bn-card ${accent ? "bn-" + accent : ""}`;
  el.href = n.href || "#/home";
  el.innerHTML = `<span class="bn-ic">${msg ? ui.avatar(who, "bn-av") : `<img src="assets/icon-192.png" alt="">`}${msg ? `<img class="bn-app" src="assets/icon-192.png" alt="">` : ""}</span>
    <span class="bn-txt"><span class="bn-top"><em>${accent ? '<i class="bn-dot"></i>' : ""}${esc(head)}</em><time>${esc(bnWhen(n.created_at))}</time></span>
      <b>${esc(msg ? who : p.title || n.title)}</b>${n.body ? `<span class="bn-body">${esc(n.body)}</span>` : ""}</span>
    <button type="button" class="bn-x" aria-label="${esc(t("Fechar"))}">${icon("x")}</button>`;
  el.onclick = (e) => {
    if (e.target.closest(".bn-x")) { e.preventDefault(); return bnOut(el); }
    if (n.id) api("/api/notifications/read", { method: "POST", body: { ids: [n.id] } }).then(() => hubNews()).catch(() => {});
    bnOut(el);
  };
  bnTimer(el, bnHold(n));
  bnSwipe(el);
  bnBox().prepend(el);   // the newest on top, like a Mac
}
function bnWhen(iso) {
  const s = (Date.now() - new Date(iso || Date.now())) / 1000;
  return s < 60 ? t("agora") : fmt.ago(iso);
}
// the time on the screen pauses while the mouse is on it, so a banner being read does not run away
function bnTimer(el, ms) {
  let left = ms, from = Date.now(), timer = setTimeout(() => bnOut(el), left);
  el.onmouseenter = () => { clearTimeout(timer); left -= Date.now() - from; };
  el.onmouseleave = () => { from = Date.now(); timer = setTimeout(() => bnOut(el), Math.max(1500, left)); };
}
function bnSwipe(el) {
  let x0 = 0, y0 = 0, dx = 0, dy = 0;
  el.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = dy = 0; el.style.transition = "none"; }, { passive: true });
  el.addEventListener("touchmove", (e) => {
    dx = e.touches[0].clientX - x0; dy = Math.min(0, e.touches[0].clientY - y0);
    el.style.transform = Math.abs(dx) > -dy ? `translateX(${dx}px)` : `translateY(${dy}px)`;
  }, { passive: true });
  el.addEventListener("touchend", () => {
    el.style.transition = "";
    if (Math.abs(dx) > 70 || dy < -36) { el.dataset.swiped = "1"; return bnOut(el); }
    el.style.transform = "";
  });
  el.addEventListener("click", (e) => { if (el.dataset.swiped) e.preventDefault(); }, true);
}
function bnOut(el) {
  if (el.classList.contains("out")) return;
  el.classList.add("out");
  setTimeout(() => { el.remove(); bnNext(); }, 240);
}

// somebody came online / left: the pill at the top centre. Online is green and stays a little longer; leaving is grey and quiet.
function hubPresence(name, online) {
  let box = $("bn-island");
  if (!box) { box = Object.assign(document.createElement("div"), { id: "bn-island", className: "bn-island" }); document.body.append(box); }
  const el = document.createElement("div");
  el.className = `bn-pill ${online ? "on" : "off"}`;
  el.innerHTML = `${ui.avatar(name, "bn-av")}<span><b>${esc(String(name).split(" ")[0])}</b> ${esc(t(online ? "está online" : "saiu"))}</span><i class="bn-live"></i>`;
  box.append(el);
  while (box.children.length > 2) box.firstElementChild.remove();
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 260); }, online ? 4200 : 2800);
}
