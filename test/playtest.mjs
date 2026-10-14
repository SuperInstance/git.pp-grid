/**
 * playtest.mjs — the Grid's acceptance test, per instance.
 *
 * Run against a live deployment:
 *   GRID_URL=https://gitpp-grid.casey-digennaro.workers.dev node test/playtest.mjs
 * (defaults to the production URL).
 *
 * The discipline, same as the desk's: THE SERVER NEVER GRADES
 * ITSELF. Each section folds the raw record IN THE TEST, from the
 * instance's declared rule written out in this file, and compares
 * against the server's projections. If the two folds agree, the
 * engine is honest; the probes then check the story the seed tells.
 *
 *   CUSTODY — the original instance, as regression: every check
 *     that passed on the single-purpose build must still pass now
 *     that custody is just config.
 *   ON-CALL — the engineer-native instance: rotation derivation on
 *     probe days, swap accept/reject flows, the freeze guard,
 *     director seat name-freedom, the pager pull, scope seats,
 *     re-fold per instance.
 */

const BASE = process.env.GRID_URL ?? "https://gitpp-grid.casey-digennaro.workers.dev";

let failures = 0;
let sectionName = "";
let sectionPass = 0;
let sectionTotal = 0;
const totals = [];
function section(name) {
  if (sectionName) totals.push([sectionName, sectionPass, sectionTotal]);
  sectionName = name;
  sectionPass = 0;
  sectionTotal = 0;
  console.log(`\n== ${name} ==`);
}
function check(name, cond, detail = "") {
  sectionTotal++;
  if (cond) sectionPass++;
  else failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  " + detail}`);
}
async function get(path) {
  const r = await fetch(BASE + path);
  return r.text();
}
async function getJson(path) {
  return JSON.parse(await get(path));
}
async function post(instance, body) {
  const r = await fetch(BASE + "/api/grid", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ instance, ...body }),
  });
  return r.json();
}

/* ================================================================== */
/* CUSTODY — regression: the original instance, now just config        */
/* ================================================================== */

section("custody (regression)");

// The custody default, from the rule, written out independently:
// 7-day blocks from Friday 2026-10-02 (block 0 = mara), Fri–Thu.
const ANCHOR = Date.UTC(2026, 9, 2);
function defResp(date) {
  const [y, m, d] = date.split("-").map(Number);
  const block = Math.floor((Date.UTC(y, m - 1, d) - ANCHOR) / (7 * 86_400_000));
  return block % 2 === 0 ? "mara" : "jonas";
}
function foldLog(entries) {
  const state = {};
  for (let d = 1; d <= 31; d++) {
    const date = `2026-10-${String(d).padStart(2, "0")}`;
    state[date] = defResp(date);
  }
  const props = {};
  for (const e of entries) {
    if (e.kind === "proposal" || e.kind === "counter")
      props[e.id] = { change: e.payload.change, status: "pending" };
  }
  for (const e of entries) {
    const pid = e.payload.proposalId ?? e.payload.counterOf;
    if (!pid || !props[pid]) continue;
    if (e.kind === "accept") props[pid].status = "accepted";
    else if (e.kind === "reject") props[pid].status = "rejected";
    else if (e.kind === "counter" && props[pid].status === "pending") props[pid].status = "countered";
  }
  for (const e of entries) {
    if (e.kind !== "accept") continue;
    const p = props[e.payload.proposalId];
    if (!p || p.status !== "accepted") continue;
    const c = p.change;
    if (c.type === "assign") state[c.day] = c.to;
    else if (c.type === "swap") {
      const t = state[c.a.day];
      state[c.a.day] = state[c.b.day];
      state[c.b.day] = t;
    }
  }
  return state;
}

const log1 = await getJson("/api/grid/log?instance=custody");
const mine = foldLog(log1.entries);
const maraView = await getJson("/api/grid?instance=custody&seat=mara");
let agree = 0;
for (const day of maraView.days) if (day.responsible === mine[day.date]) agree++;
check("1a server grid == independent fold of the raw log (31/31 days)", agree === 31, `${agree}/31`);

const probe = { "2026-10-01": "jonas", "2026-10-12": "mara", "2026-10-19": "jonas", "2026-10-26": "jonas", "2026-10-31": "mara" };
const badProbes = Object.entries(probe).filter(
  ([d, want]) => maraView.days.find((x) => x.date === d)?.responsible !== want,
);
check("1b probe days: Oct 1 jonas · swapped 12 mara · 19 jonas · pending 26 jonas · rejected 31 mara", badProbes.length === 0, JSON.stringify(badProbes));

