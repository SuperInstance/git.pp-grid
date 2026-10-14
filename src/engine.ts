/**
 * engine.ts — THE GRID ENGINE. Everything instance-shaped lives in
 * instances.ts as CONFIG; everything here is the general machine
 * that config drives. No instance vocabulary (no kids, no services,
 * no names) appears in this file: if a word only makes sense in one
 * instance, it belongs in that instance's config, not in the engine.
 *
 * THE PRIMITIVES (named, because this is what the engine IS):
 *
 *   CELLS — a keyed space: rows × days. A cell holds one standing
 *     value (a person, or null — a gap) plus annotations (events,
 *     a freeze). The grid is cells, all the way down.
 *   THE DEFAULT RULE — data, declared per instance: a rotation over
 *     each row's roster, anchored to a date. The standing grid is
 *     DERIVED from it, never stored as facts. Silence inherits: if
 *     nobody proposes anything, the default is simply what happens.
 *   THE RECORD — an append-only log of authored, reasoned entries.
 *     Nothing is edited or deleted; a rejection keeps its reason
 *     attached forever because the fold reads the whole log, always.
 *   PROPOSALS — pending deltas against cells, rendered as a COLOR,
 *     not a fact. The five moves: propose, accept, reject (a reason
 *     is required — enforced here), counter (a linked new proposal;
 *     the original is marked countered), question / comment (first
 *     class, because some proposals are honestly "not sure yet").
 *     A proposal lands only when ANOTHER seat's accept enters the
 *     record; the fold applies accepted changes in ruling order.
 *   FREEZES — declared windows over cells. A frozen cell renders
 *     locked; a proposal against it must NAME the freeze in its
 *     note (its reason thread) or the port refuses it.
 *   SEATS — server-side projections of the same record, computed
 *     here, per seat kind: person (the grid at their scope),
 *     scoped (only cells carrying chosen event kinds — the rest of
 *     the record is ABSENT from the payload, not hidden), aggregate
 *     (counts and gaps only, no names at all), agent (a need-to-
 *     know list of dings), pager (a machine window pull). Same
 *     record, rendered for where you sit.
 *   PORTS — the only way in is appending a record through a declared
 *     action (index.ts enforces the guards); the way out is a PULL:
 *     an artefact generated from the fold (.ics / JSON) that a seat
 *     carries away. Pulling is free; pushing goes through the port.
 *   INSIDES — every cell opens: the DESCRIPTION (what the default
 *     says, what stands now, any freeze) and the EQUATION (every
 *     record that touched the cell, reasons attached). A cell that
 *     can explain itself — Plato's rule.
 *   RE-FOLD — the derived grid is a cache over default + record.
 *     Discard it and re-fold: the digest must come back identical,
 *     or something other than the record was carrying the truth.
 */

/* ------------------------------------------------------------------ */
/* Config — the shape of an instance (data, in instances.ts)           */
/* ------------------------------------------------------------------ */

export interface PersonDef {
  name: string;
  color: string;
  role: string;
  /** Machine-facing address for pager pulls, e.g. "priya@pager". */
  handle?: string;
}

export interface RowDef {
  id: string;
  label: string;
}

export interface FreezeWindow {
  row: string;
  from: string; // YYYY-MM-DD, inclusive
  to: string; // inclusive
  label: string;
}

export interface StandingEventDef {
  /** Row the event stands on; omit for every row. */
  row?: string;
  weekdays: number[]; // 0=Sun … 6=Sat
  title: string;
  time?: string;
  kind: string;
}

export type SeatSpec =
  | { id: string; kind: "person"; label: string; person: string; rowsScope: "all" | "rotation" }
  | { id: string; kind: "scoped"; label: string; eventKinds: string[] }
  | { id: string; kind: "aggregate"; label: string }
  | { id: string; kind: "agent"; label: string; person: string }
  | { id: string; kind: "pager"; label: string; row: string };

