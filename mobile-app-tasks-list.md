# 📱 YT Music Web Mixer — Application mobile (React Native + WebView)

Plan de création d'une version mobile **React Native** présentant la **même interface** que l'application web, en embarquant l'app existante dans des **WebView**. L'app se lance en **paysage** uniquement.

Référence : `CLAUDE.md` (cahier des charges), `tasks-list.md` (état de l'app web), `index.html` + `css/` + `js/` (code existant à embarquer).

## Légende

- [x] Terminé · [~] Partiellement / en cours · [ ] À faire

---

## Architecture choisie

**Approche : WebView pleine page.** L'app web existante (`index.html` + `css/` + `js/`) est **bundlisée dans l'app mobile** et chargée dans un composant `<WebView>` plein écran. La coquille native (React Native) gère uniquement :

- Verrouillage d'orientation **portrait**
- **Status bar** (thème sombre, couleur de fond)
- **Safe areas** (encoches iPhone, bords arrondis)
- **Splash screen** + icône app
- Bouton retour **Android** (fermer ou quitter)
- Permissions réseau (pour que la WebView puisse charger l'API YouTube IFrame + l'API YouTube Data)

Pourquoi cette approche plutôt qu'une UI native :

- ✅ L'app web est déjà fonctionnelle et testée → zéro réécriture de logique métier (crossfade, recherche, sync, persistance).
- ✅ L'API IFrame YouTube fonctionne nativement dans une WebView (c'est un `<iframe>` standard).
- ✅ `localStorage` est supporté dans la WebView (iOS WKWebView + Android WebView) → la persistance de la clé API et des videoIds fonctionne.
- ✅ Le CSS responsive existant (`@media (max-width: 720px)` → 1 colonne) s'adapte automatiquement au mobile.
- ⚠️ Limitation : le rendu est celui d'un WebView, pas 100% natif. Les transitions/scrolls peuvent différer légèrement du natif pur. Acceptable pour ce projet.

### Structure de fichiers proposée

```
yt-music-web-mixer/
├── index.html                    # app web (existante)
├── css/                           # styles web (existants)
├── js/                            # logique web (existante)
├── CLAUDE.md
├── tasks-list.md
├── mobile-app-tasks-list.md      # ← ce fichier
└── mobile/                       # projet React Native
    ├── android/                   # projet Android natif (généré)
    ├── ios/                       # projet iOS natif (généré)
    ├── src/
    │   ├── App.tsx                # composant racine : Orientation + SafeArea + WebView
    │   ├── components/
    │   │   └── MixerWebView.tsx   # wrapper WebView avec config + handlers
    │   ├── hooks/
    │   │   └── useOrientationLock.ts  # verrouillage portrait
    │   └── utils/
    │       └── webViewConfig.ts   # config WebView (JS, storage, URIs)
    ├── assets/
    │   └── web/                   # ← copie de index.html + css/ + js/ (bundlisé)
    ├── app.json                    # nom app, orientation, icône, splash
    ├── package.json
    └── babel.config.js
```

---

## 0. Choix technologiques & prérequis [ ]

- [ ] Décider : **React Native CLI (bare)** vs **Expo**
  - **Recommandé : React Native CLI (bare)** — contrôle direct sur `android/app/src/main/assets/` et le bundle iOS, nécessaire pour charger des fichiers locaux en WebView sans les limitations d'Expo
  - Alternative : Expo (plus rapide à setup) mais `expo-asset` + WebView local peut nécessiter `eject` ou prebuild
- [ ] Vérifier les versions : Node ≥ 18, JDK 17, Android SDK, Xcode (pour iOS)
- [ ] Créer le projet dans `mobile/` : `npx @react-native-community/cli@latest init YTMusicMixer --directory mobile`
- [ ] Installer les dépendances principales :
  - `react-native-webview` (WebView)
  - `react-native-orientation-locker` (verrouillage orientation)
  - `react-native-safe-area-context` (safe areas / encoches)
  - `react-native-bootsplash` ou `react-native-splash-screen` (splash screen)
  - `@react-native-community/masked-view` (si splash personnalisée)

