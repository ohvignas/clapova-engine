/**
 * Map composition element ids back to Clapova clip ids.
 *
 * Clapova's composer (`src/lib/hyperframes/compose.ts`) writes clip elements
 * as `c-<sanitized clipId>` and derived nodes as `<domId>-l` (layer),
 * `<domId>-k` / `<domId>-km` (cutout) or `<domId>-<fx...>`. Sanitization
 * replaces anything outside [A-Za-z0-9_-] with `_`, so it is not invertible on
 * its own: pass the timeline's clip ids to get an exact answer.
 */

export function clipDomId(clipId: string): string {
  return `c-${clipId.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

export type ClipIdResolver = (elementId: string | undefined) => string | undefined;

export function createClipIdResolver(knownClipIds?: readonly string[]): ClipIdResolver {
  const byDomId = new Map<string, string>();
  for (const clipId of knownClipIds ?? []) byDomId.set(clipDomId(clipId), clipId);
  // Longest dom id first so "c-a-b" wins over "c-a" for "c-a-b-l".
  const domIds = [...byDomId.keys()].sort((a, b) => b.length - a.length);

  return (elementId) => {
    if (!elementId) return undefined;
    if (byDomId.size > 0) {
      const exact = byDomId.get(elementId);
      if (exact) return exact;
      for (const domId of domIds) {
        if (elementId.startsWith(`${domId}-`)) return byDomId.get(domId);
      }
      return undefined;
    }
    // No timeline given: best-effort heuristic on the composer's naming.
    const match = /^c-(.+?)(?:-(?:l|k|km))?$/.exec(elementId);
    return match?.[1];
  };
}
