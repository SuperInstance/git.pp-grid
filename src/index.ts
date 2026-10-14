/**
 * index.ts — the Grid worker: one Durable Object per INSTANCE.
 *
 * The class below is the engine's host. It holds one instance's
 * append-only record in its own SQLite, folds it through the
 * engine (engine.ts), serves each seat's projection, and guards
 * the port. Which instance a given object serves is passed in by
 * the front door on every call and pinned in storage on first
 * touch — the object itself carries no instance vocabulary.
 *
 * THE HONEST LABEL (also on the page): the record lives in THIS
 * instance's own store — "an instance with the same operational
 * fiction", not the git.pp substrate. What is under test is the
 * shape: a default that derives, a record that accumulates, a grid
 * that is a pure fold, seats that render the same record at
 * different resolutions, and ports that only pull or append.
 *
 * THE PORT (pull, don't push): no seat can write into another
 * seat's anything. The only way in is the action methods below,
 * each of which APPENDS a record authored by the acting person.
 * Guards the fiction demands, enforced here:
 *   - you cannot rule on your own proposal (it waits for another);
 *   - a rejection must carry a reason (it stays attached forever);
 *   - a person proposes only within their scope (their rotation's
 *     rows, or all rows for an all-scope seat);
 *   - a proposal against a FROZEN cell must name the freeze in its
 *     note — its reason thread — or the port refuses it.
 * And every seat can PULL: an .ics/JSON artefact generated from
 * the fold, to carry away. Pulling is free.
 *
 * STATE vs STORAGE: the log and a cached derived digest live in
 * ctx.storage. The agent `state` broadcast over the socket is only
 * a ping — {version, digest} — so a connected page re-fetches its
 * OWN seat projection over HTTP. The socket never sprays the full
 * record at every client: a scoped seat's need-to-know is a fact
 * about the payload, not a client-side promise.
 */

import { Agent, callable, getAgentByName, routeAgentRequest } from "agents";
import {
  buildIcsPerson,
  buildPagerIcs,
  changeCells,
  deriveGrid,
  frozenFor,
  gridDigestSource,
  normalizeChange,
  periodDates,
  projectAggregate,
  projectAgentView,
  projectPager,
  projectPerson,
  projectScoped,
  rotationRows,
  rowLabel,
  sha256,
  type Change,
  type Entry,
  type InstanceConfig,
  type SeatSpec,
} from "./engine";
import { INSTANCES, seedFor } from "./instances";
import { renderPage } from "./page";

export interface Env {
  GRID: DurableObjectNamespace<Grid>;
}

interface Ping {
  version: number;
  digest: string | null;
}

const LOG_KEY = "record-log";
const CACHE_KEY = "derived-cache";
const INSTANCE_KEY = "instance-id";

export class Grid extends Agent<Env, Ping> {
  initialState: Ping = { version: 0, digest: null };

  /** Pin the instance this object serves; seed its record if empty. */
  private async begin(instanceId: string): Promise<InstanceConfig> {
    const cfg = INSTANCES[instanceId];
    if (!cfg) throw new Error(`unknown instance ${instanceId}`);
    const pinned = await this.ctx.storage.get<string>(INSTANCE_KEY);
    if (pinned && pinned !== instanceId) {
      throw new Error(`this object serves ${pinned}, not ${instanceId}`);
    }
    if (!pinned) await this.ctx.storage.put(INSTANCE_KEY, instanceId);
    const log = await this.ctx.storage.get<Entry[]>(LOG_KEY);
    if (!log) {
      await this.ctx.storage.put(LOG_KEY, seedFor(instanceId));
      await this.refreshCache(cfg);
    }
    return cfg;
  }

  /** On wake, re-derive the ping state if we know our instance. */
  async onStart() {
    const pinned = await this.ctx.storage.get<string>(INSTANCE_KEY).catch(() => undefined);
    const id = pinned ?? (this.ctx.id.name && INSTANCES[this.ctx.id.name] ? this.ctx.id.name : undefined);
    if (id) {
      const cfg = await this.begin(id).catch(() => undefined);
      if (cfg) await this.refreshCache(cfg).catch(() => undefined);
    }
  }

  /* ---------------- the record ---------------- */

