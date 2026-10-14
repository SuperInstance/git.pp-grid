/**
 * index.ts — the Grid: a shared month as a Durable Object agent.
 *
 * WHAT LIVES HERE, AND THE HONEST LABEL
 * The record — an append-only log of proposals, rulings, questions,
 * comments and events — lives in THIS instance's own store (the
 * agent's SQLite). It is deliberately labelled on the page: "an
 * instance with the same operational fiction", NOT the git.pp git
 * substrate. The shape is what is being play-tested: a default that
 * derives, a record that accumulates, a grid that is a pure fold of
 * the two, and seats that render the same record at different
 * resolutions. Nothing in the log is ever edited or deleted; a
 * rejection keeps its reason attached forever because the fold reads
 * the whole log, every time.
 *
 * THE PORT (pull, don't push)
 * No seat can write into another seat's anything. The only way in is
 * the port: the action methods below, each of which APPENDS a record
 * authored by the acting seat. A proposal does nothing until the
 * OTHER seat rules on it — the server enforces what the fiction
 * promises (you cannot accept your own proposal). And every seat can
 * PULL: an .ics of its own days, generated from the fold, to carry
 * away to its own calendar. Pulling is free; pushing goes through
 * the port or it doesn't happen.
 *
 * STATE vs STORAGE: the append-only log and a cached derived grid
 * live in ctx.storage. The agent `state` broadcast over the socket
 * is only a ping — {version, digest} — so a connected page re-fetches
 * its OWN seat projection over HTTP. That matters: the coach's
 * rendering is a server-side projection, and if the socket sprayed
 * the full record at every client, the coach's need-to-know would be
 * a client-side promise instead of a fact about the payload.
 */

import { Agent, callable, getAgentByName, routeAgentRequest } from "agents";
import gridConfig from "../grid.json";
import {
  buildIcs,
  changeDays,
  deriveGrid,
  gridDigestSource,
  monthDates,
  projectAgent,
  projectCoach,
  projectParent,
  seedLog,
  sha256,
  type Change,
  type Entry,
  type SeatId,
  type ViewSeat,
} from "./model";
import { PAGE } from "./page";

export interface Env {
  GRID: DurableObjectNamespace<Grid>;
}

interface Ping {
  version: number;
  digest: string | null;
}

const LOG_KEY = "record-log";
const CACHE_KEY = "derived-cache";

const isSeat = (s: unknown): s is SeatId => s === "mara" || s === "jonas";
const otherSeat = (s: SeatId): SeatId => (s === "mara" ? "jonas" : "mara");

export class Grid extends Agent<Env, Ping> {
  initialState: Ping = { version: 0, digest: null };

  /** On first wake, if this instance has no record, seed the demo month. */
  async onStart() {
    const log = await this.ctx.storage.get<Entry[]>(LOG_KEY);
    if (!log) {
      await this.ctx.storage.put(LOG_KEY, seedLog());
      await this.refreshCache();
    }
  }

  /* ---------------- the record ---------------- */

  @callable()
  async getLog(): Promise<Entry[]> {
    const log = await this.ctx.storage.get<Entry[]>(LOG_KEY);
    if (log) return log;
    const seed = seedLog();
    await this.ctx.storage.put(LOG_KEY, seed);
    return seed;
  }

  /** Append one entry and re-derive the cached grid. The ONLY write path. */
  private async append(
    author: SeatId | "system",
    kind: Entry["kind"],
    days: string[],
    payload: Record<string, unknown>,
    reason?: string,
  ): Promise<Entry> {
    const log = await this.getLog();
    const entry: Entry = {
      id: `e-${String(log.length + 1).padStart(4, "0")}`,
      ts: new Date().toISOString(),
      author,
      kind,
      days,
      payload,
      reason,
    };
    log.push(entry);
    await this.ctx.storage.put(LOG_KEY, log);
    await this.refreshCache(log);
    return entry;
  }

  private async refreshCache(log?: Entry[]): Promise<string> {
    const entries = log ?? (await this.getLog());
    const grid = deriveGrid(entries);
    const digest = await sha256(gridDigestSource(grid));
    await this.ctx.storage.put(CACHE_KEY, { digest, at: new Date().toISOString() });
    this.setState({ version: entries.length, digest });
    return digest;
  }

  private async digest(): Promise<string> {
    const cache = await this.ctx.storage.get<{ digest: string }>(CACHE_KEY);
    if (cache) return cache.digest;
    return this.refreshCache();
  }

