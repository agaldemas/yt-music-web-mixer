@echo off
REM ============================================================================
REM install.bat - Installe toutes les dependances de yt-music-web-mixer sur
REM Windows : Git, Node.js LTS, npm (installe avec Node), yt-dlp (nightly) et
REM ffmpeg/ffprobe, puis lance npm install dans le projet.
REM
REM Usage : double-cliquez sur install.bat, ou depuis une console :
REM   install.bat
REM
REM Strategie par dependance :
REM   1) Detection via `where` ; si deja present, on saute.
REM   2) Si winget est disponible, on l'utilise (plus simple, auto-update).
REM   3) Sinon, fallback via PowerShell (telechargement direct + lancement
REM      silencieux de l'installeur .msi ou de l'exe).
REM   4) En dernier recours, message d'erreur clair avec l'URL a ouvrir
REM      manuellement.
REM
REM Pour fonctionner, ce script necessite au minimum PowerShell 3.0 (deja
REM present sur Windows 7+). Aucune autre dependance externe.
REM ============================================================================

setlocal EnableExtensions EnableDelayedExpansion

REM --- Configuration -----------------------------------------------------------
set "PROJECT_DIR=%~dp0"
set "LOG_FILE=%PROJECT_DIR%install.log"

REM Couleurs (optionnelles, certaines consoles ne les supportent pas).
REM On evite les sequences ANSI pour rester compatible avec l'ancien cmd.exe.

REM --- Fonctions utilitaires --------------------------------------------------
call :log "=== install.bat demarre a %DATE% %TIME% ==="

REM Affiche un titre visible
echo.
echo  ===========================================================
echo    YT Music Web Mixer - Installation Windows
echo  ===========================================================
echo.

REM ============================================================================
REM ETAPE 1 : Verifications prealables
REM ============================================================================
call :section "1) Verifications prealables"

REM Verifie qu'on est bien dans le dossier du projet (package.json doit etre ici)
if not exist "%PROJECT_DIR%package.json" (
  call :error "package.json introuvable dans %PROJECT_DIR%"
  call :error "Lancez install.bat depuis le dossier du projet (apres git clone)."
  goto :end_fail
)
call :ok "Dossier projet detecte : %PROJECT_DIR%"

REM Verifie PowerShell (necessaire pour les fallbacks)
where powershell >nul 2>&1
if errorlevel 1 (
  call :error "PowerShell introuvable. Ce script en a besoin pour les fallbacks."
  call :error "PowerShell est integre a Windows 7+ ; reinstallez Windows ?"
  goto :end_fail
)
call :ok "PowerShell disponible"

REM Detecte winget (optionnel mais preferable)
set "HAS_WINGET=0"
where winget >nul 2>&1
if not errorlevel 1 set "HAS_WINGET=1"
if "%HAS_WINGET%"=="1" (
  call :ok "winget disponible (installation simplifiee)"
) else (
  call :warn "winget absent - on utilisera PowerShell en fallback"
)

REM Detecte curl (necessaire pour certains telechargements)
set "HAS_CURL=0"
where curl >nul 2>&1
if not errorlevel 1 set "HAS_CURL=1"
if "%HAS_CURL%"=="1" (
  call :ok "curl disponible"
) else (
  call :warn "curl absent (PowerShell prendra le relais)"
)

echo.

REM ============================================================================
REM ETAPE 2 : Git
REM ============================================================================
call :section "2) Git (systeme de controle de version)"

where git >nul 2>&1
if errorlevel 1 goto :need_install_git
for /f "delims=" %%v in ('git --version 2^>nul') do call :ok "Deja installe : %%v"
goto :skip_git
:need_install_git
call :info "Git manquant, installation..."

if "%HAS_WINGET%"=="1" (
  call :info "Tentative : winget install -e --id Git.Git"
  winget install -e --id Git.Git --accept-package-agreements --accept-source-agreements >> "%LOG_FILE%" 2>&1
  if not errorlevel 1 (
    call :ok "Git installe via winget"
    goto :skip_git
  ) else (
    call :warn "winget a echoue, fallback PowerShell..."
  )
)

REM Fallback PowerShell : telecharge l'installeur Git officiel
call :info "Telechargement de l'installeur Git (fallback PowerShell)..."
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "try {" ^
  "  $url='https://github.com/git-for-windows/git/releases/download/v2.47.0.windows.1/Git-2.47.0-64-bit.exe';" ^
  "  $dst=Join-Path $env:TEMP 'Git-installer.exe';" ^
  "  [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12;" ^
  "  Invoke-WebRequest -Uri $url -OutFile $dst -UseBasicParsing -ErrorAction Stop;" ^
  "  Write-Host ('Git installer telecharge : ' + $dst)" ^
  "} catch { Write-Host ('ERREUR telechargement Git : ' + $_.Exception.Message); exit 1 }" >> "%LOG_FILE%" 2>&1