  private async getLog(cfg: InstanceConfig): Promise<Entry[]> {
    const log = await this.ctx.storage.get<Entry[]>(LOG_KEY);
    if (log) return log;
    const seed = seedFor(cfg.id);
    await this.ctx.storage.put(LOG_KEY, seed);
    return seed;
  }

  /** Append one entry and re-derive the cached digest. The ONLY write path. */
  private async append(
    cfg: InstanceConfig,
    author: string,
    kind: Entry["kind"],
    cells: Entry["cells"],
    payload: Record<string, unknown>,
    reason?: string,
  ): Promise<Entry> {
    const log = await this.getLog(cfg);
    const entry: Entry = {
      id: `e-${String(log.length + 1).padStart(4, "0")}`,
      ts: new Date().toISOString(),
      author,
      kind,
      cells,
      payload,
      reason,
    };
    log.push(entry);
    await this.ctx.storage.put(LOG_KEY, log);
    await this.refreshCache(cfg, log);
    return entry;
  }

  private async refreshCache(cfg: InstanceConfig, log?: Entry[]): Promise<string> {
    const entries = log ?? (await this.getLog(cfg));
    const grid = deriveGrid(cfg, entries);
    const digest = await sha256(gridDigestSource(cfg, grid));
    await this.ctx.storage.put(CACHE_KEY, { digest, at: new Date().toISOString() });
    this.setState({ version: entries.length, digest });
    return digest;
  }

  private async digest(cfg: InstanceConfig): Promise<string> {
    const cache = await this.ctx.storage.get<{ digest: string }>(CACHE_KEY);
    if (cache) return cache.digest;
    return this.refreshCache(cfg);
  }

  /* ---------------- reads (per-seat projections) ---------------- */

  @callable()
  async view(instanceId: string, seatId: string, opts: { for?: string; row?: string } = {}) {
    const cfg = await this.begin(instanceId);
    const spec = cfg.seats.find((s) => s.id === seatId);
    if (!spec) throw new Error(`instance ${cfg.id} has no seat ${seatId}`);
    const log = await this.getLog(cfg);
    const grid = deriveGrid(cfg, log);
    const digest = await this.digest(cfg);
    switch (spec.kind) {
      case "person":
        return projectPerson(cfg, grid, log, spec, digest);
      case "scoped":
        return projectScoped(cfg, grid, spec, digest);
      case "aggregate":
        return projectAggregate(cfg, grid, spec, digest);
      case "agent":
        return projectAgentView(cfg, grid, log, opts.for ?? spec.person, digest);
      case "pager":
        return projectPager(cfg, grid, spec, opts.row ?? spec.row, digest);
    }
  }

  @callable()
  async log(instanceId: string) {
    const cfg = await this.begin(instanceId);
    const entries = await this.getLog(cfg);
    return { length: entries.length, entries };
  }

  @callable()
  async rawLog(instanceId: string): Promise<Entry[]> {
    const cfg = await this.begin(instanceId);
    return this.getLog(cfg);
  }

  @callable()
  async status(instanceId: string) {
    const cfg = await this.begin(instanceId);
    const entries = await this.getLog(cfg);
    return {
      instance: cfg.id,
      title: cfg.title,
      month: cfg.month,
      logLength: entries.length,
      digest: await this.digest(cfg),
    };
  }

  /* ---------------- the port: actions that append ---------------- */

  /** The acting seat must be a person seat; returns its spec. */
  private personSpec(cfg: InstanceConfig, person: string): Extract<SeatSpec, { kind: "person" }> {
    const spec = cfg.seats.find(
      (s): s is Extract<SeatSpec, { kind: "person" }> => s.kind === "person" && s.person === person,
    );
    if (!spec) throw new Error(`${person} holds no seat on ${cfg.id} that can use the port`);
    return spec;
  }

  private scopeRows(cfg: InstanceConfig, spec: Extract<SeatSpec, { kind: "person" }>): string[] | "all" {
    return spec.rowsScope === "all" ? "all" : rotationRows(cfg, spec.person);
  }

