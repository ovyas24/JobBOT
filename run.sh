#!/usr/bin/env bash
# ─────────────────────────────────────────────────────
#  run.sh  ·  job-hunter-japan
#  Quick launcher — installs deps if needed, then runs
# ─────────────────────────────────────────────────────

set -e

# Colours
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo ""
echo -e "${GREEN}🤖  job-hunter-japan${NC}"
echo "────────────────────"

# Check Node.js
if ! command -v node &>/dev/null; then
  echo -e "${RED}❌  Node.js not found. Install it from https://nodejs.org${NC}"
  exit 1
fi

# Check .env
if [ ! -f ".env" ]; then
  if [ -f ".env.example" ]; then
    echo -e "${YELLOW}⚠️   .env not found — copying .env.example${NC}"
    cp .env.example .env
    echo -e "${YELLOW}    ➜  Open .env and add your ANTHROPIC_API_KEY, then re-run.${NC}"
    exit 1
  else
    echo -e "${RED}❌  .env.example missing. Re-clone the repo.${NC}"
    exit 1
  fi
fi

# Install dependencies if node_modules is absent
if [ ! -d "node_modules" ]; then
  echo -e "${YELLOW}📦  node_modules not found — running npm install...${NC}"
  npm install
fi

echo -e "${GREEN}🚀  Starting job hunt...${NC}"
echo ""
node src/index.js
