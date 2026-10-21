import { existsSync } from "node:fs";
import {
  fingerprintElementId,
  isNotMediaPayload,
  NotMediaPayloadError,
  probeMediaProfile,
  resolveProjectRelativeSrc,
  type AudioElement,
  type ImageElement,
  type MediaProbeProfile,
  type VideoElement,
} from "@hyperframes/engine";
import { withMediaProbeSlot } from "../utils/mediaProbeConcurrency.js";

export const ASSET_MEDIA_TYPE_MISMATCH = "ASSET_MEDIA_TYPE_MISMATCH" as const;

export type AssetElementMediaType = "audio" | "image" | "video";
export type DetectedAssetMediaType = AssetElementMediaType | "unknown";

export interface AssetMediaTypeMismatch {
  expected: AssetElementMediaType;
  detected: DetectedAssetMediaType;
  /** Stable, bounded correlation key. Never the raw element id or source. */
  elementFingerprint: string;
}

/**
 * Author-facing detail for one mismatch: the authored element id and the
 * authored `src` (as written in the composition, never the resolved path).
 * Kept off the enumerable/serialized surface of the error so telemetry and
 * logs stay bounded; callers that talk to the composition author (an editor,
 * an AI agent) read it through `details` / `describeForAuthor()`.
 */
export interface AssetMediaTypeMismatchDetail extends AssetMediaTypeMismatch {
  elementId: string;
  src: string;
}

const MAX_DESCRIBED_MISMATCHES = 20;
const MAX_DESCRIBED_VALUE_LENGTH = 200;

function boundValue(value: string): string {
  const flat = value.replace(/[\r\n\t]+/g, " ");
  return flat.length > MAX_DESCRIBED_VALUE_LENGTH
    ? `${flat.slice(0, MAX_DESCRIBED_VALUE_LENGTH)}…`
    : flat;
}

function hintFor(expected: AssetElementMediaType, detected: DetectedAssetMediaType): string {
  if (detected === "unknown") return "the file has no usable audio or visual stream";
  const tag = detected === "image" ? "<img>" : `<${detected}>`;
  return `use a ${tag} element for this file, or point the <${expected === "image" ? "img" : expected}> at a ${expected} file`;
}

export class AssetMediaTypeMismatchError extends Error {
  readonly code = ASSET_MEDIA_TYPE_MISMATCH;
  readonly owner = "user" as const;
  readonly retryable = false as const;
  readonly mismatches: readonly AssetMediaTypeMismatch[];
  /** Non-enumerable: not serialized by JSON.stringify. See AssetMediaTypeMismatchDetail. */
  declare readonly details: readonly AssetMediaTypeMismatchDetail[];

