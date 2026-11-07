#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo '❌ Node.js غير مثبت.'
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "❌ Node.js 20+ مطلوب. الموجود: $(node -v)"
  echo 'في Pterodactyl غيّر Docker Image إلى Node.js 20 أو 22.'
  exit 1
fi

if [ ! -d node_modules ] || [ ! -f node_modules/@whiskeysockets/baileys/package.json ] || [ ! -f node_modules/@hapi/boom/package.json ] || [ ! -f node_modules/pino/package.json ]; then
  echo '📦 node_modules غير مكتملة؛ تثبيت الاعتمادات...'
  if [ -f package-lock.json ]; then
    npm ci --omit=dev --no-audit --no-fund
  else
    npm install --omit=dev --no-audit --no-fund
  fi
fi

mkdir -p data/archives session
exec npm start
