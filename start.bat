@echo off
REM Lance le serveur local (backend Node/Express d'extraction yt-dlp) sur le
REM port declare, et ouvre l'app dans le navigateur par defaut. Ctrl+C pour arreter.
REM
REM Ce serveur sert le frontend en statique ET l'API d'extraction locale
REM (/api/streams/:id -> yt-dlp) qui contourne le blocage anti-bot des instances
REM Piped publiques. App + API sont same-origin -> le Web Audio DSP fonctionne.

setlocal

set PORT=5400
set URL=http://localhost:%PORT%

REM 1) Dependances : installe express si node_modules est absent.
if not exist node_modules (
  echo Installation des dependances (npm install)...
  call npm install
  if errorlevel 1 (
    echo npm a echoue. Installez Node.js 18+ : https://nodejs.org/
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

REM 3) Ouvre le navigateur, puis demarre le serveur (bloquant).
start "" "%URL%"

set PORT=%PORT%
node server/server.js

endlocal
