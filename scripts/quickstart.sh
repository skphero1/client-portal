#!/usr/bin/env bash
set -euo pipefail

echo "==> [1/5] Ensuring .env exists..."
if [ ! -f .env ]; then
  cp .env.example .env
  echo "    Created .env from .env.example"
fi

echo "==> [2/5] Starting PostgreSQL via Docker Compose..."
docker compose up -d --wait

echo "==> [3/5] Generating Prisma client & applying migrations to dev and test DBs..."
npx prisma generate
npx prisma migrate deploy
npx dotenv -e .env.test -- prisma migrate deploy

echo "==> [4/5] Seeding memorable agency demo data..."
npm run db:seed

echo "==> [5/5] Starting Sysfortech Client Portal on http://localhost:3000 ..."
exec npm run dev
