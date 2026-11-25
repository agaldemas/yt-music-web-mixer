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

REM 3) N'ouvre le navigateur que sur demande explicite.
set "auto_open=%~1"
if /i "%auto_open%"=="yes" goto open_browser
if /i "%auto_open%"=="y" goto open_browser
if /i "%auto_open%"=="no" goto start_server
if /i "%auto_open%"=="n" goto start_server

set "auto_open=n"
set /p "auto_open=Voulez-vous ouvrir l'application dans le navigateur ? [y/N] (Entree = non) : "
if /i "%auto_open%"=="yes" goto open_browser
if /i not "%auto_open%"=="y" goto start_server

:open_browser
start "" "%URL%"

:start_server

set PORT=%PORT%
node server/server.js

endlocal
