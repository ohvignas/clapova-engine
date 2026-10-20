/**
 * Minimal Fly Machines API client (https://docs.machines.dev). Fetch is
 * injected so tests never touch the network. Nothing here deploys anything:
 * it only creates short-lived, auto-destroyed Machines inside an existing app.
 */

export interface MachineSpec {
  image: string;
  env: Record<string, string>;
  cmd?: string[];
  region?: string;
  guest?: { cpu_kind: "shared" | "performance"; cpus: number; memory_mb: number };
}

export interface FlyMachinesOptions {
  /** Fly app name, e.g. "clapova-render". */
  app: string;
  token: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface MachineExit {
  exitCode: number | null;
  state: string;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class FlyMachinesClient {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: FlyMachinesOptions) {
    this.base = `${opts.baseUrl ?? "https://api.machines.dev"}/v1/apps/${encodeURIComponent(opts.app)}`;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  private async call(method: string, path: string, body?: unknown): Promise<any> {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.opts.token}`,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new MachinesApiError(method, path, res.status, text.slice(0, 200));
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  /** Create and start a one-shot Machine (never restarts, destroyed on exit). */
  async create(spec: MachineSpec): Promise<{ id: string }> {
    const created = await this.call("POST", "/machines", {
      region: spec.region,
      config: {
        image: spec.image,
        env: spec.env,
        init: spec.cmd ? { cmd: spec.cmd } : undefined,
        guest: spec.guest,
        auto_destroy: true,
        restart: { policy: "no" },
      },
    });
    return { id: created.id as string };
  }

  async get(id: string): Promise<{ state: string; events?: any[] }> {
    return this.call("GET", `/machines/${encodeURIComponent(id)}`);
  }

  /** Poll until the Machine stops or `timeoutMs` elapses (then throws). */
  async waitForExit(id: string, timeoutMs: number): Promise<MachineExit> {
    const interval = this.opts.pollIntervalMs ?? 2000;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      let machine: { state: string; events?: any[] };
      try {
        machine = await this.get(id);
      } catch (e) {
        // auto_destroy removes the Machine right after exit: a 404 means it is gone.
        if (e instanceof MachinesApiError && e.status === 404) {
          return { exitCode: null, state: "destroyed" };
        }
        throw e;
      }
      if (machine.state === "failed") {
        return { exitCode: extractExitCode(machine.events) ?? 1, state: machine.state };
      }
      if (machine.state === "stopped" || machine.state === "destroyed") {
        return { exitCode: extractExitCode(machine.events), state: machine.state };
      }
      if (Date.now() >= deadline) throw new Error(`[clapova-fly] machine ${id} timed out`);
      await this.sleep(interval);
    }
  }

  async destroy(id: string): Promise<void> {
    try {
      await this.call("DELETE", `/machines/${encodeURIComponent(id)}?force=true`);
    } catch (e) {
      if (!(e instanceof MachinesApiError && e.status === 404)) throw e;
    }
  }
}

export class MachinesApiError extends Error {
  constructor(
    method: string,
    path: string,
    readonly status: number,
    detail: string,
  ) {
    super(`[clapova-fly] Machines API ${method} ${path} -> ${status} ${detail}`);
    this.name = "MachinesApiError";
  }
}

export function extractExitCode(events: any[] | undefined): number | null {
  if (!events) return null;
  for (const ev of events) {
    const code = ev?.request?.exit_event?.exit_code;
    if (ev?.type === "exit" && typeof code === "number") return code;
  }
  return null;
}
