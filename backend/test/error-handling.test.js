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
