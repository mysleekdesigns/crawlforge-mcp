# Stealth benchmark harness

`scripts/stealth-bench.mjs` turns the hand-run benchmark in section 2 of
[`docs/STEALTH_REVIEW_2026-09.md`](./STEALTH_REVIEW_2026-09.md) into a script.

That benchmark was driven by hand, one call at a time, on one machine, on
2026-09-21. It is the only evidence anyone has for what CrawlForge's two stealth
engines actually do against real bot walls, and it stops being evidence the
moment Playwright, Camoufox or the spoofing layer changes. The harness exists so
that the phases after it in the plan — closing the worker leaks, routing to
Camoufox, giving the agent a browser — are measured against a baseline rather
than argued about. It drives `StealthBrowserManager` and the plain fetch
directly, so it reports what the engines do, not what the tool layer says about
them.

## Running it

```bash
npm run bench:stealth            # bot walls + detector checks
npm run bench:stealth:ci         # detector self-probes only, exit-code gated
```

Or call the script directly for anything narrower:

```
node scripts/stealth-bench.mjs [--walls] [--detectors] [--ci] [--self-check]
                               [--engines=chromium,camoufox] [--targets=a,b]
                               [--out <path>] [--json <path>] [--timeout=<ms>]
```

With no flags it runs both halves: the bot-wall matrix and the detector checks.
`--walls` and `--detectors` run one half. `--engines` and `--targets` narrow a
run to the engines and targets you name, which is how you re-test a single
fix without paying for the whole matrix. `--out` writes the Markdown report and
`--json` the machine-readable form; `--timeout` overrides the per-target budget.

`--engines` takes the manager's names, `chromium` and `camoufox`, and there is
no `auto`: the harness always names one engine per column, because a column that
could be either engine measures nothing. The tools default to `auto` (see
[stealth-engines.md](./stealth-engines.md)); this is the layer underneath that
choice, which is the point of driving the manager directly.

The harness runs with the clearance jar off (see "Clearance reuse" in
[stealth-engines.md](./stealth-engines.md)), so every row starts cold. A
clearance replayed from an earlier run would measure the jar, not the engine.

A full run launches real browsers and navigates to third-party sites —
Cloudflare, Akamai and DataDome properties, plus five public detector pages. It
takes minutes, not seconds, it is visible to everyone it touches, and it is
subject to the same robots.txt policy the server applies elsewhere (the review
found trustpilot.com disallows CrawlForge, so that row is skipped rather than
fetched).

On macOS a restrictive sandbox will stop the browser launching at all. Run the
harness with the sandbox off; a failure to spawn Chromium or Camoufox under a
sandbox is an artefact of the sandbox and not a result.

## Reading the output

