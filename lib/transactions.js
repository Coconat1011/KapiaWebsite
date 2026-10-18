const { getTransactionsCollection } = require('./mongodb');

const SERVICE_CHARGE_RATE = 0.05;

function getTransactionAmounts(order) {
  const hasStoredSubtotal = Number.isFinite(Number(order.subtotal));
  const subtotalCents = Math.round((hasStoredSubtotal ? Number(order.subtotal) : Number(order.total)) * 100);
  const storedServiceChargeCents = Number.isFinite(Number(order.serviceCharge))
    ? Math.round(Number(order.serviceCharge) * 100)
    : Math.round(subtotalCents * SERVICE_CHARGE_RATE);
  const totalCents = hasStoredSubtotal
    ? Math.round(Number(order.total) * 100)
    : subtotalCents + storedServiceChargeCents;

  return {
    subtotal: subtotalCents / 100,
    serviceCharge: storedServiceChargeCents / 100,
    total: totalCents / 100
  };
}

async function archiveTransaction(order) {
  const transactionsCollection = await getTransactionsCollection();
  const amounts = getTransactionAmounts(order);
  try {
    await transactionsCollection.updateOne(
      { _id: order.id },
      {
        $setOnInsert: {
          _id: order.id,
          orderId: order.id,
          id: order.id,
          createdAt: order.createdAt,
          confirmedAt: new Date(),
          customerName: order.customerName,
          customerEmail: order.customerEmail,
          paymentMethod: order.paymentMethod,
          status: 'Paid - Verified',
          subtotal: amounts.subtotal,
          serviceCharge: amounts.serviceCharge,
          total: amounts.total,
          items: order.items,
          paymentScreenshot: order.paymentScreenshot || ''
        }
      },
      { upsert: true }
    );
  } catch (error) {
    if (error.code !== 11000 || !await transactionsCollection.findOne({ _id: order.id })) throw error;
  }
}

module.exports = { SERVICE_CHARGE_RATE, archiveTransaction, getTransactionAmounts };