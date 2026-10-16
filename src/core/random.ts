/** Independent, replayable decision stream. Never derive it from a fleet seed. */
export class RNG {
  state: number;
  constructor(seed: number) { this.state = (seed >>> 0) || 0x6d2b79f5; }
  next(): number {
    let x = this.state; x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.state = x >>> 0; return this.state / 0x100000000;
  }
  int(max: number): number { return Math.floor(this.next() * max); }
  pick<T>(values: readonly T[]): T { if (!values.length) throw new Error('没有可选项'); return values[this.int(values.length)]!; }
  shuffle<T>(values: readonly T[]): T[] {
    const result = [...values];
    for (let i = result.length - 1; i > 0; i--) { const j = this.int(i + 1); [result[i], result[j]] = [result[j]!, result[i]!]; }
    return result;
  }
}
export function independentSeed(): number {
  const out = new Uint32Array(1);
  if (typeof globalThis.crypto?.getRandomValues === 'function') { globalThis.crypto.getRandomValues(out); return out[0] || 0x6d2b79f5; }
  return (Math.random() * 0x100000000) >>> 0 || 0x6d2b79f5;
}
