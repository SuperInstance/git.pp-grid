/**
 * page.ts — the Grid, rendered per instance.
 *
 * renderPage(cfg, all) bakes one instance's config into a generic
 * client. The client speaks HTTP to the instance's agent (GET
 * /api/grid?instance=…&seat=… for the seat's own projection, POST
 * /api/grid for the port's actions) and listens on the agent
 * socket for {version, digest} pings — a ping means "the record
 * grew; re-fetch YOUR seat's projection". The page never receives
 * another seat's payload: scoped and aggregate renderings are
 * computed on the server, so what a seat cannot see was never sent.
 *
 * Every instance's first screen carries the same shape:
 *   1. The switcher — one engine, many grids.
 *   2. The claim (shared) + the instance's tagline, its rule in
 *      plain words, and the engine's five primitives in one panel.
 *   3. The seats: renderings of the same record, one per scope.
 *   4. The grid: the big color is the standing value; events are
 *      highlights; a pending proposal wears amber hatching (a
 *      color, not a fact); a frozen cell is locked; a gap is a
 *      hole where nobody stands.
 *   5. The box: click any cell — the description and the equation.
 *   6. The port (propose / rule), the pull (artefacts per seat),
 *      the re-fold proof, and the record itself, in order.
 */

import type { InstanceConfig } from "./engine";
import { INSTANCE_ORDER } from "./instances";

const CLAIM = "One record. Every seat sees its scope. Nothing moves without a ruling.";

const PRIMITIVES = [
  ["Defaults stand", "the standing grid derives from a declared rule — silence inherits it, no meeting required."],
  ["Proposals are a color", "a pending delta against the default, never a fact, until another seat rules on it."],
  ["Reasons stay", "a rejection keeps its reason attached to the cell forever; nothing is edited, nothing is deleted."],
  ["Seats see their scope", "every rendering is computed server-side from the same record — what a seat can't see was never sent."],
  ["Pull, don't push", "take your artefact away (.ics, JSON); write only through the port, as a record, under your own name."],
];

