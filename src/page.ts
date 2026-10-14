/**
 * page.ts — the Grid, rendered.
 *
 * One page, no build step, no framework. It speaks HTTP to the Grid
 * agent (GET /api/grid?seat=… for the seat's own projection, POST
 * /api/grid for the port's actions) and listens on the agent socket
 * for {version, digest} pings — a ping means "the record grew;
 * re-fetch YOUR seat's projection". The page never receives another
 * seat's payload: the coach's rendering is computed on the server,
 * so what the coach can't see was never sent.
 *
 * LAYOUT — a story first, depth below (the zero-shot standard):
 *   1. The claim: two people, one kid, one month, derived — plus the
 *      default, stated in plain words, because silence inherits it.
 *   2. The seats: four renderings of the same record. Switching
 *      seats changes what the same truth looks like from where you
 *      sit — that is the X factor, made touchable.
 *   3. The month, synoptic: the big color is responsibility; events
 *      are highlights inside a day; a pending proposal wears amber
 *      hatching — a color, not a fact.
 *   4. The box: click any day and it opens — the description (what
 *      the default says, what stands) and the equation (every record
 *      that touched the day, reasons attached, rejections struck
 *      through but never deleted). Plato's rule: a cell that can
 *      explain itself.
 *   5. The port and the pull: propose/accept/reject/counter/ask —
 *      the only way in — and "pull my days", the one way out that
 *      belongs to each seat alone.
 */
