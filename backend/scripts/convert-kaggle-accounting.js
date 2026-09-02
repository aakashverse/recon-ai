import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATASETS_DIR = path.resolve(__dirname, '../../datasets');
const FRONTEND_DATA_DIR = path.resolve(__dirname, '../../frontend/src/data');

const inputCsvPath = path.join(DATASETS_DIR, 'kaggle-accounting-financial-management.csv');
if (!fs.existsSync(inputCsvPath)) {
  console.error(`Input file not found: ${inputCsvPath}`);
  process.exit(1);
}

const csvRaw = fs.readFileSync(inputCsvPath, 'utf8').trim().split('\n');
const header = csvRaw[0].split(',').map((h) => h.trim());
const lines = csvRaw.slice(1);

const vendors = [
  'Tata Consultancy Services',
  'Infosys BPM Ltd',
  'Reliance Retail Ltd',
  'Bharti Airtel Enterprise',
  'HCL Technologies Pvt Ltd',
  'Larsen & Toubro Infotech',
  'Swiggy Bundl Technologies',
  'Zomato Media Logistics',
  'Razorpay Software Pvt Ltd',
  'Flipkart India Internet'
];

const banks = ['AXIS', 'HDFC', 'ICICI', 'SBI', 'KOTAK', 'INDUSIND'];

const invoices = [];
const bankFeed = [];

// Convert each Kaggle accounting row into paired ERP Invoice and Bank Settlement
lines.forEach((line, idx) => {
  const cols = line.split(',');
  const kaggleTxnId = cols[0];
  const date = cols[1];
  const acctType = cols[2];
  const rawAmt = Number(cols[3]) || 50000;
  const outcome = Number(cols[17]) === 1;

  const invNum = `INV-KAG-${String(idx + 1).padStart(4, '0')}`;
  const vendor = vendors[idx % vendors.length];
  const bank = banks[idx % banks.length];
  const utr = `${bank}N${String(Date.now() + idx).slice(-8)}${String(idx).padStart(4, '0')}`;

  // Indian B2B statutory classification based on business type
  let tdsSection = 'NONE';
  let tdsRate = 0;
  let deductionType = 'NONE';
  let baseOrGross = 'GROSS';

  if (idx % 5 === 0) {
    tdsSection = '194C';
    tdsRate = 2.0;
    deductionType = 'TDS_194C';
  } else if (idx % 5 === 1) {
    tdsSection = '194J';
    tdsRate = 10.0;
    deductionType = 'TDS_194J';
  } else if (idx % 5 === 2) {
    tdsSection = '194H';
    tdsRate = 5.0;
    deductionType = 'TDS_194H';
  } else if (idx % 5 === 3) {
    tdsSection = '194J_CBDT_23';
    tdsRate = 10.0;
    deductionType = 'TDS_CBDT_23';
    baseOrGross = 'BASE';
  } else {
    tdsSection = 'NONE';
    tdsRate = 0;
    deductionType = 'NONE';
  }

  // Invoice amounts (18% GST)
  const totalAmount = rawAmt;
  const baseAmount = Number((totalAmount / 1.18).toFixed(2));
  const taxAmount = Number((totalAmount - baseAmount).toFixed(2));

  // Calculate Net Bank Received Amount
  let deductionAmount = 0;
  if (tdsRate > 0) {
    if (baseOrGross === 'BASE') {
      deductionAmount = Number((baseAmount * (tdsRate / 100)).toFixed(2));
    } else {
      deductionAmount = Number((totalAmount * (tdsRate / 100)).toFixed(2));
    }
  }

  let bankReceived = Number((totalAmount - deductionAmount).toFixed(2));

  // Build authentic Indian banking narration
  let narration = '';
  const sanitizedVendor = vendor.toUpperCase().replace(/[^A-Z0-9]+/g, '-');

  if (tdsRate > 0) {
    narration = `NEFT/${bank}/${sanitizedVendor}/${invNum}/LESS-${tdsRate}PCT-TDS/UTR-${utr}`;
  } else if (idx % 7 === 0) {
    // Payment Gateway Wire Fee Deduction edge case
    const wireFee = 250;
    deductionAmount = wireFee;
    bankReceived = totalAmount - wireFee;
    narration = `SETTL/${bank}/WIRE-FEE-NETTED/${sanitizedVendor}/${invNum}/${utr}`;
  } else {
    // Exact gross payment
    narration = `RTGS/${bank}/${sanitizedVendor}/${invNum}/FULL-PAYMENT/${utr}`;
  }

  // Dirty OCR / Adversarial edge cases for testing Tier 3
  if (idx === 15) {
    narration = narration.replace('INV', '1NV').replace('202', '2O2'); // OCR typo
  } else if (idx === 25) {
    narration = `CMS-PAYMENT-REMITTANCE-${sanitizedVendor}-SETTLEMENT-AGAINST-${invNum}-NET-OF-TDS`;
  }

  invoices.push({
    invoiceNumber: invNum,
    customerName: vendor,
    totalAmount,
    baseAmount,
    taxAmount,
    tdsSection: tdsSection.replace('_CBDT_23', ''),
    tdsRate,
    issueDate: date,
    dueDate: date,
    status: 'UNPAID',
    sourceKaggleTxnId: kaggleTxnId,
  });

  bankFeed.push({
    id: `BNK-KAG-${String(idx + 1).padStart(4, '0')}`,
    date,
    amount: bankReceived,
    narration,
    utr,
    sourceKaggleTxnId: kaggleTxnId,
    expectedInvoiceId: invNum,
    expectedDeductionType: deductionType,
    expectedDeductionAmount: deductionAmount,
  });
});

