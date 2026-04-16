#!/bin/bash
set -e

cd /home/runner/workspace/frontend && npm install --no-fund --no-audit 2>&1 || true
cd /home/runner/workspace && npm install --no-fund --no-audit 2>&1 || true
