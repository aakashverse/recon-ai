import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { connectDB } from './config/db.js';
import { reconRouter } from './routes/reconRoutes.js';
import { ruleRouter } from './routes/ruleRoutes.js';

import { errorHandler, notFoundHandler } from './middleware/index.js';

dotenv.config();

// Process-level unhandled exception and rejection traps to prevent silent crashes
process.on('uncaughtException', (err) => {
  console.error('[FATAL: Uncaught Exception]:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL: Unhandled Promise Rejection]:', reason);
});

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
    memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  });
});

// 404 handler for undefined routes
app.use(notFoundHandler);

// Centralized JSON error handling middleware
app.use(errorHandler);

async function startServer() {
  try {
    await connectDB();
    const server = app.listen(PORT, () => {
      console.log(`\n===============================================================`);
      console.log(`🚀 Razorpay B2B AI Finance Controller Backend running on port ${PORT}`);
      console.log(`📡 SSE Stream: http://localhost:${PORT}/api/reconciliation/stream`);
      console.log(`📊 Health:     http://localhost:${PORT}/api/health`);
      console.log(`===============================================================\n`);
    });

    const shutdown = async () => {
      console.log('Shutting down gracefully...');
      server.close(async () => {
        try {
          const mongoose = await import('mongoose');
          await mongoose.default.connection.close(false);
          console.log('MongoDB connection closed cleanly.');
        } catch (e) {
          console.warn('Error closing MongoDB connection:', e.message);
        }
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
