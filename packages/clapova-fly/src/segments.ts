/**
 * Segment splitting for distributed Fly renders.
 *
 * `plan()` from the producer decides the real chunk boundaries (closed GOP).
 * This module is pure: it sizes the plan request from the machine budget,
 * mirrors the slice math so tests can assert boundaries, and assigns chunk
 * indices to machines.
 */

/** Same floor as the producer (`MIN_CHUNK_SIZE`): below it, per-chunk overhead dominates. */
export const MIN_SEGMENT_FRAMES = 10;

export interface Segment {
  index: number;
  /** First frame, inclusive. */
  startFrame: number;
  /** Last frame, exclusive. */
  endFrame: number;
  frames: number;
}

/** Split [0, totalFrames) into contiguous segments of at most `segmentFrames`. */
export function splitFrames(totalFrames: number, segmentFrames: number): Segment[] {
  if (!Number.isInteger(totalFrames) || totalFrames < 0) {
    throw new RangeError(`totalFrames must be a non-negative integer, got ${totalFrames}`);
  }
  if (!Number.isInteger(segmentFrames) || segmentFrames < 1) {
    throw new RangeError(`segmentFrames must be a positive integer, got ${segmentFrames}`);
  }
  const segments: Segment[] = [];
  for (let start = 0, index = 0; start < totalFrames; start += segmentFrames, index++) {
    const end = Math.min(start + segmentFrames, totalFrames);
    segments.push({ index, startFrame: start, endFrame: end, frames: end - start });
  }
  return segments;
}

export interface SegmentSizingInput {
  totalFrames: number;
  /** Machines the guards allow for this render. */
  machines: number;
  /** Chunks each machine renders in sequence. */
  chunksPerMachine?: number;
  minSegmentFrames?: number;
}

export interface SegmentSizing {
  segmentFrames: number;
  segmentCount: number;
  /** Cap to hand to `plan()` as `maxParallelChunks`. */
  maxParallelChunks: number;
}

/** Pick a segment size so the chunks spread evenly over the allowed machines. */
export function sizeSegments(input: SegmentSizingInput): SegmentSizing {
  const { totalFrames, machines } = input;
  const perMachine = Math.max(1, input.chunksPerMachine ?? 1);
  const floor = Math.max(1, input.minSegmentFrames ?? MIN_SEGMENT_FRAMES);
  if (machines < 1) throw new RangeError("machines must be >= 1");
  if (totalFrames < 1) throw new RangeError("totalFrames must be >= 1");
  const wanted = machines * perMachine;
  const segmentFrames = Math.max(floor, Math.ceil(totalFrames / wanted));
  const segmentCount = Math.ceil(totalFrames / segmentFrames);
  return { segmentFrames, segmentCount, maxParallelChunks: wanted };
}

/**
 * Assign chunk indices to at most `machineCount` machines, as contiguous
 * balanced groups. Indices in `skip` (already rendered) are left out.
 * Never returns an empty group.
 */
export function assignChunksToMachines(
  chunkCount: number,
  machineCount: number,
  skip: ReadonlySet<number> = new Set(),
): number[][] {
  if (machineCount < 1) throw new RangeError("machineCount must be >= 1");
  const pending: number[] = [];
  for (let i = 0; i < chunkCount; i++) if (!skip.has(i)) pending.push(i);
  if (pending.length === 0) return [];
  const groups = Math.min(machineCount, pending.length);
  const base = Math.floor(pending.length / groups);
  const extra = pending.length % groups;
  const out: number[][] = [];
  let cursor = 0;
  for (let g = 0; g < groups; g++) {
    const size = base + (g < extra ? 1 : 0);
    out.push(pending.slice(cursor, cursor + size));
    cursor += size;
  }
  return out;
}