// 1. Save Invoices CSV
const invoiceCsvHeader = 'Invoice Number,Customer Name,Total Amount,Base Amount,Tax Amount,TDS Section,TDS Rate,Issue Date,Status';
const invoiceCsvRows = invoices.map((inv) =>
  `${inv.invoiceNumber},"${inv.customerName}",${inv.totalAmount},${inv.baseAmount},${inv.taxAmount},${inv.tdsSection},${inv.tdsRate},${inv.issueDate},${inv.status}`
);
fs.writeFileSync(path.join(DATASETS_DIR, 'kaggle-reconciliation-invoices.csv'), [invoiceCsvHeader, ...invoiceCsvRows].join('\n'), 'utf8');

// 2. Save Bank Feed CSV
const bankCsvHeader = 'Date,Narration,Credit,UTR';
const bankCsvRows = bankFeed.map((b) => `${b.date},"${b.narration}",${b.amount},${b.utr}`);
fs.writeFileSync(path.join(DATASETS_DIR, 'kaggle-reconciliation-bank-feed.csv'), [bankCsvHeader, ...bankCsvRows].join('\n'), 'utf8');

// 3. Save Combined JSON for direct Recon AI Benchmark ingestion
const combinedData = {
  name: 'Kaggle Accounting Data for Financial Management Benchmark',
  source: 'https://www.kaggle.com/datasets/ziya07/accounting-data-for-financial-management',
  recordCount: invoices.length,
  invoices,
  bankTransactions: bankFeed,
};

fs.writeFileSync(path.join(DATASETS_DIR, 'kaggle-reconciliation-100.json'), JSON.stringify(combinedData, null, 2), 'utf8');

if (fs.existsSync(FRONTEND_DATA_DIR)) {
  fs.writeFileSync(path.join(FRONTEND_DATA_DIR, 'sample-kaggle-100.json'), JSON.stringify(combinedData, null, 2), 'utf8');
}

console.log(`✅ Converted ${invoices.length} Kaggle records into dual-ledger reconciliation dataset:`);
console.log(`   - Invoices CSV: datasets/kaggle-reconciliation-invoices.csv`);
console.log(`   - Bank Feed CSV: datasets/kaggle-reconciliation-bank-feed.csv`);
console.log(`   - Unified Benchmark: datasets/kaggle-reconciliation-100.json`);
console.log(`   - Frontend Preset: frontend/src/data/sample-kaggle-100.json`);
