import { describe, expect, it } from "vitest";
import { FlyMachinesClient, extractExitCode } from "./machines.js";
import { createFlyLauncher, decodeJob, encodeJob, JOB_ENV } from "./jobs.js";

function fakeFetch(handler: (method: string, url: string, body: any) => { status: number; json?: unknown }) {
  const calls: { method: string; url: string; body: any }[] = [];
  const fetchImpl = (async (url: string, init: any) => {
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method, url, body });
    const r = handler(init.method, url, body);
    return { ok: r.status < 400, status: r.status, text: async () => (r.json ? JSON.stringify(r.json) : "") } as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("job encoding", () => {
  it("round-trips and validates", () => {
    const job = { planHash: "h", chunkIndices: [0, 2], format: "mp4" as const };
    expect(decodeJob(encodeJob(job))).toEqual(job);
    expect(() => decodeJob(Buffer.from(JSON.stringify({ planHash: "h", chunkIndices: [-1], format: "mp4" })).toString("base64"))).toThrow();
  });
});

describe("extractExitCode", () => {
  it("finds the exit event", () => {
    expect(extractExitCode([{ type: "start" }, { type: "exit", request: { exit_event: { exit_code: 137 } } }])).toBe(137);
    expect(extractExitCode(undefined)).toBeNull();
  });
});

describe("FlyMachinesClient + launcher", () => {
  it("creates a one-shot machine, waits for exit, destroys it", async () => {
    let polls = 0;
    const { fetchImpl, calls } = fakeFetch((method, url) => {
      if (method === "POST") return { status: 200, json: { id: "m1" } };
      if (method === "GET") {
        polls++;
        return { status: 200, json: polls < 2 ? { state: "started" } : { state: "stopped", events: [{ type: "exit", request: { exit_event: { exit_code: 0 } } }] } };
      }
      return { status: 200 };
    });
    const client = new FlyMachinesClient({ app: "clapova-render", token: "t", fetchImpl, sleep: async () => undefined });
    const launcher = createFlyLauncher({ client, spec: { image: "img", region: "cdg" }, timeoutMs: 10_000 });
    const res = await launcher.run({ planHash: "h", chunkIndices: [1], format: "mp4" });
    expect(res.ok).toBe(true);
    const create = calls[0]!;
    expect(create.url).toBe("https://api.machines.dev/v1/apps/clapova-render/machines");
    expect(create.body.config).toMatchObject({ auto_destroy: true, restart: { policy: "no" } });
    expect(create.body.config.env[JOB_ENV]).toBeTruthy();
    expect(calls.at(-1)!.method).toBe("DELETE");
  });

  it("reports a non-zero exit and tolerates a destroyed machine (404)", async () => {
    const { fetchImpl } = fakeFetch((method) => {
      if (method === "POST") return { status: 200, json: { id: "m2" } };
      if (method === "GET") return { status: 200, json: { state: "stopped", events: [{ type: "exit", request: { exit_event: { exit_code: 1 } } }] } };
      return { status: 404 };
    });
    const client = new FlyMachinesClient({ app: "a", token: "t", fetchImpl, sleep: async () => undefined });
    const res = await createFlyLauncher({ client, spec: { image: "i" }, timeoutMs: 1000 }).run({ planHash: "h", chunkIndices: [0], format: "webm" });
    expect(res).toEqual({ ok: false, error: "exit code 1" });
  });

  it("returns a failure when the API rejects the create", async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 422 }));
    const client = new FlyMachinesClient({ app: "a", token: "t", fetchImpl });
    const res = await createFlyLauncher({ client, spec: { image: "i" }, timeoutMs: 1000 }).run({ planHash: "h", chunkIndices: [0], format: "mp4" });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("422");
  });
});

describe("launcher edge cases", () => {
  it("treats a failed machine state as a failure, not a timeout", async () => {
    const { fetchImpl } = fakeFetch((method) => {
      if (method === "POST") return { status: 200, json: { id: "m3" } };
      if (method === "GET") return { status: 200, json: { state: "failed" } };
      return { status: 200 };
    });
    const client = new FlyMachinesClient({ app: "a", token: "t", fetchImpl, sleep: async () => undefined });
    const res = await createFlyLauncher({ client, spec: { image: "i" }, timeoutMs: 1000 }).run({ planHash: "h", chunkIndices: [0], format: "mp4" });
    expect(res.ok).toBe(false);
  });

  it("does not create a machine when already aborted", async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ status: 200, json: { id: "x" } }));
    const client = new FlyMachinesClient({ app: "a", token: "t", fetchImpl });
    const ac = new AbortController();
    ac.abort();
    const res = await createFlyLauncher({ client, spec: { image: "i" }, timeoutMs: 1000 }).run({ planHash: "h", chunkIndices: [0], format: "mp4" }, ac.signal);
    expect(res).toEqual({ ok: false, error: "aborted" });
    expect(calls).toHaveLength(0);
  });

  it("destroys the machine when aborted mid-run", async () => {
    const ac = new AbortController();
    const { fetchImpl, calls } = fakeFetch((method) => {
      if (method === "POST") return { status: 200, json: { id: "m4" } };
      if (method === "GET") { ac.abort(); return { status: 200, json: { state: "stopped", events: [{ type: "exit", request: { exit_event: { exit_code: 0 } } }] } }; }
      return { status: 200 };
    });
    const client = new FlyMachinesClient({ app: "a", token: "t", fetchImpl, sleep: async () => undefined });
    await createFlyLauncher({ client, spec: { image: "i" }, timeoutMs: 1000 }).run({ planHash: "h", chunkIndices: [0], format: "mp4" }, ac.signal);
    expect(calls.some((c) => c.method === "DELETE")).toBe(true);
  });

  it("rejects malformed base64 job", () => {
    expect(() => decodeJob("!!!")).toThrow();
  });
});
