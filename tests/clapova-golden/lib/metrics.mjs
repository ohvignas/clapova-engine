// Mesures de la suite golden Clapova : extraction de frame, SSIM, loudness.
// Dépend seulement de ffmpeg / ffprobe (version épinglée par Dockerfile.test).
import { spawn } from "node:child_process";

export const SSIM_MIN = 0.99;
export const LUFS_TOLERANCE = 0.5;

/** Lance une commande, renvoie { code, stdout, stderr } sans jamais rejeter sur un code non nul. */
export function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function ffmpeg(args) {
  const r = await run("ffmpeg", ["-hide_banner", "-nostats", "-y", ...args]);
  if (r.code !== 0) throw new Error(`ffmpeg ${args.join(" ")}\n${r.stderr.slice(-800)}`);
  return r;
}

/** Extrait la frame au temps `t` (secondes) en PNG. */
export async function extractFrame(video, t, outPng) {
  await ffmpeg(["-ss", String(t), "-i", video, "-frames:v", "1", "-an", outPng]);
}

/** Extrait du texte ffmpeg `SSIM ... All:0.987654 (...)` la valeur globale. */
export function parseSsim(stderr) {
  const m = /SSIM[^\n]*All:([0-9.]+)/.exec(stderr);
  if (!m) throw new Error(`sortie SSIM illisible : ${stderr.slice(-300)}`);
  return Number(m[1]);
}

/** SSIM global entre deux images de même taille. */
export async function ssim(a, b) {
  const r = await run("ffmpeg", [
    "-hide_banner", "-nostats", "-i", a, "-i", b, "-lavfi", "ssim", "-f", "null", "-",
  ]);
  if (r.code !== 0) throw new Error(`SSIM ${a} ${b}\n${r.stderr.slice(-500)}`);
  return parseSsim(r.stderr);
}

/** Valeur `I:` du résumé final d'ebur128 (LUFS intégré), ou null. */
export function parseIntegratedLufs(stderr) {
  const i = stderr.lastIndexOf("Integrated loudness");
  const tail = i >= 0 ? stderr.slice(i) : stderr;
  const m = /I:\s+(-?[0-9.]+|-inf)\s+LUFS/.exec(tail);
  if (!m || m[1] === "-inf") return null;
  return Number(m[1]);
}

export async function probe(file) {
  const r = await run("ffprobe", [
    "-v", "error", "-show_entries", "stream=codec_type,width,height,r_frame_rate:format=duration",
    "-of", "json", file,
  ]);
  if (r.code !== 0) throw new Error(`ffprobe ${file}\n${r.stderr}`);
  const j = JSON.parse(r.stdout);
  const streams = j.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  return {
    duration: Number(j.format?.duration ?? 0),
    hasAudio: streams.some((s) => s.codec_type === "audio"),
    width: video?.width ?? 0,
    height: video?.height ?? 0,
  };
}

/** { hasAudio, lufs } ; lufs null si pas de flux audio ou silence total. */
export async function loudness(file) {
  const info = await probe(file);
  if (!info.hasAudio) return { hasAudio: false, lufs: null };
  const r = await run("ffmpeg", [
    "-hide_banner", "-nostats", "-i", file, "-vn",
    "-af", "ebur128=framelog=quiet", "-f", "null", "-",
  ]);
  if (r.code !== 0) throw new Error(`ebur128 ${file}\n${r.stderr.slice(-500)}`);
  return { hasAudio: true, lufs: parseIntegratedLufs(r.stderr) };
}
