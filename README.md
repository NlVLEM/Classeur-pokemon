# Mon Classeur Pokémon

Web app pour suivre sa collection de cartes Pokémon françaises : catalogue complet (TCGdex), reconnaissance des cartes par la caméra, rangement, valeur Cardmarket.

- `src/template.html` : l'app (le catalogue et le module de vision sont injectés à la construction)
- `src/vision-core.js` : détection, redressement et empreinte visuelle des cartes, commun à l'app et au calcul GitHub
- `public/` : icônes, manifeste et service worker (mode hors ligne)
- `scripts/build.js` : construit `site/` à partir de la base TCGdex
- `scripts/vision-index.js` : calcule l'empreinte visuelle de chaque carte (`site/vision-index.json` + `vision-….bin`)
- `.github/workflows/deploy.yml` : reconstruit et publie sur GitHub Pages à chaque modification et chaque lundi

La collection de chaque personne reste enregistrée dans son propre navigateur, jamais dans ce dépôt.