The report opens with a header recording host OS, exit IP and its type, engine
versions and the Playwright version. Read that first — see
[The result is IP-dependent](#the-result-is-ip-dependent) for why none of the
rows below it mean anything without it.

**The bot-wall matrix** reproduces section 2.2 of the review: one row per
target, with its vendor, and one column per fetch path — plain fetch, Chromium
stealth, Camoufox. Four values appear in a cell:

- `Pass` — the path returned `success: true` with the real page title and body.
- `Blocked` — **the tool's own verdict**, not an HTTP status. The page may have
  rendered; the verdict layer decided it was a challenge or an empty shell. The
  review documents a false positive of exactly this kind on quora.com at v6.7.0,
  where both engines rendered the real login page and the verdict layer flagged
  a Turnstile widget embedded in it (section 2.2, 2026-09-21). Read a `Blocked`
  cell as "the tool would have given up here", which is the number that matters
  to a caller, and check the page before treating it as proof of a wall.
- `skipped (robots)` — the target's robots.txt disallows CrawlForge. The harness
  did not fetch it.
- `n/a` — not attempted: the engine was not selected for this run, or its binary
  is not installed.

**The detector table** carries the assertions from section 2.3 as explicit
checks, each with an expected value, the value actually observed, and a result
of `pass`, `fail` or `skip`. `skip` means the check could not be evaluated —
usually a detector page whose DOM moved under its parser. It never means the
check passed. A run whose detector half is mostly `skip` has measured almost
nothing, however green it looks.

Illustrative shape only — every value below is a placeholder, not a measurement:

```
host: darwin/arm64 · exit IP <addr> (<ASN>, residential|datacenter)
engines: chromium <version> (playwright <version>), camoufox <version>

| Target           | Vendor     | Plain fetch | Chromium stealth | Camoufox |
| ---------------- | ---------- | ----------- | ---------------- | -------- |
| <host>           | <vendor>   | <cell>      | <cell>           | <cell>   |

| Check                | Engine   | Expected | Actual  | Result |
| -------------------- | -------- | -------- | ------- | ------ |
| navigator-webdriver  | chromium | false    | <value> | <p/f>  |
| worker-useragent     | chromium | <ua>     | <value> | <p/f>  |
```

## What CI gates

`.github/workflows/stealth-detectors.yml` runs `--ci` and then `--self-check`.

`--ci` runs the detector **self-probes only**. It visits no third-party bot wall
and no third-party detector page: it launches each engine, asks the page and its
workers about themselves, and compares the answers to what the persona claims.
Ten checks:

| id | what it asserts |
| --- | --- |
| `navigator-webdriver` | reported as `false`, not deleted |
| `useragentdata-brands` | no `HeadlessChrome` brand |
| `worker-useragent` | worker UA matches the main thread |
| `worker-platform` | worker platform matches the main thread |
| `worker-hardware-concurrency` | worker core count matches the main thread |
| `worker-languages` | worker languages match the main thread |
| `webrtc-host-candidates` | no ICE candidate carries a real host address |
| `ua-version-vs-binary` | the UA version matches the installed binary |
| `persona-os-vs-host` | the persona's OS is consistent with the host |
| `headless-markers` | no headless marker is observable |

Keeping third parties out of CI is deliberate: their pages change, their rate
limits apply, and a build that fails because someone else redesigned a page
teaches the team to ignore the build.

The exit code is gated against `scripts/lib/stealth-bench/ci-baseline.json`. Its
`knownFailing` list was seeded with the leaks the review documented at v6.7.0 and
assigned to Phase 1 — a failing id on that list does not fail the build. That is
what keeps CI green on a codebase with known leaks, while still turning red on
a **regression**: a Playwright or Camoufox bump that reopens the `Runtime.enable`
leak, or that breaks a worker property currently reported consistently, fails a
check that is not on the list.

Phase 1 has begun closing those leaks, and the list is shortened as each one
lands. So it is not a description of what still leaks — it is the set of checks
not yet gated, and it only ever gets smaller. For the current state of a check,
read a measured `--ci` run, not this file.

**Whoever fixes a Phase 1 item must delete its id from `knownFailing` in the
same commit.** That is the entire point of the allow-list. A fix that leaves its
id behind is a fix no one is protecting: the check goes green, nothing notices
when it goes back to red, and the next Playwright bump silently undoes the work.

`--self-check` is the negative control for the harness itself. It forces
`navigator.webdriver` to `true` and asserts the harness catches it. If the
detector plumbing breaks — a probe that never runs, a comparison that always
passes — every check reports `pass` and CI is green for the worst possible
reason. `--self-check` is what makes a green `--ci` run meaningful.

## The result is IP-dependent

Cloudflare scores the exit IP and the TLS/HTTP2 handshake before any JavaScript
runs, so the address a run goes out from decides part of the matrix before the
browser does anything (review section 1 and section 4, 2026-09-21). The review's
own numbers came from a Comcast residential IP in Miami, AS7922, with no proxy,
and it says plainly that the hosted instance runs from a datacenter and will
score worse on every Cloudflare, DataDome and Akamai target (section 2.1).

So a residential run and a datacenter run are two different measurements. They
are not comparable, neither is the "real" number, and a matrix without its
network context is not interpretable at all. Every baseline file must name which
one it is, in its filename and in its header.

Two baselines belong in `docs/`:

- `docs/stealth-bench-baseline-2026-09-21-residential.md` — the residential run,
  committed alongside the harness.
- The hosted-instance baseline is **still outstanding**. It has to be produced on
  the hosted instance itself, because the point of it is the exit IP; running it
  anywhere else does not substitute.

Phase 2's verification gate is stated in terms of both files — with a residential
proxy configured, the hosted run should match the residential baseline on Indeed
and Harrods, and without one it should report the datacenter result honestly.
That gate cannot be checked until the second baseline exists.

**Check that a proxied run was actually proxied.** The harness drives
`StealthBrowserManager` directly and hands it an engine and nothing else, so it
does not inherit a proxy that the tool layer applies on its behalf —
`CRAWLFORGE_STEALTH_PROXIES` is read where the tools call the browser, not here.
The header's exit IP and its type are the only proof that a run went out where
you think it did. Read that line before filing a report as the proxied
measurement; a matrix labelled "residential" from a datacenter address is worse
than no baseline, because the next person believes it.

## Known limits

**Detector-page parsers are brittle by construction.** `detector-pages.js` reads
results out of the DOM of bot.sannysoft.com, bot-detector.rebrowser.net, CreepJS,
browserscan.net and bot.incolumitas.com. Those are five sites nobody here
controls, and a redesign breaks the parser. The failure mode is `skip` rather
than a wrong number, which is the right trade, but a `skip — page layout not
recognised` is a job: the parser needs updating before that row means anything
again. Both the rebrowser and the CreepJS parser skipped on the very first run
for exactly that reason and had to be written against the live pages.

Not every `skip` is a broken parser, though. rebrowser's `dummyFn`,
`sourceUrlLeak`, `mainWorldExecution` and `exposeFunctionLeak` probes only fire
when the client calls into them, and the harness does not, so they report
`skip — not triggered`. That is the honest answer: the test did not run, and
counting an unfired probe as a pass would be the one thing worse than a skip.

**Detector results are version-coupled.** The review notes that Playwright
1.62.1 as launched by CrawlForge does not trip the `Runtime.enable` leak on
rebrowser, and that this must be re-checked on every Playwright bump (section
2.3, 2026-09-21). The same applies to sannysoft rows. A green detector half
describes the engine versions in the header and nothing else.

**One run per cell is noisy.** The review ran one attempt per cell and its own
leboncoin row inverts the Indeed and Harrods result — Chromium passed where
Camoufox did not — which it flags as vendor-dependent rather than a ranking. A
single `Blocked` is not proof that a path cannot pass a target, and a single
`Pass` is not proof that it reliably does. Re-run before drawing a conclusion
from one cell, and treat a changed cell as a signal to investigate, not as a
regression on its own.

**Behaviour is not measured.** The harness navigates and reads; it performs no
human-paced interaction, so behavioural scoring is outside what any of these
numbers cover — the same caveat the review records for its own run.

**The TCP/IP fingerprint is the host's, not the browser's.** It follows the
kernel, and only a proxy changes it. Nothing the harness reports about the
engines can fix a row that fails on it.