// A fresh proposal is a COLOR, not a fact — then an accept lands it.
const before = await getJson("/api/grid/log?instance=custody");
const prop = await post("custody", {
  seat: "mara",
  action: "propose",
  change: { type: "assign", day: "2026-10-06", to: "jonas" },
  note: "playtest: school play rehearsal runs late",
});
const afterProp = await getJson("/api/grid/log?instance=custody");
check("2a propose appends exactly one record", prop.ok && afterProp.length === before.length + 1);
const midView = await getJson("/api/grid?instance=custody&seat=mara");
const midDay = midView.days.find((d) => d.date === "2026-10-06");
check("2b pending is a color, not a fact (Oct 6 still mara, proposal shown)",
  midDay.responsible === "mara" && midDay.pending.length === 1);
const acc = await post("custody", { seat: "jonas", action: "accept", proposalId: prop.entry.id });
const afterAcc = await getJson("/api/grid?instance=custody&seat=mara");
check("2c the other seat accepts → the day lands (Oct 6 = jonas)",
  acc.ok && afterAcc.days.find((d) => d.date === "2026-10-06").responsible === "jonas");

// A rejection changes nothing and keeps its reason in the box.
const prop2 = await post("custody", {
  seat: "mara",
  action: "propose",
  change: { type: "assign", day: "2026-10-07", to: "jonas" },
  note: "playtest: dentist",
});
const rej = await post("custody", {
  seat: "jonas",
  action: "reject",
  proposalId: prop2.entry.id,
  reason: "playtest reason: that week is already upside down",
});
const v3 = await getJson("/api/grid?instance=custody&seat=mara");
const day7 = v3.days.find((d) => d.date === "2026-10-07");
check("3 reject keeps the day at default; the reason is retrievable in the cell's box",
  rej.ok && day7.responsible === "mara" &&
    day7.box.history.some((h) => (h.reason ?? "").includes("upside down")));

// The coach's payload: soccer days only, and NO responsibility field.
const coach = await get("/api/grid?instance=custody&seat=coach");
check("4 coach payload: no 'responsible', no ordinary days, has Oct 17 + snack duty",
  !coach.includes("responsible") && !coach.includes("2026-10-05") && !coach.includes("2026-10-12") &&
    coach.includes("2026-10-17") && coach.includes("Snack duty"));

// The re-fold: digest identical, derived from the log alone.
const rf = await post("custody", { seat: "mara", action: "refold" });
check("5 re-fold digest identical over the whole record", rf.identical === true && rf.before === rf.after);

// Pulls: Mara's .ics and Jonas's are exactly inverse on swapped days.
function icsMap(text) {
  const out = {};
  for (const ev of text.split("BEGIN:VEVENT").slice(1)) {
    const dt = ev.match(/DTSTART;VALUE=DATE:(\d{8})/)?.[1];
    const sum = ev.match(/SUMMARY:(.*)/)?.[1]?.trim();
    if (dt && sum?.startsWith("Kid with")) out[dt] = sum;
  }
  return out;
}
const maraIcs = icsMap(await get("/pull?instance=custody&seat=mara"));
const jonasIcs = icsMap(await get("/pull?instance=custody&seat=jonas"));
check("6a pulls are inverse: Oct 12 with Mara, Oct 19 with Jonas, both ways",
  maraIcs["20261012"] === "Kid with Mara" && jonasIcs["20261012"] === undefined &&
    jonasIcs["20261019"] === "Kid with Jonas" && maraIcs["20261019"] === undefined);
const maraText = await get("/pull?instance=custody&seat=mara");
check("6b Jonas's snack duty rides along on Mara's Oct 17 (her day, his duty)",
  maraText.includes("Snack duty") && maraText.includes("20261017"));

// The page carries the fiction's load-bearing sentences.
const page = await get("/?instance=custody");
check("7 page: 'derived, not discussed' · 'Silence means the default holds' · coach seat · honest label",
  page.includes("derived, not discussed") && page.includes("Silence means the default holds") &&
    page.includes("Coach · need-to-know") && page.includes("an instance with the same operational fiction"));

/* ================================================================== */
/* ON-CALL — the engineer-native instance                              */
/* ================================================================== */

section("oncall (lead)");

