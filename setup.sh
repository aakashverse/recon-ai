#!/bin/bash
set -e

echo "================================================================================"
echo "🚀 RAZORPAY RECON AI — 1-CLICK AUTOMATED SETUP & VERIFICATION"
echo "================================================================================"

echo "📦 [1/4] Installing dependencies..."
npm install
npm install --prefix backend
npm install --prefix frontend

echo "🧪 [2/4] Running test suite..."
npm test

echo "🔄 [3/4] Seeding fresh database state..."
npm run seed

echo "🚀 [4/4] Starting servers..."
echo "System will be available at http://localhost:5173"
npm run dev:backend &
npm run dev:frontend
