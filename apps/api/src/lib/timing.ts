export function now(): bigint {
  return process.hrtime.bigint();
}

export function elapsedMs(start: bigint): number {
  return Number(process.hrtime.bigint() - start) / 1_000_000;
}

export function rounded(value: number): number {
  return Math.round(value * 1000) / 1000;
}
