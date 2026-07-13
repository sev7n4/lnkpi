#!/bin/sh
set -eu
cd /app/apps/server
mkdir -p data uploads
export DATABASE_URL="${DATABASE_URL:-file:/app/apps/server/data/lnkpi.db}"

if [ -f ./node_modules/.bin/prisma ]; then
  ./node_modules/.bin/prisma db push --skip-generate || ./node_modules/.bin/prisma db push
elif [ -f /app/node_modules/.bin/prisma ]; then
  /app/node_modules/.bin/prisma db push --skip-generate || /app/node_modules/.bin/prisma db push
else
  echo "WARN: prisma CLI not found, skipping db push"
fi

exec node dist/main.js
