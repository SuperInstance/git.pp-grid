/**
 * instances.ts — INSTANCES ARE CONFIG.
 *
 * The engine (engine.ts) knows cells, a default rule, a record,
 * proposals, seats and ports. It does not know what a kid or a
 * service is. Everything that makes an instance THIS instance —
 * its cell space, its people, its rule in plain words, its seats,
 * its seed story — is declared here as data plus a seed log.
 *
 * Two instances ship:
 *   oncall  — the engineer-native lead: services × days, a weekly
 *             rotation per service, a launch freeze, a director who
 *             sees only aggregates, a pager that pulls 72 hours.
 *   custody — the original: two parents, one kid, one month. The
 *             first instance this engine ever ran; it is now just
 *             config, which is the point of the refactor.
 *
 * Adding an instance = adding a block here. The engine, the port
 * and the page do not change.
 */

import type { Change, Entry, InstanceConfig } from "./engine";

/* ------------------------------------------------------------------ */
/* ON-CALL — services × days, the engineer-native instance             */
/* ------------------------------------------------------------------ */

const ONCALL_RULE =
  "Weekly rotation, handover Mondays at 09:00. Each service rotates " +
  "through its own roster: api — Priya → Tom → Ana; billing — Tom → Ana; " +
  "ingest — Ana → Priya; search — Leo → Priya. The week of Monday " +
  "September 28 opens the cycle, and it alternates from there. Billing " +
  "is under a launch freeze Monday Oct 19 – Friday Oct 23: a proposal " +
  "against those days must name the freeze in its note, or the port " +
  "refuses it. If nobody proposes anything, the rotation is simply " +
  "what happens: silence means the default holds.";

export const ONCALL: InstanceConfig = {
  id: "oncall",
  title: "On-call rotation",
  tagline: "Four services. Five engineers. One rotation — derived, not group-chatted.",
  intro:
    "Group chats lose this argument: “can you cover Thursday?” slides, " +
    "a swap agreed on a call never reaches the roster, and nobody can " +
    "tell which version of the week is standing. So the rotation lives " +
    "here instead — a declared default that simply happens unless " +
    "somebody proposes otherwise, and an append-only record of every " +
    "swap, coverage ask, ruling and reason. The grid below is a fold " +
    "of those two things. Nothing is ever edited or deleted.",
  demoNote: "Demo data — the team is fictional. The pattern is the point.",
  now: "2026-10-12",
  handoverTime: "09:00",
  month: "2026-10",
  periodLabel: "October 2026",
  rows: [
    { id: "api", label: "api" },
    { id: "billing", label: "billing" },
    { id: "ingest", label: "ingest" },
    { id: "search", label: "search" },
  ],
  people: {
    priya: { name: "Priya Nair", color: "#d2a8ff", role: "platform engineer", handle: "priya@pager" },
    tom: { name: "Tom Becker", color: "#79c0ff", role: "engineer", handle: "tom@pager" },
    ana: { name: "Ana Ruiz", color: "#ffa657", role: "engineer", handle: "ana@pager" },
    leo: { name: "Leo Park", color: "#7ee787", role: "engineer", handle: "leo@pager" },
    sam: { name: "Sam Okafor", color: "#f778ba", role: "team lead", handle: "sam@pager" },
  },
  ruleText: ONCALL_RULE,
  anchor: "2026-09-28", // Monday; block 0: api=priya, billing=tom, ingest=ana, search=leo
  orderByRow: {
    api: ["priya", "tom", "ana"],
    billing: ["tom", "ana"],
    ingest: ["ana", "priya"],
    search: ["leo", "priya"],
  },
  standingEvents: [],
  freezes: [
    { row: "billing", from: "2026-10-19", to: "2026-10-23", label: "Billing v2 launch freeze" },
  ],
  seats: [
    { id: "priya", kind: "person", label: "Priya · engineer", person: "priya", rowsScope: "rotation" },
    { id: "tom", kind: "person", label: "Tom · engineer", person: "tom", rowsScope: "rotation" },
    { id: "ana", kind: "person", label: "Ana · engineer", person: "ana", rowsScope: "rotation" },
    { id: "leo", kind: "person", label: "Leo · engineer", person: "leo", rowsScope: "rotation" },
    { id: "sam", kind: "person", label: "Sam · team lead", person: "sam", rowsScope: "all" },
    { id: "director", kind: "aggregate", label: "Director · aggregate only" },
    { id: "pager", kind: "pager", label: "Pager · machine pull", row: "api" },
  ],
  icsSummary: "On call: {row} — {name}",
  agentText: "You hold the pager for {row}",
};

/**
 * The on-call seed — a month already mid-story:
 *   - an ACCEPTED swap on api (Ana's conference): Oct 12 ↔ Oct 19;
 *   - a REJECTED swap against the billing freeze, reason attached
 *     ("that's the launch freeze");
 *   - an ACCEPTED drop on search Oct 31 — a real coverage gap the
 *     director seat exists to see;
 *   - a PENDING coverage ask on ingest Oct 24, with the lead's
 *     question standing on it, unanswered.
 */
