# @clapova/fly

Distributed rendering on Fly Machines, modelled on `packages/gcp-cloud-run`
(`plan` / `renderChunk` / `assemble` from `@hyperframes/producer/distributed`).
Code only: nothing here deploys a Machine by itself.

## Flow

1. `renderOnFly` checks the scale guards (`decideMachineBudget`). If SRV2 is not
   saturated it returns `{ status: "skipped" }` and the caller renders locally.
2. `plan()` runs on the coordinator with `maxParallelChunks` capped by the
   machine budget; the plan is tarred and put in R2/S3 under `<planHash>/`.
3. Chunks are split into contiguous groups (`assignChunksToMachines`), one
   one-shot Machine per group (`createFlyLauncher`, `auto_destroy`, no restart).
   Each Machine runs `node dist/bin.js`, renders its chunks, uploads each chunk
   then a `<index>.done.json` marker (sha256, size, frames).
4. Done markers are the source of truth. Missing chunks are retried in new
   rounds (exponential backoff, `maxAttempts`). After the last attempt a
   resumable `FlyRenderError` is thrown; rerunning the same plan skips chunks
   that already have a valid marker.
5. Chunks are downloaded, digests verified (a mismatch drops the marker), then
   `assemble()` stitches them with the plan audio. Plan and chunk objects are
   deleted on success.

## Guards (same as the Clapova scaler)

`FLY_MIN_BACKLOG` (3), `FLY_MIN_WAIT_MS` (180000), `FLY_MAX_MACHINES` (3).
The Clapova scaler must pass a `QueueSnapshot` (backlog, oldest wait, running
Machines, optional `srv2Saturated`). This package never reads the Convex queue.

## Wiring to do on the Clapova side (not in this package)

- Worker image: add `node packages/clapova-fly/dist/bin.js` as an alternate
  command and the secrets `R2_BUCKET`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY` to the `clapova-render` Fly app (owner, via
  `deploy-fly-worker.sh`).
- Scaler: build the `QueueSnapshot`, call `renderOnFly` for long or 4K jobs
  (roadmap 6.3), fall back to the monolithic render on `skipped`.
- Limits inherited from the producer: integer fps only, no HDR, mp4/webm/mov.

## Tests

`npx vitest run` in this directory (bun is not required for these tests).
