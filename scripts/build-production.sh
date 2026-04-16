#!/bin/bash
set -e

rm -rf /home/runner/.local/share/solana /home/runner/.cache /home/runner/.cargo
rm -rf contract/target contract/node_modules

cd frontend
npm install
npm run build
cd ..

rm -rf frontend/node_modules frontend/src frontend/public tests src dist keys attached_assets
