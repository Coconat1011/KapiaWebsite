const assert = require('node:assert/strict');
const test = require('node:test');

process.env.ADMIN_PASSWORD = 'test-password';
delete process.env.EDGE_STORE_ACCESS_KEY;
delete process.env.EDGE_STORE_SECRET_KEY;

const handler = require('../api/upload-image');
const { createAdminToken } = require('../lib/admin-auth');
const adminToken = createAdminToken(process.env.ADMIN_PASSWORD);

async function request(method, body, authorized = false) {
  const response = {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    }
  };

  await handler({
    method,
    body,
    headers: { authorization: authorized ? `Bearer ${adminToken}` : '' }
  }, response);
  return response;
}

test('image uploads require an admin session', async () => {
  const response = await request('POST', { image: 'data:image/png;base64,aW1hZ2U=' });
  assert.equal(response.statusCode, 401);
});

test('image uploads report missing EdgeStore credentials', async () => {
  const response = await request('POST', { image: 'data:image/png;base64,aW1hZ2U=' }, true);
  assert.equal(response.statusCode, 503);
  assert.match(response.body.error, /EDGE_STORE_ACCESS_KEY/);
});