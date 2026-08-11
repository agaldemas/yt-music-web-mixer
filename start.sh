#!/usr/bin/env bash
# Lance un serveur statique local sur le port 8000 et ouvre l'app
# dans le navigateur par défaut. Ctrl+C pour arrêter.
set -e

PORT=8000
URL="http://localhost:${PORT}"

# Démarre le serveur en arrière-plan (préfére python3, fallback python).
if command -v python3 >/dev/null 2>&1; then
  python3 -m http.server "$PORT" &
elif command -v python >/dev/null 2>&1; then
  python -m http.server "$PORT" &
else
  echo "Python introuvable. Installez Python 3 ou lancez manuellement : npx serve -p ${PORT}" >&2
  exit 1
fi
SERVER_PID=$!

# Nettoie le serveur à la sortie (Ctrl+C).
trap 'kill $SERVER_PID 2>/dev/null; exit 0' INT TERM

# Ouvre le navigateur par défaut selon l'OS.
if command -v open >/dev/null 2>&1; then
  open "$URL"          # macOS
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL"      # Linux
elif command -v wslview >/dev/null 2>&1; then
  wslview "$URL"       # WSL
else
  echo "Ouvrez manuellement : ${URL}"
fi

echo "Serveur démarré sur ${URL} (PID ${SERVER_PID}). Ctrl+C pour arrêter."
wait $SERVER_PID
