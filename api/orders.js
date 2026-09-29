const crypto = require('node:crypto');
const { neon } = require('@neondatabase/serverless');
const { isAdminRequest } = require('../lib/admin-auth');

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
    date: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    paymentMethod: row.payment_method,
    status: row.status,
    total: Number(row.total),
    items: row.items
  };
}

function buildItems(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 50) {
    throw new Error('An order must contain between 1 and 50 items.');
  }

  return input.map(item => {
    const name = String(item.name || '').trim();
    const qty = Number(item.qty);
    const basePrice = Number(item.basePrice);
    const inputAddons = Array.isArray(item.addons) ? item.addons : [];
    if (!name || name.length > 200 || !Number.isInteger(qty) || qty < 1 || qty > 1000 || !Number.isFinite(basePrice) || basePrice < 0) {
      throw new Error('An order item has invalid details.');
    }
    if (inputAddons.length > 30) throw new Error('An item has too many add-ons.');

    const addons = inputAddons.map(addon => {
      const addonName = String(addon.name || '').trim();
      const price = Number(addon.price);
      if (!addonName || addonName.length > 120 || !Number.isFinite(price) || price < 0) {
        throw new Error('An order add-on has invalid details.');
      }
      return { name: addonName, price };
    });
    const unitPrice = basePrice + addons.reduce((sum, addon) => sum + addon.price, 0);
    return {
      id: String(item.id || '').slice(0, 100),
      name,
      qty,
      basePrice,
      unitPrice,
      addons,
      category: String(item.category || '').slice(0, 60),
      lineTotal: unitPrice * qty
    };
  });
}

async function ensureSchema(sql) {
  await sql`CREATE TABLE IF NOT EXISTS kapia_orders (
    id TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    customer_name TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    payment_method TEXT NOT NULL,
    status TEXT NOT NULL,
    total NUMERIC(12, 2) NOT NULL,
    items JSONB NOT NULL
  )`;
}

module.exports = async function orders(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(request.method)) {
    response.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return sendError(response, 405, 'Method not allowed.');
  }

  const adminPassword = process.env.ADMIN_PASSWORD;
  const databaseUrl = process.env.DATABASE_URL;
  if (!adminPassword) {
    return sendError(response, 503, 'Admin authentication is not configured on the server.');
  }

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
  if (!databaseUrl) {
    return sendError(response, 503, 'Order storage is not configured. Set DATABASE_URL in Vercel.');
  }

  try {
    const sql = neon(databaseUrl);
    await ensureSchema(sql);

    if (request.method === 'POST') {
      const customerName = String(request.body?.customerName || '').trim();
      const customerEmail = String(request.body?.customerEmail || '').trim();
      if (!customerName || customerName.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail) || customerEmail.length > 320) {
        return sendError(response, 400, 'Enter a valid customer name and email.');
      }

      let items;
      try {
        items = buildItems(request.body.items);
      } catch (error) {
        return sendError(response, 400, error.message);
      }
      const total = items.reduce((sum, item) => sum + item.lineTotal, 0);
      const order = {
        id: `KAP-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
        customerName,
        customerEmail,
        paymentMethod: 'QR PH / GCash (Pending)',
        status: 'Awaiting Payment',
        total,
        items
      };
      const rows = await sql`
        INSERT INTO kapia_orders (id, customer_name, customer_email, payment_method, status, total, items)
        VALUES (${order.id}, ${customerName}, ${customerEmail}, ${order.paymentMethod}, ${order.status}, ${total}, ${JSON.stringify(items)}::jsonb)
        RETURNING id, created_at, customer_name, customer_email, payment_method, status, total, items
      `;
      return response.status(201).json({ order: toOrder(rows[0]) });
    }

    if (request.method === 'GET') {
      const rows = await sql`SELECT id, created_at, customer_name, customer_email, payment_method, status, total, items FROM kapia_orders ORDER BY created_at DESC LIMIT 500`;
      return response.status(200).json(rows.map(toOrder));
    }

    if (request.method === 'PATCH') {
      const orderId = String(request.body?.id || '').trim();
      const status = String(request.body?.status || '');
      const paymentMethod = typeof request.body?.paymentMethod === 'string' ? request.body.paymentMethod.slice(0, 160) : null;
      if (!orderId || !ALLOWED_STATUSES.has(status)) return sendError(response, 400, 'Invalid order update.');

      const rows = await sql`
        UPDATE kapia_orders
        SET status = ${status}, payment_method = COALESCE(${paymentMethod}, payment_method)
        WHERE id = ${orderId}
        RETURNING id, created_at, customer_name, customer_email, payment_method, status, total, items
      `;
      if (!rows.length) return sendError(response, 404, 'Order not found.');
      return response.status(200).json({ order: toOrder(rows[0]) });
    }

    if (request.method === 'DELETE') {
      const orderId = String(request.body?.id || '').trim();
      if (orderId) await sql`DELETE FROM kapia_orders WHERE id = ${orderId}`;
      else await sql`DELETE FROM kapia_orders`;
      return response.status(200).json({ success: true });
    }

    return sendError(response, 405, 'Method not allowed.');
  } catch (error) {
    console.error('Order API error:', error);
    return sendError(response, 500, 'Could not access the order database. Check the Vercel database configuration.');
  }
};
