const { getTransactionsCollection } = require('./mongodb');

async function archiveTransaction(order) {
  const transactionsCollection = await getTransactionsCollection();
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
          total: order.total,
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

module.exports = { archiveTransaction };
