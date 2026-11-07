#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

say() { printf '%s\n' "$1"; }
say '⎋ STEAM V2 • SETUP'
say '━━━━━━━━━━━━━━━━━━━━'

# Termux: install packages through pkg. Pterodactyl/Linux: use the image's packages.
if command -v pkg >/dev/null 2>&1; then
  say '📦 تحديث مستودعات Termux...'
  pkg update -y
  say '🧰 تثبيت الأدوات الأساسية...'
  pkg install -y nodejs-lts python ffmpeg zip unzip git
else
  say 'ℹ️ Linux/Pterodactyl: لن يتم استخدام pkg.'
fi

command -v node >/dev/null 2>&1 || { say '❌ Node.js غير مثبت.'; exit 1; }
command -v npm >/dev/null 2>&1 || { say '❌ npm غير مثبت.'; exit 1; }
command -v python >/dev/null 2>&1 || { say '❌ Python غير مثبت.'; exit 1; }
command -v ffmpeg >/dev/null 2>&1 || { say '⚠️ FFmpeg غير مثبت؛ وظائف الوسائط ستتأثر.'; }

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "$NODE_MAJOR" -lt 20 ]; then
  say "❌ STEAM يحتاج Node.js 20 أو أحدث. الموجود: $(node -v)"
  say 'في Pterodactyl اختر Docker Image / Egg مبنيًا على Node.js 20 أو 22.'
  exit 1
fi

say '🐍 تثبيت yt-dlp...'
if ! command -v yt-dlp >/dev/null 2>&1; then
  python -m pip install -U yt-dlp --break-system-packages 2>/dev/null || \
  python -m pip install -U yt-dlp 2>/dev/null || \
  pip install -U yt-dlp --break-system-packages 2>/dev/null || \
  pip install -U yt-dlp
fi
command -v yt-dlp >/dev/null 2>&1 || say '⚠️ تعذر تثبيت yt-dlp؛ وظائف الصوت ستتأثر.'

say '📦 تثبيت مكتبات JavaScript...'
if [ -f package-lock.json ]; then
  npm ci --omit=dev --no-audit --no-fund
else
  npm install --omit=dev --no-audit --no-fund
fi

mkdir -p data/archives session

say '🧪 فحص ملفات JavaScript...'
find commands console services security database heart whatsapp scripts -type f -name '*.js' -o -name '*.mjs' 2>/dev/null | while IFS= read -r file; do
  node --check "$file" >/dev/null
done

say '━━━━━━━━━━━━━━━━━━━━'
say '✅ اكتمل التثبيت.'
say '▶️ لتشغيل البوت: ./start.sh أو npm start'
