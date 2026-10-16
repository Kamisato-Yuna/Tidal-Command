# Local public-information AI

## Current rules and atomic salvo revision (2026-10-16)

New matches use `classic` placement: ships cannot touch, including diagonally, and each ship may have at most one unit-cell side contacting the board boundary. A corner contributes two contacts. Manual deployment, procedural generation, defensive selection, complete sampled hypotheses and fallback candidate scoring all use this same rule. `adjacent-allowed` remains explicit for migrated version-1 games and historical benchmark reproduction; an omitted AI observation rule means legacy adjacency only.

Each match fixes a symmetric quota of 1–5 shells per side per turn (default 1), capped only by remaining unknown cells. The entire ordered target plan is selected before feedback. The core validates every coordinate and the full quota before committing, resolves ordered outcomes, stops at the winning shot, and changes side exactly once. It saves the complete plan separately from actual fired-shot events, so an unused winning-salvo tail is retained without inventing attacks. Version-2 save validation replays complete plans. Version-1 saves are strictly replay-validated and explicitly migrated with their one-shell adjacent rules unchanged.

Normal runs one complete-fleet sampling/scoring pass per salvo and selects unique unknown cells without replacement from that fixed map. Easy also plans from the same original public board. Neither policy inserts synthetic misses or replans after intermediate hits. The worker receives `shotCount` and only a public observation; it returns `coords` plus legacy `coord`. Client response validation, stale/cancel isolation, and the one-second watchdog apply to the whole batch. If a fixed quota exceeds publicly plausible cells, remaining required shells use other unknown coordinates; the board is never fabricated as observed misses.

`tests/salvo-core.test.ts` covers classic placement/sampling, symmetric quotas, invalid-plan atomicity, winning-salvo tails, migration/replay, public-only batching and worker failure/cancellation. Original core AI and rule fixtures explicitly test the old adjacent-allowed rule.

The earlier reconstructed and historical benchmark numbers later in this document were measured for **single-shell, adjacent-allowed** games before this revision. They are historical for the new default rules and do not establish classic or multi-shell strength. The benchmark now records both placement rule and `shellsPerTurn: 1`, rejects mixed-rule merges, defaults to classic and accepts `--placement=adjacent-allowed` for explicit old-rule reproduction. A separate classic smoke report, if present, is not a full acceptance run.

## Fresh classic single-shell acceptance (2026-10-16)

`../../docs/ai-acceptance-classic-1000.json` is the separate current-classic acceptance report; `../../docs/ai-acceptance-classic-results.txt` is its concise summary. Seeds 400000–400999 were distinct from prior legacy acceptance and classic smoke seeds. Runtime and benchmark SHA-256 hashes were identical before and after all four concurrent shards; no strategy tuning occurred during the run.

- 1,000 seeds, 640-sample production budget, **single-shell turns only**
- Mean shots: Normal 33.115; HuntTarget 53.312; Easy 63.109; Random 95.558
- Normal vs Easy: 99.15% over 2,000 swapped-first games; 95% paired-seed bootstrap interval 98.60–99.60%
- Normal vs fixed v1 HuntTarget: 98.65%; interval 97.90–99.30%
- 114,252 Normal decisions; zero degraded decisions and internal timeouts
- Concurrent cloud CLI latency: mean 5.70 ms; P90 12.23 ms; P99 19.86 ms; maximum 150.94 ms

Easy and fixed v1 HuntTarget do not exploit all classic no-touch/boundary deductions. These are measurements against those exact policies, not rule-aware optimal opponents or human players. Multi-shell strength, browser latency and target-device FPS remain separate. Earlier measurements below remain adjacent-allowed historical results.

## Reconstruction status

The original execution environment was replaced on 2026-10-16. These modules were reconstructed from retained implementation context. Interfaces, strategy constants and algorithms were preserved, but bit-identical source recovery is not claimed. Re-run tests and benchmarks against these files. Past measurements below are explicitly historical, not validation of this reconstruction.

## Information boundary

The attack-policy and Worker receive only `AIObservation` plus public settings, RNG and identifiers: 100 public cell states, remaining length multiset, public sunk cells, turn index and placement rule. No hidden fleet, placement seed, game store or renderer is provided. Placement, actual attack decisions, defensive-evaluation seeds and visual randomness are independent.

Generic hits reveal no ship identity, size or direction. Sunk feedback reveals exact cells; neighboring unresolved hits remain. The game core commits a complete preplanned salvo, resulting damage, actual events and next turn atomically, independently of animation. Versioned save validation replays every committed action and rejects inconsistent events, layouts or turn state.

## Easy

Random unknown-cell search with a 65% chase probability when unresolved hits exist. Chasing uses unknown neighbors and basic line extensions, without permanently merging touching hit groups.

## Normal

Straight candidate placements avoid known misses and sunk cells. Randomized exact-cover backtracking constructs complete surviving fleets, requires non-overlap (and no-touch under classic rules), and explains all unresolved hits. It chooses constrained individual hits rather than merging adjacent groups. Entirely hit surviving placements are excluded because they would already have been publicly sunk.

Samples are approximate and search-biased, not an exact posterior. Scores combine full-fleet occupancy with completion bonuses for hit ships. Unknown cells within 1.5% of best score are mixed using the independent decision RNG.