export function seedOncall(): Entry[] {
  const e = (
    id: string,
    ts: string,
    author: string,
    kind: Entry["kind"],
    cells: Entry["cells"],
    payload: Record<string, unknown>,
    reason?: string,
  ): Entry => ({ id, ts, author, kind, cells, payload, reason });
  const swapApi: Extract<Change, { type: "swap" }> = {
    type: "swap",
    a: { row: "api", day: "2026-10-12" },
    b: { row: "api", day: "2026-10-19" },
  };
  const swapBilling: Extract<Change, { type: "swap" }> = {
    type: "swap",
    a: { row: "billing", day: "2026-10-21" },
    b: { row: "billing", day: "2026-10-28" },
  };
  return [
    e("oc-01", "2026-09-26T09:00:00Z", "system", "seed", [], {
      note: "The demo month opens. The team is fictional; the pattern is the point.",
    }),
    e("oc-02", "2026-09-26T09:01:00Z", "system", "rule-note", [], { text: ONCALL_RULE }),
    e(
      "oc-03",
      "2026-09-28T08:15:00Z",
      "ana",
      "proposal",
      [swapApi.a, swapApi.b],
      {
        change: swapApi,
        note: "Platform conf on Monday the 12th — Priya, trade Mondays with me? You take the 12th, I take your 19th.",
      },
    ),
    e("oc-04", "2026-09-28T11:40:00Z", "priya", "accept", [swapApi.a, swapApi.b], {
      proposalId: "oc-03",
    }),
    e("oc-05", "2026-10-02T15:05:00Z", "sam", "event", [{ row: "billing", day: "2026-10-20" }], {
      title: "Billing v2 launch",
      time: "10:00",
      eventKind: "launch",
    }),
    e(
      "oc-06",
      "2026-10-05T09:20:00Z",
      "ana",
      "proposal",
      [swapBilling.a, swapBilling.b],
      {
        change: swapBilling,
        note: "I know the 21st is inside the launch freeze — family emergency that week. Naming it plainly: freeze or not, I have to ask.",
      },
    ),
    e("oc-07", "2026-10-05T13:02:00Z", "tom", "reject", [swapBilling.a, swapBilling.b], {
      proposalId: "oc-06",
    }, "That's the launch freeze — no swaps inside the window. That's the whole point of the freeze."),
    e(
      "oc-08",
      "2026-10-06T10:10:00Z",
      "leo",
      "proposal",
      [{ row: "search", day: "2026-10-31" }],
      {
        change: { type: "assign", row: "search", day: "2026-10-31", to: null } as Change,
        note: "Away that weekend — dropping the 31st while it's still weeks out.",
      },
    ),
    e("oc-09", "2026-10-06T12:00:00Z", "sam", "accept", [{ row: "search", day: "2026-10-31" }], {
      proposalId: "oc-08",
    }),
    e(
      "oc-10",
      "2026-10-11T17:25:00Z",
      "priya",
      "proposal",
      [{ row: "ingest", day: "2026-10-24" }],
      {
        change: { type: "assign", row: "ingest", day: "2026-10-24", to: null } as Change,
        note: "Coverage ask: I can't do ingest on the 24th. If nobody picks it up it goes uncovered — the gap will be visible, not silent.",
        tentative: true,
      },
    ),
    e("oc-11", "2026-10-12T08:45:00Z", "sam", "question", [{ row: "ingest", day: "2026-10-24" }], {
      proposalId: "oc-10",
      text: "The billing freeze ends Friday the 23rd — can you hold ingest until then, or is the 24th a hard no?",
    }),
  ];
}

/* ------------------------------------------------------------------ */
/* CUSTODY — two parents, one kid, one month (the original instance)   */
/* ------------------------------------------------------------------ */

const CUSTODY_RULE =
  "Alternating weeks, handover Fridays at 18:00. The week that starts " +
  "Friday October 2 is Mara's; it alternates from there, Friday to " +
  "Thursday. A day's color is who has the kid that night — on Fridays " +
  "the day changes hands at 18:00. Soccer practice stands every " +
  "Tuesday and Thursday at 17:00. If nobody proposes anything, this " +
  "is simply what happens: silence means the default holds.";

