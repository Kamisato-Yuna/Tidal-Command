import type { GameState, Side } from '../core';
/** Last completed player+AI round, based only on public shot history. An unfinished current round never displaces it. */
export function previousRoundShots(game: Pick<GameState, 'volleys' | 'events'>): { player: number[]; ai: number[]; round: number | null } {
  const complete = Math.floor(game.volleys.length / 2);
  if (!complete) return { player: [], ai: [], round: null };
  const start = (complete - 1) * 2, pair = game.volleys.slice(start, start + 2);
  const actual = new Set(game.events.map(e => `${e.attacker}:${e.coord}`));
  const coords = (side: Side) => pair.filter(v => v.attacker === side).flatMap(v => v.coords.filter(c => actual.has(`${side}:${c}`)));
  return { player: coords('player'), ai: coords('ai'), round: complete };
}
