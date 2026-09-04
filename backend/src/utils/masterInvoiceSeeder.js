import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Invoice } from '../models/Invoice.js';
import { RuleCache } from '../models/RuleCache.js';
import { SAMPLE_INVOICES, SAMPLE_RULES } from '../../scripts/seed-data.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const kaggleJsonPath = path.resolve(__dirname, '../../../datasets/kaggle-reconciliation-100.json');

let cachedKaggleInvoices = null;
function getKaggleInvoices() {
  if (cachedKaggleInvoices) return cachedKaggleInvoices;
  try {
    if (fs.existsSync(kaggleJsonPath)) {
      const data = JSON.parse(fs.readFileSync(kaggleJsonPath, 'utf8'));
      cachedKaggleInvoices = Array.isArray(data.invoices) ? data.invoices : [];
    } else {
      cachedKaggleInvoices = [];
    }
  } catch (err) {
    console.warn('[MasterSeeder] Warning reading Kaggle invoices:', err.message);
    cachedKaggleInvoices = [];
  }
  return cachedKaggleInvoices;
}

/**
 * Seeds or re-seeds foundational B2B invoices and historical rules
 */
export async function seedMasterInvoices() {
  const kaggleInvoices = getKaggleInvoices();
  const allMasterInvoices = [...SAMPLE_INVOICES, ...kaggleInvoices];

  const invoiceBulkOps = allMasterInvoices.map((inv) => ({
    updateOne: {
      filter: { invoiceNumber: inv.invoiceNumber },
      update: {
        $set: {
          ...inv,
          status: 'UNPAID',
          paidAmount: 0,
          reconciledBankTxnId: null,
          reconciledAt: null,
          reconMethod: null,
        },
      },
      upsert: true,
    },
  }));

  if (invoiceBulkOps.length > 0) {
    await Invoice.bulkWrite(invoiceBulkOps, { ordered: false }).catch((err) => {
      console.warn('[MasterSeeder] Invoice bulk write notice:', err.message);
    });
  }

  // Upsert sample vendor rules
  const ruleBulkOps = SAMPLE_RULES.map((r) => ({
    updateOne: {
      filter: { ruleId: r.ruleId || `${r.partyIdentifier}_DEFAULT` },
      update: { $set: r },
      upsert: true,
    },
  }));

  if (ruleBulkOps.length > 0) {
    await RuleCache.bulkWrite(ruleBulkOps, { ordered: false }).catch((err) => {
      console.warn('[MasterSeeder] RuleCache bulk write notice:', err.message);
    });
  }

  console.log(`[MasterSeeder] Ensured ${allMasterInvoices.length} ground-truth invoices and ${SAMPLE_RULES.length} rules are seeded as UNPAID.`);
}

/**
 * Self-healing guard: Ensures any invoices referenced in a bank feed are present in MongoDB
 */
export async function ensureInvoicesForTransactions(transactions = []) {
  if (!Array.isArray(transactions) || transactions.length === 0) return;

  const invoiceRegex = /\b((?:INV|INVOICE)[-_]?[0-9]{4}[-_]?[0-9]+|(?:INV|INVOICE)[-_]?[A-Z0-9]+[-_][0-9]+|(?:INV|INVOICE)[-_]?[0-9]+)\b|\b(INV\/[0-9]{4}\/[0-9]+)\b/gi;
  const referencedInvoices = new Set();

  for (const t of transactions) {
    const narration = (t.narration || '').replace(/\b1NV\b/gi, 'INV').replace(/\b1NVOICE\b/gi, 'INVOICE');
    const matches = narration.matchAll(invoiceRegex);
    for (const match of matches) {
      const raw = (match[1] || match[2] || match[0]).toUpperCase();
      const norm = raw.startsWith('INVOICE') ? raw.replace(/^INVOICE/i, 'INV') : raw;
      referencedInvoices.add(norm);
      referencedInvoices.add(raw);
    }
  }

  if (referencedInvoices.size === 0) return;

  const refArray = Array.from(referencedInvoices);
  const existingDocs = await Invoice.find({ invoiceNumber: { $in: refArray } }, 'invoiceNumber').lean();
  const existingSet = new Set(existingDocs.map((i) => i.invoiceNumber.toUpperCase()));

  const missing = refArray.filter((num) => !existingSet.has(num.toUpperCase()));
  if (missing.length === 0) return;

  // Search in SAMPLE_INVOICES and Kaggle dataset
  const kaggleInvoices = getKaggleInvoices();
  const allMaster = [...SAMPLE_INVOICES, ...kaggleInvoices];
  const missingToInsert = [];

  for (const num of missing) {
    const cleanNum = num.replace(/[^A-Z0-9]/g, '');
    const found = allMaster.find((inv) => {
      const invClean = inv.invoiceNumber.toUpperCase().replace(/[^A-Z0-9]/g, '');
      return inv.invoiceNumber.toUpperCase() === num.toUpperCase() || invClean === cleanNum;
    });

    if (found && !missingToInsert.some((i) => i.invoiceNumber === found.invoiceNumber)) {
      missingToInsert.push({
        ...found,
        status: 'UNPAID',
        paidAmount: 0,
        reconciledBankTxnId: null,
        reconciledAt: null,
        reconMethod: null,
      });
    }
  }

  if (missingToInsert.length > 0) {
    const ops = missingToInsert.map((inv) => ({
      updateOne: {
        filter: { invoiceNumber: inv.invoiceNumber },
        update: { $set: inv },
        upsert: true,
      },
    }));
    await Invoice.bulkWrite(ops, { ordered: false });
    console.log(`[MasterSeeder] Auto-seeded ${missingToInsert.length} referenced open invoices into MongoDB.`);
  }
}