export const CUSTODY: InstanceConfig = {
  id: "custody",
  title: "The shared month",
  tagline: "Two people. One kid. One month — derived, not discussed.",
  intro:
    "Chat threads lose this argument: “that Monday” slides, the subtext evaporates, " +
    "and nobody can tell which version of a day is standing. So the month lives " +
    "here instead — a default that simply happens unless somebody proposes " +
    "otherwise, and an append-only record of every proposal, ruling, question " +
    "and reason. The grid below is a fold of those two things, recomputed from " +
    "the record. Nothing is ever edited or deleted.",
  demoNote: "Demo data — Mara and Jonas are fictional. The pattern is the point.",
  now: "2026-10-13",
  handoverTime: "18:00",
  month: "2026-10",
  periodLabel: "October 2026",
  rows: [{ id: "kid", label: "the kid" }],
  people: {
    mara: { name: "Mara", color: "#e08a3c", role: "parent 1" },
    jonas: { name: "Jonas", color: "#4a90d9", role: "parent 2" },
  },
  ruleText: CUSTODY_RULE,
  anchor: "2026-10-02", // the Friday-start week of Oct 2 is Mara's (block 0)
  orderByRow: { kid: ["mara", "jonas"] },
  standingEvents: [
    { row: "kid", weekdays: [2, 4], title: "Soccer practice", time: "17:00", kind: "soccer" },
  ],
  freezes: [],
  seats: [
    { id: "mara", kind: "person", label: "Mara · parent", person: "mara", rowsScope: "all" },
    { id: "jonas", kind: "person", label: "Jonas · parent", person: "jonas", rowsScope: "all" },
    { id: "coach", kind: "scoped", label: "Coach · need-to-know", eventKinds: ["soccer", "snack"] },
    { id: "agent", kind: "agent", label: "Agent · dings only", person: "mara" },
  ],
  icsSummary: "Kid with {name}",
  agentText: "the kid is with you ({name})",
};

/**
 * The custody seed — the original demo record, re-expressed in the
 * engine's general change shapes: the rule as a rule-note; a soccer
 * game + snack duty on Sat Oct 17; an ACCEPTED swap (Jonas's work
 * trip, Oct 12 ↔ Oct 19); a REJECTED Halloween assign, reason
 * attached forever; a PENDING tentative proposal on Oct 26 with
 * Mara's unanswered question on it.
 */
export function seedCustody(): Entry[] {
  const e = (
    id: string,
    ts: string,
    author: string,
    kind: Entry["kind"],
    cells: Entry["cells"],
    payload: Record<string, unknown>,
    reason?: string,
  ): Entry => ({ id, ts, author, kind, cells, payload, reason });
  const kid = (day: string) => ({ row: "kid", day });
  return [
    e("seed-01", "2026-09-26T09:00:00Z", "system", "seed", [], {
      note: "The demo month opens. Mara and Jonas are fictional; the pattern is the point.",
    }),
    e("seed-02", "2026-09-26T09:01:00Z", "system", "rule-note", [], { text: CUSTODY_RULE }),
    e("seed-03", "2026-09-27T18:20:00Z", "jonas", "event", [kid("2026-10-17")], {
      title: "Soccer game vs. Harborview",
      time: "10:00",
      eventKind: "soccer",
    }),
    e("seed-04", "2026-09-27T18:21:00Z", "jonas", "event", [kid("2026-10-17")], {
      title: "Snack duty — oranges & water",
      eventKind: "snack",
      for: "jonas",
    }),
    e(
      "seed-05",
      "2026-09-28T07:45:00Z",
      "jonas",
      "proposal",
      [kid("2026-10-12"), kid("2026-10-19")],
      {
        change: {
          type: "swap",
          a: kid("2026-10-12"),
          b: kid("2026-10-19"),
        } as Change,
        note: "Work trip moved to Monday the 12th — can we trade Mondays?",
      },
    ),
    e("seed-06", "2026-09-28T19:02:00Z", "mara", "accept", [kid("2026-10-12"), kid("2026-10-19")], {
      proposalId: "seed-05",
    }),
    e(
      "seed-07",
      "2026-09-29T21:15:00Z",
      "mara",
      "proposal",
      [kid("2026-10-31")],
      {
        change: { type: "assign", row: "kid", day: "2026-10-31", to: "jonas" } as Change,
        note: "Halloween — could you take the 31st? There's a gallery opening I want to catch.",
      },
    ),
    e("seed-08", "2026-09-30T08:30:00Z", "jonas", "reject", [kid("2026-10-31")], {
      proposalId: "seed-07",
    }, "Hosting my parents that weekend — I can't do Halloween solo. Sorry — ask me about the 30th instead."),
    e(
      "seed-09",
      "2026-10-11T16:40:00Z",
      "jonas",
      "proposal",
      [kid("2026-10-26")],
      {
        change: { type: "assign", row: "kid", day: "2026-10-26", to: "mara" } as Change,
        note: "Not sure yet — waiting to hear back from the market about that weekend. Flagging it early so it's on the grid.",
        tentative: true,
      },
    ),
    e("seed-10", "2026-10-12T09:12:00Z", "mara", "question", [kid("2026-10-26")], {
      proposalId: "seed-09",
      text: "If the market says yes, does it run into the evening? I can cover the day but not a late pickup.",
    }),
  ];
}

/* ------------------------------------------------------------------ */
/* The registry                                                        */
/* ------------------------------------------------------------------ */

export const INSTANCES: Record<string, InstanceConfig> = {
  oncall: ONCALL,
  custody: CUSTODY,
};

/** Instance order on the switcher: engineering leads. */
export const INSTANCE_ORDER = ["oncall", "custody"];

export function seedFor(instanceId: string): Entry[] {
  if (instanceId === "oncall") return seedOncall();
  if (instanceId === "custody") return seedCustody();
  throw new Error(`no seed for instance ${instanceId}`);
}
