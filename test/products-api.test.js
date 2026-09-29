const assert = require('node:assert/strict');
const test = require('node:test');

const storedProducts = [];
const collection = {
  find: () => ({ toArray: async () => [...storedProducts] }),
  insertOne: async product => storedProducts.push(product),
  updateOne: async (filter, update, options) => {
    let product = storedProducts.find(entry => entry.id === filter.id);
    if (!product && options?.upsert) {
      product = { id: filter.id };
      storedProducts.push(product);
    }
    if (product) {
      Object.assign(product, update.$set || {});
      for (const key of Object.keys(update.$unset || {})) delete product[key];
    }
    return { matchedCount: product ? 1 : 0 };
  },
  deleteOne: async filter => {
    const index = storedProducts.findIndex(product => product.id === filter.id);
    if (index >= 0) storedProducts.splice(index, 1);
  }
};

globalThis.__kapiaMongoClientPromise = Promise.resolve({
  db: () => ({ collection: () => collection })
});
process.env.MONGODB_URI = 'mongodb://test';
process.env.ADMIN_PASSWORD = 'test-password';

const handler = require('../api/products');
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

test('product API reads defaults and protects persistent catalog changes', async () => {
  storedProducts.length = 0;

  let response = await request('GET');
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.length, 18);

  response = await request('POST', {
    product: { name: 'New feed', category: 'feeds', price: 12, desc: '', image: '', addons: [] }
  });
  assert.equal(response.statusCode, 401);

  response = await request('POST', {
    product: { name: 'New feed', category: 'feeds', price: 12, desc: '', image: '', addons: [] }
  }, true);
  assert.equal(response.statusCode, 201);
  const customId = response.body.product.id;
  assert.equal((await request('GET')).body.length, 19);

  response = await request('PATCH', {
    id: 'f1',
    product: { name: 'Updated fertilizer', category: 'fertilizer', price: 15, desc: '', image: '', addons: [] }
  }, true);
  assert.equal(response.statusCode, 200);
  assert.equal((await request('GET')).body[0].name, 'Updated fertilizer');

  response = await request('DELETE', { id: 'f1' }, true);
  assert.equal(response.statusCode, 200);
  assert.equal((await request('GET')).body.some(product => product.id === 'f1'), false);
  assert.equal((await request('GET')).body.some(product => product.id === 'f2'), true);

  response = await request('DELETE', { id: customId }, true);
  assert.equal(response.statusCode, 200);
  assert.equal((await request('GET')).body.length, 17);
});