if errorlevel 1 (
  call :error "Echec du telechargement de Git"
  call :info "Installez manuellement depuis : https://git-scm.com/download/win"
  goto :end_fail
)

set "GIT_INSTALLER=%TEMP%\Git-installer.exe"
if not exist "%GIT_INSTALLER%" (
  call :error "Installeur Git introuvable : %GIT_INSTALLER%"
  goto :end_fail
)

call :info "Lancement de l'installeur Git en mode silencieux (patientez 1-2 min)..."
"%GIT_INSTALLER%" /VERYSILENT /NORESTART /NOCANCEL /SP- /CLOSEAPPLICATIONS /LOG="%LOG_FILE%"
if errorlevel 1 (
  call :warn "L'installeur Git a retourne une erreur ; verifiez le log."
)

REM Ajoute Git au PATH de la session courante (la nouvelle install ne sera
REM visible qu'apres fermeture/rouverture du shell par l'utilisateur)
set "PATH=%ProgramFiles%\Git\bin;%PATH%"
where git >nul 2>&1
if not errorlevel 1 (
  for /f "delims=" %%v in ('git --version 2^>nul') do call :ok "Git installe : %%v"
) else (
  call :warn "Git semble installe mais pas trouve dans cette session"
  call :info "Fermez et rouvrez votre terminal, puis relancez install.bat."
)

:skip_git
echo.

REM ============================================================================
REM ETAPE 3 : Node.js + npm
REM ============================================================================
call :section "3) Node.js (>= 22.12 LTS) + npm"

where node >nul 2>&1
if errorlevel 1 goto :need_install_node
for /f "delims=" %%v in ('node --version 2^>nul') do call :ok "Deja installe : %%v"
goto :skip_node
:need_install_node
call :info "Node.js manquant, installation de la derniere LTS..."

if "%HAS_WINGET%"=="1" (
  call :info "Tentative : winget install -e --id OpenJS.NodeJS.LTS"
  winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements >> "%LOG_FILE%" 2>&1
  if not errorlevel 1 (
    call :ok "Node.js LTS installe via winget"
    goto :skip_node
  ) else (
    call :warn "winget a echoue, fallback PowerShell..."
  )
)

REM Fallback PowerShell : interroge l'API Node pour la derniere LTS, telecharge
REM le .msi x64 et l'installe en silencieux.
call :info "Telechargement de l'installeur Node LTS (fallback PowerShell)..."
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "try {" ^
  "  [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12;" ^
  "  $idx=Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -UseBasicParsing;" ^
  "  $lts=$idx | Where-Object { $_.lts -ne $false } | Select-Object -First 1;" ^
  "  $msi=$lts.files | Where-Object { $_.arch -eq 'x64' -and $_.platform -eq 'win' -and $_.kind -eq 'msi' } | Select-Object -First 1;" ^
  "  if (-not $msi) { throw 'Aucun MSI x64 trouve pour ' + $lts.version };" ^
  "  $url='https://nodejs.org/dist/' + $lts.version + '/' + $msi.filename;" ^
  "  $dst=Join-Path $env:TEMP $msi.filename;" ^
  "  Write-Host ('URL detectee : ' + $url);" ^
  "  Invoke-WebRequest -Uri $url -OutFile $dst -UseBasicParsing -ErrorAction Stop;" ^
  "  Write-Host ('MSI telecharge : ' + $dst);" ^
  "  Write-Host ('Installation silencieuse en cours (patientez 1-2 min)...');" ^
  "  $p=Start-Process -FilePath 'msiexec.exe' -ArgumentList @('/i', $dst, '/qn', '/norestart', 'ADDLOCAL=ALL') -Wait -PassThru -NoNewWindow;" ^
  "  exit $p.ExitCode" ^
  "}" >> "%LOG_FILE%" 2>&1
if errorlevel 1 (
  call :error "Echec de l'installation de Node.js"
  call :info "Installez manuellement depuis : https://nodejs.org/en/download"
  goto :end_fail
)

REM Rafraichit le PATH (le nouveau noeud n'est visible qu'apres rechargement)
set "PATH=%ProgramFiles%\nodejs;%PATH%"
where node >nul 2>&1
if not errorlevel 1 (
  for /f "delims=" %%v in ('node --version 2^>nul') do call :ok "Node.js installe : %%v"
) else (
  call :warn "Node semble installe mais introuvable dans cette session"
  call :info "Fermez et rouvrez votre terminal, puis relancez install.bat."
)

:skip_node
echo.

REM ============================================================================
REM ETAPE 4 : yt-dlp (nightly obligatoire pour ce projet)
REM ============================================================================
call :section "4) yt-dlp (nightly)"

