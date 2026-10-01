export function now(): number {
  return performance.now();
}

export function elapsedMs(start: number): number {
  return performance.now() - start;
}

export function rounded(value: number): number {
  return Math.round(value * 1000) / 1000;
}
