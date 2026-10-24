// Générateur de compositions de référence, au format de sortie de
// `src/lib/hyperframes/compose.ts` (dépôt Clapova) : racine unique
// `data-composition-id`, un clip = enfant plat `class="clip"` daté en
// secondes, wrapper `layer > mp > tr > cam` pour les visuels, une seule
// timeline GSAP en pause enregistrée dans `window.__timelines`, `<audio>`
// toujours avec un id, vidéo `muted` ou `data-has-audio` + `data-volume`,
// fondu audio en `data-automation`, jamais de `crossorigin`.
// Pur : mêmes entrées, même HTML. Ni horloge ni hasard.

export const GSAP_SRC = "https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js";

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
const num = (n) => Number(Number(n).toFixed(3));
const domId = (id) => `c-${id.replace(/[^A-Za-z0-9_-]/g, "_")}`;
const layerId = (id) => `${domId(id)}-l`;

/** Enveloppe de volume : ducking pendant la parole, plus fondus. Points { t, v } (t en secondes du clip). */
export function volumeLane({ duration, volume, speech = [], duck, fadeIn = 0, fadeOut = 0 }) {
  const pts = [];
  const push = (t, v) => {
    const last = pts[pts.length - 1];
    if (!last || t > last.t) pts.push({ t: num(t), v: num(v) });
  };
  push(0, fadeIn > 0 ? 0 : volume);
  if (fadeIn > 0) push(fadeIn, volume);
  if (duck) {
    for (const [s, e] of speech) {
      push(Math.max(0, s - duck.attack), volume);
      push(s, volume * duck.level);
      push(Math.min(duration, e), volume * duck.level);
      push(Math.min(duration, e + duck.release), volume);
    }
  }
  if (fadeOut > 0) {
    push(duration - fadeOut, pts[pts.length - 1].v);
    push(duration, 0);
  } else push(duration, pts[pts.length - 1].v);
  return pts;
}

function timing(c, lane, start = c.start, duration = c.duration) {
  return `id="${domId(c.id)}" data-start="${num(start)}" data-duration="${num(duration)}" data-track-index="${lane}"`;
}

function automation(points) {
  const flat = points.every((p) => p.v === points[0].v);
  if (flat) return "";
  return ` data-automation='${esc(JSON.stringify({ version: 1, lanes: [{ target: "volume", points }] }))}'`;
}

/**
 * @typedef {object} Clip
 * @property {string} id @property {"video"|"image"|"audio"|"text"} kind
 * @property {number} track  piste (0 = bas)
 * @property {number} start @property {number} duration  secondes
 */

/**
 * @param {object} spec  voir compositions.mjs
 * @returns {string} HTML complet
 */
