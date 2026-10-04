const assert = require('node:assert/strict');
const test = require('node:test');

process.env.ADMIN_USERNAME = 'test-admin';
process.env.ADMIN_PASSWORD = 'test-password';

const handler = require('../api/admin-login');

async function request(method, body) {
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

  await handler({ method, body }, response);
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