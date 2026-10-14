# The Grid — one engine, many grids

**Live: https://gitpp-grid.casey-digennaro.workers.dev** (leads with the on-call instance; the custody instance is at `/?instance=custody`)

A shared grid where reference is spatial and absolute. The first
build of this was a custody calendar, and the correction that
produced this repo was: *truly general purpose — custody schedules
aren't going to get it for engineers.* So the custody calendar is
now **one instance of a general engine**, and an engineering
instance leads. Instances are config; the engine doesn't know what
a kid or a service is.

## The engine

Named as such in `src/engine.ts`, because this is what it is:

- **Cells** — a keyed space (rows × days here). A cell holds one
  standing value (a person, or null — a gap) plus annotations.
- **A default rule as data** — a declared rotation per row,
  anchored to a date. The standing grid is *derived* from it,
  never stored as facts. Silence inherits: if nobody proposes
  anything, the default is simply what happens.
- **An append-only record** — authored, reasoned entries. Nothing
  is edited or deleted; a rejection keeps its reason attached
  forever because the fold reads the whole log, always.
- **Proposals** — pending deltas against cells, rendered as a
  *color*, not a fact. Five moves: propose, accept,
  reject (a reason is **required**, enforced server-side),
  counter, question/comment (first class — some proposals are
  honestly "not sure yet"). A proposal lands only when *another*
  seat's accept enters the record. You cannot rule on your own.
- **Freezes** — declared windows over cells. A frozen cell renders
  locked; a proposal against it must **name the freeze** in its
  note or the port refuses it.
- **Seats** — server-side projections of the same record:
  *person* (the grid at their scope), *scoped* (only cells
  carrying chosen event kinds — the rest is **absent** from the
  payload, not hidden), *aggregate* (counts and gaps only, no
  names at all), *agent* (a need-to-know list of dings), *pager*
  (a machine pull: one row, the next 72 hours).
- **Ports** — pull, don't push. The only way in is appending a
  record through a declared action; the way out is a pull
  artefact (`.ics` / JSON) generated from the fold.
- **Cell insides** — every cell opens: the *description* (what the
  default says, what stands now, any freeze) and the *equation*
  (every record that touched the cell, reasons attached).
- **Re-fold** — the derived grid is a cache over default + record.
  Discard it and re-fold: the sha256 digest must come back
  identical, or something other than the record was carrying
  the truth.

## The instances (config in `src/instances.ts`)

**On-call rotation** (lead) — services (api, billing, ingest,
search) × days; a weekly rotation per service; a Billing v2 launch
freeze (Oct 19–23). Seats: four engineers scoped to their own
rotation's services, a team lead (all services + inbox), a
**director** (per-service coverage, gaps and pending counts —
literally no names in the payload), and a **pager** (machine pull
of one service's next 72h, `.ics` or JSON). The seed month is
mid-story: an accepted swap, a swap rejected *because* "that's the
launch freeze", an accepted drop that leaves Oct 31 on search
uncovered, and a pending coverage ask with the lead's question
standing on it.

**The shared month** (custody) — two parents, one kid, alternating
weeks from Friday Oct 2, soccer standing Tue/Thu. Seats: both
parents, a **coach** who receives only soccer/snack days (no
responsibility field exists in that payload), and an **agent**
seat (dings only). This is the original demo, re-expressed as
engine config — its playtests are the regression suite.

## Layout

```
src/engine.ts     the engine: fold, projections, pulls, digest (no instance vocabulary)
src/instances.ts  the instances: ON-CALL + CUSTODY configs and their seed records
src/index.ts      the host: one Durable Object (Agents SDK) per instance, the port's guards, HTTP front door
src/page.ts       one generic page, rendered per instance from its config
test/playtest.mjs the acceptance test — folds the raw record independently, per instance
```

One Durable Object per instance (`/agents/grid/<instance>`), the
record in its own SQLite, derivation per request. The socket
broadcasts only `{version, digest}` pings, so a connected page
re-fetches *its own seat's* projection — a scoped seat's
need-to-know is a fact about the payload, never a client promise.

**Honest label:** each instance's record lives in its own store —
*an instance with the same operational fiction*, not the git.pp
substrate. What is under test is the shape. The git-native sibling
is [git.pp-ng](https://github.com/SuperInstance/git.pp-ng).

## Playtests

```
node test/playtest.mjs        # GRID_URL overrides the target
```

The test never lets the server grade itself: it re-folds each
instance's raw record from the rule written out in the test and
compares every cell, then probes the story (swaps, freeze guard,
director name-freedom by grep, pager window, scope seats, pulls,
re-fold digests per instance).

Latest run (2026-10-13, against the live deployment):
**custody 11/11 · on-call 13/13 · total 24/24.**

## Run it

```
bun install
bunx wrangler dev        # local
bunx wrangler deploy     # publish
```

MIT © SuperInstance. Part of the git.pp family.
