import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, errorHandler, notFoundHandler } from '../src/middleware/index.js';

test('Error Middleware: notFoundHandler returns structured 404 JSON', () => {
  const req = { method: 'GET', originalUrl: '/api/nonexistent-endpoint' };
  let sentStatus = null;
  let sentJson = null;

  const res = {
    status(code) {
      sentStatus = code;
      return this;
    },
    json(payload) {
      sentJson = payload;
      return this;
    },
  };

  notFoundHandler(req, res);

  assert.equal(sentStatus, 404);
  assert.equal(sentJson.success, false);
  assert.equal(sentJson.error, 'RouteNotFound');
  assert.equal(sentJson.statusCode, 404);
  assert.match(sentJson.message, /nonexistent-endpoint/);
});

test('Error Middleware: errorHandler formats custom ApiError with correct status code', () => {
  const customErr = ApiError.badRequest('Invalid TDS rate specified', { field: 'tdsRate' });
  const req = { method: 'POST', originalUrl: '/api/reconciliation/batch' };
  let sentStatus = null;
  let sentJson = null;

  const res = {
    status(code) {
      sentStatus = code;
      return this;
    },
    json(payload) {
      sentJson = payload;
      return this;
    },
  };

  errorHandler(customErr, req, res, () => {});

  assert.equal(sentStatus, 400);
  assert.equal(sentJson.success, false);
  assert.equal(sentJson.message, 'Invalid TDS rate specified');
  assert.deepEqual(sentJson.details, { field: 'tdsRate' });
});

test('Error Middleware: errorHandler handles Mongoose-style ValidationError properly', () => {
  const validationErr = new Error('Validation failed');
  validationErr.name = 'ValidationError';
  validationErr.errors = {
    amount: {message: 'Path amount is required' },
    utrNumber: {message: 'Path utrNumber is required' },
  };

  const req = { method: 'POST', originalUrl: '/api/reconciliation/import-invoices' };
  let sentStatus = null;
  let sentJson = null;

  const res = {
    status(code) {
      sentStatus = code;
      return this;
    },
    json(payload) {
      sentJson = payload;
      return this;
    },
  };

  errorHandler(validationErr, req, res, () => {});

  assert.equal(sentStatus, 400);
  assert.equal(sentJson.error, 'ValidationError');
  assert.equal(sentJson.details.amount, 'Path amount is required');
  assert.equal(sentJson.details.utrNumber, 'Path utrNumber is required');
});

test('Data Normalizer: cleanly parses and structures Kaggle Financial Management dataset', async () => {
  const { parseCSV, normalizeBankStatementRows, normalizeInvoiceRows } = await import('../src/utils/csvParser.js');
  const kaggleSample = `Transaction ID,Date,Account Type,Transaction Amount,Cash Flow,Net Income,Revenue,Expenditure,Profit Margin,Debt-to-Equity Ratio,Operating Expenses,Gross Profit,Transaction Volume,Processing Time (seconds),Accuracy Score,Missing Data Indicator,Normalized Transaction Amount,Transaction Outcome
TXN_0001,2026-01-02,Expense,430475,-430475,-120533,482132,430475,-25,0.43,172190,51657,2,0.22,0.95,0,0.3419,1
TXN_0004,2026-01-05,Revenue,830736,830736,144548,830736,490134,17.4,0.82,196054,340602,5,0.43,0.96,0,0.6635,1`;

  const rows = parseCSV(kaggleSample);
  assert.equal(rows.length, 2);

  const bankRows = normalizeBankStatementRows(rows);
  assert.equal(bankRows.length, 2);
  assert.equal(bankRows[0].bankTxnId, 'TXN_0001');
  assert.equal(bankRows[0].amount, 430475);
  assert.match(bankRows[0].narration, /INV-TXN_0001/);

  const invoiceRows = normalizeInvoiceRows(rows);
  assert.equal(invoiceRows.length, 2);
  assert.equal(invoiceRows[0].invoiceNumber, 'INV-TXN_0001');
  assert.equal(invoiceRows[0].totalAmount, 430475);
  assert.equal(invoiceRows[0].expectedTdsSection, '194C');
  assert.equal(invoiceRows[1].invoiceNumber, 'INV-TXN_0004');
  assert.equal(invoiceRows[1].totalAmount, 830736);
  assert.equal(invoiceRows[1].expectedTdsSection, 'NONE');
});