  /** Validate a change's cells against the instance, the seat's
   *  scope, and the freeze rule. Throws the doctrine, in words. */
  private assertChangeAllowed(
    cfg: InstanceConfig,
    spec: Extract<SeatSpec, { kind: "person" }>,
    change: Change,
    note?: string,
  ) {
    const dates = periodDates(cfg);
    const scope = this.scopeRows(cfg, spec);
    for (const ref of changeCells(change)) {
      if (!cfg.rows.some((r) => r.id === ref.row)) throw new Error(`no such row: ${ref.row}`);
      if (!dates.includes(ref.day)) throw new Error(`${ref.day} is outside ${cfg.periodLabel}`);
      if (scope !== "all" && !scope.includes(ref.row)) {
        throw new Error(
          `${cfg.people[spec.person]?.name ?? spec.person} has no scope on ${rowLabel(cfg, ref.row)} — ` +
            `their seat covers ${scope.map((r) => rowLabel(cfg, r)).join(", ")}`,
        );
      }
      const fz = frozenFor(cfg, ref.row, ref.day);
      if (fz && !/freeze/i.test(note ?? "")) {
        throw new Error(
          `${ref.day} (${rowLabel(cfg, ref.row)}) is under "${fz.label}" — ` +
            `a proposal against a frozen day must name the freeze in its note.`,
        );
      }
    }
    if (change.type === "assign" && change.to !== null && !cfg.people[change.to]) {
      throw new Error(`no such person: ${change.to}`);
    }
  }

  @callable()
  async propose(instanceId: string, person: string, change: Change, note?: string, tentative?: boolean) {
    const cfg = await this.begin(instanceId);
    const spec = this.personSpec(cfg, person);
    this.assertChangeAllowed(cfg, spec, change, note);
    const entry = await this.append(cfg, person, "proposal", changeCells(change), {
      change,
      note: note ?? "",
      tentative: Boolean(tentative),
    });
    return { ok: true, entry, logLength: (await this.getLog(cfg)).length };
  }

  /** Shared guard for accept/reject/counter: ANOTHER seat rules, once. */
  private async proposalFor(cfg: InstanceConfig, person: string, proposalId: string) {
    const log = await this.getLog(cfg);
    const target = log.find((e) => e.id === proposalId);
    if (!target || (target.kind !== "proposal" && target.kind !== "counter")) {
      throw new Error(`no such proposal: ${proposalId}`);
    }
    if (target.author === person) {
      throw new Error("you cannot rule on your own proposal — it waits for another seat");
    }
    const grid = deriveGrid(cfg, log);
    const view = grid.proposals[proposalId];
    if (!view || view.status !== "pending") {
      throw new Error(`proposal ${proposalId} is already ${view?.status ?? "resolved"}`);
    }
    return { target, view };
  }

  @callable()
  async accept(instanceId: string, person: string, proposalId: string) {
    const cfg = await this.begin(instanceId);
    this.personSpec(cfg, person);
    const { view } = await this.proposalFor(cfg, person, proposalId);
    const entry = await this.append(cfg, person, "accept", changeCells(view.change), { proposalId });
    return { ok: true, entry, logLength: (await this.getLog(cfg)).length };
  }

  @callable()
  async reject(instanceId: string, person: string, proposalId: string, reason: string) {
    if (!reason || !reason.trim()) {
      throw new Error("a rejection must carry a reason — it stays attached forever");
    }
    const cfg = await this.begin(instanceId);
    this.personSpec(cfg, person);
    const { view } = await this.proposalFor(cfg, person, proposalId);
    const entry = await this.append(cfg, person, "reject", changeCells(view.change), { proposalId }, reason.trim());
    return { ok: true, entry, logLength: (await this.getLog(cfg)).length };
  }

  @callable()
  async counter(instanceId: string, person: string, proposalId: string, change: Change, note?: string) {
    const cfg = await this.begin(instanceId);
    const spec = this.personSpec(cfg, person);
    await this.proposalFor(cfg, person, proposalId);
    this.assertChangeAllowed(cfg, spec, change, note);
    const entry = await this.append(cfg, person, "counter", changeCells(change), {
      change,
      counterOf: proposalId,
      note: note ?? "",
    });
    return { ok: true, entry, logLength: (await this.getLog(cfg)).length };
  }

