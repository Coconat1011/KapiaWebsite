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
process.env.EDGE_STORE_ACCESS_KEY = 'test-access-key';
process.env.EDGE_STORE_SECRET_KEY = 'test-secret-key';

const handler = require('../api/products');
const { createAdminToken } = require('../lib/admin-auth');
const edgeStore = require('../lib/edgestore');
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
  assert.equal(response.body[0].inStock, true);

  response = await request('POST', {
    product: { name: 'New feed', category: 'feeds', price: 12, desc: '', image: '', addons: [] }
  });
  assert.equal(response.statusCode, 401);

  response = await request('PATCH', {
    id: 'f1',
    product: { name: 'Unavailable fertilizer', category: 'fertilizer', price: 850, desc: '', image: '', inStock: false, addons: [] }
  });
  assert.equal(response.statusCode, 401);
  assert.equal((await request('GET')).body[0].inStock, true);

  response = await request('POST', {
    product: { name: 'New feed', category: 'feeds', price: 12, desc: '', image: '', addons: [] }
  }, true);
  assert.equal(response.statusCode, 201);
  const customId = response.body.product.id;
  assert.equal((await request('GET')).body.length, 19);

  response = await request('PATCH', {
    id: 'f1',
    product: { name: 'Updated fertilizer', category: 'fertilizer', price: 15, desc: '', image: '', inStock: false, addons: [] }
  }, true);
  assert.equal(response.statusCode, 200);
  assert.equal((await request('GET')).body[0].name, 'Updated fertilizer');
  assert.equal((await request('GET')).body[0].inStock, false);

  response = await request('DELETE', { id: 'f1' }, true);
  assert.equal(response.statusCode, 200);
  assert.equal((await request('GET')).body.some(product => product.id === 'f1'), false);
  assert.equal((await request('GET')).body.some(product => product.id === 'f2'), true);

  response = await request('DELETE', { id: customId }, true);
  assert.equal(response.statusCode, 200);
  assert.equal((await request('GET')).body.length, 17);
});

test('product API deletes replaced and removed EdgeStore images only when unused', async () => {
  storedProducts.length = 0;
  const oldImage = 'https://files.edgestore.dev/project/_public/product.jpg';
  const deletedImages = [];
  const originalDeleteProductImage = edgeStore.deleteProductImage;
  edgeStore.deleteProductImage = async url => {
    deletedImages.push(url);
    return true;
  };

  try {
    storedProducts.push({
      id: 'custom-photo',
      name: 'Photo product',
      category: 'feeds',
      desc: '',
      price: 10,
      image: oldImage,
      addons: []
    });
    storedProducts.push({
      id: 'custom-shared',
      name: 'Shared photo product',
      category: 'feeds',
      desc: '',
      price: 10,
      image: oldImage,
      addons: []
    });

    let response = await request('PATCH', {
      id: 'custom-photo',
      product: { name: 'Photo product', category: 'feeds', price: 10, desc: '', image: '', addons: [] }
    }, true);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(deletedImages, []);

    response = await request('PATCH', {
      id: 'custom-shared',
      product: { name: 'Shared photo product', category: 'feeds', price: 10, desc: '', image: 'https://example.com/new.jpg', addons: [] }
    }, true);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(deletedImages, [oldImage]);

    const nextImage = 'https://files.edgestore.dev/project/_public/next.jpg';
    storedProducts.find(product => product.id === 'custom-shared').image = nextImage;
    response = await request('DELETE', { id: 'custom-shared' }, true);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(deletedImages, [oldImage, nextImage]);
  } finally {
    edgeStore.deleteProductImage = originalDeleteProductImage;
  }
});