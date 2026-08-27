import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const PRIMARY_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/razorpay_recon_ai';
const LOCAL_FALLBACK_URI = 'mongodb://127.0.0.1:27017/razorpay_recon_ai';

let isConnected = false;
let supportsTransactions = false;

export async function connectDB() {
  if (isConnected && mongoose.connection.readyState === 1) return mongoose.connection;

  // Try primary URI
  try {
    const conn = await mongoose.connect(PRIMARY_URI, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      maxPoolSize: 20,
      autoIndex: true,
    });

    isConnected = true;
    console.log(`[Database] Connected to MongoDB at ${conn.connection.host}:${conn.connection.port}/${conn.connection.name}`);

    // Check if replica set
    try {
      const adminDb = conn.connection.db.admin();
      const status = await adminDb.command({ replSetGetStatus: 1 }).catch(() => null);
      supportsTransactions = Boolean(status && status.ok);
    } catch {
      supportsTransactions = false;
    }

    console.log(`[Database] ACID Multi-Doc Transactions: ${supportsTransactions ? 'ReplicaSet Active (Full Session Rollback)' : 'Standalone Mode (Atomic Document Updates)'}`);
    return conn.connection;
  } catch (primaryErr) {
    console.warn(`[Database Warning] Primary connection failed (${primaryErr.message}). Failing over to resilient Local MongoDB instance...`);

    try {
      const fallbackConn = await mongoose.connect(LOCAL_FALLBACK_URI, {
        serverSelectionTimeoutMS: 3000,
        autoIndex: true,
      });

      isConnected = true;
      supportsTransactions = false;
      console.log(`[Database] Successfully connected to Local Fallback MongoDB at 127.0.0.1:27017/razorpay_recon_ai`);
      return fallbackConn.connection;
    } catch (fallbackErr) {
      console.error(`[Database Critical Error] Failed to connect to both Primary and Local MongoDB:`, fallbackErr.message);
      throw fallbackErr;
    }
  }
}

/**
 * Executes operations inside an ACID transaction if supported,
 * otherwise runs them atomically with error recovery.
 */
export async function withTransaction(operationCallback) {
  if (supportsTransactions) {
    const session = await mongoose.startSession();
    try {
      let result;
      await session.withTransaction(async () => {
        result = await operationCallback(session);
      });
      return result;
    } catch (err) {
      throw err;
    } finally {
      await session.endSession();
    }
  } else {
    // Standalone fallback: execute directly without session wrapper
    return await operationCallback(null);
  }
}

export function isTransactionSupported() {
  return supportsTransactions;
}
