const crypto = require('node:crypto');
const { getOrdersCollection } = require('../lib/mongodb');
const { archiveTransaction } = require('../lib/transactions');

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_SIGNATURE_AGE_SECONDS = 300;

function sendError(response, status, message) {
  return response.status(status).json({ error: message });
}

async function readRawBody(request) {
  if (Buffer.isBuffer(request.body)) return request.body;
  if (typeof request.body === 'string') return Buffer.from(request.body);

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('Webhook request is too large.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function isValidSignature(rawBody, header, webhookSecret, livemode) {
  if (typeof header !== 'string') return false;
  const values = Object.fromEntries(header.split(',').map(part => {
    const separator = part.indexOf('=');
    return separator < 0 ? ['', ''] : [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
  }));
  const timestamp = Number(values.t);
  const signature = values[livemode ? 'li' : 'te'];
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(timestamp) || timestamp > now + 60 || now - timestamp > MAX_SIGNATURE_AGE_SECONDS) return false;
  if (!/^[a-f0-9]{64}$/i.test(signature || '')) return false;

  const expected = crypto.createHmac('sha256', webhookSecret)
    .update(`${timestamp}.${rawBody.toString('utf8')}`)
    .digest();
  const received = Buffer.from(signature, 'hex');
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

async function archivePaidOrder(order) {
  await archiveTransaction(order);
  await (await getOrdersCollection()).deleteOne({ id: order.id });
}

module.exports = async function paymongoWebhook(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return sendError(response, 405, 'Method not allowed.');
  }

  const webhookSecret = process.env.PAYMONGO_WEBHOOK_SECRET;
  if (!webhookSecret) return sendError(response, 503, 'PayMongo webhook is not configured.');
  if (!process.env.MONGODB_URI) {
    return sendError(response, 503, 'Order storage is not configured. Set MONGODB_URI in Vercel.');
  }

  try {
    const rawBody = await readRawBody(request);
    if (rawBody.length > MAX_BODY_BYTES) return sendError(response, 413, 'Webhook request is too large.');

    let payload;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch (error) {
      return sendError(response, 400, 'Invalid webhook payload.');
    }
    const signature = request.headers?.['paymongo-signature'] || request.headers?.['Paymongo-Signature'];
    if (!isValidSignature(rawBody, signature, webhookSecret, payload.data?.livemode === true)) {
      return sendError(response, 401, 'Invalid PayMongo webhook signature.');
    }

    const event = payload.data;
    if (event?.type !== 'checkout_session.payment.paid') {
      return response.status(200).json({ received: true });
    }

    const session = event.data;
    const attributes = session?.attributes;
    const paidPayment = attributes?.payments?.find(payment => payment.attributes?.status === 'paid');
    const orderId = attributes?.reference_number;
    if (!session?.id || !orderId || !paidPayment) {
      return sendError(response, 400, 'Paid checkout event is missing payment details.');
    }

    const ordersCollection = await getOrdersCollection();
    const order = await ordersCollection.findOne({ id: orderId, paymongoSessionId: session.id });
    if (!order) {
      console.warn('Received a PayMongo payment for an unknown checkout session.');
      return response.status(200).json({ received: true });
    }

    const expectedAmount = Math.round(Number(order.total) * 100);
    if (paidPayment.attributes.currency !== 'PHP' || Number(paidPayment.attributes.amount) !== expectedAmount) {
      console.error('PayMongo payment amount or currency did not match the order:', order.id);
      return sendError(response, 400, 'Paid checkout amount does not match the order.');
    }

    if (order.status === 'Awaiting Payment' || order.status === 'Awaiting COD / Pickup') {
      await ordersCollection.updateOne(
        { id: order.id, paymongoSessionId: session.id, status: order.status },
        { $set: { status: 'Paid - Verified', paymentMethod: 'PayMongo Hosted Checkout' } }
      );
    } else if (order.status !== 'Paid - Verified') {
      return response.status(200).json({ received: true });
    }

    const paidOrder = await ordersCollection.findOne({ id: order.id, paymongoSessionId: session.id });
    if (paidOrder?.status === 'Paid - Verified') await archivePaidOrder(paidOrder);
    return response.status(200).json({ received: true });
  } catch (error) {
    console.error('PayMongo webhook error:', error);
    return sendError(response, error.statusCode || 500, error.statusCode ? error.message : 'Could not process the PayMongo webhook.');
  }
};

module.exports.config = { api: { bodyParser: false } };
