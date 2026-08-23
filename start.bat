@echo off
echo ===================================================================
echo   Starting Razorpay B2B AI Finance Controller
echo ===================================================================

echo [1/2] Launching Backend on Port 5000...
start cmd /k "cd backend && npm run dev"

echo [2/2] Launching Frontend on Port 5173...
start cmd /k "cd frontend && npm run dev"

echo Done! Open http://localhost:5173 in your browser.
pause
