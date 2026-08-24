/**
 * Universal Financial Data Parser & Normalizer for Indian Enterprise Feeds
 * Auto-detects columns from HDFC, ICICI, SBI, Axis, Kotak, Tally, Zoho, Paired Recon Sheets, and Gemini AI JSON
 */

export function extractNumber(val, fallback = 0) {
  if (val === undefined || val === null) return fallback;
  if (typeof val === 'number') return isNaN(val) ? fallback : val;
  if (typeof val === 'string') {
    const clean = val.replace(/[^0-9.-]/g, '');
    const num = parseFloat(clean);
    return isNaN(num) ? fallback : num;
  }
  return fallback;
}

export function extractString(val, fallback = '') {
  if (val === undefined || val === null) return fallback;
  if (typeof val === 'string') return val.trim();
  return String(val).trim();
}

export function findValueByKeys(obj, keys) {
  if (!obj || typeof obj !== 'object') return undefined;

  // 1. Direct exact key match (case-sensitive and lowercase)
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== '') {
      return obj[k];
    }
    const lowerK = k.toLowerCase();
    if (obj[lowerK] !== undefined && obj[lowerK] !== null && String(obj[lowerK]).trim() !== '') {
      return obj[lowerK];
    }
  }

  // 2. Strict normalized key match (exact equality of stripped alphanumeric characters)
  const objKeys = Object.keys(obj);
  for (const k of keys) {
    const cleanK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const ok of objKeys) {
      const cleanOk = ok.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (cleanOk === cleanK) {
        if (obj[ok] !== undefined && obj[ok] !== null && String(obj[ok]).trim() !== '') {
          return obj[ok];
        }
      }
    }
  }

  return undefined;
}

export function parseCSV(inputText) {
  if (!inputText) return [];

  // If already parsed array
  if (Array.isArray(inputText)) return inputText;

  if (typeof inputText !== 'string') {
    if (typeof inputText === 'object') {
      if (Array.isArray(inputText.records)) return inputText.records;
      if (Array.isArray(inputText.transactions)) return inputText.transactions;
      if (Array.isArray(inputText.invoices)) return inputText.invoices;
      return [inputText];
    }
    return [];
  }

  const text = inputText.trim();

  // If JSON array/object was pasted or structured by AI
  if (text.startsWith('[') || text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed;
      if (parsed.records && Array.isArray(parsed.records)) return parsed.records;
      if (parsed.transactions && Array.isArray(parsed.transactions)) return parsed.transactions;
      if (parsed.invoices && Array.isArray(parsed.invoices)) return parsed.invoices;
      return [parsed];
    } catch {
      // Fallback to CSV parsing
    }
  }

  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  // Parse header line (handling quotes & commas)
  const headerLine = lines[0];
  const headers = parseCSVRow(headerLine);

  // Check if first line is a valid header row
  const isHeaderRow = headers.some((h) => {
    const clean = h.toLowerCase().replace(/[^a-z0-9]/g, '');
    return ['date', 'narration', 'credit', 'amount', 'utr', 'invoice', 'vendor', 'customer', 'total', 'bank', 'id', 'particulars'].some((key) =>
      clean.includes(key)
    );
  });

  if (isHeaderRow && lines.length > 1) {
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVRow(lines[i]);
      if (values.length === 0 || (values.length === 1 && !values[0])) continue;

      const rowObj = {};
      headers.forEach((h, idx) => {
        const key = h.trim().toLowerCase();
        rowObj[key] = values[idx] !== undefined ? values[idx].trim() : '';
      });
      rows.push(rowObj);
    }
    return rows;
  }

  // Unstructured Text Fallback
  const extractedRows = [];
  lines.forEach((line, idx) => {
    const amountMatch = line.match(/(?:₹|INR|amount|credit|rs\.?|total)?\s*([0-9]{1,3}(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)\b/i);
    const utrMatch = line.match(/\b([A-Z]{4}[0-9]{6,16}|CMS[0-9]{8,14}|UPI\/\d{12}|BANK-[0-9]+)\b/i);
    const dateMatch = line.match(/\b(\d{4}-\d{2}-\d{2}|\d{2}[/-]\d{2}[/-]\d{4})\b/);
    
    let cleanAmount = '0';
    if (amountMatch) {
      cleanAmount = amountMatch[1].replace(/,/g, '');
    }

    if (parseFloat(cleanAmount) > 0 || line.length > 10) {
      extractedRows.push({
        narration: line.trim(),
        credit: cleanAmount,
        amount: cleanAmount,
        utr: utrMatch ? utrMatch[1] : '',
        date: dateMatch ? dateMatch[1] : new Date().toISOString().split('T')[0],
      });
    }
  });

  return extractedRows;
}