// The rotations, written out independently from the rule:
// 7-day blocks from Monday 2026-09-28; each service cycles its roster.
const OC_ANCHOR = Date.UTC(2026, 8, 28);
const OC_ORDER = {
  api: ["priya", "tom", "ana"],
  billing: ["tom", "ana"],
  ingest: ["ana", "priya"],
  search: ["leo", "priya"],
};
function ocDefault(row, date) {
  const [y, m, d] = date.split("-").map(Number);
  const block = Math.floor((Date.UTC(y, m - 1, d) - OC_ANCHOR) / (7 * 86_400_000));
  const roster = OC_ORDER[row];
  return roster[((block % roster.length) + roster.length) % roster.length];
}
function ocFold(entries) {
  const state = {};
  for (const row of Object.keys(OC_ORDER)) {
    for (let d = 1; d <= 31; d++) {
      const date = `2026-10-${String(d).padStart(2, "0")}`;
      state[`${row}|${date}`] = ocDefault(row, date);
    }
  }
  const props = {};
  for (const e of entries) {
    if (e.kind === "proposal" || e.kind === "counter")
      props[e.id] = { change: e.payload.change, status: "pending" };
  }
  for (const e of entries) {
    const pid = e.payload.proposalId ?? e.payload.counterOf;
    if (!pid || !props[pid]) continue;
    if (e.kind === "accept") props[pid].status = "accepted";
    else if (e.kind === "reject") props[pid].status = "rejected";
    else if (e.kind === "counter" && props[pid].status === "pending") props[pid].status = "countered";
  }
  for (const e of entries) {
    if (e.kind !== "accept") continue;
    const p = props[e.payload.proposalId];
    if (!p || p.status !== "accepted") continue;
    const c = p.change;
    if (c.type === "assign") state[`${c.row}|${c.day}`] = c.to;
    else if (c.type === "swap") {
      const ka = `${c.a.row}|${c.a.day}`;
      const kb = `${c.b.row}|${c.b.day}`;
      const t = state[ka];
      state[ka] = state[kb];
      state[kb] = t;
    }
  }
  return state;
}
const ocCell = (view, row, date) =>
  view.rows.find((r) => r.id === row)?.cells.find((c) => c.date === date);

const ocLog = await getJson("/api/grid/log?instance=oncall");
const ocMine = ocFold(ocLog.entries);
const samView = await getJson("/api/grid?instance=oncall&seat=sam");
let ocAgree = 0;
let ocCells = 0;
for (const row of samView.rows) {
  for (const c of row.cells) {
    ocCells++;
    if (c.value === ocMine[`${row.id}|${c.date}`]) ocAgree++;
  }
}
check("O1a lead seat grid == independent fold of the raw log (124/124 cells)", ocAgree === ocCells && ocCells === 124, `${ocAgree}/${ocCells}`);

const ocProbes = [
  ["api", "2026-10-01", "priya"], // rotation block 0
  ["api", "2026-10-12", "priya"], // accepted swap landed (was ana)
  ["api", "2026-10-13", "ana"],
  ["api", "2026-10-19", "ana"], // accepted swap landed (was priya)
  ["api", "2026-10-20", "priya"],
  ["billing", "2026-10-21", "ana"], // frozen; rejected swap moved nothing
  ["ingest", "2026-10-24", "priya"], // pending coverage ask moves nothing
  ["search", "2026-10-31", null], // accepted drop = a real gap
  ["search", "2026-10-13", "leo"],
];
const ocBad = ocProbes.filter(([r, d, want]) => ocCell(samView, r, d)?.value !== want);
check("O1b probe days: rotation + accepted swap + frozen reject + pending ask + the gap", ocBad.length === 0, JSON.stringify(ocBad));

// Director seat: aggregates only — the payload must contain NO names.
const dirText = await get("/api/grid?instance=oncall&seat=director");
const dir = JSON.parse(dirText);
const NAMES = ["Priya", "Nair", "Tom", "Becker", "Ana", "Ruiz", "Leo", "Park", "Sam", "Okafor",
  '"priya"', '"tom"', '"ana"', '"leo"', '"sam"'];
const leaks = NAMES.filter((n) => dirText.includes(n));
check("O2a director payload contains no engineer names (grep)", leaks.length === 0, leaks.join(","));
check("O2b director sees the gap + counts: search gap Oct 31, pending = 1",
  dir.rows.find((r) => r.row === "search")?.gaps.join() === "2026-10-31" &&
    dir.rows.find((r) => r.row === "api")?.covered === 31 &&
    dir.pendingCount === 1,
  JSON.stringify(dir.rows));

// Scope seats: an engineer sees only their rotation's rows.
const leoView = await getJson("/api/grid?instance=oncall&seat=leo");
const tomView = await getJson("/api/grid?instance=oncall&seat=tom");
check("O3 scope: Leo's grid is search only; Tom's is api + billing",
  leoView.rows.map((r) => r.id).join() === "search" &&
    tomView.rows.map((r) => r.id).join() === "api,billing");

// The freeze guard: a proposal against a frozen day must name the freeze.
const fzBad = await post("oncall", {
  seat: "ana",
  action: "propose",
  change: { type: "swap", a: { row: "billing", day: "2026-10-22" }, b: { row: "billing", day: "2026-10-29" } },
  note: "family thing that week",
});
check("O4a freeze-day proposal without naming the freeze is refused", Boolean(fzBad.error) && /freeze/i.test(fzBad.error), JSON.stringify(fzBad));
const fzOk = await post("oncall", {
  seat: "ana",
  action: "propose",
  change: { type: "swap", a: { row: "billing", day: "2026-10-22" }, b: { row: "billing", day: "2026-10-29" } },
  note: "Asking inside the launch freeze — family emergency, naming it plainly",
});
const fzRej = fzOk.ok
  ? await post("oncall", { seat: "tom", action: "reject", proposalId: fzOk.entry.id, reason: "playtest cleanup — still the freeze" })
  : { ok: false };
