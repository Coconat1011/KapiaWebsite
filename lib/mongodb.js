const { MongoClient } = require('mongodb');

const GLOBAL_CLIENT_KEY = '__kapiaMongoClientPromise';

async function getOrdersCollection() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('Set MONGODB_URI in Vercel Project Settings > Environment Variables.');

  if (!globalThis[GLOBAL_CLIENT_KEY]) {
    const client = new MongoClient(uri, {
      maxPoolSize: 5,
      serverSelectionTimeoutMS: 10000
    });
    globalThis[GLOBAL_CLIENT_KEY] = client.connect();
  }

  const client = await globalThis[GLOBAL_CLIENT_KEY];
  const databaseName = process.env.MONGODB_DB_NAME || 'kapia_farm_cafe';
  return client.db(databaseName).collection('orders');
}

module.exports = { getOrdersCollection };
