/**
 * playtest.mjs — the Grid, played with honestly.
 *
 * Run: node test/playtest.mjs
 *
 * Independence note: check (1) folds the record HERE, from the
 * spec — the default (Friday-anchor alternating weeks) plus the raw
 * log fetched from the deployment, applied by this file's own code.
 * The server's grid is never trusted to grade itself; the two folds
 * must agree on all 31 days, and five probe days must also match the
 * seed story's hand-computed values. Checks (2) and (3) then act
 * through the port (propose / accept / reject) and verify the record
 * grew by exactly the entries it should — no more, no fewer.
 */
const BASE = process.env.GRID_URL ?? "https://gitpp-grid.casey-digennaro.workers.dev";

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
};

const getView = async (seat, extra = "") =>
  (await fetch(`${BASE}/api/grid?seat=${seat}${extra}`)).json();
const getLog = async () => (await (await fetch(`${BASE}/api/grid/log`)).json()).entries;
const post = async (body) => {
  const res = await fetch(`${BASE}/api/grid`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
};

/* ---------- the independent fold (from the spec, not the server) ---------- */
const DAY = 86_400_000;
const ANCHOR = Date.UTC(2026, 9, 2); // Friday Oct 2 2026 → Mara's week
const defResp = (date) => {
  const [y, m, d] = date.split("-").map(Number);
  const block = Math.floor((Date.UTC(y, m - 1, d) - ANCHOR) / (7 * DAY));
  return ((block % 2) + 2) % 2 === 0 ? "mara" : "jonas";
};
const DATES = Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);

function fold(log) {
  const resp = {};
  for (const d of DATES) resp[d] = defResp(d);
  const status = {};
  const proposals = {};
  for (const e of log) {
    if (e.kind === "proposal" || e.kind === "counter") {
      proposals[e.id] = e;
      status[e.id] = "pending";
    }
  }
  for (const e of log) {
    const pid = e.payload.proposalId ?? e.payload.counterOf;
    if (!pid || !proposals[pid]) continue;
    if (e.kind === "accept") status[pid] = "accepted";
    else if (e.kind === "reject") status[pid] = "rejected";
    else if (e.kind === "counter") status[pid] = "countered";
  }
  for (const e of log) {
    if (e.kind !== "accept") continue;
    const p = proposals[e.payload.proposalId];
    if (!p || status[p.id] !== "accepted") continue;
    const c = p.payload.change;
    if (c.type === "assign") resp[c.day] = c.to;
    else if (c.type === "swap") {
      const t = resp[c.days[0]];
      resp[c.days[0]] = resp[c.days[1]];
      resp[c.days[1]] = t;
    }
  }
  return resp;
}

/* ---------- (1) the seeded grid matches an independent fold ---------- */
const log0 = await getLog();
const expected = fold(log0);
const maraView = await getView("mara");
let agree = 0;
for (const d of maraView.days) {
  if (expected[d.date] === d.responsible) agree++;
}
check(
  "1a. server grid == independent fold of default+record (all 31 days)",
  agree === 31,
  `${agree}/31 days agree`,
);
const story = {
  "2026-10-01": "jonas", // Thursday before the anchor week
  "2026-10-12": "mara", // swapped in (accepted proposal)
  "2026-10-19": "jonas", // swapped out
  "2026-10-26": "jonas", // pending proposal changes nothing
  "2026-10-31": "mara", // rejected proposal changes nothing
};
const storyOk = Object.entries(story).every(
  ([d, who]) => expected[d] === who && maraView.days.find((x) => x.date === d)?.responsible === who,
);
check("1b. five probe days match the seed story, hand-computed", storyOk, JSON.stringify(story));

