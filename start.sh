#!/usr/bin/env bash
# Lance le serveur local (backend Node/Express d'extraction yt-dlp) sur le port
# déclaré, et ouvre l'app dans le navigateur par défaut. Ctrl+C pour arrêter.
#
# Ce serveur sert le frontend en statique ET l'API d'extraction locale
# (/api/streams/:id → yt-dlp) qui contourne le blocage anti-bot des instances
# Piped publiques. App + API sont same-origin → le Web Audio DSP fonctionne.
set -e

# Se place dans le dossier du projet (celui qui contient ce script).
cd "$(dirname "$0")"

PORT="${PORT:-5400}"
URL="http://localhost:${PORT}"

# 1) Dépendances : installe express si node_modules est absent.
if [ ! -d node_modules ]; then
  echo "Installation des dépendances (npm install)…"
  if ! command -v npm >/dev/null 2>&1; then
    echo "npm introuvable. Installez Node.js 18+ : https://nodejs.org/" >&2
    exit 1
  fi
  npm install
fi

# 2) Vérifie yt-dlp : sans lui, l'extraction locale est inactive et l'app
#    bascule sur Piped/IFrame. Avertissement non bloquant.
if ! command -v yt-dlp >/dev/null 2>&1; then
  echo "⚠ yt-dlp introuvable — l'extraction locale sera inactive." >&2
  echo "  Installez-le : https://github.com/yt-dlp/yt-dlp#installation" >&2
  echo "  (L'app basculera sur Piped/IFrame en attendant.)" >&2
fi

# 3) Démarre le serveur Express en arrière-plan.
export PORT
node server/server.js &
SERVER_PID=$!

# Nettoie le serveur à la sortie (Ctrl+C).
trap 'kill $SERVER_PID 2>/dev/null; exit 0' INT TERM

# 4) Gère l'ouverture du navigateur selon le paramètre --open-app et par défaut.
auto_open="${1:-prompt}"  # Par défaut, demander à l'utilisateur (si pas de paramètre)

# Normalise la valeur pour accepter yes/yes/no/Y/N/etc.
case "$(echo "$auto_open" | tr '[:upper:]' '[:lower:]' | xargs)" in
  yes|y) auto_open="yes" ;;
  no|n)  auto_open="no" ;;
  *)     auto_open="prompt" ;;  # Cas avec d'autres valeurs → on demande
esac

if [[ "$auto_open" == "yes" ]]; then
  # Ouverture automatique demandée
  if command -v open >/dev/null 2>&1; then
    open "$URL"          # macOS
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL"      # Linux
  elif command -v wslview >/dev/null 2>&1; then
    wslview "$URL"       # WSL
  else
    echo "Ouvrez manuellement : ${URL}"
  fi
elif [[ "$auto_open" == "no" ]]; then
  # Ouverture automatique désactivée (pas de navigateur ouvert)
  echo "Le serveur est démarré sur ${URL}. Ouvrez-le manuellement." 
else
  # Prompt demandé à l'utilisateur
  echo "Voulez-vous ouvrir l'application dans le navigateur ?" >&2
  read -p "Entrez (y/n) pour oui/non : " confirm
  case "$(echo "$confirm" | tr '[:upper:]' '[:lower:]' | xargs)" in
    y|yes) 
      if command -v open >/dev/null 2>&1; then
        open "$URL"          # macOS
      elif command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$URL"      # Linux
      elif command -v wslview >/dev/null 2>&1; then
        wslview "$URL"       # WSL
      else
        echo "Aucun navigateur par défaut détecté. Ouvrez manuellement : ${URL}"
      fi
      ;;
    n|no) ;;  # Rien à faire, on ne lance pas le navigateur
    *)   echo "Réponse invalide. Laissez le serveur tourner sans ouvrir le navigateur." ;;
  esac
fi

echo "Serveur démarré sur ${URL} (PID ${SERVER_PID}). Ctrl+C pour arrêter."
wait $SERVER_PID