Production budgets: 640 complete samples, 48,000 nodes, approximately 420 ms internal protection. Worker client terminates at the 1-second protection timer and supplies a clearly marked public-placement fallback. Actual choice, RNG, elapsed time, sample/node counts and timeout/degradation are saved. Timers can be delayed by browser/OS scheduling; a strict device-independent wall-time guarantee is not claimed.

## Defensive deployment

Normal generates 24 procedural candidate fleets across random, adjacent, edge-biased and dispersed styles. Each is evaluated against eight independent baselines: four checkerboard HuntTarget, three Easy, one Random. The selector randomly chooses among up to five candidates within 3% of best weighted score. Evaluation receives no player layout and occurs before combat. It is a bounded heuristic; measured defense comparisons matter more than naming a tactic.

## Tests and reproduction

`tests/core-*.test.ts` covers fleet legality, distinct length-three ships, generic-hit privacy, adjacent/parallel/staggered hit constraints, exact fleet coverage, fixed deployment, fairness before and after feedback, independent visual RNG, wins, save replay, complete games, stale/cancelled workers and timeout fallback.

Run:

- `npm test`
- `npm run typecheck`
- `npm run benchmark -- --placement=classic --seeds=1000 --seed-start=500000 --out=benchmark.json`

The benchmark separately reports common-target attacks, defensive layouts and complete-strategy races. Because attacks are independent and hits do not grant extra turns, shots-to-sink determine exact alternating-turn outcomes. Equal shots favor the first player; every seed is tested in both first-player roles. Confidence intervals bootstrap seed pairs, not correlated games independently.

For parallel runs, use disjoint shards with `--raw-diagnostics=1`; use shard lengths divisible by six except the last to preserve style order. Merge with `--merge=/path/a.json,/path/b.json --out=benchmark.json`. Duplicate seeds and incompatible budgets/versions are rejected. Concurrent timing is labeled separately from isolated browser performance.

## Current reconstruction verification (2026-10-16)

- Fresh correctness suite: 24/24 passed; TypeScript passed
- Fresh benchmark/merge smoke passed
- `reconstructed-benchmark-64.json`: 64 new seeds, 200000–200063, production 640 samples
- Mean shots: Normal 44.484; HuntTarget 49.891; Easy 62.422; Random 94.922
- Swapped-first wins: 79.69% vs Easy (95% interval 68.75–89.06%); 75.00% vs HuntTarget (64.84–85.16%)
- 10,293 Normal decisions; no degraded decisions or internal budget timeouts
- Current cloud CLI latency: mean 4.75 ms; P90 10.84 ms; P99 14.53 ms; maximum 57.63 ms

This fresh run is a 64-seed smoke test, below the 1,000-seed acceptance requirement. It does not establish browser latency, target-hardware frame rates or human win rates.

## Current full acceptance (2026-10-16)

The fresh full acceptance run is `../../docs/ai-acceptance-reconstructed-1000.json`, with a short summary in `../../docs/ai-acceptance-current-results.txt`.

- 1,000 fixed acceptance seeds, 300000–300999, at production budget; 2,000 swapped-first games per pairing
- Two seeds (300000 and 300006) previously appeared only in a 20-sample merge-plumbing smoke; no strategy tuning followed. The other 998 seeds were previously unused.
- Runtime and benchmark SHA-256 source hashes were checked unchanged and are embedded in the report
- Same-target mean shots: Normal 45.821; HuntTarget 51.423; Easy 61.382; Random 95.373
- Normal vs Easy: 83.50%, 95% paired-seed bootstrap interval 81.15–85.70%
- Normal vs HuntTarget: 72.90%, interval 70.20–75.45%
- 159,255 Normal decisions; zero degraded decisions and internal budget timeouts
- Four-process cloud CLI latency: mean 5.54 ms; P90 12.17 ms; P99 18.01 ms; maximum 340.95 ms
- The 65% HuntTarget goal is met; the 90% Easy goal remains unmet
- Human playtests, browser latency and target-device FPS are separate and remain unestablished by this benchmark

## Historical result, original environment only

The prior, now-lost implementation completed 1,000 held-out seeds (100000–100999), with 640 samples and four concurrent benchmark processes. The original raw per-seed report is no longer present. Retained aggregate results:

- Same-target mean shots: Normal 45.768; HuntTarget 51.330; Easy 61.632; Random 95.314
- Normal vs Easy: 82.65%, 95% paired-seed bootstrap interval 80.40–84.85%; 2,000 swapped-first games
- Normal vs HuntTarget: 75.20%, interval 72.50–77.80%; 2,000 swapped-first games
- 158,890 Normal decisions; 2 degraded; 47 internal budget timeouts
- CLI mean 10.25 ms; P90 21.82 ms; P99 55.44 ms; maximum 1.321 seconds under concurrent load
- Normal defensive selection increased mean sink cost from 44.545 to 45.939 shots under Normal, and 51.228 to 52.719 under HuntTarget
- 24 correctness tests and TypeScript passed in that original environment

The historical 65% HuntTarget target was met; the 90% Easy target was not. These statistics do not establish current-code strength, human win rates, browser latency or target-hardware frame rates. Current measurements must remain separate.