export function composeHtml(spec) {
  const { width, height } = spec;
  const nodes = [];
  const tweens = [];
  const speech = spec.clips
    .filter((c) => c.role === "voix")
    .map((c) => [c.start, c.start + c.duration]);
  const tracks = new Map();
  for (const c of spec.clips) tracks.set(c.track, [...(tracks.get(c.track) ?? []), c]);

  for (const c of spec.clips) {
    const lane = c.track;
    const prev = (tracks.get(lane) ?? []).find(
      (o) => o !== c && Math.abs(o.start + o.duration - c.start) < 0.04,
    );
    const tIn = c.transitionIn && prev ? c.transitionIn : null;
    // Un fondu ou une glissade dessine le clip entrant en avance sur le précédent.
    const handle = tIn ? tIn.duration : 0;
    const start = c.start - handle;
    const duration = c.duration + handle;
    const z = (lane + 1) * 10000 + Math.min(99, (tracks.get(lane) ?? []).indexOf(c));
    const volume = c.volume ?? 1;

    if (c.kind === "audio") {
      const points = volumeLane({
        duration: c.duration,
        volume,
        speech: c.role === "musique" ? speech.map(([s, e]) => [s - c.start, e - c.start]) : [],
        duck: c.role === "musique" && spec.duck ? spec.duck : null,
        fadeIn: c.fadeIn ?? 0,
        fadeOut: c.fadeOut ?? 0,
      });
      nodes.push(
        `<audio ${timing(c, lane)} src="${esc(c.src)}" data-media-start="${num(c.trimIn ?? 0)}" data-volume="${volume}"${automation(points)}></audio>`,
      );
      continue;
    }

    let inner;
    if (c.kind === "video") {
      const sound = c.sound ? `data-has-audio="true" data-volume="${volume}"` : "muted";
      inner = `<video class="clip media" ${timing(c, lane, start, duration)} src="${esc(c.src)}" data-media-start="${num(Math.max(0, (c.trimIn ?? 0) - handle))}" playsinline ${sound}></video>`;
    } else if (c.kind === "image") {
      inner = `<img class="clip media" ${timing(c, lane, start, duration)} src="${esc(c.src)}" alt="" />`;
    } else {
      const fontSize = Math.round(c.fontSize ?? height / 18);
      const top = Math.max(0, Math.round((c.y ?? 0.5) * height - fontSize * 0.6));
      const body = c.anim
        ? [...c.text]
            .map((ch, i) =>
              ch === "\n"
                ? "<br>"
                : `<span class="u u${i}" style="display:inline-block">${ch === " " ? "&nbsp;" : esc(ch)}</span>`,
            )
            .join("")
        : esc(c.text);
      inner = `<div class="clip text" ${timing(c, lane, start, duration)} style="padding-top:${top}px;justify-content:center;text-align:center;font-size:${fontSize}px;font-weight:${c.fontWeight ?? 700};color:${c.color ?? "#ffffff"}">${body}</div>`;
      if (c.anim) {
        tweens.push(
          `tl.fromTo(${JSON.stringify(`#${domId(c.id)} .u`)},{opacity:0,y:${Math.round(fontSize * 0.6)}},{opacity:1,y:0,duration:0.5,stagger:0.04,ease:"power3.out",immediateRender:false},${num(c.start)});`,
        );
      }
    }
    nodes.push(
      `<div id="${layerId(c.id)}" class="layer" style="z-index:${z}"><div class="mp"><div class="tr"><div class="cam">${inner}</div></div></div></div>`,
    );

    const sel = JSON.stringify(`#${domId(c.id)}`);
    if (c.fadeIn > 0)
      tweens.push(
        `tl.fromTo(${sel},{opacity:0},{opacity:1,duration:${num(c.fadeIn)},ease:"none",immediateRender:false},${num(c.start)});`,
      );
    if (c.fadeOut > 0)
      tweens.push(
        `tl.fromTo(${sel},{opacity:1},{opacity:0,duration:${num(c.fadeOut)},ease:"none",immediateRender:false},${num(c.start + c.duration - c.fadeOut)});`,
      );
    if (tIn) {
      const trIn = JSON.stringify(`#${layerId(c.id)} .tr`);
      const trOut = JSON.stringify(`#${layerId(prev.id)} .tr`);
      if (tIn.preset === "fondu") {
        tweens.push(
          `tl.fromTo(${trIn},{opacity:0},{opacity:1,duration:${num(handle)},ease:"none",immediateRender:false},${num(start)});`,
        );
      } else if (tIn.preset === "glisse") {
        tweens.push(
          `tl.fromTo(${trIn},{xPercent:100},{xPercent:0,duration:${num(handle)},ease:"power2.inOut",immediateRender:false},${num(start)});`,
        );
        tweens.push(
          `tl.fromTo(${trOut},{xPercent:0},{xPercent:-30,duration:${num(handle)},ease:"power2.inOut",immediateRender:false},${num(start)});`,
        );
      } else throw new Error(`transition inconnue : ${tIn.preset}`);
    }
  }

  const duration = Math.max(0.1, ...spec.clips.map((c) => c.start + c.duration));
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=${width}, height=${height}" />
<script src="${GSAP_SRC}"></script>
<style>
body{margin:0;background:#000}
#root{position:relative;width:100%;height:100%;overflow:hidden;background:${spec.background ?? "#000"}}
.clip,.layer,.mp,.tr,.cam,.kc{position:absolute;inset:0}
.layer{pointer-events:none}
.media{width:100%;height:100%;object-fit:cover}
.text{box-sizing:border-box;display:flex;align-items:flex-start;padding-left:5%;padding-right:5%;font-family:system-ui,sans-serif;line-height:1.2;white-space:pre-wrap;text-shadow:0 2px 12px rgba(0,0,0,.6)}
</style>
</head>
<body>
<div id="root" data-composition-id="${spec.id}" data-start="0" data-width="${width}" data-height="${height}" data-duration="${num(duration)}">
${nodes.join("\n")}
</div>
<script>
const tl = gsap.timeline({ paused: true });
${tweens.join("\n")}
window.__timelines["${spec.id}"] = tl;
</script>
</body>
</html>
`;
}
