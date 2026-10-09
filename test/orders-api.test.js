const assert = require('node:assert/strict');
const test = require('node:test');

const storedOrders = [];
const storedTransactions = [];
const collections = {
  orders: createCollection(storedOrders),
  transactions: createCollection(storedTransactions)
};

function createCollection(rows) {
  return {
    find: () => ({
      sort: sortBy => ({
        limit: () => ({
          toArray: async () => [...rows].sort((left, right) => {
            const leftDate = new Date(left[Object.keys(sortBy)[0]]).getTime();
            const rightDate = new Date(right[Object.keys(sortBy)[0]]).getTime();
            return (leftDate - rightDate) * Object.values(sortBy)[0];
          })
        })
      })
    }),
    insertOne: async row => rows.push(row),
    findOne: async filter => rows.find(row => Object.entries(filter).every(([key, value]) => row[key] === value)) || null,
    updateOne: async (filter, update, options = {}) => {
      let row = rows.find(entry => Object.entries(filter).every(([key, value]) => entry[key] === value));
      if (!row && options.upsert) {
        row = { ...filter, ...(update.$setOnInsert || {}) };
        rows.push(row);
      } else if (row) {
        Object.assign(row, update.$set || {});
      }
      return { matchedCount: row ? 1 : 0 };
    },
    deleteOne: async filter => {
      const index = rows.findIndex(row => Object.entries(filter).every(([key, value]) => row[key] === value));
      if (index >= 0) rows.splice(index, 1);
    },
    deleteMany: async () => rows.splice(0, rows.length)
  };
}

globalThis.__kapiaMongoClientPromise = Promise.resolve({
  db: () => ({ collection: name => collections[name] })
});
process.env.MONGODB_URI = 'mongodb://test';
process.env.ADMIN_PASSWORD = 'test-password';

const handler = require('../api/orders');
const { createAdminToken } = require('../lib/admin-auth');
const adminToken = createAdminToken(process.env.ADMIN_PASSWORD);

function createResponse() {
  return {
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
}

async function request(method, body, { authorized = false, history = false } = {}) {
  const response = createResponse();
  await handler({
    method,
    body,
    query: history ? { history: '1' } : {},
    headers: { authorization: authorized ? `Bearer ${adminToken}` : '' }
  }, response);
  return response;
}

function newOrder() {
  return {
    customerName: 'Test Customer',
    customerEmail: 'customer@example.com',
    items: [{ name: 'Coffee', qty: 2, basePrice: 25, addons: [] }]
  };
}

test('admin confirmations are saved as separate, persistent transaction history', async () => {
  storedOrders.length = 0;
  storedTransactions.length = 0;

  let response = await request('GET', undefined, { history: true });
  assert.equal(response.statusCode, 401);

  response = await request('POST', newOrder());
  assert.equal(response.statusCode, 201);
  const orderId = response.body.order.id;

  response = await request('PATCH', { id: orderId, status: 'Paid - Verified' });
  assert.equal(response.statusCode, 401);

  response = await request('PATCH', { id: orderId, status: 'Paid - Verified' }, { authorized: true });
  assert.equal(response.statusCode, 200);
  assert.equal(storedTransactions.length, 1);
  assert.equal(storedOrders.length, 0);
  const firstConfirmationAt = storedTransactions[0].confirmedAt;
  assert.equal(storedTransactions[0].orderId, orderId);
  assert.equal(storedTransactions[0].status, 'Paid - Verified');

  response = await request('PATCH', { id: orderId, status: 'Paid - Verified' }, { authorized: true });
  assert.equal(response.statusCode, 404);
  assert.equal(storedTransactions.length, 1);
  assert.equal(storedTransactions[0].confirmedAt, firstConfirmationAt);

  response = await request('GET', undefined, { authorized: true, history: true });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.length, 1);
  assert.equal(response.body[0].confirmedAt, firstConfirmationAt.toISOString());

  response = await request('DELETE', { history: true, id: orderId }, { authorized: true });
  assert.equal(response.statusCode, 200);
  assert.equal(storedTransactions.length, 0);
  assert.equal(storedOrders.length, 0);

  response = await request('DELETE', {}, { authorized: true });
  assert.equal(response.statusCode, 200);
  assert.equal(storedOrders.length, 0);
  assert.equal(storedTransactions.length, 0);

  response = await request('DELETE', { history: true }, { authorized: true });
  assert.equal(response.statusCode, 200);
  assert.equal(storedTransactions.length, 0);
});
