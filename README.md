# Halo Desk

Halo Desk est une capsule flottante pour macOS, Windows et Linux. Elle affiche l’heure ou le compte à rebours et se déplie pour laisser place à un assistant en français. L’assistant interprète des commandes locales et fonctionne sans clé API ni compte. Seuls les raccourcis web ouvrent un site dans le navigateur.

## Télécharger

Télécharge le paquet correspondant à ton système dans la [dernière release GitHub](https://github.com/mathisbusanabussei359-web/halo-desk/releases/latest).

| Système | Fichier |
| --- | --- |
| Mac avec puce Apple (M1 et suivantes) | DMG `arm64` |
| Mac avec processeur Intel | DMG `x64` |
| Windows 64 bits | Installateur `.exe` |
| Linux 64 bits | `.AppImage` |

Sur macOS, ouvre le DMG et glisse Halo Desk dans Applications. Sur Windows, lance l’installateur. Sur Linux, rends l’AppImage exécutable (`chmod +x nom-du-fichier.AppImage`), puis ouvre-la.

Les builds macOS sont signés localement sans certificat Developer ID ni notarisation. L’installateur Windows est distribué sans certificat Authenticode. Gatekeeper et SmartScreen peuvent afficher un avertissement ou bloquer l’ouverture selon les réglages de la machine. L’AppImage peut nécessiter FUSE 2.

## Démarrer depuis le code source

Installe [Node.js 24 LTS](https://nodejs.org/), puis ouvre un terminal dans ce dossier.

```sh
npm ci
npm test
npm start
```

Clique sur la capsule pour la déplier. **Échap** la replie. **Ctrl + Maj + Espace** sur Windows et Linux, ou **⌘ + Maj + Espace** sur macOS, alterne l’affichage et le masquage. Si la combinaison est déjà prise, utilise l’icône de la barre système. L’onglet **Notes** permet de retrouver et de supprimer les notes.

| Commande | Action |
| --- | --- |
| `focus` ou `focus 30m` | Lance une session de concentration, 25 minutes par défaut |
| `minuteur 90s`, `minuteur 5m`, `minuteur 1h` | Lance un minuteur de 1 seconde à 24 heures |
| `annuler` | Arrête le minuteur en cours |
| `note Appeler Léa` | Enregistre une note |
| `notes` | Ouvre les notes |
| `calc (12 + 3) * 4` | Calcule une expression arithmétique |
| `copier Bonjour !` | Copie le texte dans le presse-papiers |
| `ouvrir agenda`, `ouvrir github`, `ouvrir traduction` | Ouvre Google Agenda, GitHub ou DeepL |
| `aide` | Liste les exemples |

La capsule suit un minuteur à la fois. Les notes et l’échéance du minuteur restent sur ton ordinateur. L’appli peut notifier la fin d’un minuteur tant qu’elle tourne, même masquée. Si elle a été quittée, elle signale une échéance dépassée à sa prochaine ouverture.

## Construire et publier

Pour générer un paquet local pour le système hôte, lance `npm run dist`. Le paquet apparaît dans `dist/`.

Pour récupérer le code source depuis GitHub, clone le dépôt.

```sh
git clone https://github.com/mathisbusanabussei359-web/halo-desk.git
cd halo-desk
```

Le workflow **Builds de bureau** vérifie le bot et compile des paquets sur les machines GitHub. Les builds de la branche principale sont téléchargeables dans **Actions**. Un tag crée ou actualise une **Release** et y joint les paquets des quatre cibles.

```sh
git tag v1.0.0
git push origin v1.0.0
```

Mets à jour la version dans `package.json` et le lockfile avant de publier un nouveau tag.

Sous Linux, la position de la fenêtre, le raccourci global et l’icône de barre système dépendent du compositeur Wayland et de l’environnement de bureau. Si la position ou le raccourci pose problème sous Wayland, essaie `npm start -- --ozone-platform=x11` depuis une session avec XWayland. Les notifications dépendent des réglages système.

## Code

- `src/main.cjs` gère la fenêtre Electron, les données, les notifications et le raccourci.
- `src/bot.cjs` interprète les commandes et calcule les expressions sans exécuter de code utilisateur.
- `src/preload.cjs` expose les seules actions nécessaires à l’interface.
- `src/index.html`, `src/style.css` et `src/renderer.js` composent l’interface.

Licence MIT.
