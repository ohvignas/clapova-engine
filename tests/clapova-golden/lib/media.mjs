// Médias de test générés par ffmpeg (aucun asset payant ni fichier binaire commité).
// Sources synthétiques déterministes : mires, dégradés à graine fixe, sinus.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { run } from "./metrics.mjs";

const SECONDS = 8;
const BITEXACT = ["-fflags", "+bitexact", "-flags:v", "+bitexact", "-flags:a", "+bitexact", "-map_metadata", "-1"];
const H264 = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-g", "30", "-bf", "0", "-threads", "1"];

const video = (source) => ["-f", "lavfi", "-i", `${source}:rate=30:duration=${SECONDS}`];

/** nom de fichier -> arguments ffmpeg (sans "-y" ni chemin de sortie). */
export const MEDIA = {
  "plan-a.mp4": [...video("testsrc2=size=1920x1080"), ...H264, "-an"],
  "plan-b.mp4": [...video("gradients=size=1920x1080:seed=3:speed=0.02"), ...H264, "-an"],
  "plan-v.mp4": [...video("testsrc2=size=1080x1920"), ...H264, "-an"],
  "plan-v2.mp4": [...video("gradients=size=1080x1920:seed=9:speed=0.02"), ...H264, "-an"],
  // Vidéo avec son natif : sinus 440 Hz AAC.
  "plan-son.mp4": [
    ...video("testsrc2=size=1920x1080"),
    "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${SECONDS}`,
    ...H264, "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2",
  ],
  "fond.png": ["-f", "lavfi", "-i", "gradients=size=1920x1080:seed=21:speed=0", "-frames:v", "1"],
  "fond-v.png": ["-f", "lavfi", "-i", "gradients=size=1080x1920:seed=21:speed=0", "-frames:v", "1"],
  // Voix simulée : porteuse 170 Hz modulée en syllabes de 2,5 Hz.
  "voix.wav": [
    "-f", "lavfi",
    "-i", `aevalsrc=0.4*sin(2*PI*170*t)*(0.55+0.45*sin(2*PI*2.5*t)):s=48000:d=${SECONDS}`,
    "-c:a", "pcm_s16le",
  ],
  // Musique simulée : accord la-do#-mi avec trémolo lent.
  "musique.wav": [
    "-f", "lavfi",
    "-i", `aevalsrc=0.16*(sin(2*PI*220*t)+sin(2*PI*277.18*t)+sin(2*PI*329.63*t))*(0.8+0.2*sin(2*PI*0.5*t)):s=48000:d=${SECONDS}`,
    "-c:a", "pcm_s16le",
  ],
};

/** Génère tous les médias dans `dir` ; renvoie la liste des fichiers. */
export async function generateMedia(dir) {
  await mkdir(dir, { recursive: true });
  const names = Object.keys(MEDIA);
  for (const name of names) {
    const out = join(dir, name);
    const r = await run("ffmpeg", ["-hide_banner", "-nostats", "-y", ...MEDIA[name], ...BITEXACT, out]);
    if (r.code !== 0) throw new Error(`génération de ${name} : ${r.stderr.slice(-600)}`);
  }
  return names;
}
