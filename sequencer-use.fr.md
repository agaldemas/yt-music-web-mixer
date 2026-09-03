# 🥁 Séquenceur & Boîte à Rythmes — Guide d'utilisation

Le Séquenceur est un module intégré au YT Music Web Mixer qui transforme votre navigateur en une véritable machine à rythmes. Il combine une matrice de programmation pas-à-pas et une interface de batterie interactive.

## 🚀 Accès
Depuis la page principale du Mixer, cliquez sur le bouton **🥁 Séquenceur** dans l'en-tête pour ouvrir l'interface.

---

## 🖼️ Aperçu de l'interface

![Interface du Séquenceur](sequencer-ui.png)

*(Légende : De haut en bas $\rightarrow$ Transport & Presets $\rightarrow$ Matrice de programmation $\rightarrow$ Batterie interactive)*

---

## 🎛️ Guide des fonctionnalités

### 1. La Matrice de Pas (Step Sequencer)
La grille permet de composer vos propres rythmes sur 16 pas (doubles-croches).

- **Programmation** : Cliquez sur une cellule pour activer/désactiver une note. Une cellule allumée en bleu sera jouée au passage du curseur.
- **Pistes** : Vous disposez de 9 instruments (Kick, Snare, Hats, Toms, Crash, Ride).
- **Playhead** : Le curseur jaune indique la position actuelle de la lecture en temps réel.
- **BPM** : Ajustez la vitesse du rythme via le slider (40 à 240 BPM).

### 2. La Batterie Interactive (Drum Kit View)
Sous la grille se trouve une vue de dessus de votre kit de batterie.

- **Frappe directe** : Cliquez sur un fût ou une cymbale pour déclencher le son instantanément.
- **Raccourcis Clavier** : Jouez comme sur un vrai clavier :
  - `B` ou `Espace` $\rightarrow$ Grosse caisse (Kick)
  - `S` $\rightarrow$ Caisse claire (Snare)
  - `H` $\rightarrow$ Charleston (Hat)
  - `T`/`Y`/`G` $\rightarrow$ Toms (High, Mid, Low)
  - `C` $\rightarrow$ Crash
  - `R` $\rightarrow$ Ride
- **Pédale Charleston** : Cliquez sur la pédale (bas-gauche) pour basculer entre l'état **UP** (ouvert) et **DOWN** (fermé). Cela modifie le son du Charleston, que vous jouiez via la grille ou le clavier.

### 3. Presets « Rythmes »
Ne partez pas de zéro ! Utilisez les rythmes prédéfinis inspirés des genres les plus courants.

- **Menu Rythmes** : Cliquez sur le bouton **Rythmes ▾** pour ouvrir le menu déroulant.
- **Sélection** : Choisissez parmi les styles (Pop rock, Jazz, Funk, Disco, Hip-hop, Heavy metal). 
- **Impact** : Charger un preset ajuste automatiquement la grille, le BPM et le mode de swing (pour le Jazz).

### 4. Personnalisation des sons
Chaque piste dispose d'un menu de configuration :
- **Synthèse** : Son généré en temps réel par Tone.js.
- **Samples** : Utilisation de fichiers WAV haute qualité (Kits Acoustique ou Électronique).