where yt-dlp >nul 2>&1
if errorlevel 1 goto :ytdlp_not_installed
REM yt-dlp est present : verifier la version
for /f "delims=" %%v in ('yt-dlp --version 2^>nul') do (
  echo %%v | findstr /R "2026\.08" >nul && (
    call :ok "Deja installe (nightly) : %%v"
    goto :skip_ytdlp
  )
  echo %%v | findstr /R "2026\.09" >nul && (
    call :ok "Deja installe (nightly) : %%v"
    goto :skip_ytdlp
  )
  call :warn "yt-dlp installe mais en version stable : %%v"
  call :info "La version 2026.07.04 est CASSEE pour ce projet. Reinstallation nightly..."
)
goto :ytdlp_install_needed
:ytdlp_not_installed
call :info "yt-dlp manquant, installation..."
:ytdlp_install_needed

REM Strategie : winget (qui maintient a jour) puis fallback PowerShell sur la
REM binaire nightly officiel.
if "%HAS_WINGET%"=="1" (
  call :info "Tentative : winget install -e --id yt-dlp.yt-dlp"
  winget install -e --id yt-dlp.yt-dlp --accept-package-agreements --accept-source-agreements >> "%LOG_FILE%" 2>&1
  if not errorlevel 1 (
    call :ok "yt-dlp installe via winget"
    goto :after_ytdlp_install
  ) else (
    call :warn "winget a echoue, fallback PowerShell..."
  )
)

REM Fallback PowerShell : telecharge yt-dlp.exe (nightly) dans %USERPROFILE%\bin
call :info "Telechargement de yt-dlp.exe (nightly)..."
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "try {" ^
  "  $bin=Join-Path $env:USERPROFILE 'bin';" ^
  "  if (-not (Test-Path $bin)) { New-Item -ItemType Directory -Path $bin -Force | Out-Null };" ^
  "  $dst=Join-Path $bin 'yt-dlp.exe';" ^
  "  [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12;" ^
  "  Invoke-WebRequest -Uri 'https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp.exe' -OutFile $dst -UseBasicParsing -ErrorAction Stop;" ^
  "  Write-Host ('yt-dlp.exe telecharge : ' + $dst)" ^
  "} catch { Write-Host ('ERREUR : ' + $_.Exception.Message); exit 1 }" >> "%LOG_FILE%" 2>&1
if errorlevel 1 (
  call :error "Echec du telechargement de yt-dlp"
  call :info "Telechargez manuellement depuis : https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest"
  goto :end_fail
)

REM Ajoute %USERPROFILE%\bin au PATH de la session courante
set "PATH=%USERPROFILE%\bin;%PATH%"

:after_ytdlp_install
where yt-dlp >nul 2>&1
if errorlevel 1 (
  call :error "yt-dlp introuvable apres installation"
  call :info "Verifiez que %USERPROFILE%\bin est dans votre PATH systeme."
  goto :end_fail
)
for /f "delims=" %%v in ('yt-dlp --version 2^>nul') do call :ok "yt-dlp : %%v"

:skip_ytdlp
echo.

REM ============================================================================
REM ETAPE 5 : ffmpeg + ffprobe
REM ============================================================================
call :section "5) ffmpeg + ffprobe (extraction audio)"

where ffmpeg >nul 2>&1
if errorlevel 1 goto :need_install_ffmpeg
for /f "delims=" %%v in ('ffmpeg -version 2^>nul') do call :ok "Deja installe : %%v"
goto :skip_ffmpeg
:need_install_ffmpeg
call :info "ffmpeg manquant, installation..."

if "%HAS_WINGET%"=="1" (
  call :info "Tentative : winget install -e --id Gyan.FFmpeg"
  winget install -e --id Gyan.FFmpeg --accept-package-agreements --accept-source-agreements >> "%LOG_FILE%" 2>&1
  if not errorlevel 1 (
    call :ok "ffmpeg installe via winget"
    goto :skip_ffmpeg
  ) else (
    call :warn "winget a echoue, fallback PowerShell..."
  )
)

