const assert = require('node:assert/strict');
const test = require('node:test');

const storedOrders = [];
const storedTransactions = [];
const storedProducts = [
  { id: 'test-coffee', name: 'Coffee', category: 'foods_drinks', price: 25, addons: [{ name: 'Extra shot', price: 10 }], inStock: true },
  { id: 'test-feed', name: 'Layer Feed', category: 'feeds', price: 100, addons: [], instruction: 'Provide fresh water alongside feed.', inStock: true },
  { id: 'test-soup', name: 'Farm Soup', category: 'foods_drinks', price: 50, addons: [], ingredients: 'Water, vegetables, and salt.', inStock: true }
];
const collections = {
  orders: createCollection(storedOrders),
  transactions: createCollection(storedTransactions),
  products: createCollection(storedProducts)
};

function createCollection(rows) {
  return {
    find: () => ({
      toArray: async () => [...rows],
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
    items: [{ id: 'test-coffee', name: 'Coffee', qty: 2, basePrice: 25, addons: [] }]
  };
}

test('orders require a valid customer email', async () => {
  storedOrders.length = 0;
  storedTransactions.length = 0;

  for (const customerEmail of ['', undefined, 'not-an-email']) {
    const order = newOrder();
    if (customerEmail === undefined) delete order.customerEmail;
    else order.customerEmail = customerEmail;

    const response = await request('POST', order);
    assert.equal(response.statusCode, 400);
    assert.match(response.body.error, /valid email address/i);
  }
  assert.equal(storedOrders.length, 0);
});

test('orders preserve fertilizer and feed product instructions', async () => {
  storedOrders.length = 0;
  storedTransactions.length = 0;

  const order = newOrder();
  order.items = [{
    id: 'test-feed',
    name: 'Layer Feed',
    qty: 1,
    basePrice: 100,
    category: 'feeds',
    instruction: 'Provide fresh water alongside feed.'
  }, {
    id: 'test-soup',
    name: 'Farm Soup',
    qty: 1,
    basePrice: 50,
    category: 'foods_drinks',
    ingredients: 'Water, vegetables, and salt.'
  }];

  const response = await request('POST', order);
  assert.equal(response.statusCode, 201);
  assert.equal(response.body.order.items[0].instruction, 'Provide fresh water alongside feed.');
  assert.equal(storedOrders[0].items[0].instruction, 'Provide fresh water alongside feed.');
  assert.equal(response.body.order.items[1].ingredients, 'Water, vegetables, and salt.');
  assert.equal(storedOrders[0].items[1].ingredients, 'Water, vegetables, and salt.');
});

test('order totals and item details come from the server catalog', async () => {
  storedOrders.length = 0;
  const order = newOrder();
  order.items[0].name = 'Free Coffee';
  order.items[0].basePrice = 0.01;

  const response = await request('POST', order);
  assert.equal(response.statusCode, 201);
  assert.equal(response.body.order.items[0].name, 'Coffee');
  assert.equal(response.body.order.items[0].basePrice, 25);
  assert.equal(response.body.order.total, 50);
  assert.equal(response.body.order.paymentMethod, 'InstaPay QR');

  order.items[0].addons = [{ name: 'Extra shot', price: 0.01 }];
  const addonOrder = await request('POST', order);
  assert.equal(addonOrder.statusCode, 201);
  assert.equal(addonOrder.body.order.total, 70);
  assert.equal(addonOrder.body.order.items[0].addons[0].price, 10);

  const invalidProduct = await request('POST', {
    ...newOrder(),
    items: [{ id: 'unknown', name: 'Coffee', qty: 1, basePrice: 0.01, addons: [] }]
  });
  assert.equal(invalidProduct.statusCode, 400);
});

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