function parseCSVRow(rowText) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < rowText.length; i++) {
    const char = rowText[i];
    if (char === '"' || char === "'") {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Normalizes Bank Statement Rows into standard Recon-AI Bank Feed Format
 */
export function normalizeBankStatementRows(rawRows) {
  if (!Array.isArray(rawRows)) return [];

  return rawRows.map((r, idx) => {
    // 1. Amount detection (Look strictly for Bank Amount, Credit, Deposit, Cr, Net Amount)
    const rawAmount = findValueByKeys(r, [
      'bank amount (inr)',
      'bank amount inr',
      'bank amount',
      'bank_amount',
      'bankamountinr',
      'bankamount',
      'credit amount',
      'credit',
      'deposit',
      'cr amount',
      'cr',
      'net amount',
      'transaction amount',
      'txn amount',
      'amount',
    ]);
    const amount = extractNumber(rawAmount, 0);

    // 2. Vendor / Customer & Invoice references
    const vendor = findValueByKeys(r, ['vendor', 'vendor name', 'customer', 'customer name', 'party', 'client', 'supplier']);
    const invoiceId = findValueByKeys(r, ['invoice id', 'invoice number', 'inv no', 'bill no', 'invoice', 'invoice_id']);
    const bankTxnKey = findValueByKeys(r, ['bank txn id', 'bank_txn_id', 'bank id', 'bank_id', 'bank ref', 'bank_ref', 'transaction id', 'banktxnid']);

    // 3. Narration / Description
    let narration = findValueByKeys(r, ['narration', 'description', 'particulars', 'remarks', 'transaction remarks', 'details']);
    if (!narration) {
      if (vendor || invoiceId) {
        narration = `${vendor || 'Vendor'}${invoiceId ? ' - ' + invoiceId : ''}${bankTxnKey ? ' - Ref: ' + bankTxnKey : ''}`;
      } else {
        narration = `Bank Credit #${idx + 1}`;
      }
    }

    // 4. UTR / Ref Number detection
    let utr = findValueByKeys(r, ['utr', 'utr number', 'utr_number', 'utrnumber', 'ref no', 'reference number', 'chq/ref no', 'tran id']);
    if (!utr) {
      const match = narration.match(/\b([A-Z]{4}[0-9]{6,16}|CMS[0-9]{8,14}|UPI\/\d{12}|BANK-[0-9]+)\b/i);
      if (match) utr = match[1].toUpperCase();
    }
    if (!utr) {
      utr = bankTxnKey ? String(bankTxnKey) : `UTR-${Date.now().toString().slice(-6)}-${idx + 1}`;
    }

    // 5. Txn Date
    const txnDate = findValueByKeys(r, ['bank date', 'bank_date', 'bankdate', 'txn date', 'txndate', 'date', 'value date', 'transaction date']) || new Date().toISOString().split('T')[0];

    const bankTxnId = bankTxnKey ? String(bankTxnKey) : `BANK-${Date.now().toString().slice(-4)}-${idx + 1}`;

    return {
      bankTxnId,
      utrNumber: utr,
      amount,
      narration,
      txnDate: extractString(txnDate),
      category: 'REAL_UPLOADED_FEED',
    };
  }).filter((txn) => txn.amount > 0);
}

/**
 * Normalizes Invoices Rows into standard Recon-AI Invoice Model
 */
export function normalizeInvoiceRows(rawRows) {
  if (!Array.isArray(rawRows)) return [];

  return rawRows.map((r, idx) => {
    // 1. Invoice Number (Strictly invoice tokens, never generic 'id' which clashes with row serials)
    const invoiceNumber = findValueByKeys(r, [
      'invoice id',
      'invoice_id',
      'invoiceid',
      'invoice number',
      'invoice_number',
      'invoicenumber',
      'inv no',
      'bill no',
      'invoice #',
      'invoice',
      'inv_id',
    ]) || `INV-IMPORT-${idx + 1}`;

    // 2. Customer Name / Vendor
    const customerName = findValueByKeys(r, [
      'vendor',
      'vendor name',
      'vendor_name',
      'customer',
      'customer name',
      'customer_name',
      'customername',
      'party',
      'client',
      'supplier',
    ]) || 'Corporate Client';

    // 3. GSTIN
    const customerGstin = findValueByKeys(r, ['gstin', 'customer gstin', 'gst no', 'tax id']) || null;

    // 4. Amounts (Strictly invoice amount / gross amount, NEVER bank amount)
    const rawTotal = findValueByKeys(r, [
      'invoice amount (inr)',
      'invoice amount inr',
      'invoice amount',
      'invoice_amount',
      'invoiceamountinr',
      'invoiceamount',
      'invoice total',
      'invoicetotal',
      'invoice gross',
      'total amount',
      'total_amount',
      'totalamount',
      'gross amount',
      'gross_amount',
      'invoice value',
      'bill amount',
      'amount',
    ]);
    const totalAmount = extractNumber(rawTotal, 0);

    const rawBase = findValueByKeys(r, ['base amount', 'base_amount', 'baseamount', 'taxable value', 'subtotal']);
    let baseAmount = rawBase !== undefined ? extractNumber(rawBase, 0) : Number((totalAmount / 1.18).toFixed(2));

    const rawTax = findValueByKeys(r, ['tax amount', 'tax_amount', 'taxamount', 'gst', 'tax']);
    let taxAmount = rawTax !== undefined ? extractNumber(rawTax, 0) : Number((totalAmount - baseAmount).toFixed(2));

    // 5. TDS section & rate
    const rawTdsSection = findValueByKeys(r, ['tds section', 'tds_section', 'tdssection', 'section', 'expected tds section']) || 'NONE';
    const validSections = ['194C', '194J', '194H', '194Q', '194I', '194A', '206AB', 'NONE'];
    const expectedTdsSection = validSections.includes(String(rawTdsSection).toUpperCase()) ? String(rawTdsSection).toUpperCase() : 'NONE';

    const rawTdsRate = findValueByKeys(r, ['tds rate', 'tds_rate', 'tdsrate', 'tds %', 'rate', 'expected tds rate']);
    const expectedTdsRate = extractNumber(rawTdsRate, 0);

    const expectedTdsAmount = Number(((baseAmount * expectedTdsRate) / 100).toFixed(2));

    return {
      invoiceNumber: extractString(invoiceNumber),
      customerName: extractString(customerName),
      customerGstin: customerGstin ? extractString(customerGstin) : null,
      customerEmail: `finance@${extractString(customerName).toLowerCase().replace(/[^a-z0-9]/g, '') || 'vendor'}.com`,
      customerPhone: '+919876543210',
      totalAmount,
      baseAmount,
      taxAmount,
      expectedTdsSection,
      expectedTdsRate,
      expectedTdsAmount,
      expectedNetAmount: totalAmount - expectedTdsAmount,
      status: 'UNPAID',
    };
  }).filter((inv) => inv.totalAmount > 0);
}
