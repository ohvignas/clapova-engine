# Suite golden Clapova

Filet de non-régression du moteur de rendu (roadmap Clapova Engine, tâche 0.5).
Dix compositions de référence, rendues par le producer du fork puis comparées à des références :

- SSIM >= 0,99 sur chaque frame clé (liste `frames` de chaque composition) ;
- loudness intégré (ebur128) à +/- 0,5 LU ;
- durée à +/- 1 frame, présence ou absence du flux audio identiques.

| Id | Format | Couvre |
|---|---|---|
| g01 / g02 | 16:9 / 9:16 | titre animé sur image, sans son |
| g03 / g04 | 16:9 / 9:16 | voix + musique avec ducking et fondus |
| g05 | 16:9 | transition fondu |
| g06 | 9:16 | transition glissée |
| g07 | 16:9 | vidéo sans son + titre animé |
| g08 | 9:16 | vidéo sans son + musique |
| g09 | 16:9 | vidéo avec son natif |
| g10 | 16:9 | multi-pistes : image, deux plans, transition, titre, voix, musique |

## Comment les compositions sont produites

`lib/compose.mjs` reproduit le format de sortie de `src/lib/hyperframes/compose.ts` (dépôt Clapova) :
racine `data-composition-id`, clips plats `class="clip"`, wrapper `layer > mp > tr > cam`, timeline GSAP
unique en pause, `<audio>` avec id, vidéo `muted` ou `data-has-audio`, fondus audio en `data-automation`.
`lib/compositions.mjs` décrit les dix scénarios. Aucun asset payant : `lib/media.mjs` fabrique avec ffmpeg
des mires, dégradés à graine fixe, une voix simulée (sinus modulé) et un accord de musique.
Rien de binaire n'est commité hors références.

Si `compose.ts` change de format, mettre `lib/compose.mjs` à jour dans la même PR.

## Lancer

Les références dépendent de Chrome et de ffmpeg : les produire et les comparer uniquement dans l'image de test.

```bash
docker build -f Dockerfile.test -t hyperframes-producer:test .

# Comparer (CI) :
docker run --rm --security-opt seccomp=unconfined --shm-size=4g \
  -v "$PWD/tests/clapova-golden:/app/tests/clapova-golden" \
  --entrypoint bash hyperframes-producer:test \
  -c "cd /app && node tests/clapova-golden/run.mjs"

# Écrire ou mettre à jour les références (puis les commiter) :
... node tests/clapova-golden/run.mjs --update [id...]
```

Options de `run.mjs` : `--update`, `--skip-render DIR` (compare des MP4 déjà rendus, `DIR/<id>.mp4`),
ids en arguments pour limiter. En cas d'échec, la vidéo et les frames obtenues sont copiées dans `failures/<id>/`.

## Tests de la suite elle-même

Sans Chrome, avec ffmpeg et ffprobe seulement :

```bash
node --test tests/clapova-golden/golden.test.mjs
```

## Mise à jour des références

Un changement volontaire de rendu (Chrome, ffmpeg, producer) change les pixels. Lancer le workflow
`clapova-golden` en `workflow_dispatch` avec `update: true`, télécharger l'artefact `clapova-golden-references`,
le copier dans `tests/clapova-golden/references/` et le commiter avec la justification du changement.
