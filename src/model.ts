/**
 * model.ts — the Grid's whole domain, as a pure function.
 *
 * THE FICTION
 * Two people share responsibility for a kid across a month. A chat
 * thread fails at this: "that Monday" slides, subtext evaporates,
 * and nobody can tell which version of a day is standing. A grid
 * works, because it is built the way this system builds everything:
 *
 *   - There is a DEFAULT, and the default is derived, not stored as
 *     31 little facts. Silence inherits: if nobody proposes anything,
 *     the default is simply what happens.
 *   - Everything else is a RECORD — append-only, authored, reasoned.
 *     A proposal is a color on the grid, not a fact. It lands only
 *     when another record (an accept) says so; a rejection keeps its
 *     reason attached forever; a question is a first-class entry,
 *     because some proposals are honestly "not sure yet".
 *   - THE GRID IS A FOLD. deriveGrid(default, log) is pure: same
 *     default, same log, same month — from any seat, on any machine.
 *     The desk's burn test is this file's unit test made visible.
 *
 * CELLS WITH INSIDES (the Plato rule): a day's face shows a value;
 * the box behind it carries the description (what the default says,
 * what stands now) AND the equation (every record that touched the
 * day, and how the standing value was computed). projectDay() builds
 * the insides; the page just opens the box.
 *
 * SEATS ARE RENDERINGS: projectFor() computes a DIFFERENT payload
 * per seat from the same derived grid — server-side. The coach's
 * payload never contains responsibility data at all (it is not
 * hidden by the client; it is never sent). A mechanic watches the
 * gauges with a different eye than the captain, and the deckhand
 * has only been told a few details: same engine, three resolutions.
 */

import config from "../grid.json";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type SeatId = "mara" | "jonas";
export type ViewSeat = SeatId | "coach" | "agent";

export type EntryKind =
  | "seed"
  | "rule-note"
  | "proposal"
  | "accept"
  | "reject"
  | "counter"
  | "question"
  | "comment"
  | "event";

export interface ChangeAssign {
  type: "assign";
  day: string;
  to: SeatId;
}
export interface ChangeSwap {
  type: "swap";
  days: [string, string];
}
export interface ChangeEvent {
  type: "event";
  day: string;
  title: string;
  time?: string;
  eventKind?: string;
  for?: SeatId;
}
export type Change = ChangeAssign | ChangeSwap | ChangeEvent;

export interface Entry {
  id: string;
  /** ISO timestamp. Seed entries carry fixed, story-time stamps. */
  ts: string;
  author: SeatId | "system";
  kind: EntryKind;
  /** Days this entry directly concerns. */
  days: string[];
  payload: Record<string, unknown>;
  reason?: string;
}

export interface DayEvent {
  title: string;
  time?: string;
  kind: string; // "soccer" | "snack" | "event"
  for?: SeatId;
  source: "standing" | "record" | "proposal";
  entryId?: string;
}

export type ProposalStatus = "pending" | "accepted" | "rejected" | "countered";

export interface ProposalView {
  id: string;
  author: SeatId;
  ts: string;
  change: Change;
  note?: string;
  tentative?: boolean;
  status: ProposalStatus;
  /** Filled when status is accepted/rejected/countered. */
  resolvedBy?: SeatId;
  resolutionReason?: string;
  counterId?: string;
  counterOf?: string;
  summary: string;
}

export interface Day {
  date: string; // YYYY-MM-DD
  /** Who has the kid that night (after the 18:00 Friday handover). */
  responsible: SeatId;
  /** What the default alone says. */
  defaultResponsible: SeatId;
  events: DayEvent[];
  /** Pending proposals touching this day (a color, not a fact). */
  pending: ProposalView[];
  /** Entry ids of everything that ever touched this day, in log order. */
  historyIds: string[];
}

export interface DerivedGrid {
  month: string;
  days: Record<string, Day>;
  proposals: Record<string, ProposalView>;
}

/* ------------------------------------------------------------------ */
/* The default — data, stated in plain words on the page               */
/* ------------------------------------------------------------------ */

export const MONTH = config.month; // "2026-10"
export const SEATS: Record<SeatId, { name: string; color: string; role: string }> =
  config.seats as never;

/** The anchor: the Friday-start week of Fri 2026-10-02 is Mara's. */
const ANCHOR_FRIDAY = Date.UTC(2026, 9, 2); // 2026-10-02
const DAY_MS = 86_400_000;

