# Halo Desk

Halo Desk est une sorte de Dynamic Island pour macOS, Windows et Linux. Elle affiche l’heure ou le compte à rebours et se déplie pour laisser place à Halo, un petit robot animé. L’assistant interprète des commandes locales et fonctionne sans clé API ni compte. Seuls les raccourcis web ouvrent un site dans le navigateur.

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

Halo s’incline vers le pointeur dans la capsule, réagit à la saisie, se concentre avec toi et fête la fin d’un minuteur ou d’une tâche. Au bout de **30 secondes sans mouvement de souris**, il s’assoupit et des « Z z » apparaissent. Bouge le pointeur pour le réveiller. L’option système de réduction des animations est respectée.

Lorsqu’une autre fenêtre passe en plein écran, Halo Desk glisse vers le haut et se masque. La capsule revient quand tu quittes le plein écran. Si tu l’avais masquée toi-même, elle reste masquée. Le minuteur continue pendant ce temps.

Halo Desk consulte la position du pointeur et des informations sur la fenêtre active. Il ne capture ni l’écran ni les frappes dans les autres apps. La détection du plein écran utilise les dimensions de la fenêtre active sur macOS et Windows, et son état sur Linux avec X11 et `xprop`. Sous Wayland natif, le plein écran des fenêtres Wayland n’est pas détecté et le sommeil utilise l’inactivité signalée par le système.

| Commande | Action |
| --- | --- |
| `focus` ou `focus 30m` | Lance une session de concentration, 25 minutes par défaut |
| `minuteur 90s`, `minuteur 5m`, `minuteur 1h` | Lance un minuteur de 1 seconde à 24 heures |
| `annuler` | Arrête le minuteur en cours |
| `pause`, `reprendre` | Met le minuteur en pause ou repart du temps restant |
| `date` | Affiche la date et l’heure locales |
| `note Appeler Léa` | Enregistre une note |
| `notes` | Ouvre les notes |
| `tâche Envoyer le dossier` | Ajoute un élément à la liste de tâches |
| `tâches`, `fait 1` | Affiche la liste ou termine une tâche par son numéro |
| `calc (12 + 3) * 4` | Calcule une expression arithmétique |
| `copier Bonjour !` | Copie le texte dans le presse-papiers |
| `dé 20`, `pile ou face` | Lance un dé ou tire à pile ou face |
| `ouvrir agenda`, `ouvrir github`, `ouvrir traduction` | Ouvre Google Agenda, GitHub ou DeepL |
| `aide` | Liste les exemples |

Les formulations courtes et naturelles utilisent les mêmes commandes. `minuteur 5m`, `minuteur 5 minutes` et `lance un minuteur de 5 minutes` donnent la même durée. Tu peux aussi écrire `mets le minuteur en pause`, `montre-moi mes notes`, `ajoute une tâche : Envoyer le dossier` ou `quelle heure est-il ?`.

La capsule suit un minuteur à la fois. Les notes, les tâches et le minuteur restent sur ton ordinateur. L’appli peut notifier la fin d’un minuteur tant qu’elle tourne, même masquée. Si elle a été quittée, elle signale une échéance dépassée à sa prochaine ouverture.

## Construire et publier

Pour générer un paquet local pour le système hôte, lance `npm run dist`. Le paquet apparaît dans `dist/`.

Pour récupérer le code source depuis GitHub, clone le dépôt.

```sh
git clone https://github.com/mathisbusanabussei359-web/halo-desk.git
cd halo-desk
```

Le workflow **Builds de bureau** vérifie le bot et compile des paquets sur les machines GitHub. Les builds de la branche principale sont téléchargeables dans **Actions**. Un tag crée ou actualise une **Release** et y joint les paquets des quatre cibles.

```sh
git tag v1.2.0
git push origin v1.2.0
```

Mets à jour la version dans `package.json` et le lockfile avant de publier un nouveau tag.

Sous Linux, la position de la fenêtre, le raccourci global et l’icône de barre système dépendent du compositeur Wayland et de l’environnement de bureau. Si la position ou le raccourci pose problème sous Wayland, essaie `npm start -- --ozone-platform=x11` depuis une session avec XWayland. Les notifications dépendent des réglages système.

## Code

- `src/main.cjs` gère la fenêtre Electron, les données, les notifications et le raccourci.
- `src/bot.cjs` interprète les commandes et calcule les expressions sans exécuter de code utilisateur.
- `src/preload.cjs` expose les seules actions nécessaires à l’interface.
- `src/index.html`, `src/style.css` et `src/renderer.js` composent l’interface.

Licence MIT.