---

## 1. Verrouillage orientation portrait [ ]

- [ ] Installer `react-native-orientation-locker` (`npm install react-native-orientation-locker`)
- [ ] Config native iOS : ajouter les orientations autorisées dans `Info.plist` (`UISupportedInterfaceOrientations` = portrait uniquement)
- [ ] Config native Android : `android:screenOrientation="portrait"` dans `AndroidManifest.xml` (activité principale)
- [ ] Hook `useOrientationLock.ts` : appeler `Orientation.lockToPortrait()` au montage du composant racine (`useEffect`)
- [ ] Vérifier que la rotation ne déclenche pas de changement de layout (lock actif dès le splash)

---

## 2. Coquille native (shell) [ ]

- [ ] **Status bar** : `<StatusBar barStyle="light-content" backgroundColor="#0f1115" />` (thème sombre, couleur de fond `#0f1115` = `body` du CSS web)
- [ ] **Safe areas** : wrapper principal avec `<SafeAreaProvider>` + `<SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: '#0f1115' }}>` (pas de bottom safe area — la barre de mixage web gère sa propre marge)
- [ ] **Splash screen** : écran de démarrage fond `#0f1115` + logo/titre "🎵 YT Music Web Mixer" en blanc, disparaît quand la WebView a fini de charger (`onLoadEnd`)
- [ ] **App.json** : nom d'app `YTMusicMixer`, `displayName`, icône, splash (fond `#0f1115`)
- [ ] **Icône app** : générer icônes iOS (`Icon-60@2x.png`, etc.) et Android (`mipmap-*/ic_launcher.png`) — réutiliser le `favicon.ico` ou créer une icône dédiée
- [ ] Vérifier que le contenu WebView remplit tout l'écran sous la status bar (pas de marge blanche en haut)

---

## 3. Intégration WebView — chargement de l'app web locale [ ]

### 3.1 Copie des assets web

- [ ] Créer `mobile/assets/web/`
- [ ] Copier `index.html`, `css/`, `js/` depuis la racine du projet vers `mobile/assets/web/`
- [ ] Ajouter un **script de synchronisation** (`mobile/scripts/sync-web-assets.sh`) : copie les fichiers web vers `assets/web/` avant le build (pour éviter de travailler sur des copies divergentes)
- [ ] Exclure `assets/web/` de Git si on synchronise à chaque build, OU le committer pour des builds reproductibles (recommandé : committer)

### 3.2 Configuration WebView

- [ ] Installer `react-native-webview` (`npm install react-native-webview`)
- [ ] Composant `MixerWebView.tsx` :
  ```tsx
  <WebView
    source={{ uri: Platform.OS === 'ios'
      ? `file://${RNFS.MainBundlePath}/web/index.html`
      : 'file:///android_asset/web/index.html' }}
    originWhitelist={['*']}
    allowingReadAccessToURLs={'file://'}
    allowFileAccess={true}               // Android
    allowFileAccessFromFileURLs={true}   // Android
    allowUniversalAccessFromFileURLs={false} // sécurité : pas d'accès universel
    javaScriptEnabled={true}
    domStorageEnabled={true}             // Android : active localStorage
    mediaPlaybackRequiresUserAction={false}  // autorise autoplay (muted)
    allowsInlineMediaPlayback={true}     // iOS : lecture inline
    allowsBackForwardNavigationGestures={false}
    renderToHardwareTextureAndroid={true}
    containerStyle={{ flex: 1, backgroundColor: '#0f1115' }}
    onLoadEnd={handleLoadEnd}
    onError={handleWebViewError}
  />
  ```
- [ ] Configurer `react-native-fs` (ou equivalent) pour récupérer le chemin du bundle iOS (`RNFS.MainBundlePath`)
- [ ] Ajouter `web/` aux ressources bundlisées :
  - **iOS** : glisser le dossier `web/` dans Xcode → "Create folder references" (blue folder) pour que les sous-dossiers `css/` et `js/` soient préservés dans le bundle
  - **Android** : copier `assets/web/` dans `android/app/src/main/assets/web/` (ou via le script de sync)
- [ ] Vérifier que les chemins relatifs dans `index.html` (`css/styles.css`, `js/app.js`) résolvent correctement depuis le `file://` local