export interface InstanceConfig {
  id: string;
  /** Switcher/title text, e.g. "On-call rotation". */
  title: string;
  tagline: string;
  intro: string;
  demoNote: string;
  /** The demo's "today", YYYY-MM-DD — agent views and pager windows anchor here. */
  now: string;
  /** Daily handover time "HH:MM" (pager shift windows). */
  handoverTime: string;
  month: string; // "2026-10"
  periodLabel: string; // "October 2026"
  rows: RowDef[];
  people: Record<string, PersonDef>;
  /** The default rule, in plain words — printed on the page verbatim. */
  ruleText: string;
  /** Default rule as data: 7-day blocks from this anchor date, each
   *  row rotating through its roster in order. */
  anchor: string; // YYYY-MM-DD, first day of block 0
  orderByRow: Record<string, string[]>;
  standingEvents: StandingEventDef[];
  freezes: FreezeWindow[];
  seats: SeatSpec[];
  /** .ics summary templates; {name} and {row} are substituted. */
  icsSummary: string;
  /** Agent-view responsibility line template ({name}, {row}). */
  agentText: string;
}

/* ------------------------------------------------------------------ */
/* The record                                                          */
/* ------------------------------------------------------------------ */

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

export interface CellRef {
  row: string;
  day: string;
}

export type Change =
  | { type: "assign"; row: string; day: string; to: string | null }
  | { type: "swap"; a: CellRef; b: CellRef }
  | { type: "event"; row: string; day: string; title: string; time?: string; eventKind?: string; for?: string };

export interface Entry {
  id: string;
  /** ISO timestamp. Seed entries carry fixed, story-time stamps. */
  ts: string;
  author: string; // a person id, or "system"
  kind: EntryKind;
  /** Cells this entry directly concerns (the touch list). */
  cells: CellRef[];
  payload: Record<string, unknown>;
  reason?: string;
}

export interface CellEvent {
  title: string;
  time?: string;
  kind: string;
  for?: string;
  source: "standing" | "record" | "proposal";
  entryId?: string;
}

export type ProposalStatus = "pending" | "accepted" | "rejected" | "countered";

export interface ProposalView {
  id: string;
  author: string;
  ts: string;
  change: Change;
  note?: string;
  tentative?: boolean;
  status: ProposalStatus;
  resolvedBy?: string;
  resolutionReason?: string;
  counterId?: string;
  counterOf?: string;
  summary: string;
}

export interface Cell {
  row: string;
  date: string;
  /** The standing value: a person id, or null — an uncovered gap. */
  value: string | null;
  /** What the default rule alone says. */
  defaultValue: string | null;
  /** Freeze label if this cell sits inside a declared freeze window. */
  freeze: string | null;
  events: CellEvent[];
  /** Pending proposals touching this cell (a color, not a fact). */
  pending: ProposalView[];
  historyIds: string[];
}

export interface DerivedGrid {
  instance: string;
  cells: Record<string, Cell>; // key: `${row}|${date}`
  proposals: Record<string, ProposalView>;
}

export const cellKey = (row: string, date: string) => `${row}|${date}`;

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

const DAY_MS = 86_400_000;
const WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WD3 = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function utcOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(date: string, n: number): string {
  return new Date(utcOf(date) + n * DAY_MS).toISOString().slice(0, 10);
}

export function weekdayOf(date: string): number {
  return new Date(utcOf(date)).getUTCDay();
}

export function fmtDay(date: string): string {
  return `${WD3[weekdayOf(date)]} ${date}`;
}

