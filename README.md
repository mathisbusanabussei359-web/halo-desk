# Halo Desk

Halo Desk est une sorte de Dynamic Island pour macOS, Windows et Linux. La capsule affiche l’heure en mode compact et se déplie pour laisser place à Halo, un petit robot animé. L’application native est écrite en Rust avec egui. L’assistant interprète des commandes locales et fonctionne sans clé API ni compte.

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

Installe [Rust stable via rustup](https://rustup.rs/). Sur Debian ou Ubuntu, installe aussi les dépendances de compilation.

```sh
sudo apt install build-essential pkg-config libasound2-dev libx11-dev libxkbcommon-dev libgl1-mesa-dev
```

Sur les trois systèmes, depuis le dossier du projet.

```sh
cargo test --locked
cargo run --locked
```

La capsule noire affiche l’heure en mode compact. Clique dessus pour la déplier. **Échap** la replie. **Ctrl + Maj + Espace** sur Windows et Linux, ou **⌘ + Maj + Espace** sur macOS, alterne l’affichage et le masquage. Si la combinaison est déjà prise, utilise l’icône de la barre système.

| Vue | Fonction |
| --- | --- |
| **Halo** | Assistant, minuteur et mode Focus |
| **Tâches** | Ajouter et terminer des tâches |
| **Notes** | Écrire et retrouver des notes |
| **Fichiers** | Épingler des fichiers et les retrouver dans leur dossier |
| **Musique** | Lire des morceaux locaux et passer de l’un à l’autre |
| **Météo** | Choisir une ville, voir la température, le ressenti et les prévisions sur trois jours |
| **Réglages** | Afficher ou masquer l’heure, changer la position et régler les animations, le plein écran, le sommeil et les notifications |

Les réglages et les listes sont sauvegardés sur l’ordinateur. Épingler ou retirer un fichier ne le déplace pas et ne le supprime pas. La musique est lue depuis les fichiers sélectionnés. Les formats disponibles dépendent des codecs pris en charge. La météo utilise [Open-Meteo](https://open-meteo.com/), avec une connexion Internet. Le nom recherché et les coordonnées de la ville sont envoyés au service météo. Halo Desk ne demande pas la géolocalisation.

Dans la vue **Halo**, le robot s’incline vers le pointeur, réagit à la saisie, se concentre avec toi et fête la fin d’un minuteur ou d’une tâche. Au bout de **30 secondes sans mouvement de souris**, il s’assoupit et des « Z z » apparaissent. Bouge le pointeur pour le réveiller. Tu peux désactiver les animations dans les réglages.

Lorsqu’une autre fenêtre passe en plein écran, Halo Desk glisse vers le haut et se masque. La capsule revient quand tu quittes le plein écran. Si tu l’avais masquée toi-même, elle reste masquée. Le minuteur continue pendant ce temps.

Halo Desk consulte la position du pointeur et des informations sur la fenêtre active. Il ne capture ni l’écran ni les frappes dans les autres apps. La détection du plein écran utilise les dimensions de la fenêtre active sur macOS et Windows, et son état sur Linux avec X11 et `xprop`. Sous Wayland natif, la détection du plein écran et le suivi global du pointeur dépendent de XWayland. Sans accès à X11, le bot utilise les mouvements dans sa fenêtre.

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

Compile le binaire du système hôte avec `cargo build --release --locked`. Le workflow utilise les scripts dans `packaging/` pour générer les installateurs dans `dist/`.

Pour récupérer le code source depuis GitHub, clone le dépôt.

```sh
git clone https://github.com/mathisbusanabussei359-web/halo-desk.git
cd halo-desk
```

Le workflow **Builds de bureau** vérifie le bot et compile des paquets sur les machines GitHub. Les builds de la branche principale sont téléchargeables dans **Actions**. Un tag crée ou actualise une **Release** et y joint les paquets des quatre cibles.

```sh
git tag v2.0.0
git push origin v2.0.0
```

Mets à jour la version dans `Cargo.toml` et `Cargo.lock` avant de publier un nouveau tag.

Sous Linux, la position de la fenêtre, le raccourci global et l’icône de barre système dépendent du compositeur Wayland et de l’environnement de bureau. Si la position ou le raccourci pose problème sous Wayland, essaie `env -u WAYLAND_DISPLAY halo-desk` depuis une session avec XWayland. La sélection de fichiers utilise le portail de bureau sous Linux. Les notifications dépendent des réglages système.

## Données et code

Halo Desk relit le fichier local `halo.json` de la v1.3 pour réutiliser les notes, les tâches, les fichiers épinglés, les morceaux, le minuteur, la ville et les réglages. Le format JSON reste compatible. Un fichier illisible est laissé intact.

- `src/main.rs` démarre l’application graphique et protège les données contre les écritures simultanées.
- `src/ui.rs` contient la capsule, les animations et les sept vues.
- `src/bot.rs` interprète les commandes. `src/data.rs` gère le fichier local.
- `src/desktop.rs` détecte le plein écran. `src/services.rs` gère la météo et l’audio.

Licence MIT.