export const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Grid — a shared month, derived</title>
<style>
  :root { color-scheme: dark; }
  body { font: 15px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace;
         background: #0d1117; color: #e6edf3; margin: 0 auto; max-width: 1060px; padding: 24px 16px 64px; }
  h1 { font-size: 22px; margin: 0; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .08em; color: #8b949e; margin: 26px 0 8px; }
  .tag { color: #8b949e; font-size: 13px; }
  .claim { font-size: 24px; font-weight: 700; line-height: 1.3; margin: 14px 0 8px; }
  .hero p { margin: 6px 0; max-width: 50rem; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 12px 16px; margin: 10px 0; }
  .rule { border-left: 3px solid #58a6ff; }
  .honest { border-left: 3px solid #9e6a03; color: #d8c58f; }
  .bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 10px 0; }
  button, select, input, textarea { background: #161b22; color: #e6edf3; border: 1px solid #30363d;
         border-radius: 6px; padding: 6px 10px; font: inherit; }
  button { cursor: pointer; } button:hover { border-color: #58a6ff; }
  button.seat.on { border-color: #e6edf3; background: #21262d; font-weight: 700; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: #f85149; display: inline-block; }
  .dot.on { background: #3fb950; }
  /* the month */
  .dow { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; color: #8b949e; font-size: 12px; text-align: center; margin-bottom: 4px; }
  .month { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; }
  .cell { position: relative; border: 1px solid #30363d; border-radius: 8px; min-height: 92px; padding: 6px 8px;
          cursor: pointer; overflow: hidden; background: #0d1117; }
  .cell:hover { border-color: #58a6ff; }
  .cell .num { font-weight: 700; font-size: 14px; }
  .cell .who { font-size: 11px; color: #c9d1d9; }
  .cell .ev { font-size: 11px; line-height: 1.35; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cell.today { outline: 2px solid #e6edf3; outline-offset: -2px; }
  .cell .moved { position: absolute; top: 6px; right: 8px; font-size: 10px; color: #8b949e; }
  .cell .pend { position: absolute; left: 0; right: 0; bottom: 0; font-size: 10.5px; padding: 2px 8px;
    background: repeating-linear-gradient(45deg, rgba(227,179,65,.35) 0 6px, rgba(227,179,65,.12) 6px 12px); color: #f0d48a; }
  .blank { border: 1px dashed #21262d; border-radius: 8px; min-height: 92px; }
  .legend { font-size: 12px; color: #8b949e; }
  .swatch { display: inline-block; width: 10px; height: 10px; border-radius: 3px; vertical-align: -1px; margin: 0 3px 0 8px; }
  /* inbox, box, feed */
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
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: start; }
  @media (max-width: 820px) { .grid2 { grid-template-columns: 1fr; } .cell { min-height: 74px; } }
  label { font-size: 12.5px; color: #8b949e; display: block; margin-top: 8px; }
  footer { color: #8b949e; margin-top: 40px; font-size: 13px; }
  a { color: #58a6ff; }
</style>
</head>
<body>
<header>
  <div class="bar" style="justify-content:space-between">
    <h1>The Grid <span class="tag">git.pp — a shared month, derived not discussed</span></h1>
    <span class="tag"><span class="dot" id="wsdot"></span> <span id="wslabel">connecting…</span></span>
  </div>
  <div class="hero">
    <p class="claim">Two people. One kid. One month — derived, not discussed.</p>
    <p>Chat threads lose this argument: “that Monday” slides, the subtext evaporates, and nobody can tell which version of a day is standing. So the month lives here instead — a default that simply happens unless somebody proposes otherwise, and an append-only record of every proposal, ruling, question and reason. The grid below is a <b>fold</b> of those two things, recomputed from the record. Nothing is ever edited or deleted.</p>
    <p class="tag">Demo data — Mara and Jonas are fictional. The pattern is the point.</p>
  </div>
  <div class="card rule">
    <b>The default.</b> <span id="ruletext">…</span>
    <div class="tag" style="margin-top:6px">Silence means the default holds. Talk only happens at the delta — and the delta wears a color.</div>
  </div>
</header>

<h2>Sit somewhere — the same record, rendered for where you sit</h2>
<div class="bar" id="seatbar">
  <button class="seat" data-seat="mara">Mara · parent</button>
  <button class="seat" data-seat="jonas">Jonas · parent</button>
  <button class="seat" data-seat="coach">Coach · need-to-know</button>
  <button class="seat" data-seat="agent">Agent · dings only</button>
  <span class="tag" id="agentfor" style="display:none">agent for:
    <button class="seat" data-human="mara">Mara</button>
    <button class="seat" data-human="jonas">Jonas</button>
  </span>
  <span class="tag" id="digestline"></span>
</div>

<div id="inboxwrap"><h2>Your dings</h2><div id="inbox"></div></div>

<div id="gridwrap">
  <h2>October 2026 — the synoptic month</h2>
  <div class="dow"><span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span></div>
  <div class="month" id="month"></div>
  <p class="legend">
    <span class="swatch" style="background:#e08a3c"></span>Mara's night
    <span class="swatch" style="background:#4a90d9"></span>Jonas's night
    <span class="swatch" style="background:repeating-linear-gradient(45deg, rgba(227,179,65,.6) 0 4px, rgba(227,179,65,.2) 4px 8px)"></span>a proposal is pending — a color, not a fact
    <span style="margin-left:8px">◦ = moved off the default by an accepted proposal · click any day to open the box</span>
  </p>
</div>

<div id="listwrap" style="display:none"><h2 id="listtitle"></h2><div id="list"></div></div>

<div id="boxwrap" style="display:none">
  <h2>Inside the box — <span id="boxtitle"></span></h2>
  <div class="card" id="box"></div>
</div>

<div id="portwrap">
  <h2>The port — propose a change (the only way in)</h2>
  <div class="card">
    <div class="bar">
      <select id="p-type">
        <option value="assign">Give a day to…</option>
        <option value="swap">Swap two days</option>
        <option value="event">Add an event</option>
      </select>
      <span id="p-fields"></span>
    </div>
    <label>Note (your words travel with the proposal)</label>
    <input id="p-note" style="width:100%" placeholder="e.g. work trip moved — can we trade?">
    <label><input type="checkbox" id="p-tentative"> Tentative — I'm not sure yet, flagging it early</label>
    <div class="bar">
      <button id="p-submit">Propose as <span id="p-who"></span></button>
      <span class="tag" id="p-counter-note" style="display:none"></span>
      <button id="p-cancel-counter" style="display:none">cancel counter</button>
    </div>
    <p class="tag">A proposal changes nothing until the OTHER seat accepts it. Rejecting requires a reason — it stays attached forever. Questions and comments are first-class records too: open any day's box to ask one.</p>
  </div>
</div>

<h2>The pull &amp; the proof</h2>
<div class="card">
  <div class="bar">
    <a id="pull" href="/pull?seat=mara" download><button>⬇ Pull my days (.ics)</button></a>
    <button id="refold">Re-fold from the record</button>
    <button id="reset">Reset the demo</button>
  </div>
  <div id="refoldout"></div>
  <p class="tag">Pulling is free — a copy to carry to your own calendar, never a write back. The re-fold discards everything derived and rebuilds the month from the record alone: if the digest comes back identical, nothing but the record was ever carrying the truth.</p>
</div>

<h2>The record — everything, in the order it landed</h2>
<div id="feed"></div>

<footer>
  <div class="card honest">
    <b>Honest label.</b> The record on this page lives in this instance's own store (a Cloudflare Durable Object) — <i>an instance with the same operational fiction</i>, not the git substrate. What is being play-tested is the shape: a default that derives, an append-only record, a grid that is a pure fold, and seats that each render the same record at the resolution of where they sit. The coach's view is computed on the server: what the coach cannot see was never sent.
  </div>
  <p>Siblings: <a href="https://gitpp-desk.casey-digennaro.workers.dev">the captain's desk</a> (the same doctrine over git records) · <a href="https://github.com/SuperInstance/git.pp-ng">git.pp-ng</a> · <a href="https://github.com/SuperInstance/git.pp-desk">git.pp-desk</a> · this page: git.pp-grid (MIT © 2026 SuperInstance).</p>
</footer>

<script>
"use strict";
var SEATS = {
  mara: { name: "Mara", color: "#e08a3c" },
  jonas: { name: "Jonas", color: "#4a90d9" }
};
var WEEKDAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
var seat = "mara", human = "mara", view = null, selectedDay = null, counterOf = null;
var lastVersion = -1;

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
  });
}
function $(id) { return document.getElementById(id); }
function dayNum(date) { return Number(date.slice(8, 10)); }
function evIcon(kind) { return kind === "soccer" ? "⚽" : kind === "snack" ? "🍊" : "•"; }

function api(seatOverride) {
  var s = seatOverride || seat;
  var q = "/api/grid?seat=" + s + (s === "agent" ? "&for=" + human : "");
  return fetch(q).then(function (r) { return r.json(); });
}
function act(body) {
  return fetch("/api/grid", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  }).then(function (r) { return r.json(); }).then(function (j) {
    if (j.error) { alert(j.error); throw new Error(j.error); }
    return j;
  });
}

function load() {
  return api().then(function (v) {
    view = v;
    render();
  });
}

/* ---------- render ---------- */
function render() {
  document.querySelectorAll("#seatbar .seat[data-seat]").forEach(function (b) {
    b.classList.toggle("on", b.getAttribute("data-seat") === seat);
  });
  document.querySelectorAll("#agentfor .seat").forEach(function (b) {
    b.classList.toggle("on", b.getAttribute("data-human") === human);
  });
  $("agentfor").style.display = seat === "agent" ? "" : "none";
  var isParent = seat === "mara" || seat === "jonas";
  $("gridwrap").style.display = isParent ? "" : "none";
  $("inboxwrap").style.display = isParent ? "" : "none";
  $("portwrap").style.display = isParent ? "" : "none";
  $("listwrap").style.display = isParent ? "none" : "";
  $("pull").style.display = (isParent || seat === "agent") ? "" : "none";
  if (isParent || seat === "agent") {
    var who = seat === "agent" ? human : seat;
    $("pull").setAttribute("href", "/pull?seat=" + who);
    $("pull").querySelector("button").textContent = "⬇ Pull " + (seat === "agent" ? SEATS[human].name + "'s" : "my") + " days (.ics)";
  }
  if (!view) return;
  if (view.rule) $("ruletext").textContent = view.rule;
  $("digestline").textContent = view.digest ? "grid digest " + view.digest.slice(0, 12) + "…" : "";
  if (isParent) { renderMonth(); renderInbox(); renderFeed(); if (selectedDay) openBox(selectedDay, true); }
  else if (seat === "coach") renderCoach();
  else renderAgent();
  $("p-who").textContent = isParent ? SEATS[seat].name : "";
}

function renderMonth() {
  var el = $("month"); el.innerHTML = "";
  var first = new Date(Date.UTC(2026, 9, 1)).getUTCDay(); // Oct 1 2026 = Thursday (4)
  for (var i = 0; i < first; i++) { var b = document.createElement("div"); b.className = "blank"; el.appendChild(b); }
  view.days.forEach(function (d) {
    var c = document.createElement("div");
    c.className = "cell" + (d.date === "2026-10-13" ? " today" : "");
    var col = SEATS[d.responsible].color;
    c.style.background = "linear-gradient(180deg, " + col + "2e, " + col + "12)";
    c.style.borderLeft = "4px solid " + col;
    var h = '<span class="num">' + dayNum(d.date) + "</span> " +
      '<span class="who">' + esc(SEATS[d.responsible].name) + "</span>";
    if (d.responsible !== d.defaultResponsible) h += '<span class="moved" title="moved off the default by an accepted proposal">◦ moved</span>';
    d.events.slice(0, 3).forEach(function (ev) {
      h += '<div class="ev">' + evIcon(ev.kind) + " " + esc(ev.time ? ev.time + " " : "") + esc(ev.title) + "</div>";
    });
    if (d.events.length > 3) h += '<div class="ev">+' + (d.events.length - 3) + " more</div>";
    if (d.pending.length) {
      h += '<div class="pend">⏳ ' + d.pending.length + " pending — " +
        esc(d.pending.map(function (p) { return p.summary; }).join("; ")) + "</div>";
    }
    c.innerHTML = h;
    c.addEventListener("click", function () { openBox(d.date); });
    el.appendChild(c);
  });
}

function proposalButtons(p) {
  if (seat === p.author) return '<span class="tag">awaiting ' + esc(SEATS[p.author === "mara" ? "jonas" : "mara"].name) + " — you proposed this</span>";
  return '<button data-act="accept" data-id="' + p.id + '">Accept</button> ' +
    '<button data-act="reject" data-id="' + p.id + '">Reject…</button> ' +
    '<button data-act="counter" data-id="' + p.id + '">Counter…</button>';
}

function renderInbox() {
  var el = $("inbox"); el.innerHTML = "";
  if (!view.inbox.length) { el.innerHTML = '<div class="card">Nothing waiting. Silence = the default holds.</div>'; return; }
  view.inbox.forEach(function (item) {
    var div = document.createElement("div");
    div.className = "card ding" + (item.type === "resolved-yours" ? " res" : "");
    var h = "🔔 " + esc(item.text);
    if (item.type === "pending-yours" && item.proposalId) {
      var p = view.proposals.find(function (x) { return x.id === item.proposalId; });
      if (p) h += '<div class="bar" style="margin-top:6px">' + proposalButtons(p) + "</div>";
    }
    div.innerHTML = h;
    el.appendChild(div);
  });
  wireButtons(el);
}

function renderCoach() {
  $("listtitle").textContent = "Coach — game & snack days only (the custody pattern was never sent)";
  var el = $("list"); el.innerHTML = "";
  if (!view.days.length) { el.innerHTML = '<div class="card">No game days on the record.</div>'; return; }
  view.days.forEach(function (d) {
    var div = document.createElement("div"); div.className = "card";
    var h = "<b>" + esc(d.weekday) + " " + esc(d.date) + "</b>";
    d.events.forEach(function (ev) {
      h += '<div class="ev">' + evIcon(ev.kind) + " " + esc(ev.time ? ev.time + " " : "") + esc(ev.title) +
        (ev.duty ? ' <span class="tag">(' + esc(ev.duty) + ")</span>" : "") + "</div>";
    });
    div.innerHTML = h; el.appendChild(div);
  });
}

function renderAgent() {
  $("listtitle").textContent = "Agent for " + SEATS[human].name + " — dings, no grid";
  var el = $("list"); el.innerHTML = "";
  view.items.forEach(function (it) {
    var div = document.createElement("div"); div.className = "card";
    div.innerHTML = (it.kind === "ding" ? "🔔 " : "▸ ") + "<b>" + esc(it.date || "now") + "</b> " + esc(it.text);
    el.appendChild(div);
  });
  if (!view.items.length) el.innerHTML = '<div class="card">No dings. The default is carrying everything.</div>';
}

function renderFeed() {
  var el = $("feed"); el.innerHTML = "";
  view.feed.forEach(function (f) {
    var div = document.createElement("div");
    div.className = "hist";
    var who = f.author === "system" ? "the record" : SEATS[f.author].name;
    var line = '<span class="kind ' + f.kind + '">' + f.kind + "</span> <b>" + esc(who) + "</b> · " + esc(f.summary);
    if (f.kind === "reject" && f.reason) line += ' · <span class="reason">reason: “' + esc(f.reason) + "”</span>";
    div.innerHTML = line + ' <span class="tag">' + esc(f.id) + " · " + esc(f.ts.slice(0, 10)) + "</span>";
    el.appendChild(div);
  });
}

/* ---------- the box ---------- */
function openBox(date, keepScroll) {
  selectedDay = date;
  var d = view.days.find(function (x) { return x.date === date; });
  if (!d) return;
  var box = d.box;
  $("boxwrap").style.display = "";
  $("boxtitle").textContent = WEEKDAYS[new Date(date + "T12:00:00Z").getUTCDay()] + " " + date;
  var h = "";
  h += "<p><b>The description.</b> " + esc(box.defaultLine) + "</p>";
  h += "<p>" + esc(box.standingLine) + "</p>";
  if (box.events.length) {
    h += "<p><b>On this day:</b></p>";
    box.events.forEach(function (ev) {
      h += '<div class="ev">' + evIcon(ev.kind) + " " + esc(ev.time ? ev.time + " " : "") + esc(ev.title) +
        (ev.for ? ' <span class="tag">(duty: ' + esc(SEATS[ev.for].name) + ")</span>" : "") +
        ' <button data-act="optin" data-day="' + date + '" data-title="' + esc(ev.title) + '">🔔 remind me</button></div>';
    });
  }
  if (box.pending.length) {
    h += "<p><b>Pending — a color, not a fact:</b></p>";
    box.pending.forEach(function (p) {
      h += '<div class="card" style="margin:6px 0">⏳ <b>' + esc(SEATS[p.author].name) + "</b> proposed: " + esc(p.summary) +
        (p.tentative ? ' <span class="kind">tentative</span>' : "") +
        (p.note ? '<div>“' + esc(p.note) + '”</div>' : "") +
        '<div class="bar">' + proposalButtons(p) + "</div></div>";
    });
  }
  h += "<p><b>The equation — every record that touched this day:</b></p>";
  if (!box.history.length) h += '<p class="tag">Nothing. The default has never been disturbed here.</p>';
  box.history.forEach(function (x) {
    var struck = x.kind === "proposal" && view.proposals.some(function (p) { return p.id === x.id && p.status === "rejected"; });
    h += '<div class="hist"><span class="kind ' + x.kind + '">' + x.kind + '</span> <span class="' + (struck ? "strike" : "") + '">' + esc(x.summary) + "</span>" +
      (x.reason ? ' <span class="reason">— reason: “' + esc(x.reason) + '”</span>' : "") +
      ' <span class="tag">' + esc(x.id) + " · " + esc(x.ts.slice(0, 10)) + "</span></div>";
  });
  h += '<div class="bar" style="margin-top:10px">' +
    '<input id="q-text" placeholder="Ask a question or leave a comment about this day…" style="flex:1">' +
    '<button data-act="question" data-day="' + date + '">Ask</button>' +
    '<button data-act="comment" data-day="' + date + '">Comment</button></div>';
  $("box").innerHTML = h;
  wireButtons($("box"));
  if (!keepScroll) $("boxwrap").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function wireButtons(root) {
  root.querySelectorAll("button[data-act]").forEach(function (b) {
    b.addEventListener("click", function () { doAction(b); });
  });
}

function doAction(b) {
  var a = b.getAttribute("data-act"), id = b.getAttribute("data-id");
  if (a === "accept") act({ seat: seat, action: "accept", proposalId: id }).then(load);
  else if (a === "reject") {
    var reason = prompt("Reject — your reason stays attached to this day forever:");
    if (reason) act({ seat: seat, action: "reject", proposalId: id, reason: reason }).then(load);
  } else if (a === "counter") {
    counterOf = id;
    $("p-counter-note").style.display = "";
    $("p-counter-note").textContent = "Countering " + id + " — your proposal replaces it.";
    $("p-cancel-counter").style.display = "";
    $("portwrap").scrollIntoView({ behavior: "smooth" });
  } else if (a === "optin") {
    act({ seat: seat, action: "optin", day: b.getAttribute("data-day"), title: b.getAttribute("data-title") }).then(load);
  } else if (a === "question" || a === "comment") {
    var t = $("q-text").value.trim();
    if (!t) return;
    act({ seat: seat, action: a, text: t, day: b.getAttribute("data-day") }).then(load);
  }
}

/* ---------- the propose form ---------- */
function renderProposalFields() {
  var t = $("p-type").value, f = $("p-fields");
  var day = '<input type="date" id="p-day" min="2026-10-01" max="2026-10-31" value="2026-10-20">';
  if (t === "assign") {
    f.innerHTML = day + ' → <select id="p-to"><option value="mara">Mara</option><option value="jonas">Jonas</option></select>';
  } else if (t === "swap") {
    f.innerHTML = day + ' ↔ <input type="date" id="p-day2" min="2026-10-01" max="2026-10-31" value="2026-10-27">';
  } else {
    f.innerHTML = day + ' <input id="p-title" placeholder="event title"> <input id="p-time" placeholder="18:00" size="5"> ' +
      '<select id="p-ekind"><option value="event">event</option><option value="soccer">soccer</option><option value="snack">snack duty</option></select>';
  }
}
$("p-type").addEventListener("change", renderProposalFields);
$("p-submit").addEventListener("click", function () {
  var t = $("p-type").value, change;
  if (t === "assign") change = { type: "assign", day: $("p-day").value, to: $("p-to").value };
  else if (t === "swap") change = { type: "swap", days: [$("p-day").value, $("p-day2").value] };
  else change = { type: "event", day: $("p-day").value, title: $("p-title").value, time: $("p-time").value || undefined, eventKind: $("p-ekind").value };
  var body = { seat: seat, note: $("p-note").value, tentative: $("p-tentative").checked, change: change };
  if (counterOf) { body.action = "counter"; body.proposalId = counterOf; }
  else body.action = "propose";
  act(body).then(function () {
    counterOf = null;
    $("p-counter-note").style.display = "none";
    $("p-cancel-counter").style.display = "none";
    $("p-note").value = "";
    load();
  });
});
$("p-cancel-counter").addEventListener("click", function () {
  counterOf = null;
  $("p-counter-note").style.display = "none";
  $("p-cancel-counter").style.display = "none";
});

/* ---------- seats ---------- */
document.querySelectorAll("#seatbar .seat[data-seat]").forEach(function (b) {
  b.addEventListener("click", function () { seat = b.getAttribute("data-seat"); selectedDay = null; $("boxwrap").style.display = "none"; load(); });
});
document.querySelectorAll("#agentfor .seat").forEach(function (b) {
  b.addEventListener("click", function () { human = b.getAttribute("data-human"); load(); });
});

/* ---------- the proof ---------- */
$("refold").addEventListener("click", function () {
  act({ action: "refold" }).then(function (j) {
    $("refoldout").innerHTML =
      '<p>before: <span class="digest">' + j.before + '</span></p>' +
      '<p>after: <span class="digest">' + j.after + '</span> ' +
      (j.identical ? '<span class="badge ok">IDENTICAL ✓</span>' : '<span class="badge bad">DIFFERENT ✗</span>') +
      '</p><p class="tag">re-folded from ' + j.logLength + ' records — the log alone.</p>';
    load();
  });
});
$("reset").addEventListener("click", function () {
  if (confirm("Reset the demo record to its seed? (The current record is replaced — this is demo hygiene, not editing.)")) {
    act({ action: "reset" }).then(function () { selectedDay = null; $("boxwrap").style.display = "none"; load(); });
  }
});

/* ---------- socket: pings only ---------- */
try {
  var proto = location.protocol === "https:" ? "wss://" : "ws://";
  var ws = new WebSocket(proto + location.host + "/agents/grid/demo");
  ws.onmessage = function (ev) {
    try {
      var msg = JSON.parse(ev.data);
      if (msg.type === "cf_agent_state" && msg.state && typeof msg.state.version === "number") {
        if (lastVersion >= 0 && msg.state.version !== lastVersion) load();
        lastVersion = msg.state.version;
      }
      if (msg.type === "cf_agent_identity") { $("wsdot").className = "dot on"; $("wslabel").textContent = "live"; }
    } catch (e) { /* not ours */ }
  };
  ws.onopen = function () { $("wsdot").className = "dot on"; $("wslabel").textContent = "live"; };
  ws.onclose = function () { $("wsdot").className = "dot"; $("wslabel").textContent = "offline — refresh to update"; };
} catch (e) { /* the page still works over HTTP */ }

renderProposalFields();
load();
</script>
</body>
</html>
`;
