const crypto = require('node:crypto');
const { getOrdersCollection, getProductsCollection, getTransactionsCollection } = require('../lib/mongodb');
const { getAdminPassword, isAdminRequest } = require('../lib/admin-auth');
const { listProducts } = require('../lib/catalog');
const { archiveTransaction } = require('../lib/transactions');

const ALLOWED_STATUSES = new Set([
  'Awaiting Payment',
  'Payment Reported',
  'Paid - Verified',
  'Awaiting COD / Pickup',
  'Completed'
]);

function sendError(response, status, message) {
  return response.status(status).json({ error: message });
}

function toOrder(row) {
  return {
    id: row.id,
    date: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    customerName: row.customerName,
    customerEmail: row.customerEmail,
    paymentMethod: row.paymentMethod,
    status: row.status,
    total: Number(row.total),
    items: row.items
  };
}

function toTransaction(row) {
  return {
    ...toOrder(row),
    confirmedAt: row.confirmedAt instanceof Date ? row.confirmedAt.toISOString() : row.confirmedAt
  };
}

function buildItems(input, products) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 50) {
    throw new Error('An order must contain between 1 and 50 items.');
  }

  return input.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('An order item has invalid details.');
    }
    const id = String(item.id || '').trim();
    const product = products.find(entry => entry.id === id);
    const qty = Number(item.qty);
    const inputAddons = Array.isArray(item.addons) ? item.addons : [];
    if (!product || product.inStock === false || !Number.isInteger(qty) || qty < 1 || qty > 1000) {
      throw new Error('An order item has invalid details.');
    }
    if (inputAddons.length > 30) throw new Error('An item has too many add-ons.');

    const addons = inputAddons.map(addon => {
      const addonName = typeof addon?.name === 'string' ? addon.name.trim() : '';
      const catalogAddon = (product.addons || []).find(entry => entry.name === addonName);
      if (!catalogAddon) {
        throw new Error('An order add-on has invalid details.');
      }
      return { name: catalogAddon.name, price: Number(catalogAddon.price) };
    });
    const basePrice = Number(product.price);
    const basePriceCents = Math.round(basePrice * 100);
    const addonPriceCents = addons.map(addon => Math.round(addon.price * 100));
    if (!Number.isSafeInteger(basePriceCents) || basePriceCents < 0 || addonPriceCents.some(price => !Number.isSafeInteger(price) || price < 0)) {
      throw new Error('An order item has invalid details.');
    }
    const unitPriceCents = basePriceCents + addonPriceCents.reduce((sum, price) => sum + price, 0);
    if (!Number.isSafeInteger(unitPriceCents) || !Number.isSafeInteger(unitPriceCents * qty)) {
      throw new Error('An order item has invalid details.');
    }
    const category = String(product.category || '').slice(0, 60);
    return {
      id,
      name: product.name,
      qty,
      basePrice: Math.round(basePrice * 100) / 100,
      unitPrice: unitPriceCents / 100,
      addons,
      category,
      instruction: category === 'fertilizer' || category === 'feeds' ? String(product.instruction || '').slice(0, 2000) : '',
      ingredients: category === 'foods_drinks' ? String(product.ingredients || '').slice(0, 2000) : '',
      lineTotal: unitPriceCents * qty / 100
    };
  });
}

module.exports = async function orders(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(request.method)) {
    response.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return sendError(response, 405, 'Method not allowed.');
  }

  const adminPassword = getAdminPassword();
  const mongoUri = process.env.MONGODB_URI;

  if ((request.method === 'GET' || request.method === 'DELETE') && !isAdminRequest(request, adminPassword)) {
    return sendError(response, 401, 'Admin login is required.');
  }
  if (request.method === 'PATCH') {
    const requestedStatus = String(request.body?.status || '');
    const isCustomerUpdate = requestedStatus === 'Payment Reported' || requestedStatus === 'Awaiting COD / Pickup';
    if (!isCustomerUpdate && !isAdminRequest(request, adminPassword)) {
      return sendError(response, 401, 'Admin login is required.');
    }
  }
  if (!mongoUri) {
    return sendError(response, 503, 'Order storage is not configured. Set MONGODB_URI in Vercel.');
  }

  try {
    const ordersCollection = await getOrdersCollection();
    const isHistoryRequest = request.query?.history === '1';

    if (request.method === 'POST') {
      const customerName = String(request.body?.customerName || '').trim();
      const customerEmail = String(request.body?.customerEmail || '').trim();
      const hasValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail);
      if (!customerName || customerName.length > 200 || !hasValidEmail || customerEmail.length > 320) {
        return sendError(response, 400, 'Enter a customer name and a valid email address.');
      }

      const products = await listProducts(await getProductsCollection());
      let items;
      try {
        items = buildItems(request.body.items, products);
      } catch (error) {
        return sendError(response, 400, error.message);
      }
      const totalCents = items.reduce((sum, item) => sum + Math.round(item.lineTotal * 100), 0);
      const order = {
        id: `KAP-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
        createdAt: new Date(),
        customerName,
        customerEmail,
        paymentMethod: 'PayMongo Checkout',
        status: 'Awaiting Payment',
        total: totalCents / 100,
        items
      };
      await ordersCollection.insertOne(order);
      return response.status(201).json({ order: toOrder(order) });
    }

    if (request.method === 'GET') {
      if (isHistoryRequest) {
        const transactionsCollection = await getTransactionsCollection();
        const transactions = await transactionsCollection.find({}).sort({ confirmedAt: -1 }).limit(500).toArray();
        return response.status(200).json(transactions.map(toTransaction));
      }
      const orders = await ordersCollection.find({}).sort({ createdAt: -1 }).limit(500).toArray();
      return response.status(200).json(orders.map(toOrder));
    }

    if (request.method === 'PATCH') {
      const orderId = String(request.body?.id || '').trim();
      const status = String(request.body?.status || '');
      const paymentMethod = typeof request.body?.paymentMethod === 'string' ? request.body.paymentMethod.slice(0, 160) : null;
      if (!orderId || !ALLOWED_STATUSES.has(status)) return sendError(response, 400, 'Invalid order update.');

      const update = { status };
      if (paymentMethod !== null) update.paymentMethod = paymentMethod;
      const result = await ordersCollection.updateOne({ id: orderId }, { $set: update });
      if (!result.matchedCount) return sendError(response, 404, 'Order not found.');
      const updatedOrder = await ordersCollection.findOne({ id: orderId });
      if (status === 'Paid - Verified') {
        await archiveTransaction(updatedOrder);
        await ordersCollection.deleteOne({ id: updatedOrder.id });
      }
      return response.status(200).json({ order: toOrder(updatedOrder) });
    }

    if (request.method === 'DELETE') {
      if (request.body?.history === true) {
        const transactionsCollection = await getTransactionsCollection();
        const orderId = String(request.body?.id || '').trim();
        if (orderId) await transactionsCollection.deleteOne({ orderId });
        else await transactionsCollection.deleteMany({});
        return response.status(200).json({ success: true });
      }
      const orderId = String(request.body?.id || '').trim();
      if (orderId) await ordersCollection.deleteOne({ id: orderId });
      else await ordersCollection.deleteMany({});
      return response.status(200).json({ success: true });
    }

    return sendError(response, 405, 'Method not allowed.');
  } catch (error) {
    console.error('Order API error:', error);
    return sendError(response, 500, 'Could not access MongoDB. Check MONGODB_URI and the Atlas network access settings.');
  }
};