export const RULE_TEXT =
  "Alternating weeks, handover Fridays at 18:00. The week that starts " +
  "Friday October 2 is Mara's; it alternates from there, Friday to " +
  "Thursday. A day's color is who has the kid that night — on Fridays " +
  "the day changes hands at 18:00. Soccer practice stands every " +
  "Tuesday and Thursday at 17:00. If nobody proposes anything, this " +
  "is simply what happens: silence means the default holds.";

export const STANDING_EVENTS: {
  weekdays: number[];
  title: string;
  time: string;
  kind: string;
}[] = [{ weekdays: [2, 4], title: "Soccer practice", time: "17:00", kind: "soccer" }];

/** All dates of the demo month, YYYY-MM-DD. */
export function monthDates(month = MONTH): string[] {
  const [y, m] = month.split("-").map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

function utcOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function weekdayOf(date: string): number {
  return new Date(utcOf(date)).getUTCDay(); // 0=Sun … 6=Sat
}

/**
 * The default, computed — never stored. Week blocks run Friday
 * through Thursday from the anchor; even blocks are Mara's, odd
 * blocks Jonas's. Oct 1 (the Thursday before the anchor) falls in
 * block −1: Jonas.
 */
export function defaultResponsible(date: string): SeatId {
  const block = Math.floor((utcOf(date) - ANCHOR_FRIDAY) / (7 * DAY_MS));
  return ((block % 2) + 2) % 2 === 0 ? "mara" : "jonas";
}

/** A plain-words account of the default for one day (the description). */
export function defaultExplain(date: string): string {
  const block = Math.floor((utcOf(date) - ANCHOR_FRIDAY) / (7 * DAY_MS));
  const friday = new Date(utcOf(date) - ((weekdayOf(date) + 2) % 7) * DAY_MS);
  const friStr = friday.toISOString().slice(0, 10);
  const who = SEATS[defaultResponsible(date)].name;
  return (
    `Default: ${who} — the week block starting Friday ${friStr} ` +
    `(block ${block} counting from Fri 2026-10-02, Mara's week; odd blocks are Jonas's).`
  );
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

export function changeDays(change: Change): string[] {
  return change.type === "swap" ? [...change.days] : [change.day];
}

export function changeSummary(change: Change): string {
  switch (change.type) {
    case "assign":
      return `${change.day} → ${SEATS[change.to].name}`;
    case "swap":
      return `swap ${change.days[0]} ↔ ${change.days[1]}`;
    case "event":
      return `add "${change.title}" on ${change.day}${change.time ? ` at ${change.time}` : ""}`;
  }
}

function entrySummary(e: Entry): string {
  const who = e.author === "system" ? "the record" : SEATS[e.author].name;
  switch (e.kind) {
    case "proposal": {
      const c = e.payload.change as Change;
      return `${who} proposed: ${changeSummary(c)}${e.payload.tentative ? " (tentative)" : ""}`;
    }
    case "accept":
      return `${who} accepted ${String(e.payload.proposalId)}`;
    case "reject":
      return `${who} rejected ${String(e.payload.proposalId)} — "${e.reason ?? ""}"`;
    case "counter": {
      const c = e.payload.change as Change;
      return `${who} countered ${String(e.payload.counterOf)} with: ${changeSummary(c)}`;
    }
    case "question":
      return `${who} asked: "${String(e.payload.text ?? "")}"`;
    case "comment":
      return e.payload.optIn
        ? `${who} opted in to a reminder`
        : `${who} commented: "${String(e.payload.text ?? "")}"`;
    case "event":
      return `event: ${String(e.payload.title ?? "")} on ${e.days[0] ?? ""}`;
    case "rule-note":
      return "rule note";
    default:
      return e.kind;
  }
}

/* ------------------------------------------------------------------ */
/* The fold                                                            */
/* ------------------------------------------------------------------ */

/**
 * deriveGrid — the pure fold. Default first, then the record in log
 * order: direct event entries land; proposals land ONLY through an
 * accept (applied in the order the accepts appear). A swap exchanges
 * the two days' currently-standing responsibility, so accepted
 * changes compose in the order they were ruled.
 */
export function deriveGrid(log: Entry[]): DerivedGrid {
  const dates = monthDates();
  const days: Record<string, Day> = {};
  for (const date of dates) {
    const events: DayEvent[] = [];
    const wd = weekdayOf(date);
    for (const s of STANDING_EVENTS) {
      if (s.weekdays.includes(wd)) {
        events.push({ title: s.title, time: s.time, kind: s.kind, source: "standing" });
      }
    }
    days[date] = {
      date,
      responsible: defaultResponsible(date),
      defaultResponsible: defaultResponsible(date),
      events,
      pending: [],
      historyIds: [],
    };
  }

  const touch = (entry: Entry, extraDays: string[] = []) => {
    for (const d of new Set([...entry.days, ...extraDays])) {
      if (days[d] && !days[d].historyIds.includes(entry.id)) days[d].historyIds.push(entry.id);
    }
  };

  // First pass: proposal statuses (an accept/reject/counter may sit
  // anywhere after its proposal in the log).
  const proposals: Record<string, ProposalView> = {};
  for (const e of log) {
    if (e.kind === "proposal" || e.kind === "counter") {
      const change = e.payload.change as Change;
      proposals[e.id] = {
        id: e.id,
        author: e.author as SeatId,
        ts: e.ts,
        change,
        note: (e.payload.note as string) || undefined,
        tentative: Boolean(e.payload.tentative),
        status: "pending",
        counterOf: (e.payload.counterOf as string) || undefined,
        summary: changeSummary(change),
      };
    }
  }
  for (const e of log) {
    const pid = (e.payload.proposalId ?? e.payload.counterOf) as string | undefined;
    if (!pid || !proposals[pid]) continue;
    if (e.kind === "accept") {
      proposals[pid].status = "accepted";
      proposals[pid].resolvedBy = e.author as SeatId;
    } else if (e.kind === "reject") {
      proposals[pid].status = "rejected";
      proposals[pid].resolvedBy = e.author as SeatId;
      proposals[pid].resolutionReason = e.reason;
    } else if (e.kind === "counter" && e.payload.counterOf === pid) {
      if (proposals[pid].status === "pending") {
        proposals[pid].status = "countered";
        proposals[pid].counterId = e.id;
      }
    }
  }

  // Second pass: apply, in log order.
  for (const e of log) {
    if (e.kind === "event") {
      for (const d of e.days) {
        if (!days[d]) continue;
        days[d].events.push({
          title: String(e.payload.title ?? ""),
          time: (e.payload.time as string) || undefined,
          kind: String(e.payload.eventKind ?? "event"),
          for: (e.payload.for as SeatId) || undefined,
          source: "record",
          entryId: e.id,
        });
      }
      touch(e);
    } else if (e.kind === "accept") {
      const p = proposals[String(e.payload.proposalId)];
      if (!p || p.status !== "accepted") continue;
      const c = p.change;
      if (c.type === "assign") {
        if (days[c.day]) days[c.day].responsible = c.to;
      } else if (c.type === "swap") {
        const [a, b] = c.days;
        if (days[a] && days[b]) {
          const t = days[a].responsible;
          days[a].responsible = days[b].responsible;
          days[b].responsible = t;
        }
      } else if (c.type === "event") {
        if (days[c.day]) {
          days[c.day].events.push({
            title: c.title,
            time: c.time,
            kind: c.eventKind ?? "event",
            for: c.for,
            source: "proposal",
            entryId: p.id,
          });
        }
      }
      touch(e, changeDays(c));
    } else if (e.kind === "proposal" || e.kind === "counter") {
      const p = proposals[e.id];
      if (p) touch(e, changeDays(p.change));
    } else {
      // accept handled above; reject/question/comment/rule-note touch
      // their days (and, for resolutions, the proposal's days).
      const pid = e.payload.proposalId as string | undefined;
      touch(e, pid && proposals[pid] ? changeDays(proposals[pid].change) : []);
    }
  }

  // Pending proposals become the color on their days.
  for (const p of Object.values(proposals)) {
    if (p.status !== "pending") continue;
    for (const d of changeDays(p.change)) {
      if (days[d]) days[d].pending.push(p);
    }
  }

  return { month: MONTH, days, proposals };
}

/* ------------------------------------------------------------------ */
/* Digest — the canonical pin (sha256 over canonical JSON)             */
/* ------------------------------------------------------------------ */

export const canonical = (v: unknown): string =>
  v === null || typeof v !== "object"
    ? (JSON.stringify(v) ?? "null")
    : Array.isArray(v)
      ? "[" + v.map(canonical).join(",") + "]"
      : "{" +
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => JSON.stringify(k) + ":" + canonical((v as Record<string, unknown>)[k]))
          .join(",") +
        "}";

export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The grid-state digest: responsibility + events per day, nothing else. */
export function gridDigestSource(grid: DerivedGrid): string {
  const out: Record<string, unknown> = {};
  for (const date of Object.keys(grid.days).sort()) {
    const d = grid.days[date];
    out[date] = {
      r: d.responsible,
      e: d.events.map((ev) => [ev.title, ev.time ?? "", ev.kind, ev.for ?? ""]),
    };
  }
  return canonical(out);
}

/* ------------------------------------------------------------------ */
/* The box: one day's insides                                          */
/* ------------------------------------------------------------------ */

export interface DayBox {
  date: string;
  defaultLine: string;
  standingLine: string;
  responsible: SeatId;
  events: DayEvent[];
  pending: ProposalView[];
  history: {
    id: string;
    ts: string;
    author: string;
    kind: EntryKind;
    summary: string;
    reason?: string;
  }[];
}

export function projectDay(grid: DerivedGrid, log: Entry[], date: string): DayBox {
  const d = grid.days[date];
  const byId = new Map(log.map((e) => [e.id, e]));
  const history = (d?.historyIds ?? [])
    .map((id) => byId.get(id))
    .filter((e): e is Entry => Boolean(e))
    .map((e) => ({
      id: e.id,
      ts: e.ts,
      author: e.author === "system" ? "the record" : SEATS[e.author].name,
      kind: e.kind,
      summary: entrySummary(e),
      reason: e.reason,
    }));
  const standing = d.responsible === d.defaultResponsible
    ? `Standing: ${SEATS[d.responsible].name} — the default holds; no accepted record moved this day.`
    : `Standing: ${SEATS[d.responsible].name} — moved off the default (${SEATS[d.defaultResponsible].name}) by an accepted proposal in the history below.`;
  return {
    date,
    defaultLine: defaultExplain(date),
    standingLine: standing,
    responsible: d.responsible,
    events: d.events,
    pending: d.pending,
    history,
  };
}

/* ------------------------------------------------------------------ */
/* Per-seat projections — the X factor, computed server-side           */
/* ------------------------------------------------------------------ */

export interface InboxItem {
  type: "pending-yours" | "question-for-you" | "resolved-yours";
  proposalId?: string;
  entryId: string;
  text: string;
  ts: string;
}

export function inboxFor(grid: DerivedGrid, log: Entry[], seat: SeatId): InboxItem[] {
  const items: InboxItem[] = [];
  for (const p of Object.values(grid.proposals)) {
    if (p.status === "pending" && p.author !== seat) {
      items.push({
        type: "pending-yours",
        proposalId: p.id,
        entryId: p.id,
        text: `${SEATS[p.author].name} proposed: ${p.summary}${p.tentative ? " — tentative, not sure yet" : ""}${p.note ? ` — "${p.note}"` : ""}`,
        ts: p.ts,
      });
    }
    if (p.status !== "pending" && p.author === seat) {
      items.push({
        type: "resolved-yours",
        proposalId: p.id,
        entryId: p.id,
        text: `Your proposal (${p.summary}) was ${p.status}${p.resolutionReason ? ` — "${p.resolutionReason}"` : ""}`,
        ts: p.ts,
      });
    }
  }
  for (const e of log) {
    if (e.kind === "question" && e.author !== seat && e.author !== "system") {
      const pid = e.payload.proposalId as string | undefined;
      const about = pid && grid.proposals[pid] ? grid.proposals[pid] : undefined;
      if (!about || about.author === seat) {
        items.push({
          type: "question-for-you",
          entryId: e.id,
          proposalId: pid,
          text: `${SEATS[e.author].name} asked: "${String(e.payload.text ?? "")}"${about ? ` (on: ${about.summary})` : ""}`,
          ts: e.ts,
        });
      }
    }
  }
  return items.sort((a, b) => (a.ts < b.ts ? -1 : 1));
}

/** Parent seats: the whole grid, insides included. */
export function projectParent(grid: DerivedGrid, log: Entry[], seat: SeatId, digest: string) {
  return {
    view: "grid" as const,
    seat,
    month: MONTH,
    rule: RULE_TEXT,
    digest,
    days: monthDates().map((date) => {
      const d = grid.days[date];
      return {
        date,
        responsible: d.responsible,
        defaultResponsible: d.defaultResponsible,
        events: d.events,
        pending: d.pending,
        box: projectDay(grid, log, date),
      };
    }),
    proposals: Object.values(grid.proposals),
    inbox: inboxFor(grid, log, seat),
    feed: log.map((e) => ({
      id: e.id,
      ts: e.ts,
      author: e.author,
      kind: e.kind,
      days: e.days,
      summary: entrySummary(e),
      reason: e.reason,
    })),
  };
}

/**
 * Coach: ONLY days carrying soccer or snack duty, and only the
 * events. No responsibility field exists anywhere in this payload —
 * it is removed here, at the projection, not hidden by the client.
 */
export function projectCoach(grid: DerivedGrid, digest: string) {
  const days = monthDates()
    .map((date) => grid.days[date])
    .filter((d) => d.events.some((ev) => ev.kind === "soccer" || ev.kind === "snack"))
    .map((d) => ({
      date: d.date,
      weekday: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][
        weekdayOf(d.date)
      ],
      events: d.events
        .filter((ev) => ev.kind === "soccer" || ev.kind === "snack")
        .map((ev) => ({
          title: ev.title,
          time: ev.time,
          kind: ev.kind,
          duty: ev.for ? `${SEATS[ev.for].name} has snack duty` : undefined,
        })),
    }));
  return { view: "events" as const, seat: "coach" as const, month: MONTH, digest, days };
}

