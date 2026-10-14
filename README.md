# git.pp-grid — the shared month, as a grid

**Live:** https://gitpp-grid.casey-digennaro.workers.dev

Built 2026-10-13 to play-test, touchably, the scheduling fiction
from Casey's design session that day: two people sharing
responsibility for a kid discover that a chat thread cannot hold a
calendar — "that Monday" slides, subtext evaporates, and nobody can
tell which version of a day is standing. A shared grid can, if it is
built like the rest of git.pp: a default that derives, a record that
accumulates, and renderings that know where their viewer sits.

Mara and Jonas (the demo parents) are fictional. The pattern is the
point.

## The fiction, implemented as specified

- **A default that stands unless changed.** Alternating weeks,
  handover Fridays 18:00, the week of Friday Oct 2 2026 is Mara's.
  The rule is *data* — stated in plain words at the top of the page —
  and the whole month derives from it. Silence inherits: no
  proposal, no change, no conversation needed. A day's color is who
  has the kid that night; soccer practice stands Tue/Thu 17:00.
- **An append-only record.** Every entry has an id, a timestamp, an
  author seat, a kind (`proposal`, `accept`, `reject`, `counter`,
  `question`, `comment`, `event`, `rule-note`), target days, a
  payload, and — where the fiction demands it — a reason. Nothing is
  edited or deleted; a rejection keeps its reason attached forever.
- **Cells with insides (the Plato rule).** A day's face shows a
  value. Clicking opens the box: the *description* (what the default
  says, what stands now and why it moved) and the *equation* (every
  record that touched the day, rejections struck through, reasons
  attached). A cell that can explain itself.
- **Proposals wear a color.** Proposing renders the day amber-
  hatched — visibly *pending*, not fact — and dings the other seat's
  inbox. The resolution moves are **accept** (lands as a record; the
  grid re-derives), **reject** (a reason is required, enforced
  server-side), **counter** (a linked new proposal; the original is
  marked countered), and **question / comment** — first-class,
  because some proposals are honestly "not sure yet — waiting to
  hear back" (the seed's pending proposal on Oct 26 is exactly that,
  and it is flagged *tentative*).
- **Seats are renderings — the X factor.** Four seats, one record:
  **Mara** and **Jonas** get the whole grid and their own inboxes.
  **Coach** gets only game/practice days and snack duty — computed
  by a *server-side projection*; the payload never contains
  responsibility data at all (the playtest greps it). **Agent** gets
  no grid at all: a need-to-know list of dings for its human. Same
  record, rendered for where you sit — the mechanic watches the
  gauges with a different eye than the captain, and the deckhand
  has only been told a few details.
- **Pull, don't push.** Each parent seat gets **Pull my days**: an
  .ics of their responsibility days, their events on those days, and
  their duties/opt-ins wherever they fall — a copy to carry to a
  phone calendar, never a write back. No seat can write into another
  seat's anything; the only way in is the port (the action endpoints,
  which append records and enforce the fiction: you cannot rule on
  your own proposal).
- **Re-fold.** A control discards the derived grid and re-derives it
  from the log alone, showing the state digest before/after.

## The honest label

The record here lives in this instance's own store (a Cloudflare
Durable Object, via the Agents SDK) — the page says so, in an
amber-bordered card: *an instance with the same operational
fiction*, **not** the git.pp substrate. What is under test is the
shape: default + record → grid → per-seat renderings. The sibling
artefact, [git.pp-desk](https://github.com/SuperInstance/git.pp-desk),
runs the same doctrine over real git records.

## The seed month (October 2026)

The record opens already lived-in: the rule as a rule-note; a soccer
game and Jonas's snack duty on Sat Oct 17; an **accepted** swap
(Jonas's work trip: Oct 12 ↔ Oct 19 — so the 12th is Mara's, the 19th
Jonas's, both off-default); a **rejected** Halloween proposal with
its reason ("Hosting my parents that weekend — I can't do Halloween
solo…"); and a **pending tentative** proposal on Oct 26 with Mara's
unanswered question attached. The first screen tells the story
before you touch anything.

## Playtest (2026-10-13, against the live deployment)

Run it yourself: `node test/playtest.mjs`. Check 1 folds the record
*in the test*, from the spec, over the raw log — the server never
grades itself.

```
PASS  1a. server grid == independent fold of default+record (all 31 days) — 31/31 days agree
PASS  1b. five probe days match the seed story, hand-computed — {2026-10-01: jonas, 2026-10-12: mara, 2026-10-19: jonas, 2026-10-26: jonas, 2026-10-31: mara}
PASS  2a. propose appends exactly one entry — log 10 → 11
PASS  2b. a pending proposal is a color, not a fact (day unmoved, proposal shown) — responsible=mara, pending=1
PASS  2c. accept appends exactly one entry and the day lands — log 11 → 12, 2026-10-06 = jonas
PASS  3. reject keeps the day at default, reason retrievable in the box — log 12 → 14, 2026-10-07 = mara, history has the reason
PASS  4. coach payload: game days present, responsibility data absent
PASS  6a. mara's pull: has her swapped-in Oct 12, not her swapped-out Oct 19
PASS  6b. jonas's pull: exactly inverse, plus his snack duty on Mara's day
PASS  5. re-fold digest identical (the record alone carries the grid) — over 14 records
PASS  7. page serves the claim, the rule, and the seats

All checks passed.
```

Port guards probed separately, live: ruling on your own proposal is
refused ("it waits for the other seat"); a rejection with an empty
reason is refused ("it stays attached forever"); a counter marks the
original `countered` and stands as the live proposal. After the
playtest, the demo record was reset to its seed — and the grid
digest returned to `0e62290c…`, the same value the very first status
call reported before any test traffic existed.

## Run your own

```
npm install
npm run dev      # local
npm run deploy   # wrangler deploy (needs a Cloudflare account with
                 # Workers + Durable Objects; GRID binding and the
                 # SQLite migration are declared in wrangler.toml)
```

The demo month, seats, and instance name live in `grid.json`; the
default rule, the fold, the projections and the .ics pull are in
`src/model.ts` — pure functions, commented as the design they
implement. The page is `src/page.ts`; the agent and the port are
`src/index.ts`.

## License

MIT © 2026 SuperInstance.
