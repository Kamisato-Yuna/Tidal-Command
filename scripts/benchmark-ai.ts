/** Public-observation benchmark, reconstructed after environment replacement.
 * Current reports measure the current source; old numbers are historical only.
 * npm run benchmark -- --seeds=1000 --seed-start=100000 --out=benchmark.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { platform, release, arch, cpus } from 'node:os';
import { RNG, randomFleet, FLEET_SPECS, type AIObservation, type AIDecision, type KnownCell, type Ship, type FleetStyle } from '../src/core';
import { chooseEasy, chooseNormal } from '../src/ai';
import { chooseBaseline } from '../src/ai/baselines';
const args: Record<string, string> = Object.fromEntries(process.argv.slice(2).map((a: string) => a.replace(/^--/, '').split('=')));
const seedCount = Math.max(1, Number(args.seeds || 64)), seedStart = Math.max(1, Number(args['seed-start'] || 100000)), maxSamples = Math.max(1, Number(args.samples || 640)), out = args.out;
if (![seedCount, seedStart, maxSamples].every(Number.isSafeInteger)) throw new Error('Seed counts and samples must be positive integers');
type Policy = 'Random' | 'HuntTarget' | 'Easy' | 'Normal';
interface AttackRun { shots: number; degraded: number; timedOut: number; decisions: number; samples: number; nodes: number; latencies: number[] }
const latencies: number[] = []; let degraded = 0, timedOut = 0, normalDecisions = 0, sampleTotal = 0, nodeTotal = 0;
function runAttack(policy: Policy, fleet: Ship[], seed: number): AttackRun {
  const board: KnownCell[] = Array(100).fill('unknown'), remaining = FLEET_SPECS.map(s => s.length), sunk: number[][] = [];
  let rngState = seed, shots = 0, fallbacks = 0, timeouts = 0, samples = 0, nodes = 0; const times: number[] = [];
  while (remaining.length) {
    const observation: AIObservation = { width: 10, height: 10, knownEnemyBoard: [...board], remainingEnemyLengths: [...remaining], publicSunkShips: sunk.map(c => [...c]), turnIndex: shots + 1 };
    let decision: AIDecision;
    if (policy === 'Normal') decision = chooseNormal(observation, rngState, { maxSamples });
    else if (policy === 'Easy') decision = chooseEasy(observation, rngState);
    else decision = chooseBaseline(policy === 'Random' ? 'random' : 'huntTarget', observation, rngState);
    rngState = decision.rngState; const cell = decision.coord;
    if (board[cell] !== 'unknown') throw new Error(`${policy} repeated or invalid shot ${cell}`); shots++;
    const ship = fleet.find(s => s.cells.includes(cell)); board[cell] = ship ? 'hit' : 'miss';
    if (ship && ship.cells.every(c => board[c] === 'hit')) { for (const c of ship.cells) board[c] = 'sunk'; sunk.push([...ship.cells]); remaining.splice(remaining.indexOf(ship.length), 1); }
    times.push(decision.diagnostics.elapsedMs); fallbacks += Number(decision.diagnostics.degraded); timeouts += Number(decision.diagnostics.timedOut); samples += decision.diagnostics.samples; nodes += decision.diagnostics.nodes;
    if (shots > 100) throw new Error(`${policy} exceeded 100 shots`);
  }
  if (policy === 'Normal') { latencies.push(...times); degraded += fallbacks; timedOut += timeouts; normalDecisions += shots; sampleTotal += samples; nodeTotal += nodes; }
  return { shots, degraded: fallbacks, timedOut: timeouts, decisions: shots, samples, nodes, latencies: times };
}
function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b), percentile = (p: number) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] || 0;
  return { n: sorted.length, mean: values.reduce((a, b) => a + b, 0) / values.length, median: percentile(0.5), p90: percentile(0.9), p99: percentile(0.99), min: sorted[0], max: sorted.at(-1) };
}
function winReport(pairs: Array<[number, number]>) {
  const first = pairs.map(([normal, other]) => Number(normal <= other)), second = pairs.map(([normal, other]) => Number(normal < other)), paired = pairs.map((_, i) => (first[i]! + second[i]!) / 2);
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length, rng = new RNG(20261016), bootstrap: number[] = [];
  for (let i = 0; i < 2000; i++) { let total = 0; for (let j = 0; j < paired.length; j++) total += paired[rng.int(paired.length)]!; bootstrap.push(total / paired.length); }
  bootstrap.sort((a, b) => a - b);
  return { seedPairs: pairs.length, games: pairs.length * 2, normalFirstWinRate: mean(first), normalSecondWinRate: mean(second), combinedWinRate: mean(paired), pairedSeedBootstrap95CI: [bootstrap[49], bootstrap[1949]] };
}
const policies: Policy[] = ['Random', 'HuntTarget', 'Easy', 'Normal'];
const common: Record<Policy, number[]> = { Random: [], HuntTarget: [], Easy: [], Normal: [] };
const styles: FleetStyle[] = ['random', 'edge', 'adjacent', 'dispersed', 'easy', 'normal'];
const perStyle: Record<string, Record<Policy, number[]>> = {};
const defense: Record<string, number[]> = { randomUnderNormal: [], mixedUnderNormal: [], randomUnderHuntTarget: [], mixedUnderHuntTarget: [] };
const easyPairs: Array<[number, number]> = [], baselinePairs: Array<[number, number]> = [], seedRecords: object[] = [];
const started = performance.now();
if (args.merge) {
  const paths = args.merge.split(','), shards = paths.map(path => JSON.parse(readFileSync(path, 'utf8')));
  const records = shards.flatMap(s => s.seedRecords).sort((a, b) => a.seed - b.seed);
  if (new Set(records.map(r => r.seed)).size !== records.length) throw new Error('Duplicate seeds in merge');
  if (shards.some(s => !Array.isArray(s.rawNormalLatencies))) throw new Error('Run shards with --raw-diagnostics=1');
  if (shards.some(s => s.benchmarkVersion !== shards[0].benchmarkVersion || s.configuration.maxSamples !== shards[0].configuration.maxSamples)) throw new Error('Incompatible benchmark shards');
  const group: Record<string, Record<Policy, number[]>> = {};
  for (const record of records) { group[record.style] ||= { Random: [], HuntTarget: [], Easy: [], Normal: [] }; for (const p of policies) group[record.style]![p].push(record.commonTargetShots[p]); }
  const allTimes = shards.flatMap(s => s.rawNormalLatencies) as number[], totalDecisions = shards.reduce((sum, s) => sum + s.normalDiagnostics.decisions, 0), totalDegraded = shards.reduce((sum, s) => sum + s.normalDiagnostics.degraded, 0), totalTimeouts = shards.reduce((sum, s) => sum + s.normalDiagnostics.timedOut, 0);
  const merged = { ...shards[0], createdAt: new Date().toISOString(), status: records.length >= 1000 ? '1000-plus-seed current-source benchmark; browser profiling and human playtests still required' : 'current-source smoke benchmark, below 1000-seed acceptance target',
    configuration: { ...shards[0].configuration, seedCount: records.length, seedStart: records[0].seed, seedEnd: records.at(-1).seed, parallelShards: paths.length, shardRanges: shards.map(s => [s.configuration.seedStart, s.configuration.seedEnd]) },
    attackEfficiencySameTargets: Object.fromEntries(policies.map(p => [p, stats(records.map(r => r.commonTargetShots[p]))])),
    attackEfficiencyByStyle: Object.fromEntries(Object.entries(group).map(([style, record]) => [style, Object.fromEntries(policies.map(p => [p, stats(record[p])]))])),
    defenseEfficiency: Object.fromEntries(Object.keys(defense).map(key => [key, stats(records.map(r => r.defenseShots[key]))])),
    fullStrategyPairedRaces: { explanation: shards[0].fullStrategyPairedRaces.explanation, normalVsEasy: winReport(records.map(r => r.normalVsEasyShots)), normalVsHuntTarget: winReport(records.map(r => r.normalVsHuntTargetShots)) },
    normalDiagnostics: { decisions: totalDecisions, elapsedMs: stats(allTimes), degraded: totalDegraded, degradedRate: totalDegraded / totalDecisions, timedOut: totalTimeouts, timedOutRate: totalTimeouts / totalDecisions,
      meanCompleteSamples: shards.reduce((sum, s) => sum + s.normalDiagnostics.meanCompleteSamples * s.normalDiagnostics.decisions, 0) / totalDecisions, meanSearchNodes: shards.reduce((sum, s) => sum + s.normalDiagnostics.meanSearchNodes * s.normalDiagnostics.decisions, 0) / totalDecisions },
    limitations: [...shards[0].limitations, `Timing measured with ${paths.length} concurrent benchmark shards; not isolated browser timing.`],
    elapsedSeconds: Math.max(...shards.map(s => s.elapsedSeconds)), aggregateProcessSeconds: shards.reduce((sum, s) => sum + s.elapsedSeconds, 0), seedRecords: records, rawNormalLatencies: undefined };
  const json = JSON.stringify(merged, null, 2); if (out) writeFileSync(out, json + '\n'); console.log(json); process.exit(0);
}
for (let i = 0; i < seedCount; i++) {
  const seed = seedStart + i, style = styles[i % styles.length]!, commonFleet = randomFleet(seed, style), baseAttackSeed = (0x9e3779b9 ^ (seed * 2654435761)) >>> 0 || 1, results = {} as Record<Policy, AttackRun>;
  for (const policy of policies) { results[policy] = runAttack(policy, commonFleet, baseAttackSeed); common[policy].push(results[policy].shots); perStyle[style] ||= { Random: [], HuntTarget: [], Easy: [], Normal: [] }; perStyle[style]![policy].push(results[policy].shots); }
  const randomLayout = style === 'random' ? commonFleet : randomFleet(seed, 'random'), normalLayout = style === 'normal' ? commonFleet : randomFleet(seed, 'normal'), easyLayout = style === 'easy' ? commonFleet : randomFleet(seed, 'easy');
  const normalAtRandom = style === 'random' ? results.Normal : runAttack('Normal', randomLayout, baseAttackSeed), normalAtNormal = style === 'normal' ? results.Normal : runAttack('Normal', normalLayout, baseAttackSeed), normalAtEasy = style === 'easy' ? results.Normal : runAttack('Normal', easyLayout, baseAttackSeed);
  const baselineAtRandom = style === 'random' ? results.HuntTarget : runAttack('HuntTarget', randomLayout, baseAttackSeed), baselineAtNormal = style === 'normal' ? results.HuntTarget : runAttack('HuntTarget', normalLayout, baseAttackSeed), easyAtNormal = style === 'normal' ? results.Easy : runAttack('Easy', normalLayout, baseAttackSeed);
  defense.randomUnderNormal.push(normalAtRandom.shots); defense.mixedUnderNormal.push(normalAtNormal.shots); defense.randomUnderHuntTarget.push(baselineAtRandom.shots); defense.mixedUnderHuntTarget.push(baselineAtNormal.shots);
  easyPairs.push([normalAtEasy.shots, easyAtNormal.shots]); baselinePairs.push([normalAtRandom.shots, baselineAtNormal.shots]);
  seedRecords.push({ seed, style, commonTargetShots: Object.fromEntries(policies.map(p => [p, results[p].shots])), normalVsEasyShots: easyPairs.at(-1), normalVsHuntTargetShots: baselinePairs.at(-1), defenseShots: { randomUnderNormal: normalAtRandom.shots, mixedUnderNormal: normalAtNormal.shots, randomUnderHuntTarget: baselineAtRandom.shots, mixedUnderHuntTarget: baselineAtNormal.shots } });
  if ((i + 1) % 10 === 0 || i === seedCount - 1) console.error(`Completed ${i + 1}/${seedCount} seeds; ${((performance.now() - started) / 1000).toFixed(1)} seconds`);
}
const report = { benchmarkVersion: 'tidal-ai-v1-reconstructed', createdAt: new Date().toISOString(), status: seedCount >= 1000 ? '1000-plus-seed current-source benchmark; browser profiling and human playtests still required' : 'current-source smoke benchmark, below 1000-seed acceptance target',
  environment: { node: process.version, platform: platform(), release: release(), arch: arch(), cpu: cpus()[0]?.model, logicalCpus: cpus().length },
  configuration: { seedCount, seedStart, seedEnd: seedStart + seedCount - 1, maxSamples, maxNodes: 48000, maxMs: 420, productionSamplingBudget: maxSamples === 640, placementGenerator: 'procedural nonuniform; normal selects among 24 diverse candidates evaluated against 8 independent random/hunt/easy baseline runs', baselineVersion: 'random-v1 / checkerboard-hunt-target-v1', hiddenInformation: 'Evaluator exposes independent cloned public observations only.' },
  attackEfficiencySameTargets: Object.fromEntries(policies.map(p => [p, stats(common[p])])), attackEfficiencyByStyle: Object.fromEntries(Object.entries(perStyle).map(([style, records]) => [style, Object.fromEntries(policies.map(p => [p, stats(records[p])]))])), defenseEfficiency: Object.fromEntries(Object.entries(defense).map(([label, shots]) => [label, stats(shots)])),
  fullStrategyPairedRaces: { explanation: 'Attacks are independent of opponent attacks. Fixed fleets and alternating turns make outcomes exactly determined by shots-to-sink; first player wins equal-shot races. Every seed is evaluated in both first-player roles. Normal uses selected mixed layouts; Easy uses spaced layouts; HuntTarget uses random layouts.', normalVsEasy: winReport(easyPairs), normalVsHuntTarget: winReport(baselinePairs) },
  normalDiagnostics: { decisions: normalDecisions, elapsedMs: stats(latencies), degraded, degradedRate: degraded / normalDecisions, timedOut, timedOutRate: timedOut / normalDecisions, meanCompleteSamples: sampleTotal / normalDecisions, meanSearchNodes: nodeTotal / normalDecisions },
  limitations: ['Approximate biased constrained sampling, not exact posterior or optimal play.', 'Defensive strength requires the separate reported comparison; adjacency is not automatically stronger.', 'Wall-time protection can change decisions across devices; actual choices and diagnostics are saved in games.', 'CLI performance is not browser Worker latency or target-device FPS.', 'Human win rates and perceived fairness require playtests.', 'Source was reconstructed after environment replacement. Historical benchmark numbers are not validation of this source.'],
  elapsedSeconds: (performance.now() - started) / 1000, seedRecords, ...(args['raw-diagnostics'] ? { rawNormalLatencies: latencies } : {}) };
const json = JSON.stringify(report, null, 2); if (out) writeFileSync(out, json + '\n'); console.log(json);
