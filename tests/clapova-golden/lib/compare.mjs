// Règles de comparaison pures (testables sans rendu) : SSIM par frame clé,
// loudness à ±0,5 LU, durée à ±1 frame, présence du flux audio.
import { LUFS_TOLERANCE, SSIM_MIN } from "./metrics.mjs";

/**
 * @param {{ fps:number, hasAudio:boolean, lufs:number|null, duration:number }} ref
 * @param {{ hasAudio:boolean, lufs:number|null, duration:number }} got
 * @param {{ t:number, ssim:number }[]} frames
 * @returns {string[]} échecs, vide si tout passe
 */
export function compareResult(ref, got, frames) {
  const fails = [];
  for (const f of frames) {
    if (!(f.ssim >= SSIM_MIN))
      fails.push(`frame ${f.t}s : SSIM ${f.ssim.toFixed(4)} < ${SSIM_MIN}`);
  }
  if (ref.hasAudio !== got.hasAudio) {
    fails.push(
      `flux audio : attendu ${ref.hasAudio ? "présent" : "absent"}, obtenu ${got.hasAudio ? "présent" : "absent"}`,
    );
  } else if (ref.hasAudio) {
    if (ref.lufs == null || got.lufs == null) {
      if (ref.lufs !== got.lufs) fails.push(`loudness : attendu ${ref.lufs}, obtenu ${got.lufs}`);
    } else {
      const d = Math.abs(got.lufs - ref.lufs);
      if (d > LUFS_TOLERANCE)
        fails.push(
          `loudness : ${got.lufs} LUFS pour ${ref.lufs} attendu (écart ${d.toFixed(2)} LU > ${LUFS_TOLERANCE})`,
        );
    }
  }
  const frameS = 1 / ref.fps;
  if (Math.abs(got.duration - ref.duration) > frameS + 1e-6) {
    fails.push(`durée : ${got.duration}s pour ${ref.duration}s attendu (> 1 frame)`);
  }
  return fails;
}