  @callable()
  async question(instanceId: string, person: string, text: string, proposalId?: string, day?: string, row?: string) {
    if (!text?.trim()) throw new Error("a question needs words");
    const cfg = await this.begin(instanceId);
    this.personSpec(cfg, person);
    const cells = day ? [{ row: row ?? cfg.rows[0].id, day }] : [];
    const entry = await this.append(cfg, person, "question", cells, {
      text: text.trim(),
      ...(proposalId ? { proposalId } : {}),
    });
    return { ok: true, entry, logLength: (await this.getLog(cfg)).length };
  }

  @callable()
  async comment(instanceId: string, person: string, text: string, day?: string, row?: string) {
    if (!text?.trim()) throw new Error("a comment needs words");
    const cfg = await this.begin(instanceId);
    this.personSpec(cfg, person);
    const entry = await this.append(cfg, person, "comment", day ? [{ row: row ?? cfg.rows[0].id, day }] : [], {
      text: text.trim(),
    });
    return { ok: true, entry, logLength: (await this.getLog(cfg)).length };
  }

  /** Opt into a reminder for an event on a cell — recorded, not toggled. */
  @callable()
  async optin(instanceId: string, person: string, day: string, title: string, row?: string) {
    const cfg = await this.begin(instanceId);
    this.personSpec(cfg, person);
    const entry = await this.append(cfg, person, "comment", [{ row: row ?? cfg.rows[0].id, day }], {
      text: `Reminder set: ${title} on ${day}`,
      optIn: `${day}|${title}`,
    });
    return { ok: true, entry, logLength: (await this.getLog(cfg)).length };
  }

  /* ---------------- the re-fold (the burn test, restated) ---------------- */

  /**
   * Discard the cached digest and re-derive it from the log alone.
   * If the cache and the re-fold disagree, something other than the
   * record was carrying state — the one thing this design says must
   * never happen.
   */
  @callable()
  async refold(instanceId: string) {
    const cfg = await this.begin(instanceId);
    const before = await this.digest(cfg);
    const log = await this.getLog(cfg);
    await this.ctx.storage.delete(CACHE_KEY);
    const after = await this.refreshCache(cfg, log);
    return { before, after, identical: before === after, logLength: log.length };
  }

  /** Demo hygiene: restore this instance's seeded record. */
  @callable()
  async reset(instanceId: string) {
    const cfg = await this.begin(instanceId);
    await this.ctx.storage.put(LOG_KEY, seedFor(cfg.id));
    const digest = await this.refreshCache(cfg);
    return { ok: true, digest, logLength: (await this.getLog(cfg)).length };
  }
}

/* ------------------------------------------------------------------ */
/* Worker front door                                                   */
/* ------------------------------------------------------------------ */

const DEFAULT_INSTANCE = "custody"; // API compat: the first deployment's clients name no instance

