const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const storedOrders = [];
const storedTransactions = [];

function createCollection(rows) {
  return {
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
    }
  };
}

const collections = {
  orders: createCollection(storedOrders),
  transactions: createCollection(storedTransactions)
};

globalThis.__kapiaMongoClientPromise = Promise.resolve({
  db: () => ({ collection: name => collections[name] })
});
process.env.MONGODB_URI = 'mongodb://test';
process.env.PAYMONGO_SECRET_KEY = 'sk_test_checkout';
process.env.PAYMONGO_WEBHOOK_SECRET = 'webhook-test-secret';
process.env.SITE_URL = 'https://kapia.example';

const checkoutHandler = require('../api/paymongo-checkout');
const webhookHandler = require('../api/paymongo-webhook');

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

async function request(handler, method, body, headers = {}) {
  const response = createResponse();
  await handler({ method, body, headers }, response);
  return response;
}

function addPendingOrder() {
  storedOrders.length = 0;
  storedTransactions.length = 0;
  storedOrders.push({
    id: 'KAP-1760000000000-ABC123',
    createdAt: new Date('2026-10-16T08:00:00.000Z'),
    customerName: 'Test Customer',
    customerEmail: 'customer@example.com',
    paymentMethod: 'PayMongo Checkout',
    status: 'Awaiting Payment',
    total: 125,
    items: [{
      name: 'Coffee',
      qty: 2,
      unitPrice: 50,
      addons: [{ name: 'Extra shot', price: 10 }],
      lineTotal: 100
    }, {
      name: 'Cake',
      qty: 1,
      unitPrice: 25,
      addons: [],
      lineTotal: 25
    }]
  });
}

test('PayMongo checkout uses the stored order, server key, and hosted session', async () => {
  addPendingOrder();
  const originalFetch = globalThis.fetch;
  let providerRequest;
  globalThis.fetch = async (url, options) => {
    providerRequest = { url, options, body: JSON.parse(options.body) };
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        data: {
          id: 'cs_test_123',
          attributes: { checkout_url: 'https://checkout.paymongo.com/session-123' }
        }
      })
    };
  };

  try {
    const response = await request(checkoutHandler, 'POST', { orderId: storedOrders[0].id });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.checkoutUrl, 'https://checkout.paymongo.com/session-123');
    assert.equal(providerRequest.url, 'https://api.paymongo.com/v2/checkout_sessions');
    assert.equal(providerRequest.options.headers.Authorization, `Basic ${Buffer.from('sk_test_checkout:').toString('base64')}`);
    assert.deepEqual(providerRequest.body.data.attributes.line_items.map(item => [item.name, item.amount, item.quantity]), [
      ['Coffee (Extra shot)', 5000, 2],
      ['Cake', 2500, 1]
    ]);
    assert.equal(providerRequest.body.data.attributes.reference_number, storedOrders[0].id);
    assert.equal(providerRequest.body.data.attributes.payment_method_types.includes('gcash'), true);
    assert.equal(storedOrders[0].paymongoSessionId, 'cs_test_123');
    assert.equal(storedOrders[0].paymentMethod, 'PayMongo Hosted Checkout');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('PayMongo webhook verifies the signature and archives only the matched paid order', async () => {
  addPendingOrder();
  storedOrders[0].paymongoSessionId = 'cs_test_123';
  const payload = {
    data: {
      type: 'checkout_session.payment.paid',
      livemode: false,
      data: {
        id: 'cs_test_123',
        attributes: {
          reference_number: storedOrders[0].id,
          payments: [{ attributes: { status: 'paid', amount: 12500, currency: 'PHP' } }]
        }
      }
    }
  };
  let rawBody = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const createSignature = body => crypto.createHmac('sha256', process.env.PAYMONGO_WEBHOOK_SECRET)
    .update(`${timestamp}.${body}`)
    .digest('hex');

  const invalid = await request(webhookHandler, 'POST', rawBody, {
    'paymongo-signature': `t=${timestamp},te=${'0'.repeat(64)},li=${'0'.repeat(64)}`
  });
  assert.equal(invalid.statusCode, 401);
  assert.equal(storedOrders.length, 1);
  assert.equal(storedTransactions.length, 0);

  payload.data.data.attributes.payments[0].attributes.amount = 1;
  rawBody = JSON.stringify(payload);
  const mismatchedAmount = await request(webhookHandler, 'POST', rawBody, {
    'paymongo-signature': `t=${timestamp},te=${createSignature(rawBody)},li=${'0'.repeat(64)}`
  });
  assert.equal(mismatchedAmount.statusCode, 400);
  assert.equal(storedOrders.length, 1);
  assert.equal(storedTransactions.length, 0);

  payload.data.data.attributes.payments[0].attributes.amount = 12500;
  rawBody = JSON.stringify(payload);
  const valid = await request(webhookHandler, 'POST', rawBody, {
    'paymongo-signature': `t=${timestamp},te=${createSignature(rawBody)},li=${'0'.repeat(64)}`
  });
  assert.equal(valid.statusCode, 200);
  assert.equal(storedOrders.length, 0);
  assert.equal(storedTransactions.length, 1);
  assert.equal(storedTransactions[0].status, 'Paid - Verified');
  assert.equal(storedTransactions[0].paymentMethod, 'PayMongo Hosted Checkout');
});