const samAfterFz = await getJson("/api/grid?instance=oncall&seat=sam");
check("O4b naming the freeze lets it pend; a ruling rejects it; the frozen day never moved",
  fzOk.ok && fzRej.ok && ocCell(samAfterFz, "billing", "2026-10-22")?.value === "ana");

// Swap flow: self-rule refused, the other seat's accept lands both days.
const swBefore = await getJson("/api/grid/log?instance=oncall");
const sw = await post("oncall", {
  seat: "ana",
  action: "propose",
  change: { type: "swap", a: { row: "api", day: "2026-10-06" }, b: { row: "api", day: "2026-10-13" } },
  note: "playtest swap",
});
const selfRule = await post("oncall", { seat: "ana", action: "accept", proposalId: sw.entry.id });
const swAcc = await post("oncall", { seat: "tom", action: "accept", proposalId: sw.entry.id });
const swAfter = await getJson("/api/grid/log?instance=oncall");
const samAfterSw = await getJson("/api/grid?instance=oncall&seat=sam");
check("O5 swap: author cannot self-rule; other seat accepts; both days exchange; log +2",
  Boolean(selfRule.error) && /own proposal/.test(selfRule.error) && swAcc.ok &&
    swAfter.length === swBefore.length + 2 &&
    ocCell(samAfterSw, "api", "2026-10-06")?.value === "ana" &&
    ocCell(samAfterSw, "api", "2026-10-13")?.value === "tom",
  JSON.stringify({ selfRule, swAcc }));

// Reject flow: the day stays, the reason lands in the box.
const rj = await post("oncall", {
  seat: "leo",
  action: "propose",
  change: { type: "assign", row: "search", day: "2026-10-20", to: "leo" },
  note: "playtest: I'd rather take the 20th",
});
const rjRej = await post("oncall", {
  seat: "priya",
  action: "reject",
  proposalId: rj.entry.id,
  reason: "playtest: launch-drill week — I'm keeping search",
});
const samAfterRj = await getJson("/api/grid?instance=oncall&seat=sam");
const cell20 = ocCell(samAfterRj, "search", "2026-10-20");
check("O6 reject: day stays with Priya; reason retrievable in the cell's box",
  rjRej.ok && cell20?.value === "priya" &&
    cell20.box.history.some((h) => (h.reason ?? "").includes("launch-drill")));

// The pager pull: one service, the next 72h, reflecting the record.
// (Oct 13 now shows Tom — the O5 swap landed after the seed story.)
const pager = await getJson("/pull?instance=oncall&seat=pager&row=api&format=json");
check("O7a pager JSON: api only, Oct 12–14 window, holders from the fold",
  pager.row === "api" &&
    pager.entries.map((e) => e.date).join() === "2026-10-12,2026-10-13,2026-10-14" &&
    pager.entries.map((e) => e.person).join() === "priya,tom,ana",
  JSON.stringify(pager.entries));
const pagerIcs = await get("/pull?instance=oncall&seat=pager&row=api");
check("O7b pager .ics: timed shifts from the 09:00 handover, no other service named",
  pagerIcs.includes("DTSTART:20261012T090000") && pagerIcs.includes("On call: api") &&
    !pagerIcs.includes("billing") && !pagerIcs.includes("ingest"));

// Re-fold per instance.
const ocRf = await post("oncall", { seat: "sam", action: "refold" });
check("O8 re-fold digest identical (oncall)", ocRf.identical === true && ocRf.before === ocRf.after);

// The lead page: switcher, claim, primitives — no custody vocabulary in the panel.
const lead = await get("/");
check("O9 lead page: engine claim + primitives panel + switcher to custody",
  lead.includes("one engine, many grids") && lead.includes("Defaults stand") &&
    lead.includes("Pull, don't push") && lead.includes("On-call rotation") &&
    lead.includes("/?instance=custody"));

/* ================================================================== */

section("");
totals.push([sectionName, sectionPass, sectionTotal]);
console.log("\n== totals ==");
let allPass = 0;
let allTotal = 0;
for (const [name, p, t] of totals) {
  if (!name) continue;
  console.log(`${name}: ${p}/${t}`);
  allPass += p;
  allTotal += t;
}
console.log(`TOTAL: ${allPass}/${allTotal}${failures ? ` — ${failures} FAILURES` : " — all green"}`);
process.exit(failures ? 1 : 0);