/* ---------- (2) propose → accept, through the port ---------- */
const n0 = (await getLog()).length;
const prop = await post({
  seat: "jonas",
  action: "propose",
  change: { type: "assign", day: "2026-10-06", to: "jonas" },
  note: "playtest: dentist trip",
});
const n1 = (await getLog()).length;
check("2a. propose appends exactly one entry", prop.ok && n1 === n0 + 1, `log ${n0} → ${n1}`);
const midView = await getView("mara");
const midDay = midView.days.find((d) => d.date === "2026-10-06");
check(
  "2b. a pending proposal is a color, not a fact (day unmoved, proposal shown)",
  midDay.responsible === "mara" && midDay.pending.some((p) => p.id === prop.entry.id),
  `responsible=${midDay.responsible}, pending=${midDay.pending.length}`,
);
const acc = await post({ seat: "mara", action: "accept", proposalId: prop.entry.id });
const n2 = (await getLog()).length;
const afterView = await getView("jonas");
const afterDay = afterView.days.find((d) => d.date === "2026-10-06");
check(
  "2c. accept appends exactly one entry and the day lands",
  acc.ok && n2 === n1 + 1 && afterDay.responsible === "jonas",
  `log ${n1} → ${n2}, 2026-10-06 = ${afterDay.responsible}`,
);

/* ---------- (3) reject: the day holds, the reason stays ---------- */
const prop2 = await post({
  seat: "mara",
  action: "propose",
  change: { type: "assign", day: "2026-10-07", to: "jonas" },
  note: "playtest: gallery thing",
});
const rej = await post({
  seat: "jonas",
  action: "reject",
  proposalId: prop2.entry.id,
  reason: "playtest: grandma is visiting",
});
const n3 = (await getLog()).length;
const v3 = await getView("mara");
const day7 = v3.days.find((d) => d.date === "2026-10-07");
const boxHist = day7.box.history.map((h) => `${h.kind}:${h.reason ?? h.summary}`);
check(
  "3. reject keeps the day at default, reason retrievable in the box",
  rej.ok &&
    n3 === n2 + 2 &&
    day7.responsible === "mara" &&
    boxHist.some((s) => s.startsWith("reject:playtest: grandma is visiting")),
  `log ${n2} → ${n3}, 2026-10-07 = ${day7.responsible}, history has the reason`,
);

/* ---------- (4) coach: the payload never contained it ---------- */
const coachRes = await fetch(`${BASE}/api/grid?seat=coach`);
const coachText = await coachRes.text();
check(
  "4. coach payload: game days present, responsibility data absent",
  !coachText.includes("responsible") &&
    !coachText.includes("2026-10-05") &&
    !coachText.includes("2026-10-12") &&
    coachText.includes("2026-10-17") &&
    coachText.includes("Snack duty"),
  "no 'responsible', no non-event days, Oct 17 + snack duty present",
);

/* ---------- (6) the pull: my days, not yours ---------- */
const parseIcs = (text) =>
  text
    .split("BEGIN:VEVENT")
    .slice(1)
    .map((b) => ({
      start: (b.match(/DTSTART[^:\r\n]*:([0-9T]+)/) || [])[1],
      summary: (b.match(/SUMMARY:(.*)/) || [])[1] ?? "",
    }));
const maraIcs = parseIcs(await (await fetch(`${BASE}/pull?seat=mara`)).text());
const jonasIcs = parseIcs(await (await fetch(`${BASE}/pull?seat=jonas`)).text());
const kidDay = (events, name, ymd) =>
  events.some((e) => e.summary === `Kid with ${name}` && e.start === ymd);
check(
  "6a. mara's pull: has her swapped-in Oct 12, not her swapped-out Oct 19",
  kidDay(maraIcs, "Mara", "20261012") && !kidDay(maraIcs, "Mara", "20261019"),
);
check(
  "6b. jonas's pull: exactly inverse, plus his snack duty on Mara's day",
  kidDay(jonasIcs, "Jonas", "20261019") &&
    !kidDay(jonasIcs, "Jonas", "20261012") &&
    jonasIcs.some((e) => e.summary.includes("Snack duty") && e.start.startsWith("20261017")),
);

/* ---------- (5) re-fold from the record alone ---------- */
const refold = await post({ action: "refold" });
check(
  "5. re-fold digest identical (the record alone carries the grid)",
  refold.identical === true && refold.before === refold.after,
  `digest ${String(refold.before).slice(0, 16)}… over ${refold.logLength} records`,
);

/* ---------- (7) the page serves the story ---------- */
const page = await (await fetch(`${BASE}/`)).text();
check(
  "7. page serves the claim, the rule, and the seats",
  page.includes("derived, not discussed") &&
    page.includes("Silence means the default holds") &&
    page.includes("Coach · need-to-know") &&
    page.includes("an instance with the same operational fiction"),
);

console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