### 3.3 Gestion de `origin` (YouTube IFrame)

- [ ] L'app web ajoute `origin: window.location.origin` dans `playerVars` **uniquement en `http(s):`**. En `file://` dans la WebView, `window.location.origin` peut valoir `"null"` ou `"file://"`. Vérifier que `youtube.js` ne bloque pas l'ajout d'`origin` dans ce cas (adapter si besoin : ajouter `origin` en `file://` aussi, ou le retirer)
- [ ] Tester le chargement des 2 lecteurs de test (`lfmxnzJAbl8`, `sBBxnnIQ-Vk`) au démarrage de l'app

---

## 4. Compatibilité YouTube IFrame en WebView [ ]

- [ ] **JavaScript activé** dans la WebView (`javaScriptEnabled={true}`) — requis pour l'API IFrame
- [ ] **Chargement du script API** : `https://www.youtube.com/iframe_api` doit se charger → permissions réseau OK
- [ ] **localStorage** activé :
  - Android : `domStorageEnabled={true}` (sinon `localStorage` = vide, clé API et videoIds perdus)
  - iOS : WKWebView active `localStorage` par défaut, mais peut être purgé si données effacées → documenter
- [ ] **Autoplay muted** : la politique du navigateur (WebView) exige `muted:1` pour l'autoplay. L'app web le fait déjà (`playerVars.mute = 1`). Vérifier que les 2 lecteurs démarrent bien en muted sans geste utilisateur
- [ ] **Bouton unmute** : tester que le tap sur "Activer le son" déclenche `unMute()` correctement en WebView (iOS WKWebView peut bloquer le son sans geste — le tap compte comme geste)
- [ ] **`playsinline: 1`** : déjà dans `playerVars` → la vidéo reste inline (pas de fullscreen automatique sur iOS)
- [ ] Tester `loadVideoById`, `playVideo`, `pauseVideo`, `seekTo`, `setVolume`, `mute`, `unMute` depuis l'UI web dans la WebView
- [ ] Vérifier que `onError` (codes 100/101/150) s'affiche correctement dans la voie concernée

---

## 5. Recherche YouTube Data en WebView [ ]

