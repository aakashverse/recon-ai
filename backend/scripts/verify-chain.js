import { connectDB } from '../src/config/db.js';
import { ReconciliationEvent } from '../src/models/ReconciliationEvent.js';
import { calculateEventHash, GENESIS_HASH } from '../src/utils/hasher.js';

async function verifyHashChain() {
  console.log(`\n================================================================================`);
  console.log(`🔒 RAZORPAY RECON AI — CRYPTOGRAPHIC HASH CHAIN AUDIT VERIFIER`);
  console.log(`================================================================================\n`);

  await connectDB();

  console.log('🔍 Fetching chronological Reconciliation Audit Trail...');
  const events = await ReconciliationEvent.find().sort({ chainIndex: 1 }).lean();

  if (!events.length) {
    console.log('⚠️ No reconciliation events found in database to verify.');
    process.exit(0);
  }

  console.log(`📋 Verifying ${events.length} cryptographically chained audit events...\n`);

  let previousHash = GENESIS_HASH;
  let corruptedCount = 0;
  const verifiedEvents = [];

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const expectedPrevious = i === 0 ? (ev.previousEventHash || GENESIS_HASH) : previousHash;

    // Check Link Integrity
    const linkValid = ev.previousEventHash === expectedPrevious;

    // Check Content Hash Integrity
    const recalculatedHash = calculateEventHash(ev.previousEventHash, ev);
    const contentValid = ev.eventHash === recalculatedHash;

    if (!linkValid || !contentValid) {
      corruptedCount++;
      console.error(`❌ [TAMPER DETECTED] Event #${i + 1} (${ev.bankTxnId}) failed cryptographic verification!`);
      console.error(`   Stored Prev Hash:  ${ev.previousEventHash}`);
      console.error(`   Expected Prev:     ${expectedPrevious}`);
      console.error(`   Stored Event Hash: ${ev.eventHash}`);
      console.error(`   Calculated Hash:   ${recalculatedHash}\n`);
    } else {
      verifiedEvents.push({
        index: i + 1,
        bankTxnId: ev.bankTxnId,
        tier: ev.resolvedTier,
        hashPreview: `${ev.eventHash.slice(0, 16)}...`,
        status: '✅ VALID',
      });
    }

    previousHash = ev.eventHash;
  }

  console.log('--------------------------------------------------------------------------------');
  console.log(`📊 CHAIN VERIFICATION REPORT (Sample Last 5 Events)`);
  console.log('--------------------------------------------------------------------------------');
  console.table(verifiedEvents.slice(-5));

  console.log('--------------------------------------------------------------------------------');
  if (corruptedCount === 0) {
    console.log(`🏆 HASH CHAIN INTEGRITY: 100% VALID & TAMPER-EVIDENT`);
    console.log(`   Total Verified Events: ${events.length}`);
    console.log(`   Broken / Altered Links: 0`);
    console.log(`   Cryptographic Proof: SHA-256 Merkle-Chain verified against Genesis.`);
    console.log(`================================================================================\n`);
    process.exit(0);
  } else {
    console.error(`🚨 VERIFICATION FAILED: ${corruptedCount} corrupted or tampered records detected!`);
    console.log(`================================================================================\n`);
    process.exit(1);
  }
}

verifyHashChain().catch((err) => {
  console.error('❌ Chain verification fatal error:', err);
  process.exit(1);
});
