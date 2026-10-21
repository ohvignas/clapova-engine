/**
 * Scale guards, kept identical to the Clapova render scaler (wideo repo):
 * a Machine starts only when SRV2 is saturated, i.e. FLY_MIN_BACKLOG jobs are
 * queued and the oldest has waited FLY_MIN_WAIT_MS, with at most
 * FLY_MAX_MACHINES Machines alive at once.
 *
 * Integration point: the Clapova scaler passes a queue snapshot in. This
 * package never reads the Convex queue itself.
 */

export interface FlyGuards {
  minBacklog: number;
  minWaitMs: number;
  maxMachines: number;
}

export const DEFAULT_GUARDS: FlyGuards = {
  minBacklog: 3,
  minWaitMs: 3 * 60_000,
  maxMachines: 3,
};

function intEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export function readGuardsFromEnv(env: Record<string, string | undefined>): FlyGuards {
  return {
    minBacklog: intEnv(env.FLY_MIN_BACKLOG, DEFAULT_GUARDS.minBacklog),
    minWaitMs: intEnv(env.FLY_MIN_WAIT_MS, DEFAULT_GUARDS.minWaitMs),
    maxMachines: intEnv(env.FLY_MAX_MACHINES, DEFAULT_GUARDS.maxMachines),
  };
}

export interface QueueSnapshot {
  /** Jobs waiting in the render queue. */
  backlog: number;
  /** Age of the oldest waiting job, in ms. */
  oldestWaitMs: number;
  /** Machines currently running for this app (all renders). */
  runningMachines: number;
  /** Explicit override from the caller; when false, never scale out. */
  srv2Saturated?: boolean;
}

export interface MachineBudget {
  allowed: boolean;
  /** Machines this render may start now (0 when not allowed). */
  machines: number;
  reason: string;
}

export function decideMachineBudget(snap: QueueSnapshot, guards: FlyGuards): MachineBudget {
  const saturated =
    snap.srv2Saturated !== undefined
      ? snap.srv2Saturated
      : snap.backlog >= guards.minBacklog && snap.oldestWaitMs >= guards.minWaitMs;
  if (!saturated) {
    return { allowed: false, machines: 0, reason: "SRV2 not saturated, render locally" };
  }
  const room = Math.max(0, guards.maxMachines - snap.runningMachines);
  if (room === 0) {
    return { allowed: false, machines: 0, reason: "FLY_MAX_MACHINES reached" };
  }
  return { allowed: true, machines: room, reason: "SRV2 saturated" };
}
