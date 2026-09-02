export function notFoundHandler(req, res) {
  return res.status(404).json({
    success: false,
    error: 'RouteNotFound',
    message: `Cannot ${req.method} ${req.originalUrl} — endpoint does not exist on this server.`,
    statusCode: 404,
    timestamp: new Date().toISOString(),
  });
}
