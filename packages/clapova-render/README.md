# @clapova/render

In-process render API for the Clapova render worker, on top of `@hyperframes/producer`
(`createRenderJob` / `executeRenderJob`) and `@hyperframes/lint` (`lintProject`).
It replaces `spawn(HF_BIN, ["render", ...])`, the stdout progress regex and `killTree`.

## API

```ts
import { renderTimeline, previewFrames, checkComposition, isClapovaRenderError } from "@clapova/render";

const check = await checkComposition({ projectDir, clipIds });   // lint (+ optional preflight)
if (check.blocking) return reportToAgent(check.issues);           // <= 20 issues, errors first

const ac = new AbortController();
const result = await renderTimeline({
  projectDir, outputPath, fps: 30, quality: "standard", clipIds,
  signal: ac.signal, timeoutMs: 20 * 60_000,
  onProgress: ({ percent, stage, done, total }) => heartbeat(percent),  // monotonic 0..100
});

const frames = await previewFrames({ projectDir, times: [0, 2.5, 7], outDir });  // <= 12 PNG, 540p
```

## Errors

Every failure is a `ClapovaRenderError` (`code`, `owner: "user" | "system"`, `retryable`,
`stage`, `issues[]`). `JSON.stringify(err)` gives the payload to store in Convex.
Each issue carries `clipId`, `elementId`, `src`, `expected`, `detected`, `hint` when known.

| code | owner | retryable | source |
|---|---|---|---|
| `ASSET_MEDIA_TYPE_MISMATCH` | user | no | producer `AssetMediaTypeMismatchError`; `details` (feat/erreur-media-detaillee) gives clipId/src |
| `NOT_MEDIA_PAYLOAD` | user | no | engine `NotMediaPayloadError` (fingerprints only) |
| `RENDER_QUALITY_BLOCKED` | user | no | producer `RenderQualityError` (one issue per warning code) |
| `RENDER_CANCELLED` | system | no | caller abort |
| `RENDER_TIMEOUT` | system | yes | `timeoutMs` exceeded |
| `INVALID_INPUT` | user | no | bad options, rejected before the engine starts |
| `PREVIEW_EXTRACT_FAILED` | system | yes | ffmpeg frame extraction |
| any typed engine code | as thrown | as thrown | errors carrying `code` + `owner` + `retryable` |
| `RENDER_FAILED` | system | yes | anything else |

Engine errors are recognized by shape (`code` / `name`), not class identity.
`clipIds` maps element ids written by Clapova's composer (`c-<clipId>`, `-l`, `-k`, `-km`)
back to timeline clip ids; without it a naming heuristic is used.

## Wiring in the Clapova worker (not done here)

- `workers/render/index.mjs`: replace the `spawn(HF_BIN, ["render", ...])` block with
  `renderTimeline`, the progress regex with `onProgress`, `killTree` with `AbortController.abort()`,
  and the `/VIDEO_SOURCE_UNRENDERABLE/` match with `err.toJSON()` sent to Convex.
- `spawn(HF_BIN, ["snapshot", ...])` becomes `previewFrames`.
- Asset preflight (feat/preflight-assets) plugs into `checkComposition({ preflight })`;
  it throws an engine-shaped error or a `ClapovaRenderError`.
- The agent tool `check_composition` (feat/outil-check-composition) can call `checkComposition` directly.
- Pin an exact version; switch with `RENDER_ENGINE=fork|npm` during the transition.

## Limits

- `previewFrames` renders a full draft then extracts frames with ffmpeg (`FFMPEG_PATH` or `ffmpeg`).
  Exact but not fast; roadmap 3.5/5.5 moves it to a warm browser pool.
- Lease checks (`assertRenderActive`, 6th arg of `executeRenderJob`) and `resumeSegments`
  resume after lease loss are roadmap 1.5.
- In the workspace, `@hyperframes/producer` resolves to its TS sources (bun). Under plain Node,
  consume the published `dist` build.

## Scripts

`bun run build` (tsup to `dist/`), `bun run test` (vitest), `bun run typecheck`.
`src/engine.contract.test.ts` fails if a producer/lint export this SDK relies on disappears upstream.
