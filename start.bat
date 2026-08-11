@echo off
REM Lance un serveur statique local sur le port 8000 et ouvre l'app
REM dans le navigateur par defaut. Ctrl+C pour arreter.

set PORT=8000
set URL=http://localhost:%PORT%

REM Ouvre le navigateur, puis demarre le serveur (bloquant).
start "" "%URL%"

py -m http.server %PORT%
if errorlevel 1 (
  python -m http.server %PORT%
)

REM Si Python est absent, message d'aide.
if errorlevel 1 (
  echo Python introuvable. Installez Python 3 ou lancez : npx serve -p %PORT%
  pause
  exit /b 1
)