REM Fallback PowerShell : telecharge le ZIP essentials de gyan.dev
call :info "Telechargement de ffmpeg (essentials)..."
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "try {" ^
  "  $bin=Join-Path $env:USERPROFILE 'bin';" ^
  "  if (-not (Test-Path $bin)) { New-Item -ItemType Directory -Path $bin -Force | Out-Null };" ^
  "  $tmp=Join-Path $env:TEMP 'ffmpeg-extract';" ^
  "  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force };" ^
  "  New-Item -ItemType Directory -Path $tmp -Force | Out-Null;" ^
  "  $zip=Join-Path $tmp 'ffmpeg.zip';" ^
  "  [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12;" ^
  "  Invoke-WebRequest -Uri 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' -OutFile $zip -UseBasicParsing -ErrorAction Stop;" ^
  "  Expand-Archive -Path $zip -DestinationPath $tmp -Force;" ^
  "  $exe=Get-ChildItem -Path $tmp -Recurse -Filter 'ffmpeg.exe' | Select-Object -First 1;" ^
  "  if (-not $exe) { throw 'ffmpeg.exe introuvable dans le zip' };" ^
  "  Copy-Item $exe.FullName (Join-Path $bin 'ffmpeg.exe') -Force;" ^
  "  $exe2=Get-ChildItem -Path $tmp -Recurse -Filter 'ffprobe.exe' | Select-Object -First 1;" ^
  "  if ($exe2) { Copy-Item $exe2.FullName (Join-Path $bin 'ffprobe.exe') -Force };" ^
  "  Write-Host 'ffmpeg + ffprobe copies dans ' + $bin" ^
  "} catch { Write-Host ('ERREUR : ' + $_.Exception.Message); exit 1 }" >> "%LOG_FILE%" 2>&1
if errorlevel 1 (
  call :error "Echec de l'installation de ffmpeg"
  call :info "Telechargez manuellement depuis : https://www.gyan.dev/ffmpeg/builds/"
  goto :end_fail
)

set "PATH=%USERPROFILE%\bin;%PATH%"
where ffmpeg >nul 2>&1
if not errorlevel 1 (
  for /f "delims=" %%v in ('ffmpeg -version 2^>nul') do call :ok "ffmpeg : %%v"
) else (
  call :warn "ffmpeg semble installe mais introuvable dans cette session"
)

:skip_ffmpeg
echo.

REM ============================================================================
REM ETAPE 6 : Dependances Node du projet (npm install)
REM ============================================================================
call :section "6) Dependances Node du projet (npm install)"

cd /d "%PROJECT_DIR%"
if exist node_modules (
  call :ok "node_modules deja present (skip npm install)"
  call :info "Si vous voulez forcer la reinstallation : rmdir /s /q node_modules"
) else (
  call :info "Lancement de npm install (peut prendre 1-2 min)..."
  call npm install
  if errorlevel 1 (
    call :error "npm install a echoue. Verifiez votre connexion et les logs ci-dessus."
    goto :end_fail
  )
  call :ok "Dependances npm installees"
)
echo.

REM ============================================================================
REM ETAPE 7 : Verification finale (preflight)
REM ============================================================================
call :section "7) Verification finale"

call :log "=== Preflight final ==="
echo.
echo Outils systeme :
for /f "delims=" %%v in ('git --version 2^>nul')       do echo   git      : %%v
for /f "delims=" %%v in ('node --version 2^>nul')      do echo   node     : %%v
for /f "delims=" %%v in ('npm --version 2^>nul')       do echo   npm      : %%v
for /f "delims=" %%v in ('yt-dlp --version 2^>nul')    do echo   yt-dlp   : %%v
for /f "delims=" %%v in ('ffmpeg -version 2^>nul')     do echo   ffmpeg   : %%v
for /f "delims=" %%v in ('ffprobe -version 2^>nul')    do echo   ffprobe  : %%v
echo.
echo Projet :
if exist "%PROJECT_DIR%node_modules\express" (
  call :ok "express installe"
) else (
  call :warn "express introuvable dans node_modules"
)
echo.

REM ============================================================================
REM Fin
REM ============================================================================
call :section "Installation terminee"
echo.
echo  Tout est en place. Pour lancer l'application :
echo.
echo    start.bat
echo.
echo  OU directement :
echo.
echo    npm start
echo.
echo  Puis ouvrez http://127.0.0.1:5400 dans votre navigateur.
echo.
echo  Notes :
echo    - Si certaines commandes ci-dessus (git/node/yt-dlp) ne sont pas
echo      reconnues apres l'installation, FERMEZ et ROUVREZ votre terminal :
echo      les variables PATH ne se propagent qu'au prochain login shell.
echo    - Un journal detaille a ete ecrit dans : %LOG_FILE%
echo.
goto :end_ok

:end_fail
echo.
echo  *** ECHEC DE L'INSTALLATION ***
echo  Consultez le journal pour les details : %LOG_FILE%
echo.
endlocal & exit /b 1

:end_ok
endlocal
exit /b 0


REM ============================================================================
REM Fonctions d'affichage
REM ============================================================================
:log
echo [%DATE% %TIME%] %~1 >> "%LOG_FILE%"
goto :eof

:section
echo.
echo  --- %~1 ---
echo.
goto :eof

:ok
echo   [OK] %~1
goto :eof

:info
echo   [..] %~1
goto :eof

:warn
echo   [!]  %~1
goto :eof

:error
echo   [X]  %~1
goto :eof
