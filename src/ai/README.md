# Local public-information AI

## Reconstruction status

The original execution environment was replaced on 2026-10-16. These modules were reconstructed from retained implementation context. Interfaces, strategy constants and algorithms were preserved, but bit-identical source recovery is not claimed. Re-run tests and benchmarks against these files. Past measurements below are explicitly historical, not validation of this reconstruction.

## Information boundary

Only `AIObservation` crosses the attack-policy and Worker boundary: 100 public cell states, remaining length multiset, public sunk cells, and turn index. No hidden fleet, placement seed, game store or renderer is provided. Placement, actual attack decisions, defensive-evaluation seeds and visual randomness are independent.

Generic hits reveal no ship identity, size or direction. Sunk feedback reveals exact cells; neighboring unresolved hits remain. The game core commits a shot, resulting damage, event and next turn atomically, independently of animation. Versioned save validation replays every committed action and rejects inconsistent events, layouts or turn state.

## Easy

Random unknown-cell search with a 65% chase probability when unresolved hits exist. Chasing uses unknown neighbors and basic line extensions, without permanently merging touching hit groups.

## Normal

Straight candidate placements avoid known misses and sunk cells. Randomized exact-cover backtracking constructs complete surviving fleets, requires non-overlap, and explains all unresolved hits. It chooses constrained individual hits rather than merging adjacent groups. Entirely hit surviving placements are excluded because they would already have been publicly sunk.

Samples are approximate and search-biased, not an exact posterior. Scores combine full-fleet occupancy with completion bonuses for hit ships. Unknown cells within 1.5% of best score are mixed using the independent decision RNG.

Production budgets: 640 complete samples, 48,000 nodes, approximately 420 ms internal protection. Worker client terminates at the 1-second protection timer and supplies a clearly marked public-placement fallback. Actual choice, RNG, elapsed time, sample/node counts and timeout/degradation are saved. Timers can be delayed by browser/OS scheduling; a strict device-independent wall-time guarantee is not claimed.

## Defensive deployment

Normal generates 24 procedural candidate fleets across random, adjacent, edge-biased and dispersed styles. Each is evaluated against eight independent baselines: four checkerboard HuntTarget, three Easy, one Random. The selector randomly chooses among up to five candidates within 3% of best weighted score. Evaluation receives no player layout and occurs before combat. It is a bounded heuristic; measured defense comparisons matter more than naming a tactic.

## Tests and reproduction

`tests/core-*.test.ts` covers fleet legality, distinct length-three ships, generic-hit privacy, adjacent/parallel/staggered hit constraints, exact fleet coverage, fixed deployment, fairness before and after feedback, independent visual RNG, wins, save replay, complete games, stale/cancelled workers and timeout fallback.

Run:

- `npm test`
- `npm run typecheck`
- `npm run benchmark -- --seeds=1000 --seed-start=100000 --out=benchmark.json`

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
