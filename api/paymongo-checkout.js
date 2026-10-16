const { getOrdersCollection } = require('../lib/mongodb');

function sendError(response, status, message) {
  return response.status(status).json({ error: message });
}

function getSiteUrl() {
  const configuredUrl = process.env.SITE_URL;
  if (!configuredUrl) return null;

  let siteUrl;
  try {
    siteUrl = new URL(configuredUrl);
  } catch (error) {
    return null;
  }
  const isLocalhost = siteUrl.hostname === 'localhost' || siteUrl.hostname === '127.0.0.1';
  if ((!isLocalhost && siteUrl.protocol !== 'https:') || siteUrl.username || siteUrl.password || siteUrl.pathname !== '/' || siteUrl.search || siteUrl.hash) return null;
  return siteUrl;
}

function getReturnUrl(siteUrl, orderId, result) {
  const returnUrl = new URL('/Kapia_Farm_Cafe_w%20admin.html', siteUrl);
  returnUrl.searchParams.set('payment', result);
  returnUrl.searchParams.set('order', orderId);
  return returnUrl.toString();
}

function buildLineItems(order) {
  return order.items.map(item => {
    const addonNames = (item.addons || []).map(addon => addon.name);
    const name = `${item.name}${addonNames.length ? ` (${addonNames.join(', ')})` : ''}`.slice(0, 255);
    return {
      name,
      amount: Math.round(Number(item.unitPrice) * 100),
      currency: 'PHP',
      quantity: item.qty
    };
  });
}

module.exports = async function paymongoCheckout(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return sendError(response, 405, 'Method not allowed.');
  }

  const secretKey = process.env.PAYMONGO_SECRET_KEY;
  if (!secretKey) return sendError(response, 503, 'Online payments are not configured. Set PAYMONGO_SECRET_KEY in Vercel.');
  if (!/^sk_(test|live)_/.test(secretKey)) {
    return sendError(response, 503, 'PAYMONGO_SECRET_KEY must be a PayMongo test or live secret key.');
  }
  if (!process.env.MONGODB_URI) {
    return sendError(response, 503, 'Order storage is not configured. Set MONGODB_URI in Vercel.');
  }

  const orderId = typeof request.body?.orderId === 'string' ? request.body.orderId.trim() : '';
  if (!/^KAP-[0-9]+-[A-F0-9]{6}$/.test(orderId)) return sendError(response, 400, 'Invalid order.');

  try {
    const ordersCollection = await getOrdersCollection();
    const order = await ordersCollection.findOne({ id: orderId });
    if (!order) return sendError(response, 404, 'Order not found.');
    if (order.status !== 'Awaiting Payment' || order.paymentMethod === 'Cash on Delivery') {
      return sendError(response, 409, 'This order is not awaiting online payment.');
    }
    if (order.paymongoCheckoutUrl) {
      return response.status(200).json({ checkoutUrl: order.paymongoCheckoutUrl });
    }

    const siteUrl = getSiteUrl();
    if (!siteUrl) return sendError(response, 503, 'Set SITE_URL to the public HTTPS website URL in Vercel.');
    const lineItems = buildLineItems(order);
    const lineTotalCents = lineItems.reduce((sum, item) => sum + item.amount * item.quantity, 0);
    const orderTotalCents = Math.round(Number(order.total) * 100);
    if (!lineItems.length
      || lineItems.some(item => !Number.isSafeInteger(item.amount) || item.amount < 0 || !Number.isInteger(item.quantity) || item.quantity < 1)
      || !Number.isSafeInteger(lineTotalCents)
      || lineTotalCents <= 0
      || lineTotalCents !== orderTotalCents) {
      return sendError(response, 400, 'The order total is invalid for online payment.');
    }

    const checkoutResponse = await fetch('https://api.paymongo.com/v2/checkout_sessions', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        data: {
          attributes: {
            line_items: lineItems,
            payment_method_types: ['card', 'gcash', 'qrph'],
            success_url: getReturnUrl(siteUrl, orderId, 'success'),
            cancel_url: getReturnUrl(siteUrl, orderId, 'cancelled'),
            reference_number: orderId,
            send_email_receipt: true,
            billing: {
              name: order.customerName,
              email: order.customerEmail
            }
          }
        }
      })
    });
    const responseText = await checkoutResponse.text();
    let checkout;
    try {
      checkout = JSON.parse(responseText);
    } catch (error) {
      console.error('PayMongo returned a non-JSON checkout response:', checkoutResponse.status);
      return sendError(response, 502, `PayMongo returned HTTP ${checkoutResponse.status} without JSON.`);
    }
    if (!checkoutResponse.ok) {
      console.error('PayMongo checkout creation failed:', checkoutResponse.status, checkout.errors || checkout.error);
      return sendError(response, 502, 'PayMongo could not start checkout. Please try again or choose cash on delivery.');
    }

    const sessionId = checkout.data?.id;
    const checkoutUrl = checkout.data?.attributes?.checkout_url;
    if (typeof sessionId !== 'string' || typeof checkoutUrl !== 'string') {
      console.error('PayMongo checkout response was missing session details.');
      return sendError(response, 502, 'PayMongo returned an invalid checkout response.');
    }
    let parsedCheckoutUrl;
    try {
      parsedCheckoutUrl = new URL(checkoutUrl);
    } catch (error) {
      return sendError(response, 502, 'PayMongo returned an invalid checkout URL.');
    }
    if (parsedCheckoutUrl.protocol !== 'https:' || parsedCheckoutUrl.hostname !== 'checkout.paymongo.com') {
      console.error('PayMongo checkout response contained an unexpected checkout URL.');
      return sendError(response, 502, 'PayMongo returned an invalid checkout URL.');
    }

    await ordersCollection.updateOne(
      { id: orderId, status: 'Awaiting Payment' },
      {
        $set: {
          paymongoSessionId: sessionId,
          paymongoCheckoutUrl: checkoutUrl,
          paymentMethod: 'PayMongo Hosted Checkout'
        }
      }
    );
    return response.status(200).json({ checkoutUrl });
  } catch (error) {
    console.error('PayMongo checkout API error:', error);
    return sendError(response, 500, error.message || 'Could not start PayMongo checkout.');
  }
};