/**
 * Agent: no grid at all — a need-to-know list of dings for its
 * human: their upcoming responsibility days, their events wherever
 * they fall, and the proposals waiting on them.
 */
export function projectAgent(grid: DerivedGrid, log: Entry[], digest: string, human: SeatId) {
  const items: { date: string; kind: string; text: string }[] = [];
  const today = "2026-10-13"; // the demo's "now" (Casey's today)
  for (const date of monthDates()) {
    const d = grid.days[date];
    if (date >= today && d.responsible === human) {
      items.push({ date, kind: "responsibility", text: `${config.kid} is with you (${SEATS[human].name})` });
    }
    for (const ev of d.events) {
      if (ev.for === human) {
        items.push({ date, kind: "duty", text: `${ev.title}${ev.time ? ` at ${ev.time}` : ""}` });
      } else if (date >= today && d.responsible === human) {
        items.push({ date, kind: "event", text: `${ev.title}${ev.time ? ` at ${ev.time}` : ""}` });
      }
    }
  }
  for (const item of inboxFor(grid, log, human)) {
    if (item.type === "pending-yours") {
      items.push({ date: "", kind: "ding", text: `Waiting on you: ${item.text}` });
    } else if (item.type === "question-for-you") {
      items.push({ date: "", kind: "ding", text: item.text });
    }
  }
  return { view: "list" as const, seat: "agent" as const, for: human, month: MONTH, digest, items };
}