  /* ---------------- reads (per-seat projections) ---------------- */

  @callable()
  async view(seat: ViewSeat, human?: SeatId) {
    const log = await this.getLog();
    const grid = deriveGrid(log);
    const digest = await this.digest();
    if (seat === "coach") return projectCoach(grid, digest);
    if (seat === "agent") return projectAgent(grid, log, digest, human ?? "mara");
    if (isSeat(seat)) return projectParent(grid, log, seat, digest);
    throw new Error(`unknown seat ${String(seat)}`);
  }

  @callable()
  async log() {
    const entries = await this.getLog();
    return { length: entries.length, entries };
  }

  @callable()
  async status() {
    const entries = await this.getLog();
    return {
      month: gridConfig.month,
      logLength: entries.length,
      digest: await this.digest(),
      instance: gridConfig.instance,
    };
  }

  /* ---------------- the port: actions that append ---------------- */

  @callable()
  async propose(seat: SeatId, change: Change, note?: string, tentative?: boolean) {
    if (!isSeat(seat)) throw new Error("proposals come from a parent seat");
    for (const d of changeDays(change)) {
      if (!monthDates().includes(d)) throw new Error(`${d} is outside the demo month`);
    }
    const entry = await this.append(seat, "proposal", changeDays(change), {
      change,
      note: note ?? "",
      tentative: Boolean(tentative),
    });
    return { ok: true, entry, logLength: (await this.getLog()).length };
  }

  /** Shared guard for accept/reject/counter: the OTHER seat rules, once. */
  private async proposalFor(seat: SeatId, proposalId: string) {
    const log = await this.getLog();
    const target = log.find((e) => e.id === proposalId);
    if (!target || (target.kind !== "proposal" && target.kind !== "counter")) {
      throw new Error(`no such proposal: ${proposalId}`);
    }
    if (target.author === seat) {
      throw new Error("you cannot rule on your own proposal — it waits for the other seat");
    }
    const grid = deriveGrid(log);
    const view = grid.proposals[proposalId];
    if (!view || view.status !== "pending") {
      throw new Error(`proposal ${proposalId} is already ${view?.status ?? "resolved"}`);
    }
    return { target, view };
  }

  @callable()
  async accept(seat: SeatId, proposalId: string) {
    await this.proposalFor(seat, proposalId);
    const entry = await this.append(seat, "accept", [], { proposalId });
    return { ok: true, entry, logLength: (await this.getLog()).length };
  }

  @callable()
  async reject(seat: SeatId, proposalId: string, reason: string) {
    if (!reason || !reason.trim()) {
      throw new Error("a rejection must carry a reason — it stays attached forever");
    }
    await this.proposalFor(seat, proposalId);
    const entry = await this.append(seat, "reject", [], { proposalId }, reason.trim());
    return { ok: true, entry, logLength: (await this.getLog()).length };
  }

  @callable()
  async counter(seat: SeatId, proposalId: string, change: Change, note?: string) {
    await this.proposalFor(seat, proposalId);
    const entry = await this.append(seat, "counter", changeDays(change), {
      change,
      counterOf: proposalId,
      note: note ?? "",
    });
    return { ok: true, entry, logLength: (await this.getLog()).length };
  }

  @callable()
  async question(seat: SeatId, text: string, proposalId?: string, day?: string) {
    if (!text?.trim()) throw new Error("a question needs words");
    const days = day ? [day] : [];
    const entry = await this.append(seat, "question", days, {
      text: text.trim(),
      ...(proposalId ? { proposalId } : {}),
    });
    return { ok: true, entry, logLength: (await this.getLog()).length };
  }

  @callable()
  async comment(seat: SeatId, text: string, day?: string) {
    if (!text?.trim()) throw new Error("a comment needs words");
    const entry = await this.append(seat, "comment", day ? [day] : [], { text: text.trim() });
    return { ok: true, entry, logLength: (await this.getLog()).length };
  }

  /** Opt into a reminder for an event on any day — recorded, not toggled. */
  @callable()
  async optin(seat: SeatId, day: string, title: string) {
    const entry = await this.append(seat, "comment", [day], {
      text: `Reminder set: ${title} on ${day}`,
      optIn: `${day}|${title}`,
    });
    return { ok: true, entry, logLength: (await this.getLog()).length };
  }

  /* ---------------- the re-fold (the burn test, restated) ---------------- */