/** All dates of the instance's period, YYYY-MM-DD. */
export function periodDates(cfg: InstanceConfig): string[] {
  const [y, m] = cfg.month.split("-").map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${cfg.month}-${String(i + 1).padStart(2, "0")}`);
}

/* ------------------------------------------------------------------ */
/* The default rule — data in, standing value out, never stored       */
/* ------------------------------------------------------------------ */

function blockIndex(cfg: InstanceConfig, date: string): number {
  return Math.floor((utcOf(date) - utcOf(cfg.anchor)) / (7 * DAY_MS));
}

/** The default, computed: block n of a row takes roster[n mod len]. */

export function defaultFor(cfg: InstanceConfig, row: string, date: string): string | null {
  const roster = cfg.orderByRow[row];
  if (!roster || roster.length === 0) return null;
  const b = blockIndex(cfg, date);
  return roster[((b % roster.length) + roster.length) % roster.length];
}

/** A plain-words account of the default for one cell (the description). */
export function defaultExplain(cfg: InstanceConfig, row: string, date: string): string {
  const roster = cfg.orderByRow[row] ?? [];
  const b = blockIndex(cfg, date);
  const start = addDays(cfg.anchor, b * 7);
  const who = defaultFor(cfg, row, date);
  const names = roster.map((p) => personName(cfg, p)).join(" → ");
  return (
    `Default: ${who ? personName(cfg, who) : "nobody"} — ${rowLabel(cfg, row)} rotates ${names}; ` +
    `this is week block ${b}, starting ${fmtDay(start)} (blocks count from ${fmtDay(cfg.anchor)}).`
  );
}

export function personName(cfg: InstanceConfig, id: string | null): string {
  if (id === null) return "nobody";
  return cfg.people[id]?.name ?? id;
}

export function rowLabel(cfg: InstanceConfig, row: string): string {
  return cfg.rows.find((r) => r.id === row)?.label ?? row;
}

/** Rows in whose rotation this person stands (their scope). */
export function rotationRows(cfg: InstanceConfig, person: string): string[] {
  return cfg.rows.filter((r) => (cfg.orderByRow[r.id] ?? []).includes(person)).map((r) => r.id);
}

/** The freeze covering a cell, if any — declared data, like the rule. */
export function frozenFor(cfg: InstanceConfig, row: string, date: string): FreezeWindow | null {
  return cfg.freezes.find((f) => f.row === row && f.from <= date && date <= f.to) ?? null;
}

/* ------------------------------------------------------------------ */
/* Changes — including the legacy single-row shapes of the first      */
/* custody deployment, normalised here so old clients keep working.    */
/* ------------------------------------------------------------------ */

/** Accept the canonical change shapes plus the legacy ones
 *  ({assign, day, to} with no row; {swap, days:[a,b]} on row 0). */
export function normalizeChange(cfg: InstanceConfig, raw: unknown): Change {
  const c = raw as Record<string, unknown>;
  if (!c || typeof c !== "object") throw new Error("change required");
  const firstRow = cfg.rows[0]?.id;
  if (c.type === "assign") {
    return {
      type: "assign",
      row: typeof c.row === "string" ? c.row : firstRow,
      day: String(c.day ?? ""),
      to: (c.to as string | null) ?? null,
    };
  }
  if (c.type === "swap") {
    if (Array.isArray(c.days)) {
      return {
        type: "swap",
        a: { row: firstRow, day: String(c.days[0]) },
        b: { row: firstRow, day: String(c.days[1]) },
      };
    }
    const a = c.a as CellRef;
    const b = c.b as CellRef;
    return { type: "swap", a: { row: a.row, day: a.day }, b: { row: b.row, day: b.day } };
  }
  if (c.type === "event") {
    return {
      type: "event",
      row: typeof c.row === "string" ? c.row : firstRow,
      day: String(c.day ?? ""),
      title: String(c.title ?? ""),
      time: (c.time as string) || undefined,
      eventKind: (c.eventKind as string) || undefined,
      for: (c.for as string) || undefined,
    };
  }
  throw new Error(`unknown change type ${String(c.type)}`);
}

export function changeCells(change: Change): CellRef[] {
  return change.type === "swap" ? [change.a, change.b] : [{ row: change.row, day: change.day }];
}

export function changeSummary(cfg: InstanceConfig, change: Change): string {
  switch (change.type) {
    case "assign":
      return `${rowLabel(cfg, change.row)} ${change.day} → ${change.to ? personName(cfg, change.to) : "NOBODY (uncovered)"}`;
    case "swap":
      return `swap ${rowLabel(cfg, change.a.row)} ${change.a.day} ↔ ${rowLabel(cfg, change.b.row)} ${change.b.day}`;
    case "event":
      return `add "${change.title}" on ${rowLabel(cfg, change.row)} ${change.day}${change.time ? ` at ${change.time}` : ""}`;
  }
}

function entrySummary(cfg: InstanceConfig, e: Entry): string {
  const who = e.author === "system" ? "the record" : personName(cfg, e.author);
  switch (e.kind) {
    case "proposal": {
      const c = e.payload.change as Change;
      return `${who} proposed: ${changeSummary(cfg, c)}${e.payload.tentative ? " (tentative)" : ""}`;
    }
    case "accept":
      return `${who} accepted ${String(e.payload.proposalId)}`;
    case "reject":
      return `${who} rejected ${String(e.payload.proposalId)} — "${e.reason ?? ""}"`;
    case "counter": {
      const c = e.payload.change as Change;
      return `${who} countered ${String(e.payload.counterOf)} with: ${changeSummary(cfg, c)}`;
    }
    case "question":
      return `${who} asked: "${String(e.payload.text ?? "")}"`;
    case "comment":
      return e.payload.optIn
        ? `${who} opted in to a reminder`
        : `${who} commented: "${String(e.payload.text ?? "")}"`;
    case "event":
      return `event: ${String(e.payload.title ?? "")} on ${e.cells[0] ? `${rowLabel(cfg, e.cells[0].row)} ${e.cells[0].day}` : ""}`;
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
 * accept (applied in the order the accepts appear, so accepted
 * changes compose in ruling order). A swap exchanges the two cells'
 * currently-standing values. Same config, same log, same grid —
 * from any seat, on any machine.
 */
export function deriveGrid(cfg: InstanceConfig, log: Entry[]): DerivedGrid {
  const dates = periodDates(cfg);
  const cells: Record<string, Cell> = {};
  for (const row of cfg.rows) {
    for (const date of dates) {
      const events: CellEvent[] = [];
      const wd = weekdayOf(date);
      for (const s of cfg.standingEvents) {
        if ((!s.row || s.row === row.id) && s.weekdays.includes(wd)) {
          events.push({ title: s.title, time: s.time, kind: s.kind, source: "standing" });
        }
      }
      const fz = frozenFor(cfg, row.id, date);
      cells[cellKey(row.id, date)] = {
        row: row.id,
        date,
        value: defaultFor(cfg, row.id, date),
        defaultValue: defaultFor(cfg, row.id, date),
        freeze: fz ? fz.label : null,
        events,
        pending: [],
        historyIds: [],
      };
    }
  }
  const cell = (ref: CellRef) => cells[cellKey(ref.row, ref.day)];
  const touch = (entry: Entry, extra: CellRef[] = []) => {
    for (const ref of [...entry.cells, ...extra]) {
      const c = cell(ref);
      if (c && !c.historyIds.includes(entry.id)) c.historyIds.push(entry.id);
    }
  };

  // First pass: proposal statuses (a ruling may sit anywhere after
  // its proposal in the log).
  const proposals: Record<string, ProposalView> = {};
  for (const e of log) {
    if (e.kind === "proposal" || e.kind === "counter") {
      const change = e.payload.change as Change;
      proposals[e.id] = {
        id: e.id,
        author: e.author,
        ts: e.ts,
        change,
        note: (e.payload.note as string) || undefined,
        tentative: Boolean(e.payload.tentative),
        status: "pending",
        counterOf: (e.payload.counterOf as string) || undefined,
        summary: changeSummary(cfg, change),
      };
    }
  }
  for (const e of log) {
    const pid = (e.payload.proposalId ?? e.payload.counterOf) as string | undefined;
    if (!pid || !proposals[pid]) continue;
    if (e.kind === "accept") {
      proposals[pid].status = "accepted";
      proposals[pid].resolvedBy = e.author;
    } else if (e.kind === "reject") {
      proposals[pid].status = "rejected";
      proposals[pid].resolvedBy = e.author;
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
      for (const ref of e.cells) {
        const c = cell(ref);
        if (!c) continue;
        c.events.push({
          title: String(e.payload.title ?? ""),
          time: (e.payload.time as string) || undefined,
          kind: String(e.payload.eventKind ?? "event"),
          for: (e.payload.for as string) || undefined,
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
        const target = cell({ row: c.row, day: c.day });
        if (target) target.value = c.to;
      } else if (c.type === "swap") {
        const A = cell(c.a);
        const B = cell(c.b);
        if (A && B) {
          const t = A.value;
          A.value = B.value;
          B.value = t;
        }
      } else if (c.type === "event") {
        const target = cell({ row: c.row, day: c.day });
        if (target) {
          target.events.push({
            title: c.title,
            time: c.time,
            kind: c.eventKind ?? "event",
            for: c.for,
            source: "proposal",
            entryId: p.id,
          });
        }
      }
      touch(e, changeCells(c));
    } else if (e.kind === "proposal" || e.kind === "counter") {
      const p = proposals[e.id];
      if (p) touch(e, changeCells(p.change));
    } else {
      const pid = e.payload.proposalId as string | undefined;
      touch(e, pid && proposals[pid] ? changeCells(proposals[pid].change) : []);
    }
  }

  // Pending proposals become the color on their cells.
  for (const p of Object.values(proposals)) {
    if (p.status !== "pending") continue;
    for (const ref of changeCells(p.change)) {
      const c = cell(ref);
      if (c) c.pending.push(p);
    }
  }

  return { instance: cfg.id, cells, proposals };
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

/** The grid-state digest: value + freeze + events per cell, nothing else. */
export function gridDigestSource(cfg: InstanceConfig, grid: DerivedGrid): string {
  const out: Record<string, unknown> = {};
  for (const row of cfg.rows) {
    const rowOut: Record<string, unknown> = {};
    for (const date of periodDates(cfg)) {
      const c = grid.cells[cellKey(row.id, date)];
      if (!c) continue;
      rowOut[date] = {
        v: c.value,
        f: c.freeze ?? "",
        e: c.events.map((ev) => [ev.title, ev.time ?? "", ev.kind, ev.for ?? ""]),
      };
    }
    out[row.id] = rowOut;
  }
  return canonical(out);
}

/** Cell lookup helper for projections and pulls. */
export function cellFor(grid: DerivedGrid, row: string, date: string): Cell {
  return grid.cells[cellKey(row, date)];
}

/* ------------------------------------------------------------------ */
/* Insides — one cell's box: the description AND the equation          */
/* ------------------------------------------------------------------ */

export interface CellBox {
  row: string;
  date: string;
  defaultLine: string;
  standingLine: string;
  freezeLine?: string;
  value: string | null;
  events: CellEvent[];
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

export function projectCell(
  cfg: InstanceConfig,
  grid: DerivedGrid,
  log: Entry[],
  row: string,
  date: string,
): CellBox {
  const c = cellFor(grid, row, date);
  const byId = new Map(log.map((e) => [e.id, e]));
  const history = (c?.historyIds ?? [])
    .map((id) => byId.get(id))
    .filter((e): e is Entry => Boolean(e))
    .map((e) => ({
      id: e.id,
      ts: e.ts,
      author: e.author === "system" ? "the record" : personName(cfg, e.author),
      kind: e.kind,
      summary: entrySummary(cfg, e),
      reason: e.reason,
    }));
  const fz = frozenFor(cfg, row, date);
  const standing = !c || c.value === c.defaultValue
    ? `Standing: ${personName(cfg, c?.value ?? null)} — the default holds; no accepted record moved this cell.`
    : `Standing: ${personName(cfg, c.value)} — moved off the default (${personName(cfg, c.defaultValue)}) by an accepted proposal in the history below.`;
  return {
    row,
    date,
    defaultLine: defaultExplain(cfg, row, date),
    standingLine: standing,
    freezeLine: fz
      ? `Under a freeze: "${fz.label}" (${fz.from} → ${fz.to}). A proposal against this cell must name the freeze in its note.`
      : undefined,
    value: c?.value ?? null,
    events: c?.events ?? [],
    pending: c?.pending ?? [],
    history,
  };
}

/* ------------------------------------------------------------------ */
/* Inbox — what is waiting on one person, at their scope               */
/* ------------------------------------------------------------------ */

export interface InboxItem {
  type: "pending-yours" | "question-for-you" | "resolved-yours";
  proposalId?: string;
  entryId: string;
  text: string;
  ts: string;
}

export function inboxFor(
  cfg: InstanceConfig,
  grid: DerivedGrid,
  log: Entry[],
  person: string,
  scopeRows: string[] | "all",
): InboxItem[] {
  const inScope = (p: ProposalView) =>
    scopeRows === "all" || changeCells(p.change).some((ref) => scopeRows.includes(ref.row));
  const items: InboxItem[] = [];
  for (const p of Object.values(grid.proposals)) {
    if (p.status === "pending" && p.author !== person && inScope(p)) {
      items.push({
        type: "pending-yours",
        proposalId: p.id,
        entryId: p.id,
        text: `${personName(cfg, p.author)} proposed: ${p.summary}${p.tentative ? " — tentative, not sure yet" : ""}${p.note ? ` — "${p.note}"` : ""}`,
        ts: p.ts,
      });
    }
    if (p.status !== "pending" && p.author === person) {
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
    if (e.kind === "question" && e.author !== person && e.author !== "system") {
      const pid = e.payload.proposalId as string | undefined;
      const about = pid && grid.proposals[pid] ? grid.proposals[pid] : undefined;
      if (!about || about.author === person) {
        items.push({
          type: "question-for-you",
          entryId: e.id,
          proposalId: pid,
          text: `${personName(cfg, e.author)} asked: "${String(e.payload.text ?? "")}"${about ? ` (on: ${about.summary})` : ""}`,
          ts: e.ts,
        });
      }
    }
  }
  return items.sort((a, b) => (a.ts < b.ts ? -1 : 1));
}

/** The record as a feed — entry summaries, in log order. Entries are
 *  filtered to a seat's scope when a scope is given: a scoped seat's
 *  feed never names activity outside its rows. */
export function feedFor(cfg: InstanceConfig, log: Entry[], scopeRows: string[] | "all") {
  return log
    .filter(
      (e) =>
        scopeRows === "all" ||
        e.cells.length === 0 ||
        e.cells.some((ref) => scopeRows.includes(ref.row)),
    )
    .map((e) => ({
      id: e.id,
      ts: e.ts,
      author: e.author,
      kind: e.kind,
      cells: e.cells,
      summary: entrySummary(cfg, e),
      reason: e.reason,
    }));
}

/* ------------------------------------------------------------------ */
/* Seat projections — the X factor, computed server-side               */
/* ------------------------------------------------------------------ */

function cellPayload(cfg: InstanceConfig, grid: DerivedGrid, log: Entry[], row: string, date: string) {
  const c = cellFor(grid, row, date);
  return {
    date,
    value: c.value,
    defaultValue: c.defaultValue,
    freeze: c.freeze,
    events: c.events,
    pending: c.pending,
    box: projectCell(cfg, grid, log, row, date),
  };
}

/**
 * Person seat: the grid at their scope (all rows, or the rows of
 * their rotation), insides included, plus their inbox and the feed.
 * For a single-row instance this also carries the legacy day-shaped
 * face (`days`, with `responsible`) that the first custody page and
 * its playtests were built against — same cells, day-shaped.
 */
export function projectPerson(
  cfg: InstanceConfig,
  grid: DerivedGrid,
  log: Entry[],
  spec: Extract<SeatSpec, { kind: "person" }>,
  digest: string,
) {
  const scope = spec.rowsScope === "all" ? "all" : rotationRows(cfg, spec.person);
  const rowsInScope = cfg.rows.filter((r) => scope === "all" || scope.includes(r.id));
  const rows = rowsInScope.map((r) => ({
    id: r.id,
    label: r.label,
    cells: periodDates(cfg).map((date) => cellPayload(cfg, grid, log, r.id, date)),
  }));
  const out: Record<string, unknown> = {
    view: "grid",
    instance: cfg.id,
    seat: spec.id,
    person: spec.person,
    month: cfg.month,
    periodLabel: cfg.periodLabel,
    now: cfg.now,
    rule: cfg.ruleText,
    digest,
    rows,
    proposals: Object.values(grid.proposals).filter(
      (p) => scope === "all" || changeCells(p.change).some((ref) => scope.includes(ref.row)),
    ),
    inbox: inboxFor(cfg, grid, log, spec.person, scope),
    feed: feedFor(cfg, log, scope),
  };
  if (cfg.rows.length === 1 && rows.length === 1) {
    out.days = rows[0].cells.map((c) => ({
      ...c,
      responsible: c.value,
      defaultResponsible: c.defaultValue,
    }));
  }
  return out;
}

/**
 * Scoped seat (the coach): ONLY cells carrying the chosen event
 * kinds, and only those events. No standing value exists anywhere
 * in this payload — it is removed at the projection, not hidden.
 */
export function projectScoped(
  cfg: InstanceConfig,
  grid: DerivedGrid,
  spec: Extract<SeatSpec, { kind: "scoped" }>,
  digest: string,
) {
  const days: unknown[] = [];
  for (const date of periodDates(cfg)) {
    for (const row of cfg.rows) {
      const c = cellFor(grid, row.id, date);
      const evs = c.events.filter((ev) => spec.eventKinds.includes(ev.kind));
      if (!evs.length) continue;
      days.push({
        date,
        weekday: WD[weekdayOf(date)],
        row: row.id,
        rowLabel: row.label,
        events: evs.map((ev) => ({
          title: ev.title,
          time: ev.time,
          kind: ev.kind,
          duty: ev.for ? `${personName(cfg, ev.for)} has ${ev.kind} duty` : undefined,
        })),
      });
    }
  }
  return { view: "events", instance: cfg.id, seat: spec.id, month: cfg.month, digest, days };
}

/**
 * Aggregate seat (the director): coverage and counts ONLY. Per row:
 * how many cells stand covered, which dates are gaps, how many
 * proposals are pending. No names, no notes, no history — the
 * office view: totals and gaps, because that is what the office
 * schedules from.
 */
export function projectAggregate(
  cfg: InstanceConfig,
  grid: DerivedGrid,
  spec: Extract<SeatSpec, { kind: "aggregate" }>,
  digest: string,
) {
  const rows = cfg.rows.map((r) => {
    let covered = 0;
    const gaps: string[] = [];
    for (const date of periodDates(cfg)) {
      const c = cellFor(grid, r.id, date);
      if (c.value === null) gaps.push(date);
      else covered++;
    }
    const pending = Object.values(grid.proposals).filter(
      (p) => p.status === "pending" && changeCells(p.change).some((ref) => ref.row === r.id),
    ).length;
    return {
      row: r.id,
      label: r.label,
      covered,
      total: periodDates(cfg).length,
      gaps,
      status: gaps.length ? "gap" : "covered",
      pending,
    };
  });
  return {
    view: "aggregate",
    instance: cfg.id,
    seat: spec.id,
    month: cfg.month,
    digest,
    rows,
    pendingCount: rows.reduce((n, r) => n + r.pending, 0),
  };
}

/**
 * Agent seat: no grid at all — a need-to-know list of dings for its
 * human: their standing cells from "now", their duties wherever
 * they fall, and the proposals and questions waiting on them.
 */
export function projectAgentView(
  cfg: InstanceConfig,
  grid: DerivedGrid,
  log: Entry[],
  human: string,
  digest: string,
) {
  const items: { date: string; kind: string; text: string }[] = [];
  for (const date of periodDates(cfg)) {
    for (const row of cfg.rows) {
      const c = cellFor(grid, row.id, date);
      if (date >= cfg.now && c.value === human) {
        items.push({
          date,
          kind: "responsibility",
          text: fillTemplate(cfg.agentText, cfg, human, row.id),
        });
      }
      for (const ev of c.events) {
        if (ev.for === human) {
          items.push({ date, kind: "duty", text: `${ev.title}${ev.time ? ` at ${ev.time}` : ""}` });
        } else if (date >= cfg.now && c.value === human) {
          items.push({ date, kind: "event", text: `${ev.title}${ev.time ? ` at ${ev.time}` : ""}` });
        }
      }
    }
  }
  for (const item of inboxFor(cfg, grid, log, human, "all")) {
    if (item.type === "pending-yours" || item.type === "question-for-you") {
      items.push({ date: "", kind: "ding", text: item.type === "pending-yours" ? `Waiting on you: ${item.text}` : item.text });
    }
  }
  return { view: "list", instance: cfg.id, seat: "agent", for: human, month: cfg.month, digest, items };
}

/* ------------------------------------------------------------------ */
/* The pager — a machine seat: one row, the next 72 hours              */
/* ------------------------------------------------------------------ */

export interface PagerWindow {
  from: string; // ISO instant
  to: string;
  entries: { date: string; person: string | null; name: string; handle?: string }[];
}

/** Shifts run handover-to-handover. The window is [now@handover,
 *  +72h); a day's shift belongs to it iff the shift interval and the
 *  window intersect. */
export function pagerWindow(cfg: InstanceConfig, grid: DerivedGrid, row: string): PagerWindow {
  const startMs = Date.parse(`${cfg.now}T${cfg.handoverTime}:00Z`);
  const endMs = startMs + 72 * 3_600_000;
  const entries: PagerWindow["entries"] = [];
  for (const date of periodDates(cfg)) {
    const shiftStart = Date.parse(`${date}T${cfg.handoverTime}:00Z`);
    const shiftEnd = shiftStart + 24 * 3_600_000;
    if (shiftStart < endMs && shiftEnd > startMs) {
      const c = cellFor(grid, row, date);
      entries.push({
        date,
        person: c.value,
        name: personName(cfg, c.value),
        handle: c.value ? cfg.people[c.value]?.handle : undefined,
      });
    }
  }
  return {
    from: new Date(startMs).toISOString(),
    to: new Date(endMs).toISOString(),
    entries,
  };
}

export function projectPager(
  cfg: InstanceConfig,
  grid: DerivedGrid,
  spec: Extract<SeatSpec, { kind: "pager" }>,
  row: string,
  digest: string,
) {
  const w = pagerWindow(cfg, grid, row);
  return {
    view: "pager",
    instance: cfg.id,
    seat: spec.id,
    row,
    rowLabel: rowLabel(cfg, row),
    window: { from: w.from, to: w.to },
    entries: w.entries,
    digest,
  };
}

/* ------------------------------------------------------------------ */
/* Templates + the pulls (artefacts a seat carries away)               */
/* ------------------------------------------------------------------ */

export function fillTemplate(
  tpl: string,
  cfg: InstanceConfig,
  person: string | null,
  row?: string,
): string {
  return tpl
    .replaceAll("{name}", personName(cfg, person))
    .replaceAll("{row}", row ? rowLabel(cfg, row) : "");
}

function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

export function optedInEvents(log: Entry[], person: string): Set<string> {
  const out = new Set<string>();
  for (const e of log) {
    if (e.kind === "comment" && e.author === person && e.payload.optIn) {
      out.add(String(e.payload.optIn));
    }
  }
  return out;
}

/** One person's pull: their standing days across all rows, the
 *  events on those days, and their duties/opt-ins wherever they
 *  fall. A copy to carry away — never a write back. */
export function buildIcsPerson(
  cfg: InstanceConfig,
  grid: DerivedGrid,
  log: Entry[],
  person: string,
): string {
  const name = personName(cfg, person);
  const opted = optedInEvents(log, person);
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SuperInstance//git.pp-grid//EN",
    `X-WR-CALNAME:${cfg.title} — ${name} (pulled from the Grid)`,
  ];
  const stamp = `${cfg.now.replace(/-/g, "")}T000000Z`;
  for (const date of periodDates(cfg)) {
    for (const row of cfg.rows.map((r) => r.id)) {
      const d = cellFor(grid, row, date);
      const ymd = date.replace(/-/g, "");
      const next = addDays(date, 1).replace(/-/g, "");
      if (d.value === person) {
        lines.push(
          "BEGIN:VEVENT",
          `UID:grid-${cfg.id}-${row}-${date}-${person}@git.pp-grid`,
          `DTSTAMP:${stamp}`,
          `DTSTART;VALUE=DATE:${ymd}`,
          `DTEND;VALUE=DATE:${next}`,
          `SUMMARY:${icsEscape(fillTemplate(cfg.icsSummary, cfg, person, row))}`,
          "END:VEVENT",
        );
      }
      for (const ev of d.events) {
        const mine = d.value === person || ev.for === person || opted.has(`${date}|${ev.title}`);
        if (!mine) continue;
        lines.push(
          "BEGIN:VEVENT",
          `UID:grid-ev-${cfg.id}-${row}-${date}-${ev.title.replace(/\W+/g, "")}@git.pp-grid`,
          `DTSTAMP:${stamp}`,
        );
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
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

/** The pager's pull: timed shift events for one row's 72h window. */
export function buildPagerIcs(cfg: InstanceConfig, grid: DerivedGrid, row: string): string {
  const w = pagerWindow(cfg, grid, row);
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SuperInstance//git.pp-grid//EN",
    `X-WR-CALNAME:${rowLabel(cfg, row)} pager — next 72h (pulled from the Grid)`,
  ];
  const stamp = `${cfg.now.replace(/-/g, "")}T000000Z`;
  const [hh, mm] = cfg.handoverTime.split(":");
  for (const en of w.entries) {
    const ymd = en.date.replace(/-/g, "");
    const next = addDays(en.date, 1).replace(/-/g, "");
    lines.push(
      "BEGIN:VEVENT",
      `UID:pager-${cfg.id}-${row}-${en.date}@git.pp-grid`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${ymd}T${hh.padStart(2, "0")}${mm.padStart(2, "0")}00`,
      `DTEND:${next}T${hh.padStart(2, "0")}${mm.padStart(2, "0")}00`,
      `SUMMARY:${icsEscape(fillTemplate(cfg.icsSummary, cfg, en.person, row))}`,
      ...(en.handle ? [`DESCRIPTION:${icsEscape(`Page: ${en.handle}`)}`] : []),
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