/* ------------------------------------------------------------------ */
/* The pull: an .ics of one seat's days (the phone-calendar move)      */
/* ------------------------------------------------------------------ */

function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

export function optedInEvents(log: Entry[], seat: SeatId): Set<string> {
  const out = new Set<string>();
  for (const e of log) {
    if (e.kind === "comment" && e.author === seat && e.payload.optIn) {
      out.add(String(e.payload.optIn));
    }
  }
  return out;
}

export function buildIcs(grid: DerivedGrid, log: Entry[], seat: SeatId): string {
  const name = SEATS[seat].name;
  const opted = optedInEvents(log, seat);
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SuperInstance//git.pp-grid//EN",
    `X-WR-CALNAME:Kid days — ${name} (pulled from the Grid)`,
  ];
  const stamp = "20261013T000000Z";
  for (const date of monthDates()) {
    const d = grid.days[date];
    const ymd = date.replace(/-/g, "");
    const next = new Date(utcOf(date) + DAY_MS).toISOString().slice(0, 10).replace(/-/g, "");
    if (d.responsible === seat) {
      lines.push(
        "BEGIN:VEVENT",
        `UID:grid-${date}-${seat}@git.pp-grid`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${ymd}`,
        `DTEND;VALUE=DATE:${next}`,
        `SUMMARY:${icsEscape(`Kid with ${name}`)}`,
        "END:VEVENT",
      );
    }
    for (const ev of d.events) {
      const mine =
        d.responsible === seat || ev.for === seat || opted.has(`${date}|${ev.title}`);
      if (!mine) continue;
      lines.push("BEGIN:VEVENT", `UID:grid-ev-${date}-${ev.title.replace(/\W+/g, "")}@git.pp-grid`, `DTSTAMP:${stamp}`);
      if (ev.time) {
        const [hh, mm] = ev.time.split(":");
        lines.push(`DTSTART:${ymd}T${hh.padStart(2, "0")}${mm.padStart(2, "0")}00`);
        lines.push(`DTEND:${ymd}T${String(Number(hh) + 1).padStart(2, "0")}${mm.padStart(2, "0")}00`);
      } else {
        lines.push(`DTSTART;VALUE=DATE:${ymd}`, `DTEND;VALUE=DATE:${next}`);
      }
      lines.push(`SUMMARY:${icsEscape(ev.title)}`, "END:VEVENT");
    }
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

/* ------------------------------------------------------------------ */
/* The seed — a month that already tells the story                     */
/* ------------------------------------------------------------------ */

/**
 * The demo record. Fixed story-time timestamps in late September, so
 * the history reads as lived-in when the page opens in October:
 *   - the rule itself, as a rule-note;
 *   - a soccer game + snack duty on Sat Oct 17 (a direct event pair);
 *   - an ACCEPTED swap (Jonas's work trip): Oct 12 ↔ Oct 19;
 *   - a REJECTED assign (Halloween), reason attached forever;
 *   - a PENDING tentative proposal on Oct 26 ("waiting to hear back
 *     from the market") — plus Mara's question on it, unanswered.
 */
export function seedLog(): Entry[] {
  const e = (
    id: string,
    ts: string,
    author: Entry["author"],
    kind: EntryKind,
    days: string[],
    payload: Record<string, unknown>,
    reason?: string,
  ): Entry => ({ id, ts, author, kind, days, payload, reason });
  return [
    e("seed-01", "2026-09-26T09:00:00Z", "system", "seed", [], {
      note: "The demo month opens. Mara and Jonas are fictional; the pattern is the point.",
    }),
    e("seed-02", "2026-09-26T09:01:00Z", "system", "rule-note", [], {
      text: RULE_TEXT,
    }),
    e("seed-03", "2026-09-27T18:20:00Z", "jonas", "event", ["2026-10-17"], {
      title: "Soccer game vs. Harborview",
      time: "10:00",
      eventKind: "soccer",
    }),
    e("seed-04", "2026-09-27T18:21:00Z", "jonas", "event", ["2026-10-17"], {
      title: "Snack duty — oranges & water",
      eventKind: "snack",
      for: "jonas",
    }),
    e(
      "seed-05",
      "2026-09-28T07:45:00Z",
      "jonas",
      "proposal",
      ["2026-10-12", "2026-10-19"],
      {
        change: { type: "swap", days: ["2026-10-12", "2026-10-19"] } as Change,
        note: "Work trip moved to Monday the 12th — can we trade Mondays?",
      },
    ),
    e("seed-06", "2026-09-28T19:02:00Z", "mara", "accept", [], {
      proposalId: "seed-05",
    }),
    e(
      "seed-07",
      "2026-09-29T21:15:00Z",
      "mara",
      "proposal",
      ["2026-10-31"],
      {
        change: { type: "assign", day: "2026-10-31", to: "jonas" } as Change,
        note: "Halloween — could you take the 31st? There's a gallery opening I want to catch.",
      },
    ),
    e("seed-08", "2026-09-30T08:30:00Z", "jonas", "reject", [], {
      proposalId: "seed-07",
    }, "Hosting my parents that weekend — I can't do Halloween solo. Sorry — ask me about the 30th instead."),
    e(
      "seed-09",
      "2026-10-11T16:40:00Z",
      "jonas",
      "proposal",
      ["2026-10-26"],
      {
        change: { type: "assign", day: "2026-10-26", to: "mara" } as Change,
        note: "Not sure yet — waiting to hear back from the market about that weekend. Flagging it early so it's on the grid.",
        tentative: true,
      },
    ),
    e("seed-10", "2026-10-12T09:12:00Z", "mara", "question", ["2026-10-26"], {
      proposalId: "seed-09",
      text: "If the market says yes, does it run into the evening? I can cover the day but not a late pickup.",
    }),
  ];
}
