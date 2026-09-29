const crypto = require('node:crypto');

const TOKEN_LIFETIME_MS = 8 * 60 * 60 * 1000;

function constantTimeEqual(value, expected) {
  const actualBuffer = Buffer.from(String(value || ''));
  const expectedBuffer = Buffer.from(String(expected || ''));
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function createAdminToken(secret) {
  const payload = Buffer.from(JSON.stringify({ expiresAt: Date.now() + TOKEN_LIFETIME_MS })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function isAdminRequest(request, secret) {
  const authorization = request.headers.authorization || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;

  const expectedSignature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  if (!constantTimeEqual(signature, expectedSignature)) return false;

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number(decoded.expiresAt) > Date.now();
  } catch (error) {
    return false;
  }
}

module.exports = { constantTimeEqual, createAdminToken, isAdminRequest };