- [ ] **`fetch()` vers `https://www.googleapis.com/youtube/v3/search`** : doit fonctionner en WebView (pas de restriction CORS côté mobile WebView pour `file://` → vérifier)
- [ ] Si la recherche est bloquée en `file://` (possible sur iOS WKWebView), ajouter `allowUniversalAccessFromFileURLs={true}` **uniquement si nécessaire** (attention sécurité) ou migrer vers un mini-serveur local embarqué
- [ ] Tester les états UI du panneau de recherche : `idle`, `loading`, `results`, `error`, `no-results`
- [ ] Tester la gestion d'erreurs : 403/429 (quota), 400 (clé invalide), réseau/CORS
- [ ] Tester le fallback sans clé : saisie d'URL/ID → extraction `videoId`
- [ ] Tester la pagination ‹ › et l'historique des résultats
- [ ] Vérifier que la clé API saisie dans la modal Paramètres persiste via `localStorage` en WebView (reloader l'app → clé toujours là)

---

## 6. Crossfader & contrôles de mixage en WebView [ ]

- [ ] Tester le slider de crossfade en tactile (drag du thumb rectangle 15×30px) — vérifier la réactivité du touch sur iOS et Android
- [ ] Si le thumb est trop petit au touch (15×30px), envisager un **agrandissement de la zone tactile** sans changer le visuel (CSS `padding` invisible ou `touch-action: none` + events personnalisés)
- [ ] Vérifier le calcul equal-power en temps réel (`playerA.setVolume(vA * master/100)`)
- [ ] Tester `play both` / `pause both` / `sync B→A` / `sync continu` / `master volume`
- [ ] Tester le **crossfade progressif par paliers** (sliders dans la modal Paramètres)
- [ ] Vérifier l'affichage des volumes A/B et master synchronisé avec la cible

---

## 7. Adaptations mobile du CSS existant [ ]

Le CSS existant a déjà un breakpoint `@media (max-width: 720px)` → 1 colonne. En portrait mobile (~390-414px), l'app passe automatiquement en layout 1 colonne (deck A empilé au-dessus du deck B).

- [ ] Vérifier le rendu 1 colonne : deck A → deck B → barre de mixage (flex-wrap)
- [ ] Si on veut **forcer 2 colonnes côte à côte** même en portrait (comme sur l'image de référence), surcharger la media query ou forcer `.decks { grid-template-columns: 1fr 1fr }` dans un CSS mobile dédié. ⚠️ Les lecteurs seront très étroits (~180px chacun) → peu lisible. À valider visuellement.
- [ ] **Viewport meta** : `index.html` a déjà `<meta name="viewport" content="width=device-width, initial-scale=1.0">` → correct pour mobile
- [ ] **Scroll** : vérifier que le scroll vertical dans les résultats de recherche (`.deck-results { max-height: 260px; overflow-y: auto }`) fonctionne au touch en WebView
- [ ] **Zoom au double-tap** : désactiver pour éviter le zoom involontaire sur les sliders → ajouter `<meta name="viewport" ... maximum-scale=1.0, user-scalable=no">` (ou `touch-action: manipulation` sur le body)
- [ ] **Taille des boutons** : vérifier que les boutons de la barre de mixage et des decks sont assez grands au touch (min 44×44px recommandé Apple HIG). Si trop petits, ajouter un CSS mobile avec `min-height: 44px` sur `.mixer-btn`, `.deck-mute-btn`, `.deck-nav-btn`
- [ ] **Modale Paramètres** : vérifier qu'elle s'affiche correctement en plein écran mobile (`max-width: 480px` → pleine largeur) et que le clavier virtuel ne masque pas l'input de clé API
- [ ] **Safe area bottom** : la barre de mixage est `position: sticky; bottom: 0` → sur iPhone avec home indicator, vérifier qu'elle n'est pas masquée. Ajouter `padding-bottom: env(safe-area-inset-bottom)` si besoin

---

## 8. Communication RN ↔ WebView (postMessage) [ ]

L'app web est autonome → communication RN↔WebView **minimale**. Prévoir un pont pour les features natives futures.

- [ ] Injecter un script d'amorçage (`injectedJavaScript`) au chargement de la WebView :
  ```js
  // Pont RN ↔ Web : expose une fonction pour envoyer des messages à RN
  window.YT_MIXER_BRIDGE = {
    send: (type, payload) => window.ReactNativeWebView.postMessage(
      JSON.stringify({ type, payload })
    )
  };
  true; // requis pour injectedJavaScript
  ```
- [ ] Côté RN, handler `onMessage` sur la WebView : parser le JSON et router selon `type`
- [ ] Messages web → RN à implémenter (optionnel) :
  - `{ type: 'video_loaded', payload: { deck, videoId } }` → could trigger native notification or media session
  - `{ type: 'error', payload: { deck, code, message } }` → could show native toast
  - `{ type: 'request_api_key' }` → could open native settings screen
- [ ] Messages RN → web (via `webViewRef.current.injectJavaScript()`) :
  - Ex: injecter la clé API depuis un stockage natif (Keychain/Keystore) si on veut migrer `localStorage` → secure storage natif
- [ ] Documenter le contrat de messages dans `mobile/src/utils/webViewConfig.ts`

---

## 9. Gestion du bouton retour (Android) [ ]

- [ ] Handler `BackHandler` Android : intercepter le bouton retour matériel
- [ ] Comportement :
  - Si la modal Paramètres est ouverte → fermer la modal (injecter JS qui appelle `closeModal()`)
  - Sinon → quitter l'app (ou minimiser) avec `BackHandler.exitApp()`
- [ ] Détecter l'état de la modal via `onMessage` (la web app envoie `{ type: 'modal_open' }` / `{ type: 'modal_close' }`)
- [ ] Ou alternative plus simple : injecter `history.back()` si la web app utilise `history` (elle ne le fait pas actuellement) → donc handler custom

---

## 10. Permissions réseau & config native [ ]

- [ ] **Android `AndroidManifest.xml`** :
  - `<uses-permission android:name="android.permission.INTERNET" />` (déjà présent par défaut)
  - `android:usesCleartextTraffic="true"` si besoin (pour `http://` — pas nécessaire car YouTube est en HTTPS, mais utile pour un serveur local de dev)
- [ ] **iOS `Info.plist`** :
  - `NSAppTransportSecurity` avec `NSAllowsArbitraryLoads` uniquement si nécessaire (HTTPS requis par défaut, YouTube est en HTTPS → OK)
  - Ajouter `NSAllowsLocalNetworking` si on utilise un serveur statique local en dev
- [ ] Vérifier qu'aucune permission supplémentaire n'est requise (pas d'accès micro/caméra/localisation)

---

## 11. Optimisations performance mobile [ ]

- [ ] **Double lecture YouTube** : la lecture simultanée de 2 vidéos YouTube en WebView peut être lourde sur mobile (RAM/CPU limité). Afficher le warning de l'app web (lourdeur double lecture) de façon visible
- [ ] **Hardware acceleration** Android : `android:hardwareAccelerated="true"` (déjà par défaut)
- [ ] **Texture rendering** : `renderToHardwareTextureAndroid={true}` sur la WebView
- [ ] Vérifier que le scroll est fluide (pas de jank) pendant la lecture des 2 vidéos
- [ ] Si saccades : envisager de réduire la qualité vidéo (non contrôlable par l'API IFrame → indiquer à l'utilisateur de le faire manuellement dans le lecteur)
- [ ] Tester sur un appareil modeste (ex: 4 Go RAM) pour évaluer la faisabilité

---

## 12. Build & déploiement [ ]

### 12.1 Android (APK / AAB)

- [ ] Configurer `android/app/build.gradle` : `applicationId`, `versionCode`, `versionName`
- [ ] Générer la keystore de release : `keytool -genkeypair -v -storetype PKCS12 -keystore android/app/release.keystore ...`
- [ ] Configurer `signingConfigs` dans `build.gradle`
- [ ] Build APK debug : `cd mobile && npx react-native run-android`
- [ ] Build AAB release : `cd android && ./gradlew bundleRelease`
- [ ] Tester l'APK sur un appareil physique en mode portrait

### 12.2 iOS (IPA)

- [ ] Ouvrir `ios/YTMusicMixer.xcworkspace` dans Xcode
- [ ] Configurer le signing (Team, Bundle Identifier, Provisioning Profile)
- [ ] Vérifier que le dossier `web/` est bien référencé comme "folder reference" (bleu) dans Xcode
- [ ] Build sur simulateur : `npx react-native run-ios`
- [ ] Build sur appareil physique : via Xcode (compte développeur Apple requis)
- [ ] Vérifier `UISupportedInterfaceOrientations` = portrait uniquement dans Build Settings

---

## 13. Tests [ ]

- [ ] **Tests fonctionnels** (sur appareils/simulateurs) :
  - [ ] Lancement de l'app en portrait → 2 lecteurs se chargent (vidéos de test)
  - [ ] Recherche YouTube avec clé API → résultats affichés
  - [ ] Sélection d'un résultat → vidéo chargée dans le lecteur
  - [ ] Crossfade A↔B en temps réel (drag du slider tactile)
  - [ ] Play both / pause both
  - [ ] Sync B→A (ponctuel + continu)
  - [ ] Master volume
  - [ ] Mute/unmute par voie
  - [ ] Modal Paramètres (clé API, crossfade progressif)
  - [ ] Persistance : reloader l'app → videoIds et clé API restaurés
  - [ ] Fallback sans clé : saisie d'URL/ID manuelle
  - [ ] Gestion d'erreurs : vidéo supprimée (101/150), quota dépassé (429)
- [ ] **Tests orientation** : rotation de l'appareil → reste en portrait
- [ ] **Tests bouton retour Android** : ferme modal si ouverte, sinon quitte
- [ ] **Tests performance** : double lecture sur appareil modeste (pas de crash, scroll fluide)
- [ ] **Tests safe area** : iPhone avec encoche (notch) → rien de masqué

---

## 14. Documentation [ ]

- [ ] Mettre à jour `CLAUDE.md` : ajouter une section "Version mobile (React Native)" décrivant l'architecture WebView, le dossier `mobile/`, le script de sync des assets web
- [ ] Créer `mobile/README.md` : instructions de build et lancement (Android + iOS), dépendances, configuration native
- [ ] Documenter les **limitations spécifiques au mobile** :
  - Double lecture YouTube lourde sur mobile → recommander 1 voie à la fois sur appareil modeste
  - `localStorage` en WebView peut être purgé par le système (iOS notamment) → ne pas garantir la persistance
  - Le zoom tactile est désactivé (`user-scalable=no`) pour éviter les zooms involontaires sur les sliders
  - Le sync continu n'est jamais parfait (200-500ms de drift normal)
  - Le bouton retour Android ferme la modal si ouverte, sinon quitte l'app
- [ ] Documenter le **pont RN ↔ WebView** (types de messages, contrat) dans `mobile/src/utils/webViewConfig.ts`

---

## 15. Évolutions futures (optionnel) [ ]

- [ ] **Media Session API native** : afficher les métadonnées du morceau en cours dans le centre de contrôle iOS / Android (title, artist, artwork) via `MediaSession` ou un module natif
- [ ] **Stockage sécurisé natif** : migrer la clé API YouTube de `localStorage` (WebView) vers Keychain (iOS) / Keystore (Android) pour plus de sécurité
- [ ] **Notifications locales** : alerter quand une vidéo est terminée (état ENDED)
- [ ] **Partage natif** : bouton de partage du morceau en cours (Share sheet iOS / Android)
- [ ] **Picture-in-Picture** : activer le PiP pour le lecteur principal
- [ ] **Mode paysage optionnel** : autoriser le paysage sur tablette uniquement, layout 2 colonnes forcé
- [ ] **Push de l'app sur les stores** : Google Play Store (AAB), App Store (IPA) — nécessite comptes développeur

---

## Notes

- **Approche WebView = zéro réécriture de logique métier.** Toute la logique (crossfade, recherche, sync, persistance) reste dans les fichiers JS existants. La WebView charge `index.html` tel quel.
- **Le verrouillage portrait se fait au niveau natif** (`Info.plist` iOS + `AndroidManifest.xml` Android) ET via `react-native-orientation-locker` au runtime. Double verrou pour fiabilité.
- **Assets web bundlisés** : les fichiers `index.html` + `css/` + `js/` sont copiés dans `mobile/assets/web/` puis référencés dans le bundle natif (iOS Xcode folder reference + Android `assets/`).
- **`localStorage` en WebView** : activé par `domStorageEnabled={true}` (Android) et par défaut sur iOS WKWebView. La clé API, les videoIds et les réglages persistent au rechargement.
- **L'image de référence** (screenshot joint) montre l'interface web actuelle : header `🎵 YT Music Web Mixer` + ⚙️, 2 decks côte à côte (A bleu à gauche, B rose à droite) avec recherche + lecteur + résultats, barre de mixage en bas (crossfade + boutons + master). La version mobile en portrait empile les 2 decks verticalement (layout responsive existant).
- **Priorité d'implémentation suggérée** : 0 (setup) → 1 (orientation) → 2 (shell) → 3 (WebView + assets) → 4 (YouTube IFrame) → 5 (recherche) → 6 (crossfader) → 7 (CSS mobile) → 10 (permissions) → 12 (build) → 13 (tests) → 8/9 (pont/back) → 14 (doc). Les sections 8, 9, 11, 15 sont optionnelles.
