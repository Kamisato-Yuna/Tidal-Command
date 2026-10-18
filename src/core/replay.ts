import { cloneFleet, opponent } from './game';
import { validateCompletedMatch } from './history';
import type { GameState, KnownCell, Ship, ShotEvent, Side } from './types';

/** Read-only projection, deliberately not a resumable GameState. */
export interface ReplayFrame {
  readonly index: number;
  readonly events: readonly ShotEvent[];
  readonly shots: { readonly player: readonly number[]; readonly ai: readonly number[] };
  /** Maps attacker's knowledge of the opposite board. */
  readonly known: { readonly player: readonly KnownCell[]; readonly ai: readonly KnownCell[] };
  /** Maps defender to ships sunk by this frame, never future sunk ships. */
  readonly sunk: { readonly player: readonly Ship[]; readonly ai: readonly Ship[] };
  readonly lastEvent: ShotEvent | null;
  readonly round: number;
  /** Zero-based committed volley index; shotInVolley is one-based after deployment. */
  readonly volleyIndex: number;
  readonly shotInVolley: number;
  readonly plannedShots: number;
  readonly winner: Side | null;
}

/** Freeze cloned output so neither a renderer nor playback controls can alter history. */
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

/**
 * Validate once, then construct deployment plus one frame per executed shot.
 * A winning salvo's unused tail is retained in the archive, never shown as shots.
 * Cache these frames per archived match; autoplay only changes the frame index.
 */
export function buildReplayFrames(completed: GameState): readonly ReplayFrame[] {
  const game = validateCompletedMatch(completed);
  const events: ShotEvent[] = [];
  const shots: { player: number[]; ai: number[] } = { player: [], ai: [] };
  const known: { player: KnownCell[]; ai: KnownCell[] } = { player: Array<KnownCell>(100).fill('unknown'), ai: Array<KnownCell>(100).fill('unknown') };
  const sunk: { player: Ship[]; ai: Ship[] } = { player: [], ai: [] };
  const frames: ReplayFrame[] = [];
  let lastEvent: ShotEvent | null = null;
  const snapshot = (volleyIndex: number, shotInVolley: number, plannedShots: number): ReplayFrame => freeze({
    index: events.length,
    events: [...events],
    shots: { player: [...shots.player], ai: [...shots.ai] },
    known: { player: [...known.player], ai: [...known.ai] },
    sunk: { player: cloneFleet(sunk.player), ai: cloneFleet(sunk.ai) },
    lastEvent,
    round: Math.floor(volleyIndex / 2) + 1,
    volleyIndex,
    shotInVolley,
    plannedShots,
    winner: lastEvent?.winner ?? null,
  });
  frames.push(snapshot(0, 0, game.volleys[0]!.coords.length));
  let offset = 0;
  for (let volleyIndex = 0; volleyIndex < game.volleys.length; volleyIndex++) {
    const volley = game.volleys[volleyIndex]!;
    for (let shotInVolley = 1; shotInVolley <= volley.coords.length && offset < game.events.length; shotInVolley++) {
      const event = game.events[offset++]!;
      // The validator already guarantees attacker, order, and winning truncation.
      lastEvent = event;
      events.push(event);
      shots[event.attacker].push(event.coord);
      known[event.attacker][event.coord] = event.result === 'miss' ? 'miss' : 'hit';
      if (event.sunkShip) {
        for (const cell of event.sunkShip.cells) known[event.attacker][cell] = 'sunk';
        sunk[opponent(event.attacker)].push(event.sunkShip);
      }
      frames.push(snapshot(volleyIndex, shotInVolley, volley.coords.length));
      if (event.winner) break;
    }
  }
  return freeze(frames);
}

/** Even the final replay frame keeps the opponent's unsunk layout hidden. */
export function replayVisibleShips(game: GameState, frame: ReplayFrame, perspective: Side = 'player'): { player: Ship[]; ai: Ship[] } {
  if (perspective !== 'player' && perspective !== 'ai') throw new Error('复盘视角无效');
  return {
    player: cloneFleet(perspective === 'player' ? game.fleets.player : frame.sunk.player),
    ai: cloneFleet(perspective === 'ai' ? game.fleets.ai : frame.sunk.ai),
  };
}
