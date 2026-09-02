import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATASETS_DIR = path.resolve(__dirname, '../../datasets');
if (!fs.existsSync(DATASETS_DIR)) {
  fs.mkdirSync(DATASETS_DIR, { recursive: true });
}

console.log('Generating Kaggle Accounting Dataset (ziya07/accounting-data-for-financial-management)...');

const accountTypes = ['Revenue', 'Expense', 'Asset', 'Liability'];
const dates = [];
const startDate = new Date('2026-01-01T00:00:00Z');
for (let i = 0; i < 240; i++) {
  const d = new Date(startDate);
  d.setDate(d.getDate() + i);
  dates.push(d.toISOString().slice(0, 10));
}

// 1. Generate rows adhering strictly to Kaggle schema
const rows = [];
const header = [
  'Transaction ID',
  'Date',
  'Account Type',
  'Transaction Amount',
  'Cash Flow',
  'Net Income',
  'Revenue',
  'Expenditure',
  'Profit Margin',
  'Debt-to-Equity Ratio',
  'Operating Expenses',
  'Gross Profit',
  'Transaction Volume',
  'Processing Time (seconds)',
  'Accuracy Score',
  'Missing Data Indicator',
  'Normalized Transaction Amount',
  'Transaction Outcome'
];

let minAmt = Infinity;
let maxAmt = -Infinity;
const rawRows = [];

for (let i = 1; i <= 100; i++) {
  const txnId = `TXN_${String(i).padStart(4, '0')}`;
  const date = dates[i % dates.length];
  const acctType = accountTypes[i % accountTypes.length];
  
  // Base amount distribution (₹5,000 to ₹12,50,000)
  const baseVal = Math.round(5000 + Math.pow(Math.sin(i * 0.17) * 0.5 + 0.5, 2) * 1245000);
  if (baseVal < minAmt) minAmt = baseVal;
  if (baseVal > maxAmt) maxAmt = baseVal;

  let revenue = 0;
  let expenditure = 0;
  let cashFlow = 0;

  if (acctType === 'Revenue') {
    revenue = baseVal;
    expenditure = Math.round(baseVal * (0.55 + (i % 25) * 0.01));
    cashFlow = baseVal;
  } else if (acctType === 'Expense') {
    expenditure = baseVal;
    revenue = Math.round(baseVal * (1.10 + (i % 20) * 0.02));
    cashFlow = -baseVal;
  } else if (acctType === 'Asset') {
    cashFlow = Math.round(baseVal * 0.2);
    revenue = Math.round(baseVal * 0.4);
    expenditure = Math.round(baseVal * 0.2);
  } else { // Liability
    cashFlow = -Math.round(baseVal * 0.15);
    revenue = Math.round(baseVal * 0.3);
    expenditure = Math.round(baseVal * 0.45);
  }

  const grossProfit = revenue - expenditure;
  const opex = Math.round(expenditure * 0.4);
  const netIncome = grossProfit - opex;
  const profitMargin = revenue > 0 ? Number(((netIncome / revenue) * 100).toFixed(2)) : 0;
  const debtToEquity = Number((0.3 + ((i * 13) % 200) / 100).toFixed(2));
  const txnVolume = 1 + (i % 45);
  const processingTime = Number((0.15 + ((i * 7) % 350) / 100).toFixed(2));
  const accuracyScore = Number((0.92 + ((i * 3) % 8) / 100).toFixed(2));
  const missingData = (i % 47 === 0) ? 1 : 0;
  const outcome = (missingData === 1 && (i % 3 === 0)) ? 0 : 1;

  rawRows.push({
    txnId,
    date,
    acctType,
    baseVal,
    cashFlow,
    netIncome,
    revenue,
    expenditure,
    profitMargin,
    debtToEquity,
    opex,
    grossProfit,
    txnVolume,
    processingTime,
    accuracyScore,
    missingData,
    outcome
  });
}

// 2. Compute min-max normalized transaction amount
const csvLines = [header.join(',')];
for (const r of rawRows) {
  const normalizedAmt = Number(((r.baseVal - minAmt) / (maxAmt - minAmt)).toFixed(4));
  const line = [
    r.txnId,
    r.date,
    r.acctType,
    r.baseVal,
    r.cashFlow,
    r.netIncome,
    r.revenue,
    r.expenditure,
    r.profitMargin,
    r.debtToEquity,
    r.opex,
    r.grossProfit,
    r.txnVolume,
    r.processingTime,
    r.accuracyScore,
    r.missingData,
    normalizedAmt,
    r.outcome
  ];
  csvLines.push(line.join(','));
}

const csvPath = path.join(DATASETS_DIR, 'kaggle-accounting-financial-management.csv');
fs.writeFileSync(csvPath, csvLines.join('\n'), 'utf8');

console.log(`✅ Saved Kaggle accounting transactions to: ${csvPath}`);
console.log(`   Columns: ${header.length} | File size: ${(fs.statSync(csvPath).size / 1024).toFixed(1)} KB`);
