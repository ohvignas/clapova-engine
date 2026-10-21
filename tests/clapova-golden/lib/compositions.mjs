// Les 10 compositions de référence de la suite golden Clapova.
// Durées en secondes, 30 fps. `frames` : instants des frames clés comparées en SSIM.
// `audio: false` : aucune piste sonore attendue dans le rendu (vidéo sans son).

const H = { width: 1920, height: 1080 };
const V = { width: 1080, height: 1920 };
const DUCK = { level: 0.25, attack: 0.08, release: 0.3 };

const titre = (id, text, o = {}) => ({
  id, kind: "text", track: 3, text, anim: true, role: "titre", ...o,
});

export const COMPOSITIONS = [
  {
    id: "g01-16x9-titre-anime", ...H, fps: 30, audio: false,
    tags: ["16:9", "titre-anime", "sans-son"],
    background: "#14213d",
    frames: [0.2, 1.2, 3.8],
    clips: [
      { id: "fond", kind: "image", src: "assets/fond.png", track: 0, start: 0, duration: 4, fadeIn: 0.4 },
      titre("t1", "Clapova", { start: 0.3, duration: 3.5, fontSize: 160, y: 0.42 }),
      titre("t2", "Le montage par la parole", { start: 0.9, duration: 2.9, fontSize: 64, y: 0.62, fontWeight: 400 }),
    ],
  },
  {
    id: "g02-9x16-titre-anime", ...V, fps: 30, audio: false,
    tags: ["9:16", "titre-anime", "sans-son"],
    background: "#14213d",
    frames: [0.2, 1.2, 3.8],
    clips: [
      { id: "fond", kind: "image", src: "assets/fond-v.png", track: 0, start: 0, duration: 4, fadeIn: 0.4 },
      titre("t1", "Clapova", { start: 0.3, duration: 3.5, fontSize: 150, y: 0.4 }),
      titre("t2", "Le montage\npar la parole", { start: 0.9, duration: 2.9, fontSize: 72, y: 0.55, fontWeight: 400 }),
    ],
  },
  {
    id: "g03-16x9-voix-musique", ...H, fps: 30, audio: true, duck: DUCK,
    tags: ["16:9", "voix", "musique", "ducking"],
    frames: [0.5, 2.5, 5.5],
    clips: [
      { id: "v1", kind: "video", src: "assets/plan-a.mp4", track: 0, start: 0, duration: 6 },
      { id: "voix", kind: "audio", role: "voix", src: "assets/voix.wav", track: 1, start: 1, duration: 3.5, volume: 1 },
      { id: "mus", kind: "audio", role: "musique", src: "assets/musique.wav", track: 2, start: 0, duration: 6, volume: 0.8, fadeIn: 0.5, fadeOut: 1 },
    ],
  },
  {
    id: "g04-9x16-voix-musique", ...V, fps: 30, audio: true, duck: DUCK,
    tags: ["9:16", "voix", "musique", "ducking"],
    frames: [0.5, 2.5, 5.5],
    clips: [
      { id: "v1", kind: "video", src: "assets/plan-v.mp4", track: 0, start: 0, duration: 6 },
      { id: "voix", kind: "audio", role: "voix", src: "assets/voix.wav", track: 1, start: 0.8, duration: 4, volume: 1 },
      { id: "mus", kind: "audio", role: "musique", src: "assets/musique.wav", track: 2, start: 0, duration: 6, volume: 0.8, fadeIn: 0.5, fadeOut: 1 },
    ],
  },
  {
    id: "g05-16x9-transition-fondu", ...H, fps: 30, audio: false,
    tags: ["16:9", "transition", "fondu", "sans-son"],
    frames: [1.0, 2.0, 2.15, 2.3, 3.5],
    clips: [
      { id: "a", kind: "video", src: "assets/plan-a.mp4", track: 0, start: 0, duration: 2 },
      { id: "b", kind: "video", src: "assets/plan-b.mp4", track: 0, start: 2, duration: 2, transitionIn: { preset: "fondu", duration: 0.5 } },
    ],
  },
  {
    id: "g06-9x16-transition-glisse", ...V, fps: 30, audio: false,
    tags: ["9:16", "transition", "glisse", "sans-son"],
    frames: [1.0, 1.8, 2.0, 3.5],
    clips: [
      { id: "a", kind: "video", src: "assets/plan-v.mp4", track: 0, start: 0, duration: 2 },
      { id: "b", kind: "video", src: "assets/plan-v2.mp4", track: 0, start: 2, duration: 2, transitionIn: { preset: "glisse", duration: 0.5 } },
    ],
  },
  {
    id: "g07-16x9-video-muette-titre", ...H, fps: 30, audio: false,
    tags: ["16:9", "video-muette", "titre-anime", "sans-son"],
    frames: [0.5, 2.0, 4.5],
    clips: [
      { id: "v1", kind: "video", src: "assets/plan-b.mp4", track: 0, start: 0, duration: 5 },
      titre("t1", "Vidéo sans son", { start: 0.5, duration: 4, fontSize: 110, y: 0.8 }),
    ],
  },
  {
    id: "g08-9x16-video-muette-musique", ...V, fps: 30, audio: true,
    tags: ["9:16", "video-muette", "musique"],
    frames: [0.5, 2.5, 4.5],
    clips: [
      { id: "v1", kind: "video", src: "assets/plan-v2.mp4", track: 0, start: 0, duration: 5 },
      { id: "mus", kind: "audio", role: "musique", src: "assets/musique.wav", track: 1, start: 0, duration: 5, volume: 0.9, fadeIn: 0.3, fadeOut: 0.8 },
    ],
  },
  {
    id: "g09-16x9-video-son-natif", ...H, fps: 30, audio: true,
    tags: ["16:9", "son-natif", "titre-anime"],
    frames: [0.5, 2.5, 4.5],
    clips: [
      { id: "v1", kind: "video", src: "assets/plan-son.mp4", track: 0, start: 0, duration: 5, sound: true, volume: 0.7 },
      titre("t1", "Son d'origine", { start: 1, duration: 3.5, fontSize: 100, y: 0.15 }),
    ],
  },
  {
    id: "g10-16x9-multi-pistes", ...H, fps: 30, audio: true, duck: DUCK,
    tags: ["16:9", "voix", "musique", "transition", "titre-anime", "multi-pistes"],
    frames: [0.5, 2.0, 3.2, 5.5],
    clips: [
      { id: "fond", kind: "image", src: "assets/fond.png", track: 0, start: 0, duration: 6 },
      { id: "a", kind: "video", src: "assets/plan-a.mp4", track: 1, start: 0.5, duration: 2.5, fadeIn: 0.3 },
      { id: "b", kind: "video", src: "assets/plan-b.mp4", track: 1, start: 3, duration: 2.5, transitionIn: { preset: "fondu", duration: 0.4 }, fadeOut: 0.4 },
      titre("t1", "Résumé", { start: 0.8, duration: 4.5, fontSize: 120, y: 0.12 }),
      { id: "voix", kind: "audio", role: "voix", src: "assets/voix.wav", track: 4, start: 0.6, duration: 4, volume: 1 },
      { id: "mus", kind: "audio", role: "musique", src: "assets/musique.wav", track: 5, start: 0, duration: 6, volume: 0.7, fadeIn: 0.4, fadeOut: 1 },
    ],
  },
];
