@echo off
echo ================================================================================
echo ?? RAZORPAY RECON AI ? 1-CLICK AUTOMATED SETUP & VERIFICATION
echo ================================================================================

echo ?? [1/4] Installing dependencies...
call npm install
call npm install --prefix backend
call npm install --prefix frontend

echo ?? [2/4] Running test suite...
call npm test

echo ?? [3/4] Seeding fresh database state...
call npm run seed

echo ?? [4/4] Starting backend and frontend...
echo System is starting at http://localhost:5173 (Frontend) and http://localhost:5000 (Backend API)
start "Recon AI Backend" cmd /k "npm run dev:backend"
start "Recon AI Frontend" cmd /k "npm run dev:frontend"

echo ? Setup complete!
