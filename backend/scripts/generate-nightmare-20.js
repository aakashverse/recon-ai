import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const NIGHTMARE_DATA_20 = [
  {
    bankTxnId: 'WORST-01',
    utrNumber: 'AXISN098273641',
    amount: 100000,
    narration: 'NEFT/AXISN098273641/INV-2024-1001/TECHCORP/GROSS-FULL-PMT/BLR-EAST-BR',
    category: 'TIER_1_EXACT_GROSS',
    txnDate: '2026-08-25'
  },
  {
    bankTxnId: 'WORST-02',
    utrNumber: 'HDFCN112233445',
    amount: 49000,
    narration: 'HDFC/RTGS/CMS/INV-2024-1002/ACME-GLOBAL/CONTRACTOR-194C-2PCT-TDS/MUM-NORTH',
    category: 'TIER_2_TDS_194C_2PCT',
    txnDate: '2026-08-25'
  },
  {
    bankTxnId: 'WORST-03',
    utrNumber: 'ICICIN998877665',
    amount: 225000,
    narration: 'ICICI-CORP-NEFT-CLOUDSCALE-INV-2024-1003-PROF-FEES-SEC-194J-LESS-10PCT',
    category: 'TIER_2_TDS_194J_10PCT',
    txnDate: '2026-08-25'
  },
  {
    bankTxnId: 'WORST-04',
    utrNumber: 'SBIN001928374',
    amount: 499500,
    narration: 'SBI/RTGS/INFOSYS-LTD/INV-2024-2002/PURCHASE-OF-GOODS-TDS-SEC194Q-0.1PCT',
    category: 'TIER_2_TDS_194Q_POINT1PCT',
    txnDate: '2026-08-25'
  },
  {
    bankTxnId: 'WORST-05',
    utrNumber: 'KOTAK99881122',
    amount: 76000,
    narration: 'KOTAK/NEFT/SWIGGY/INV-2024-2007/BROKERAGE-COMMISSION-194H-5PCT-DEDUCTION',
    category: 'TIER_2_TDS_194H_5PCT',
    txnDate: '2026-08-25'
  },
  {
    bankTxnId: 'WORST-06',
    utrNumber: 'PUNBN88776655',
    amount: 72000,
    narration: 'PUNB-CORP-ZOMATO-INV-2024-2009-NON-FILER-PENAL-TDS-SEC206AB-20PCT-RATE',
    category: 'TIER_2_TDS_206AB_20PCT',
    txnDate: '2026-08-25'
  },
  {
    bankTxnId: 'WORST-07',
    utrNumber: 'YESBN33445566',
    amount: 183050.85,
    narration: 'YESB/RTGS/INFOSYS/INV-2024-2001/CBDT-CIRCULAR-23-TDS-ON-BASE-ONLY-10PCT',
    category: 'TIER_2_CBDT_CIRCULAR_23_BASE_TDS',
    txnDate: '2026-08-25'
  },
  {
    bankTxnId: 'WORST-08',
    utrNumber: 'AXISP99001122',
    amount: 109900,
    narration: 'PG-SETTL/RAZORPAY/PAYTM/INV-2024-2014/NET-PAYOUT-LESS-WIRE-FEE-100',
    category: 'TIER_2_GATEWAY_FEE_100',
    txnDate: '2026-08-25'
  },
  {
    bankTxnId: 'WORST-09',
    utrNumber: 'INDBN77889900',
    amount: 122450,
    narration: 'INDB/NEFT/SWIGGY/INV-2024-2008/TDS-2PCT-PLUS-WIRE-CHG-50-COMBO',
    category: 'TIER_2_TDS_PLUS_WIRE_FEE_COMBO',
    txnDate: '2026-08-25'
  },
  {
    bankTxnId: 'WORST-10',
    utrNumber: 'BARBN44556677',
    amount: 140000,
    narration: 'BARB-CMS-CONSOLIDATED-INV-2024-1008-AND-INV-2024-1009-SPLIT-PMT',
    category: 'TIER_2_BOUNDED_SPLIT_2_INVOICES',
    txnDate: '2026-08-25'
  },
  {
    bankTxnId: 'WORST-11',
    utrNumber: 'CITIN11002299',
    amount: 441000,
    narration: 'CITI-CORP/TATA-CONSULTANCY/INV-2024-2004/RULE-HISTORICAL-CONTRACT-2PCT',
    category: 'TIER_2_LEARNED_RULE_HISTORICAL',
    txnDate: '2026-08-25'
  },
  {
    bankTxnId: 'WORST-12',
    utrNumber: 'HSBCN99221100',
    amount: 274400,
    narration: 'HSBC/NEFT/WIPRO/INV-2024-2006/RETAINER-MONTHLY-SETTL-2PCT',
    category: 'TIER_2_LEARNED_RULE_RETAINER',
    txnDate: '2026-08-25'
  },
  {
    bankTxnId: 'WORST-13',
    utrNumber: 'UPI58291039102',
    amount: 67500,
    narration: 'UPI/CR/58291039102/1NV-2O24-IOO4/ZENITH/OCR-MESSY-TYPOS-TDS-1O-PERCENT',
    category: 'TIER_3_GENAI_OCR_TYPO_HEALING',
    txnDate: '2026-08-25'
  },
  {
    bankTxnId: 'WORST-14',
    utrNumber: 'IMPS8829102910',
    amount: 144000,
    narration: 'IMPS/HEXAWAVE-CONSULTING/PROF-SERVICES-SETTLEMENT-LESS-10PCT-TDS-AUG',
    category: 'TIER_3_GENAI_NATURAL_LANGUAGE',
    txnDate: '2026-08-25'
  },
  {
    bankTxnId: 'WORST-15',
    utrNumber: 'IDFIN99882211',
    amount: 85000,
    narration: 'IDFC/NEFT/TECHCORP/INV-2024-1001/SHORT-UNILATERAL-DEDUCTION-15K',
    category: 'EXCEPTION_CIRCUIT_BREAKER_SHORT_PAY',
    txnDate: '2026-08-25'
  },
  {
    bankTxnId: 'WORST-16',
    utrNumber: 'FEDBN99112233',
    amount: 150000,
    narration: 'FEDB-RTGS-TECHCORP-INV-2024-1001-EXCESS-OVERPAYMENT-FRAUD-RISK-50K-DIFF',
    category: 'EXCEPTION_CIRCUIT_BREAKER_OVERPAYMENT',
    txnDate: '2026-08-25'
  },
  {
    bankTxnId: 'WORST-17',
    utrNumber: 'UNION99334455',
    amount: 35000,
    narration: 'UNION/NEFT/ACME/INV-2024-1002/ILLEGAL-30PCT-UNEXPLAINED-WITHHOLDING',
    category: 'EXCEPTION_CIRCUIT_BREAKER_ILLEGAL_TDS',
    txnDate: '2026-08-25'
  },
  {
    bankTxnId: 'WORST-18',
    utrNumber: 'UPI99881122334',
    amount: 14250,
    narration: 'UPI/CR/998811223344/UNKNOWN-ANONYMOUS-DIRECT-PAYMENT-NO-INVOICE',
    category: 'EXCEPTION_UNMAPPED_ANONYMOUS_CREDIT',
    txnDate: '2026-08-25'
  },
  {
    bankTxnId: 'WORST-19',
    utrNumber: 'YESBN99009915',
    amount: 42800,
    narration: 'NEFT-YESB-UNKNOWN-PARTY-SECURITY-ADVANCE-UNALLOCATED',
    category: 'EXCEPTION_UNMAPPED_RETAINER',
    txnDate: '2026-08-25'
  },
  {
    bankTxnId: 'WORST-20',
    utrNumber: 'AXISN098273641',
    amount: 100000,
    narration: 'NEFT/AXISN098273641/INV-2024-1001/DUPLICATE-REPLAY-ATTACK-TEST',
    category: 'IDEMPOTENCY_DUPLICATE_REPLAY_REJECTED',
    txnDate: '2026-08-25'
  }
];

const rootJsonPath = path.resolve(__dirname, '../../sample-chaos-20-nightmare.json');
const rootCsvPath = path.resolve(__dirname, '../../sample-chaos-20-nightmare.csv');

fs.writeFileSync(rootJsonPath, JSON.stringify(NIGHTMARE_DATA_20, null, 2), 'utf-8');

const csvLines = ['Date,Narration,Credit,UTR'];
for (const d of NIGHTMARE_DATA_20) {
  csvLines.push(`${d.txnDate},"${d.narration}",${d.amount},${d.utrNumber}`);
}
fs.writeFileSync(rootCsvPath, csvLines.join('\n'), 'utf-8');

console.log('✅ Generated sample-chaos-20-nightmare.json and sample-chaos-20-nightmare.csv cleanly.');
