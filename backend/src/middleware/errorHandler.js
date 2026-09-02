/**
 * Centralized API Error Handling Middleware
 * Provides structured JSON responses for validation, database, and operational errors.
 */

export class ApiError extends Error {
  constructor(statusCode, message, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(msg, details) {
    return new ApiError(400, msg, details);
  }

  static notFound(msg = 'Resource not found') {
    return new ApiError(404, msg);
  }

  static conflict(msg) {
    return new ApiError(409, msg);
  }

  static internal(msg = 'Internal server error') {
    return new ApiError(500, msg);
  }
}

export function errorHandler(err, req, res, next) {
  let statusCode = err.statusCode || 500;
  let errorType = err.name || 'InternalServerError';
  let message = err.message || 'An unexpected error occurred';
  let details = err.details || null;

  // Handle Mongoose Validation Errors
  if (err.name === 'ValidationError') {
    statusCode = 400;
    errorType = 'ValidationError';
    message = 'Validation failed for one or more fields';
    details = Object.keys(err.errors || {}).reduce((acc, key) => {
      acc[key] = err.errors[key].message;
      return acc;
    }, {});
  }

  // Handle Mongoose CastError (e.g. invalid ObjectId)
  if (err.name === 'CastError') {
    statusCode = 400;
    errorType = 'InvalidIdentifier';
    message = `Invalid format for field: ${err.path}`;
  }

  // Handle Mongo Duplicate Key Error (E11100)
  if (err.code === 11100) {
    statusCode = 409;
    errorType = 'DuplicateKeyError';
    const fields = Object.keys(err.keyValue || {});
    message = `A record with this ${fields.join(', ')} already exists.`;
  }

  // Handle Malformed JSON request bodies
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    statusCode = 400;
    errorType = 'MalformedJson';
    message = 'Request body contains invalid/malformed JSON syntax.';
  }

  // Log non-operational (unexpected) errors
  if (statusCode >= 500) {
    console.error(`[Server Error ${req.method} ${req.originalUrl}]:`, err);
  }

  return res.status(statusCode).json({
    success: false,
    error: errorType,
    message,
    details,
    statusCode,
    path: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString(),
  });
}
