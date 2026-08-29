@echo off
REM Lance le serveur local (backend Node/Express d'extraction yt-dlp) sur le
REM port declare, et ouvre l'app dans le navigateur par defaut. Ctrl+C pour arreter.
REM
REM Ce serveur sert le frontend en statique ET l'API d'extraction locale
REM (/api/streams/:id -> yt-dlp) qui contourne le blocage anti-bot des instances
REM Piped publiques. App + API sont same-origin -> le Web Audio DSP fonctionne.

setlocal

set PORT=5400
set URL=http://127.0.0.1:%PORT%

REM 1) Dependances : installe express si node_modules est absent.
if not exist node_modules (
  echo Installation des dependances (npm install)...
  call npm install
  if errorlevel 1 (
    echo npm a echoue. Installez Node.js 22.12+ ou 24 LTS : https://nodejs.org/
    pause
    exit /b 1
  )
)

REM 2) Verifie yt-dlp : sans lui, l'extraction locale est inactive et l'app
REM    bascule sur Piped/IFrame. Avertissement non bloquant.
where yt-dlp >nul 2>&1
if errorlevel 1 (
  echo [ATTENTION] yt-dlp introuvable - l'extraction locale sera inactive.
  echo   Installez-le : https://github.com/yt-dlp/yt-dlp#installation
  echo   ^(L'app basculera sur Piped/IFrame en attendant.^)
)

REM 3) Gère l'ouverture du navigateur selon le paramètre --open-app et par défaut.
set auto_open=%1
if "%auto_open%"=="" ( set auto_open=prompt )           REM Pas de paramètre : demander par défaut

REM Normalise pour accepter yes/yes/no/Y/N/etc.
sset "normalized_auto_open=%auto_open: = %"
set "normalized_auto_open_lower=%auto_open:lower=/%
if /i "%normalized_auto_open_lower%"=="yes" (
  set auto_open=yes
) else if /i "%normalized_auto_open_lower%"=="y" (
  set auto_open=yes
) else if /i "%normalized_auto_open_lower%"=="no" (
  set auto_open=no
) else if /i "%normalized_auto_open_lower%"=="n" (
  set auto_open=no
) else (
  set auto_open=prompt
)

if "%auto_open%"=="yes" (
  REM Ouverture automatique demandée
  start "" "%URL%"
) else if "%auto_open%"=="no" (
  REM Ouverture automatique désactivée
  echo Le serveur est demarré sur %URL%. Ouvrez-le manuellement.
) else (
  REM Prompt demandé a l'utilisateur
  set /p confirm="Voulez-vous ouvrir l'application dans le navigateur ? (y/n): "
  if /i "%confirm%"=="yes" (
    start "" "%URL%"
  ) else if /i "%confirm%"=="y" (
    start "" "%URL%"
  )
)

set PORT=%PORT%
node server/server.js

endlocal