function instanceOf(url: URL, body?: Record<string, unknown>): string {
  const id =
    (body?.instance as string) ?? url.searchParams.get("instance") ?? DEFAULT_INSTANCE;
  if (!INSTANCES[id]) throw new Error(`unknown instance ${id}`);
  return id;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/") {
        const id = url.searchParams.get("instance") ?? "oncall"; // the page leads with engineering
        const cfg = INSTANCES[id];
        if (!cfg) return new Response(`unknown instance ${id}`, { status: 400 });
        return new Response(renderPage(cfg, Object.values(INSTANCES)), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }

      if (url.pathname === "/api/instances") {
        return Response.json(
          Object.values(INSTANCES).map((c) => ({ id: c.id, title: c.title, tagline: c.tagline })),
        );
      }

      // The pulls: artefacts generated from the fold. GET, seat-
      // scoped, a copy to carry away — never a write back.
      if (url.pathname === "/pull") {
        const instanceId = instanceOf(url);
        const cfg = INSTANCES[instanceId];
        const stub = await getAgentByName(env.GRID, instanceId);
        const seatParam = url.searchParams.get("seat") ?? "";
        const log = await stub.rawLog(instanceId);
        const grid = deriveGrid(cfg, log);
        const pagerSpec = cfg.seats.find((s) => s.kind === "pager");
        if (pagerSpec && seatParam === pagerSpec.id) {
          const row = url.searchParams.get("row") ?? (pagerSpec as { row: string }).row;
          if (!cfg.rows.some((r) => r.id === row)) {
            return new Response(`no such row: ${row}`, { status: 400 });
          }
          if (url.searchParams.get("format") === "json") {
            const digest = (await stub.status(instanceId)).digest;
            return Response.json(
              projectPager(cfg, grid, pagerSpec as Extract<SeatSpec, { kind: "pager" }>, row, digest),
            );
          }
          return new Response(buildPagerIcs(cfg, grid, row), {
            headers: {
              "content-type": "text/calendar; charset=utf-8",
              "content-disposition": `attachment; filename="pager-${row}.ics"`,
            },
          });
        }
        if (!cfg.people[seatParam]) {
          return new Response(`seat must name a person on ${instanceId}`, { status: 400 });
        }
        return new Response(buildIcsPerson(cfg, grid, log, seatParam), {
          headers: {
            "content-type": "text/calendar; charset=utf-8",
            "content-disposition": `attachment; filename="grid-${instanceId}-${seatParam}.ics"`,
          },
        });
      }

      if (url.pathname === "/api/grid/log") {
        const instanceId = instanceOf(url);
        const stub = await getAgentByName(env.GRID, instanceId);
        return Response.json(await stub.log(instanceId));
      }

      if (url.pathname === "/api/grid" && request.method === "GET") {
        const instanceId = instanceOf(url);
        const cfg = INSTANCES[instanceId];
        const stub = await getAgentByName(env.GRID, instanceId);
        const seat =
          url.searchParams.get("seat") ?? cfg.seats.find((s) => s.kind === "person")?.id ?? "";
        try {
          return Response.json(
            await stub.view(instanceId, seat, {
              for: url.searchParams.get("for") ?? undefined,
              row: url.searchParams.get("row") ?? undefined,
            }),
          );
        } catch (err) {
          return Response.json(
            { error: err instanceof Error ? err.message : String(err) },
            { status: 400 },
          );
        }
      }

      if (url.pathname === "/api/grid" && request.method === "POST") {
        let body: Record<string, unknown>;
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return Response.json({ error: "JSON body required" }, { status: 400 });
        }
        const instanceId = instanceOf(url, body);
        const cfg = INSTANCES[instanceId];
        const stub = await getAgentByName(env.GRID, instanceId);
        const person = String(body.seat ?? "");
        const action = String(body.action ?? "");
        try {
          switch (action) {
            case "status":
              return Response.json(await stub.status(instanceId));
            case "refold":
              return Response.json(await stub.refold(instanceId));
            case "reset":
              return Response.json(await stub.reset(instanceId));
            case "propose":
              return Response.json(
                await stub.propose(
                  instanceId,
                  person,
                  normalizeChange(cfg, body.change),
                  body.note as string,
                  body.tentative as boolean,
                ),
              );
            case "accept":
              return Response.json(await stub.accept(instanceId, person, String(body.proposalId)));
            case "reject":
              return Response.json(
                await stub.reject(instanceId, person, String(body.proposalId), String(body.reason ?? "")),
              );
            case "counter":
              return Response.json(
                await stub.counter(
                  instanceId,
                  person,
                  String(body.proposalId),
                  normalizeChange(cfg, body.change),
                  body.note as string,
                ),
              );
            case "question":
              return Response.json(
                await stub.question(
                  instanceId,
                  person,
                  String(body.text ?? ""),
                  body.proposalId as string,
                  body.day as string,
                  body.row as string,
                ),
              );
            case "comment":
              return Response.json(
                await stub.comment(instanceId, person, String(body.text ?? ""), body.day as string, body.row as string),
              );
            case "optin":
              return Response.json(
                await stub.optin(instanceId, person, String(body.day ?? ""), String(body.title ?? ""), body.row as string),
              );
            default:
              return Response.json({ error: `unknown action ${action}` }, { status: 400 });
          }
        } catch (err) {
          return Response.json(
            { error: err instanceof Error ? err.message : String(err) },
            { status: 400 },
          );
        }
      }

      // WebSocket access to the instance's agent (/agents/grid/<instance>)
      // — the page listens for {version, digest} pings only.
      const agentResponse = await routeAgentRequest(request, env);
      if (agentResponse) return agentResponse;

      return new Response("not found", { status: 404 });
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 400 },
      );
    }
  },
};