export function renderPage(cfg: InstanceConfig, all: InstanceConfig[]): string {
  const clientCfg = {
    id: cfg.id,
    title: cfg.title,
    periodLabel: cfg.periodLabel,
    now: cfg.now,
    month: cfg.month,
    rows: cfg.rows,
    people: cfg.people,
    seats: cfg.seats,
  };
  const switcher = INSTANCE_ORDER.map((id) => all.find((c) => c.id === id))
    .filter((c): c is InstanceConfig => Boolean(c))
    .map(
      (c) =>
        `<a href="/?instance=${c.id}"><button class="inst${c.id === cfg.id ? " on" : ""}">${c.title}</button></a>`,
    )
    .join(" ");
  const seatButtons = cfg.seats
    .map((s) => `<button class="seat" data-seat="${s.id}">${s.label}</button>`)
    .join("\n      ");
  const primitives = PRIMITIVES.map(
    ([h, t]) => `<div class="prim"><b>${h}</b> — ${t}</div>`,
  ).join("\n      ");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Grid — ${cfg.title}</title>
<style>
  :root { color-scheme: dark; }
  body { font: 15px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace;
         background: #0d1117; color: #e6edf3; margin: 0 auto; max-width: 1060px; padding: 24px 16px 64px; }
  h1 { font-size: 22px; margin: 0; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .08em; color: #8b949e; margin: 26px 0 8px; }
  .tag { color: #8b949e; font-size: 13px; }
  .claim { font-size: 21px; font-weight: 700; line-height: 1.3; margin: 12px 0 4px; }
  .tagline { font-size: 16px; color: #c9d1d9; margin: 2px 0 8px; }
  .hero p { margin: 6px 0; max-width: 52rem; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 12px 16px; margin: 10px 0; }
  .rule { border-left: 3px solid #58a6ff; }
  .honest { border-left: 3px solid #9e6a03; color: #d8c58f; }
  .prims { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 18px; font-size: 13.5px; }
  .prim b { color: #e6edf3; }
  .bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 10px 0; }
  button, select, input, textarea { background: #161b22; color: #e6edf3; border: 1px solid #30363d;
         border-radius: 6px; padding: 6px 10px; font: inherit; }
  button { cursor: pointer; } button:hover { border-color: #58a6ff; }
  button.seat.on, button.inst.on { border-color: #e6edf3; background: #21262d; font-weight: 700; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: #f85149; display: inline-block; }
  .dot.on { background: #3fb950; }
  .dow { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; color: #8b949e; font-size: 12px; text-align: center; margin-bottom: 4px; }
  .month { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; margin-bottom: 14px; }
  .cell { position: relative; border: 1px solid #30363d; border-radius: 8px; min-height: 74px; padding: 6px 8px;
          cursor: pointer; overflow: hidden; background: #0d1117; }
  .cell:hover { border-color: #58a6ff; }
  .cell .num { font-weight: 700; font-size: 14px; }
  .cell .who { font-size: 11px; color: #c9d1d9; }
  .cell .ev { font-size: 11px; line-height: 1.35; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cell.today { outline: 2px solid #e6edf3; outline-offset: -2px; }
  .cell.gap { border: 1px dashed #da3633; background: repeating-linear-gradient(45deg, rgba(218,54,51,.12) 0 8px, transparent 8px 16px); }
  .cell.frozen { box-shadow: inset 0 0 0 2px #9e6a03; }
  .cell .moved { position: absolute; top: 6px; right: 8px; font-size: 10px; color: #8b949e; }
  .cell .pend { position: absolute; left: 0; right: 0; bottom: 0; font-size: 10.5px; padding: 2px 8px;
    background: repeating-linear-gradient(45deg, rgba(227,179,65,.35) 0 6px, rgba(227,179,65,.12) 6px 12px); color: #f0d48a; }
  .cell .face { font-size: 11px; line-height: 1.35; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cell .face-reason { color: #f0a35e; }
  .cell .face-note { color: #f0d48a; }
  .blank { border: 1px dashed #21262d; border-radius: 8px; min-height: 74px; }
  .legend { font-size: 12px; color: #8b949e; }
  .swatch { display: inline-block; width: 10px; height: 10px; border-radius: 3px; vertical-align: -1px; margin: 0 3px 0 8px; }
  .ding { border-left: 3px solid #e3b341; }
  .ding.res { border-left-color: #30363d; color: #8b949e; }
  .strike { text-decoration: line-through; color: #8b949e; }
  .reason { color: #f0a35e; }
  .hist { font-size: 13px; margin: 4px 0; }
  .kind { font-size: 10.5px; border: 1px solid #30363d; border-radius: 9px; padding: 0 7px; color: #8b949e; }
  .kind.proposal { color: #e3b341; border-color: #9e6a03; }
  .kind.accept { color: #3fb950; border-color: #238636; }
  .kind.reject { color: #f85149; border-color: #da3633; }
  pre { background: #010409; border: 1px solid #30363d; border-radius: 6px; padding: 10px; overflow-x: auto; white-space: pre-wrap; word-break: break-all; font-size: 12.5px; }
  .badge { font-weight: 700; padding: 2px 8px; border-radius: 10px; }
  .badge.ok { background: #238636; color: #fff; } .badge.bad { background: #da3633; color: #fff; }
  .digest { word-break: break-all; font-size: 12px; color: #8b949e; }
  table.agg { border-collapse: collapse; width: 100%; }
  table.agg td, table.agg th { border-bottom: 1px solid #30363d; padding: 6px 8px; text-align: left; font-size: 13.5px; }
  label { font-size: 12.5px; color: #8b949e; display: block; margin-top: 8px; }
  footer { color: #8b949e; margin-top: 40px; font-size: 13px; }
  a { color: #58a6ff; }
  @media (max-width: 820px) { .prims { grid-template-columns: 1fr; } .cell { min-height: 62px; } }
</style>
</head>
<body>
<header>
  <div class="bar" style="justify-content:space-between">
    <h1>The Grid <span class="tag">git.pp — one engine, many grids</span></h1>
    <span class="tag"><span class="dot" id="wsdot"></span> <span id="wslabel">connecting…</span></span>
  </div>
  <div class="bar" id="instbar">${switcher}</div>
  <div class="hero">
    <p class="claim">${CLAIM}</p>
    <p class="tagline">${cfg.tagline}</p>
    <p>${cfg.intro}</p>
    <p class="tag">${cfg.demoNote}</p>
  </div>
  <div class="card">
    <b>The engine, in five lines</b>
    <div class="prims" style="margin-top:8px">
      ${primitives}
    </div>
  </div>
  <div class="card rule">
    <b>The default.</b> <span id="ruletext">${cfg.ruleText}</span>
    <div class="tag" style="margin-top:6px">Silence means the default holds. Talk only happens at the delta — and the delta wears a color.</div>
  </div>
</header>

<h2>Sit in a seat — the same record, rendered for where you sit</h2>
<div class="bar" id="seatbar">
      ${seatButtons}
</div>
<div class="bar" id="humanbar" style="display:none">
  <span class="tag">agent for:</span>
  <span id="humanbtns"></span>
</div>
<div class="bar" id="pagerbar" style="display:none">
  <span class="tag">pager row:</span>
  <select id="pagerrow"></select>
  <span class="tag">pull:</span>
  <a id="pagerics" href="#" download>.ics</a>
  <a id="pagerjson" href="#" target="_blank">JSON</a>
</div>
<div id="inbox"></div>
<div id="main"></div>

<h2>Open a cell — the description and the equation</h2>
<div class="card" id="box"><span class="tag">Click any cell in a full-grid seat. Its default, what stands now, any freeze, every record that touched it — rejected ones struck through, reasons attached. A cell that can explain itself.</span></div>

<h2>The port — propose, counter-propose, and rule on what's pending</h2>
<div class="card" id="port">
  <div class="tag" id="acting"></div>
  <label>kind of proposal
    <select id="ptype">
      <option value="assign">assign a day</option>
      <option value="swap">swap two days</option>
      <option value="event">add an event</option>
    </select>
  </label>
  <div id="pfields"></div>
  <label>note — say why (a proposal against a frozen day must name its freeze here)
    <input id="pnote" style="width:100%" placeholder="e.g. conference Monday — trade?">
  </label>
  <label style="display:inline-block"><input type="checkbox" id="ptent"> tentative — I'm not sure yet</label>
  <label style="display:inline-block"><input type="checkbox" id="pcounter"> counter-proposal — answer a pending proposal with a different change of your own, instead of accepting or rejecting it: counter to proposal <input id="pcounterid" size="8" placeholder="e-0007"></label>
  <div class="bar"><button id="propose">Propose</button><span class="tag" id="pmsg"></span></div>
  <div class="tag">Pushes only happen here, as records, under your name. Rejecting another seat's proposal takes a reason — you'll be asked, and it stays attached forever. You cannot rule on your own proposal. To counter a proposal: use the “Counter — propose a different change” button on any pending proposal (in your inbox, or in its cell) — it brings you here with the proposal's id filled in; set the different change above, add a note, and Propose records it as a counter.</div>
</div>

<h2>Pull &amp; proof — artefacts out, and the re-fold</h2>
<div class="card">
  <div class="bar">
    <a id="pull" href="#" download>⬇ Pull my .ics</a>
    <span class="tag">— a copy to carry away; never a write back.</span>
  </div>
  <div class="tag">Projection digest (sha256 over the folded grid — the pin every seat is looking at):</div>
  <div class="digest" id="digest">…</div>
  <div class="bar" style="margin-top:10px">
    <button id="refold">Re-fold from the record alone</button>
    <span id="refoldmsg" class="tag"></span>
  </div>
  <div class="bar">
    <button id="reset">Reset demo to the seed record</button>
    <span class="tag">— demo hygiene; the seed is the opening position.</span>
  </div>
</div>

<h2>The record — everything that ever happened here</h2>
<div id="feed"></div>

<div class="card honest">
  <b>Honest label.</b> This record lives in this instance's own store — it is
  <i>an instance with the same operational fiction</i>, demonstrating the shape: a default that
  derives, a record that accumulates, a grid that is a pure fold, seats rendered
  server-side. The git-native substrate (git.pp, Cloudflare Artifacts) is its
  sibling submission.
</div>

<footer>
  Built by SuperInstance. The engine: cells · a default rule as data · an append-only
  record · proposals as colored pending deltas · seats as server-side projections ·
  ports that pull or append · insides that explain · a re-fold with a digest.
  Instances are config — this page's whole world is one entry in the registry.
  Part of the git.pp family, built for Cloudflare's next-gen git platform brief.
</footer>

<script>
var CFG = ${JSON.stringify(clientCfg)};
var INSTANCE = CFG.id;
var seatId = CFG.seats[0].id;
var agentSeat = CFG.seats.filter(function (s) { return s.kind === "agent"; })[0];
var pagerSeat = CFG.seats.filter(function (s) { return s.kind === "pager"; })[0];
var human = agentSeat ? agentSeat.person : null;
var pagerRow = pagerSeat ? pagerSeat.row : CFG.rows[0].id;
var view = null;
var cellMap = {};

function $(id) { return document.getElementById(id); }
function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }
function pname(id) { return id == null ? "nobody" : ((CFG.people[id] || {}).name || id); }
function pcolor(id) { return id == null ? "#da3633" : ((CFG.people[id] || {}).color || "#666"); }
function specOf(id) { return CFG.seats.filter(function (s) { return s.id === id; })[0]; }
function actingPerson() { var el = $("actingseat"); return el ? el.value : CFG.seats.filter(function (s) { return s.kind === "person"; })[0].person; }

async function getView() {
  var q = "/api/grid?instance=" + INSTANCE + "&seat=" + encodeURIComponent(seatId);
  var spec = specOf(seatId);
  if (spec && spec.kind === "agent") q += "&for=" + encodeURIComponent(human);
  if (spec && spec.kind === "pager") q += "&row=" + encodeURIComponent(pagerRow);
  var r = await fetch(q);
  return r.json();
}

async function post(action, extra) {
  var body = { instance: INSTANCE, action: action, seat: actingPerson() };
  Object.keys(extra || {}).forEach(function (k) { body[k] = extra[k]; });
  var r = await fetch("/api/grid", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
}

async function render() {
  view = await getView();
  if (view.error) { $("main").innerHTML = '<div class="card">' + esc(view.error) + "</div>"; return; }
  $("digest").textContent = view.digest || "—";
  document.querySelectorAll("#seatbar .seat").forEach(function (b) {
    b.classList.toggle("on", b.dataset.seat === seatId);
  });
  var spec = specOf(seatId);
  $("humanbar").style.display = spec && spec.kind === "agent" ? "" : "none";
  $("pagerbar").style.display = spec && spec.kind === "pager" ? "" : "none";
  renderInbox();
  renderFeed();
  if (view.view === "grid") renderGrid();
  else if (view.view === "events") renderEvents();
  else if (view.view === "aggregate") renderAggregate();
  else if (view.view === "list") renderList();
  else if (view.view === "pager") renderPager();
  updatePull();
}

function updatePull() {
  var a = $("pull");
  if (view.view === "grid") { a.style.display = ""; a.href = "/pull?instance=" + INSTANCE + "&seat=" + view.person; a.textContent = "⬇ Pull " + pname(view.person) + "'s .ics"; }
  else if (view.view === "list") { a.style.display = ""; a.href = "/pull?instance=" + INSTANCE + "&seat=" + human; a.textContent = "⬇ Pull " + pname(human) + "'s .ics"; }
  else a.style.display = "none";
}

function renderInbox() {
  var box = $("inbox");
  if (!view.inbox) { box.innerHTML = ""; return; }
  if (!view.inbox.length) { box.innerHTML = '<h2>Inbox</h2><div class="card"><span class="tag">Nothing waiting on ' + esc(pname(view.person)) + '.</span></div>'; return; }
  var h = "<h2>Inbox — waiting on " + esc(pname(view.person)) + "</h2>";
  view.inbox.forEach(function (it) {
    h += '<div class="card ding' + (it.type === "resolved-yours" ? " res" : "") + '">' + esc(it.text);
    if (it.type === "pending-yours" && it.proposalId) {
      h += '<div class="bar" style="margin:6px 0 0">' +
        '<button onclick="rule(\\'accept\\',\\'' + it.proposalId + '\\')">Accept</button>' +
        '<button onclick="rule(\\'reject\\',\\'' + it.proposalId + '\\')">Reject…</button>' +
        '<button onclick="prefillCounter(\\'' + it.proposalId + '\\')" title="Answer this proposal with a different change of your own — it goes to the port below, with this proposal\\'s id filled in">Counter — propose a different change</button></div>';
    }
    h += "</div>";
  });
  box.innerHTML = h;
}

function renderFeed() {
  var box = $("feed");
  if (!view.feed) { box.innerHTML = '<span class="tag">This seat does not receive the feed — its scope is narrower than the record.</span>'; return; }
  var h = "";
  view.feed.slice().reverse().forEach(function (e) {
    h += '<div class="hist"><span class="kind ' + e.kind + '">' + e.kind + '</span> ' + esc(e.summary) +
      (e.reason ? ' <span class="reason">— "' + esc(e.reason) + '"</span>' : "") +
      ' <span class="tag">' + esc(e.id) + " · " + esc(e.ts.slice(0, 10)) + "</span></div>";
  });
  box.innerHTML = h || '<span class="tag">The record is empty.</span>';
}

function faceReason(c) {
  // The latest settlement reason touching this cell, from the history
  // the payload already carries (the box's equation). Shown on the
  // face: a 30-second reader gets the reason without opening the cell.
  var hist = (c.box && c.box.history) || [];
  for (var i = hist.length - 1; i >= 0; i--) {
    if (hist[i].reason) return hist[i].reason;
  }
  return null;
}

function faceNote(c) {
  // The latest still-open proposal's note on this cell, if any.
  if (!c.pending || !c.pending.length) return null;
  var p = c.pending[c.pending.length - 1];
  return p && p.note ? p.note : null;
}

function cellHtml(rowId, c) {
  var cls = "cell" + (c.date === CFG.now ? " today" : "") + (c.value == null ? " gap" : "") + (c.freeze ? " frozen" : "");
  var bg = c.value == null ? "" : ' style="background:' + pcolor(c.value) + '2b"';
  var h = '<div class="' + cls + '"' + bg + ' onclick="openBox(\\'' + rowId + "','" + c.date + '\\')">';
  h += '<span class="num">' + Number(c.date.slice(8)) + "</span>";
  if (c.value !== c.defaultValue) h += '<span class="moved">◦ moved</span>';
  h += '<div class="who">' + (c.value == null ? "⚠ UNCOVERED" : esc(pname(c.value))) + (c.freeze ? " 🔒" : "") + "</div>";
  c.events.forEach(function (ev) { h += '<div class="ev">▸ ' + esc(ev.title) + (ev.time ? " " + esc(ev.time) : "") + "</div>"; });
  var fr = faceReason(c);
  if (fr) h += '<div class="face face-reason" title="' + esc(fr) + '">✕ rejected — ' + esc(fr) + "</div>";
  var fn = faceNote(c);
  if (fn) h += '<div class="face face-note" title="' + esc(fn) + '">◌ proposed — ' + esc(fn) + "</div>";
  if (c.pending && c.pending.length) h += '<div class="pend">◌ ' + c.pending.length + " pending</div>";
  return h + "</div>";
}

function renderGrid() {
  cellMap = {};
  var h = "";
  var DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  view.rows.forEach(function (row) {
    row.cells.forEach(function (c) { cellMap[row.id + "|" + c.date] = c; });
    if (view.rows.length > 1) h += "<h2>" + esc(row.label) + " — " + esc(view.periodLabel) + "</h2>";
    h += '<div class="dow">' + DOW.map(function (d) { return "<div>" + d + "</div>"; }).join("") + "</div>";
    h += '<div class="month">';
    var firstDow = new Date(row.cells[0].date + "T00:00:00Z").getUTCDay();
    for (var i = 0; i < firstDow; i++) h += '<div class="blank"></div>';
    row.cells.forEach(function (c) { h += cellHtml(row.id, c); });
    h += "</div>";
  });
  h += '<div class="legend">The big color is who stands on the cell. ◦ moved = an accepted proposal moved it off the default. 🔒 = under a freeze. ⚠ = a gap — nobody stands there.</div>';
  h += '<div class="legend">People:' + Object.keys(CFG.people).map(function (id) { return '<span class="swatch" style="background:' + CFG.people[id].color + '"></span>' + esc(CFG.people[id].name); }).join("") + "</div>";
  $("main").innerHTML = h;
}
</script>

<script>
function renderEvents() {
  var h = "<h2>" + esc(specOf(seatId).label) + " — the only days in this seat</h2>";
  h += '<div class="tag" style="margin-bottom:8px">This payload contains no responsibility field at all — open the network tab and check. Absence, not hiding.</div>';
  if (!view.days.length) h += '<div class="card">No matching days.</div>';
  view.days.forEach(function (d) {
    h += '<div class="card"><b>' + esc(d.weekday) + " " + esc(d.date) + "</b>";
    d.events.forEach(function (ev) {
      h += '<div class="hist">▸ ' + esc(ev.title) + (ev.time ? " at " + esc(ev.time) : "") + (ev.duty ? ' <span class="tag">(' + esc(ev.duty) + ")</span>" : "") + "</div>";
    });
    h += "</div>";
  });
  $("main").innerHTML = h;
}

function renderAggregate() {
  var h = "<h2>Coverage by row — aggregates only</h2>";
  h += '<div class="tag" style="margin-bottom:8px">This seat\\'s payload contains no names, no notes, no history — only coverage, gaps and pending counts. That is what the office schedules from.</div>';
  h += '<div class="card"><table class="agg"><tr><th>row</th><th>covered</th><th>gaps</th><th>pending</th><th>status</th></tr>';
  view.rows.forEach(function (r) {
    h += "<tr><td>" + esc(r.label) + "</td><td>" + r.covered + " / " + r.total + "</td><td>" +
      (r.gaps.length ? esc(r.gaps.join(", ")) : "—") + "</td><td>" + r.pending + "</td><td>" + esc(r.status) + "</td></tr>";
  });
  h += "</table><div class='tag' style='margin-top:6px'>Pending proposals across all rows: " + view.pendingCount + "</div></div>";
  $("main").innerHTML = h;
}

function renderList() {
  var h = "<h2>Dings for " + esc(pname(human)) + " — no grid, just what they need</h2>";
  if (!view.items.length) h += '<div class="card">Nothing.</div>';
  view.items.forEach(function (it) {
    h += '<div class="card ding">' + (it.date ? "<b>" + esc(it.date) + "</b> · " : "") + '<span class="kind">' + esc(it.kind) + "</span> " + esc(it.text) + "</div>";
  });
  $("main").innerHTML = h;
}

function renderPager() {
  var h = "<h2>The pager pull — one row, the next 72 hours</h2>";
  h += '<div class="tag" style="margin-bottom:8px">Window: ' + esc(view.window.from) + " → " + esc(view.window.to) + " (handover " + esc(CFG.now) + " at the instance handover time). A machine reads this, not a person.</div>";
  h += '<div class="card">';
  view.entries.forEach(function (en) {
    h += '<div class="hist"><b>' + esc(en.date) + "</b> — " + esc(en.name) + (en.handle ? ' <span class="tag">page: ' + esc(en.handle) + "</span>" : "") + "</div>";
  });
  h += "</div>";
  $("main").innerHTML = h;
}

function openBox(rowId, date) {
  var c = cellMap[rowId + "|" + date];
  if (!c) return;
  var b = c.box;
  var h = "<b>" + esc(date) + " · " + esc(rowId) + "</b>";
  h += '<div class="hist">' + esc(b.defaultLine) + "</div>";
  h += '<div class="hist">' + esc(b.standingLine) + "</div>";
  if (b.freezeLine) h += '<div class="hist" style="color:#f0d48a">🔒 ' + esc(b.freezeLine) + "</div>";
  b.events.forEach(function (ev) {
    h += '<div class="hist">▸ ' + esc(ev.title) + (ev.time ? " at " + esc(ev.time) : "") +
      ' <span class="tag">(' + esc(ev.kind) + (ev.for ? ", " + esc(pname(ev.for)) : "") + ")</span>";
    if (view.view === "grid") h += ' <button onclick="optin(\\'' + date + "','" + esc(ev.title).replace(/'/g, "\\'") + "','" + rowId + '\\')">remind me</button>';
    h += "</div>";
  });
  b.pending.forEach(function (p) {
    h += '<div class="card ding"><span class="kind proposal">pending</span> ' + esc(p.summary) + " — proposed by " + esc(pname(p.author)) +
      (p.tentative ? " (tentative)" : "") + (p.note ? '<br><span class="tag">“' + esc(p.note) + '”</span>' : "");
    if (p.author !== view.person) {
      h += '<div class="bar" style="margin:6px 0 0"><button onclick="rule(\\'accept\\',\\'' + p.id + '\\')">Accept</button>' +
        '<button onclick="rule(\\'reject\\',\\'' + p.id + '\\')">Reject…</button>' +
        '<button onclick="prefillCounter(\\'' + p.id + '\\')" title="Answer this proposal with a different change of your own — it goes to the port below, with this proposal\\'s id filled in">Counter — propose a different change</button></div>';
    } else h += '<div class="tag">Yours — it waits for another seat to rule.</div>';
    h += "</div>";
  });
  h += '<div style="margin-top:8px"><input id="bq" placeholder="ask a question or comment on this cell…" style="width:70%">' +
    ' <button onclick="boxSay(\\'' + rowId + "','" + date + '\\',\\'question\\')">Ask</button>' +
    ' <button onclick="boxSay(\\'' + rowId + "','" + date + '\\',\\'comment\\')">Comment</button></div>';
  h += "<h2 style='margin-top:14px'>The equation — every record that touched this cell</h2>";
  if (!b.history.length) h += '<span class="tag">Nothing has touched this cell. The default is the whole story.</span>';
  b.history.forEach(function (x) {
    var struck = x.kind === "proposal" && b.history.some(function (y) { return y.kind === "reject" && y.summary.indexOf(x.id) >= 0; });
    h += '<div class="hist' + (struck ? " strike" : "") + '"><span class="kind ' + x.kind + '">' + x.kind + "</span> " + esc(x.summary) +
      (x.reason ? ' <span class="reason">— "' + esc(x.reason) + '"</span>' : "") +
      ' <span class="tag">' + esc(x.id) + " · " + esc(x.author) + "</span></div>";
  });
  $("box").innerHTML = h;
  $("box").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function rule(action, pid) {
  var extra = { proposalId: pid };
  if (action === "reject") {
    var reason = prompt("Reject — with a reason. It stays attached forever:");
    if (!reason || !reason.trim()) { alert("A rejection must carry a reason."); return; }
    extra.reason = reason;
  }
  var r = await post(action, extra);
  if (r.error) alert(r.error);
  await render();
}

function prefillCounter(pid) {
  $("pcounter").checked = true;
  $("pcounterid").value = pid;
  $("pmsg").textContent = "Countering " + pid + " — set the different change above, add a note, then Propose: it is recorded as a counter to " + pid + ".";
  $("port").scrollIntoView({ behavior: "smooth" });
  $("pnote").focus();
}

async function boxSay(rowId, date, kind) {
  var text = $("bq").value;
  if (!text.trim()) return;
  var r = await post(kind, { text: text, day: date, row: rowId });
  if (r.error) alert(r.error);
  await render();
}

async function optin(date, title, rowId) {
  var r = await post("optin", { day: date, title: title, row: rowId });
  if (r.error) alert(r.error);
  await render();
}
</script>

<script>
function rowOptions(sel) {
  return CFG.rows.map(function (r) { return '<option value="' + r.id + '"' + (r.id === sel ? " selected" : "") + ">" + esc(r.label) + "</option>"; }).join("");
}
function peopleOptions(sel, allowNone) {
  var h = allowNone ? '<option value="">— nobody (drop coverage)</option>' : "";
  return h + Object.keys(CFG.people).map(function (id) { return '<option value="' + id + '"' + (id === sel ? " selected" : "") + ">" + esc(CFG.people[id].name) + "</option>"; }).join("");
}
function dateInput(id, val) {
  return '<input type="date" id="' + id + '" value="' + val + '" min="' + CFG.month + '-01" max="' + CFG.month + '-31">';
}

function buildFields() {
  var t = $("ptype").value;
  var h = "";
  if (t === "assign") {
    h = '<label>row <select id="prow">' + rowOptions(CFG.rows[0].id) + "</select></label>" +
      "<label>day " + dateInput("pday", CFG.now) + "</label>" +
      '<label>assign to <select id="pto">' + peopleOptions("", true) + "</select></label>";
  } else if (t === "swap") {
    h = '<label>first: row <select id="prowa">' + rowOptions(CFG.rows[0].id) + "</select> day " + dateInput("pdaya", CFG.now) + "</label>" +
      '<label>second: row <select id="prowb">' + rowOptions(CFG.rows[0].id) + "</select> day " + dateInput("pdayb", CFG.now) + "</label>";
  } else {
    h = '<label>row <select id="prow">' + rowOptions(CFG.rows[0].id) + "</select></label>" +
      "<label>day " + dateInput("pday", CFG.now) + "</label>" +
      '<label>title <input id="ptitle" placeholder="e.g. launch review"></label>' +
      '<label>time <input id="ptime" size="6" placeholder="10:00"></label>' +
      '<label>kind <input id="pkind" size="10" value="event"></label>';
  }
  $("pfields").innerHTML = h;
}

function readChange() {
  var t = $("ptype").value;
  if (t === "assign") return { type: "assign", row: $("prow").value, day: $("pday").value, to: $("pto").value || null };
  if (t === "swap") return { type: "swap", a: { row: $("prowa").value, day: $("pdaya").value }, b: { row: $("prowb").value, day: $("pdayb").value } };
  var c = { type: "event", row: $("prow").value, day: $("pday").value, title: $("ptitle").value, eventKind: $("pkind").value || "event" };
  if ($("ptime").value) c.time = $("ptime").value;
  return c;
}

$("ptype").addEventListener("change", buildFields);
$("propose").addEventListener("click", async function () {
  var change = readChange();
  var note = $("pnote").value;
  var r;
  if ($("pcounter").checked && $("pcounterid").value.trim()) {
    r = await post("counter", { proposalId: $("pcounterid").value.trim(), change: change, note: note });
  } else {
    r = await post("propose", { change: change, note: note, tentative: $("ptent").checked });
  }
  $("pmsg").textContent = r.error ? r.error : "Recorded as " + r.entry.id + " — it is a color on the grid until another seat rules.";
  if (!r.error) await render();
});

$("refold").addEventListener("click", async function () {
  var r = await post("refold", {});
  $("refoldmsg").innerHTML = r.identical
    ? 'Re-folded ' + r.logLength + ' records from the log alone: <span class="badge ok">DIGEST IDENTICAL ✓</span>'
    : '<span class="badge bad">DIGEST CHANGED ✗</span> — something other than the record was carrying state.';
  if (r.after) $("digest").textContent = r.after;
});
$("reset").addEventListener("click", async function () {
  if (!confirm("Reset this instance to its seed record?")) return;
  await post("reset", {});
  await render();
});

document.querySelectorAll("#seatbar .seat").forEach(function (b) {
  b.addEventListener("click", function () { seatId = b.dataset.seat; render(); });
});

// Agent-seat human toggle + pager row select + acting-person select.
(function init() {
  var hb = $("humanbtns");
  CFG.seats.filter(function (s) { return s.kind === "person"; }).forEach(function (s) {
    var b = document.createElement("button");
    b.textContent = CFG.people[s.person].name;
    if (s.person === human) b.classList.add("on");
    b.addEventListener("click", function () {
      human = s.person;
      hb.querySelectorAll("button").forEach(function (x) { x.classList.remove("on"); });
      b.classList.add("on");
      render();
    });
    hb.appendChild(b);
  });
  var pr = $("pagerrow");
  CFG.rows.forEach(function (r) {
    var o = document.createElement("option");
    o.value = r.id; o.textContent = r.label;
    if (r.id === pagerRow) o.selected = true;
    pr.appendChild(o);
  });
  pr.addEventListener("change", function () {
    pagerRow = pr.value;
    $("pagerics").href = "/pull?instance=" + INSTANCE + "&seat=pager&row=" + pagerRow;
    $("pagerjson").href = "/pull?instance=" + INSTANCE + "&seat=pager&row=" + pagerRow + "&format=json";
    render();
  });
  $("pagerics").href = "/pull?instance=" + INSTANCE + "&seat=pager&row=" + pagerRow;
  $("pagerjson").href = "/pull?instance=" + INSTANCE + "&seat=pager&row=" + pagerRow + "&format=json";
  var act = document.createElement("div");
  act.className = "bar";
  act.innerHTML = '<span class="tag">acting as:</span> <select id="actingseat">' +
    CFG.seats.filter(function (s) { return s.kind === "person"; }).map(function (s) {
      return '<option value="' + s.person + '">' + esc(CFG.people[s.person].name) + "</option>";
    }).join("") + "</select>";
  $("acting").replaceWith(act);
  buildFields();
})();

try {
  var ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/agents/grid/" + INSTANCE);
  ws.onopen = function () { $("wsdot").classList.add("on"); $("wslabel").textContent = "live — the record pings this page"; };
  ws.onmessage = function () { render(); };
  ws.onclose = function () { $("wsdot").classList.remove("on"); $("wslabel").textContent = "socket closed — refresh to reconnect"; };
} catch (e) { /* the page still works by hand */ }

render();
</script>
</body>
</html>`;
}
