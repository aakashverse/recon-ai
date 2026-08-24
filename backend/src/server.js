import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { connectDB } from './config/db.js';
import { reconRouter } from './routes/reconRoutes.js';
import { ruleRouter } from './routes/ruleRoutes.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('dev'));

// API Routes
app.use('/api/reconciliation', reconRouter);
app.use('/api/rules', ruleRouter);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'HEALTHY',
    service: 'Razorpay B2B Recon AI Engine',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[Unhandled Server Error]:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message,
  });
});

async function startServer() {
  try {
    await connectDB();
    const server = app.listen(PORT | 8080, () => {
      console.log(`\n===============================================================`);
      console.log(`🚀 Razorpay B2B AI Finance Controller Backend running on port ${PORT}`);
      console.log(`📡 SSE Stream: http://localhost:${PORT}/api/reconciliation/stream`);
      console.log(`📊 Health:     http://localhost:${PORT}/api/health`);
      console.log(`===============================================================\n`);
    });

    const shutdown = () => {
      console.log('Shutting down gracefully...');
      server.close(() => {
        process.exit(0);
      });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    console.error('Fatal initialization error:', error);
    process.exit(1);
  }
}

startServer();