  constructor(
    mismatches: readonly AssetMediaTypeMismatch[],
    details: readonly AssetMediaTypeMismatchDetail[] = [],
  ) {
    const expectedKinds = [...new Set(mismatches.map((item) => item.expected))].sort().join(",");
    super(
      `${mismatches.length} composition asset(s) do not match their authored media element type` +
        (expectedKinds ? ` (expected: ${expectedKinds})` : ""),
    );
    this.name = "AssetMediaTypeMismatchError";
    this.mismatches = mismatches;
    Object.defineProperty(this, "details", {
      value: details,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }

  /**
   * Actionable, multi-line description naming each offending element, its
   * authored src, the expected and detected media types, and a fix hint.
   * Falls back to the bounded message when no details were recorded.
   */
  describeForAuthor(): string {
    if (this.details.length === 0) return this.message;
    const shown = this.details.slice(0, MAX_DESCRIBED_MISMATCHES);
    const lines = shown.map(
      (d) =>
        `- element "${boundValue(d.elementId)}" src="${boundValue(d.src)}": ` +
        `expected ${d.expected}, detected ${d.detected} (${hintFor(d.expected, d.detected)})`,
    );
    const hidden = this.details.length - shown.length;
    if (hidden > 0) lines.push(`- … and ${hidden} more`);
    return [`${this.details.length} asset(s) do not match their media element type:`, ...lines].join(
      "\n",
    );
  }
}

function detectedAssetMediaType(profile: MediaProbeProfile): DetectedAssetMediaType {
  if (profile.visualKind === "moving") return "video";
  if (profile.visualKind === "still") return "image";
  if (profile.hasAudioStream) return "audio";
  return "unknown";
}

function mediaProfileMatchesElementType(
  expected: AssetElementMediaType,
  profile: MediaProbeProfile,
): boolean {
  if (expected === "audio") return profile.hasAudioStream;
  if (expected === "image") return profile.visualKind === "still";
  return profile.visualKind === "moving";
}

export function assertAssetMediaTypeProfile(
  expected: AssetElementMediaType,
  profile: MediaProbeProfile,
  elementIdentity: string,
  src?: string,
): void {
  if (mediaProfileMatchesElementType(expected, profile)) return;
  const mismatch: AssetMediaTypeMismatch = {
    expected,
    detected: detectedAssetMediaType(profile),
    elementFingerprint: fingerprintElementId(elementIdentity),
  };
  throw new AssetMediaTypeMismatchError(
    [mismatch],
    src === undefined ? [] : [{ ...mismatch, elementId: elementIdentity, src }],
  );
}

interface CompositionMediaAssets {
  videos: readonly VideoElement[];
  audios: readonly AudioElement[];
  images: readonly ImageElement[];
}

interface MediaReference {
  id: string;
  src: string;
  expected: AssetElementMediaType;
}

function isRemoteOrInlineSource(src: string): boolean {
  return /^(?:https?:|data:|blob:|about:)/i.test(src.trim());
}

/**
 * Fail early when a successfully-probed local asset cannot satisfy the HTML
 * element that owns it. Missing, corrupt, remote-at-runtime, and unprobeable
 * inputs deliberately remain untouched so their existing source/download/
 * invalid-media classification is preserved downstream.
 */
export async function preflightCompositionAssetMediaTypes(input: {
  projectDir: string;
  compiledDir: string;
  composition: CompositionMediaAssets;
  signal?: AbortSignal;
}): Promise<void> {
  const references: MediaReference[] = [
    ...input.composition.videos.map((asset) => ({
      id: asset.id,
      src: asset.src,
      expected: "video" as const,
    })),
    ...input.composition.audios.map((asset) => ({
      id: asset.id,
      src: asset.src,
      expected: "audio" as const,
    })),
    ...input.composition.images.map((asset) => ({
      id: asset.id,
      src: asset.src,
      expected: "image" as const,
    })),
  ];

  const byPath = new Map<string, MediaReference[]>();
  for (const reference of references) {
    if (!reference.src || isRemoteOrInlineSource(reference.src)) continue;
    const resolvedPath = resolveProjectRelativeSrc(
      reference.src,
      input.projectDir,
      input.compiledDir,
    );
    if (!existsSync(resolvedPath)) continue;
    byPath.set(resolvedPath, [...(byPath.get(resolvedPath) ?? []), reference]);
  }

  const mismatches: AssetMediaTypeMismatch[] = [];
  const details: AssetMediaTypeMismatchDetail[] = [];
  const notMediaFingerprints: string[] = [];
  const entries = [...byPath];
  await Promise.all(
    entries.map(([resolvedPath, pathReferences]) =>
      withMediaProbeSlot(async () => {
        // STUDIO-5433. This preflight is the only place every local media src is
        // seen regardless of its authored timing, so it is where a document
        // payload behind a `data-end` video gets caught — the compiler's own
        // sniff only runs for elements whose duration it has to resolve.
        //
        // Video only, deliberately. An `<img>` may legitimately be an SVG,
        // which ffprobe reads through its `svg_pipe` demuxer. And a bad audio
        // source is non-fatal by existing policy (audioStage ships the render
        // without the track and reports `audioError`), so it is classified
        // per-element in audioMixer instead of aborted here.
        const sniffableReferences = pathReferences.filter((ref) => ref.expected === "video");
        if (sniffableReferences.length > 0 && (await isNotMediaPayload(resolvedPath))) {
          notMediaFingerprints.push(
            ...sniffableReferences.map((ref) => fingerprintElementId(ref.id)),
          );
          return;
        }

        let profile: MediaProbeProfile;
        try {
          profile = await probeMediaProfile(resolvedPath, { signal: input.signal });
        } catch (error) {
          if (input.signal?.aborted) throw input.signal.reason ?? error;
          return;
        }
        for (const reference of pathReferences) {
          if (mediaProfileMatchesElementType(reference.expected, profile)) continue;
          const mismatch: AssetMediaTypeMismatch = {
            expected: reference.expected,
            detected: detectedAssetMediaType(profile),
            elementFingerprint: fingerprintElementId(reference.id),
          };
          mismatches.push(mismatch);
          details.push({ ...mismatch, elementId: reference.id, src: reference.src });
        }
      }),
    ),
  );

  // Thrown ahead of the mismatch aggregate: "this file is an HTML page" is the
  // actionable diagnosis, while the type mismatch it also produces is a symptom.
  if (notMediaFingerprints.length > 0) throw new NotMediaPayloadError(notMediaFingerprints);
  if (mismatches.length > 0) throw new AssetMediaTypeMismatchError(mismatches, details);
}
