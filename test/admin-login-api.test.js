const assert = require('node:assert/strict');
const test = require('node:test');

process.env.ADMIN_USERNAME = 'test-admin';
process.env.ADMIN_PASSWORD = 'test-password';

const handler = require('../api/admin-login');

function createResponse() {
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
  return response;
}

async function request(method, body, headers = {}) {
  const response = createResponse();

  await handler({ method, body, headers }, response);
  return response;
}

test('admin login requires the configured username and password', async () => {
  const success = await request('POST', { username: 'test-admin', password: 'test-password' });
  assert.equal(success.statusCode, 200);
  assert.equal(typeof success.body.token, 'string');

  const wrongUsername = await request('POST', { username: 'wrong-admin', password: 'test-password' });
  assert.equal(wrongUsername.statusCode, 401);

  const wrongPassword = await request('POST', { username: 'test-admin', password: 'wrong-password' });
  assert.equal(wrongPassword.statusCode, 401);
});

test('default login token is accepted by the orders API', async () => {
  const originalUsername = process.env.ADMIN_USERNAME;
  const originalPassword = process.env.ADMIN_PASSWORD;
  const originalMongoUri = process.env.MONGODB_URI;
  delete process.env.ADMIN_USERNAME;
  delete process.env.ADMIN_PASSWORD;
  delete process.env.MONGODB_URI;

  try {
    const login = await request('POST', { username: 'kapiaadmin', password: 'h1zqp7ld269o' });
    assert.equal(login.statusCode, 200);

    const orders = require('../api/orders');
    const response = createResponse();
    await orders({
      method: 'GET',
      headers: { authorization: `Bearer ${login.body.token}` }
    }, response);

    assert.equal(response.statusCode, 503);
  } finally {
    if (originalUsername === undefined) delete process.env.ADMIN_USERNAME;
    else process.env.ADMIN_USERNAME = originalUsername;
    if (originalPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = originalPassword;
    if (originalMongoUri === undefined) delete process.env.MONGODB_URI;
    else process.env.MONGODB_URI = originalMongoUri;
  }
});