  /**
   * Discard the cached derived grid and re-derive it from the log
   * alone. If the cache and the re-fold disagree, something other
   * than the record was carrying state — the one thing this design
   * says must never happen.
   */
  @callable()
  async refold() {
    const before = await this.digest();
    const log = await this.getLog();
    await this.ctx.storage.delete(CACHE_KEY);
    const after = await this.refreshCache(log);
    return { before, after, identical: before === after, logLength: log.length };
  }

  /** Demo hygiene: restore the seeded record (Casey gets a clean slate). */
  @callable()
  async reset() {
    await this.ctx.storage.put(LOG_KEY, seedLog());
    const digest = await this.refreshCache();
    return { ok: true, digest, logLength: (await this.getLog()).length };
  }
}

/* ------------------------------------------------------------------ */
/* Worker front door                                                   */
/* ------------------------------------------------------------------ */

function parseChange(raw: unknown): Change {
  const c = raw as Change;
  if (!c || typeof c !== "object") throw new Error("change required");
  if (c.type === "assign" || c.type === "swap" || c.type === "event") return c;
  throw new Error(`unknown change type ${String((c as { type?: unknown }).type)}`);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const stub = await getAgentByName(env.GRID, gridConfig.instance);

    if (url.pathname === "/") {
      return new Response(PAGE, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    // The pull: one seat's days as an .ics. GET, seat-scoped, and
    // generated from the fold — a copy to carry away, never a write.
    if (url.pathname === "/pull") {
      const seat = url.searchParams.get("seat") ?? "";
      if (!isSeat(seat)) return new Response("seat must be mara or jonas", { status: 400 });
      const log = await stub.getLog();
      const ics = buildIcs(deriveGrid(log), log, seat);
      return new Response(ics, {
        headers: {
          "content-type": "text/calendar; charset=utf-8",
          "content-disposition": `attachment; filename="grid-${seat}.ics"`,
        },
      });
    }

    if (url.pathname === "/api/grid/log") {
      return Response.json(await stub.log());
    }

    if (url.pathname === "/api/grid" && request.method === "GET") {
      const seat = (url.searchParams.get("seat") ?? "mara") as ViewSeat;
      const human = (url.searchParams.get("for") ?? "mara") as SeatId;
      try {
        return Response.json(await stub.view(seat, human));
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
      }
    }

    if (url.pathname === "/api/grid" && request.method === "POST") {
      let body: Record<string, unknown>;
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        return Response.json({ error: "JSON body required" }, { status: 400 });
      }
      const seat = body.seat as SeatId;
      const action = String(body.action ?? "");
      try {
        switch (action) {
          case "status":
            return Response.json(await stub.status());
          case "refold":
            return Response.json(await stub.refold());
          case "reset":
            return Response.json(await stub.reset());
          case "propose":
            if (!isSeat(seat)) throw new Error("seat must be mara or jonas");
            return Response.json(
              await stub.propose(seat, parseChange(body.change), body.note as string, body.tentative as boolean),
            );
          case "accept":
            if (!isSeat(seat)) throw new Error("seat must be mara or jonas");
            return Response.json(await stub.accept(seat, String(body.proposalId)));
          case "reject":
            if (!isSeat(seat)) throw new Error("seat must be mara or jonas");
            return Response.json(await stub.reject(seat, String(body.proposalId), String(body.reason ?? "")));
          case "counter":
            if (!isSeat(seat)) throw new Error("seat must be mara or jonas");
            return Response.json(
              await stub.counter(seat, String(body.proposalId), parseChange(body.change), body.note as string),
            );
          case "question":
            if (!isSeat(seat)) throw new Error("seat must be mara or jonas");
            return Response.json(
              await stub.question(seat, String(body.text ?? ""), body.proposalId as string, body.day as string),
            );
          case "comment":
            if (!isSeat(seat)) throw new Error("seat must be mara or jonas");
            return Response.json(await stub.comment(seat, String(body.text ?? ""), body.day as string));
          case "optin":
            if (!isSeat(seat)) throw new Error("seat must be mara or jonas");
            return Response.json(await stub.optin(seat, String(body.day ?? ""), String(body.title ?? "")));
          default:
            return Response.json({ error: `unknown action ${action}` }, { status: 400 });
        }
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
      }
    }

    // WebSocket access to the agent (/agents/grid/demo) — the page
    // listens for {version, digest} pings and re-fetches its seat.
    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) return agentResponse;

    return new Response("not found", { status: 404 });
  },
};
