# Patchs locaux et suivi de l'amont

Clapova Engine est un fork de [heygen-com/hyperframes](https://github.com/heygen-com/hyperframes) (Apache 2.0).

## Branches

- `upstream-mirror` : copie exacte de `upstream/main`, jamais modifiée à la main.
- `main` : porte les changements Clapova.

Remote : `git remote add upstream https://github.com/heygen-com/hyperframes`.

## Règles

1. **Merge hebdomadaire, jamais de rebase.** Chaque semaine, `upstream-mirror` est avancée sur l'amont, puis fusionnée dans `main` par une PR (merge commit). Le merge est épinglé sur une release stable `vX.Y.Z`. La CI complète et `Dockerfile.test` doivent passer.
2. **Règle d'or : aucun fichier de `packages/core`, `packages/engine` ou `packages/producer` modifié sans ticket « patch amont ».** Le code Clapova vit dans des paquets séparés (`packages/clapova-*`).
3. Chaque patch générique est proposé en amont (upstream) dans les 2 semaines.
4. Tout patch local sur ces paquets est listé ci-dessous : fichier, ticket, raison, statut amont.

## Liste des patchs locaux

| Fichier(s) | Ticket « patch amont » | Raison | PR amont | Statut |
|---|---|---|---|---|
| `packages/producer/src/services/assetMediaType.ts`, `packages/producer/src/services/htmlCompiler.ts` (+ test) | Tâche 1.2 : erreur média détaillée | `AssetMediaTypeMismatchError` porte, hors sérialisation (propriété non énumérable `details`), l'id d'élément, le `src` écrit, le type attendu et le type détecté. `describeForAuthor()` renvoie un message actionnable pour l'agent. Message, télémétrie et JSON inchangés. | à proposer | candidat amont |

## Paquets Clapova (hors patchs amont)

- `packages/clapova-render` (`@clapova/render`) : API worker `renderTimeline` / `previewFrames` / `checkComposition` / `reviewSheets` au-dessus de `producer`, `lint` et du binaire `@hyperframes/cli`. `checkComposition` lance par défaut le contrôle complet `hyperframes check --json` (lint, runtime, layout, motion, contraste, craft audit) ; `mode: "lint"` garde l'ancien contrôle statique. `reviewSheets` appelle `hyperframes snapshot --review --json` (planches beats, coutures, téléphone), jamais `--describe` (réseau). Aucun fichier de `core/engine/producer` modifié. Le test de contrat `src/engine.contract.test.ts` vérifie les exports utilisés.
- `packages/clapova-fly` : adaptateur de rendu distribué Fly. Importe seulement l'API publique `@hyperframes/producer/distributed`, aucun patch amont.

## Suivi des fusions amont

| Date | Version amont | Ce qui arrive | Conflits |
|---|---|---|---|
| 2026-10-24 | v0.8.193 (depuis v0.8.177) | `cli/src/utils/craftAudit.ts` (first_frame_empty, text_below_floor, line_unread, dead_stretch, film_silent) dans `hyperframes check` ; `cli/src/commands/snapshotReview.ts` (`snapshot --review`, planches de revue) ; `snapshot --against` ; `producer/.../audioTruePeak.ts` ; `core/src/mediaTiming.ts` et `parsers/src/mediaTiming.ts` ; correctifs engine/producer (Chrome épinglé pour check/snapshot/render, etc.). | `README.md`, `skills-manifest.json` (version amont puis manifeste régénéré pour le patch télémétrie media-use), `package.json` (`test:scripts` amont + tests `scripts/clapova/*`). Patch Tâche 1.2 intact. |

### Code amont à ne pas activer : `packages/cli/src/audio/read/stems.ts`

Arrivé avec v0.8.193. Il envoie l'audio (MP3 192 kb/s) au service cloud HeyGen pour séparer les pistes (voix, batterie, basse...). Il n'est atteint que par `hyperframes audio read --quality best` avec un accès HeyGen authentifié ; la qualité par défaut garde l'audio sur la machine. Les paquets Clapova (`clapova-render`, `clapova-fly`) ne l'importent pas et n'exposent ni `audio read` ni `--quality best`. À désactiver dans le CLI (comme `publish`, `feedback`, `cloud`) si un appelant Clapova doit un jour utiliser `audio read`.
