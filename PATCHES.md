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

- `packages/clapova-render` (`@clapova/render`) : API worker `renderTimeline` / `previewFrames` / `checkComposition` au-dessus de `producer` et `lint`. Aucun fichier de `core/engine/producer` modifié. Le test de contrat `src/engine.contract.test.ts` vérifie les exports utilisés.
