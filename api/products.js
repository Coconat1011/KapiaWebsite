const crypto = require('node:crypto');
const { getProductsCollection } = require('../lib/mongodb');
const { isAdminRequest } = require('../lib/admin-auth');
const DEFAULT_PRODUCTS = require('../lib/default-products');

const ALLOWED_CATEGORIES = new Set(['fertilizer', 'feeds', 'foods_drinks']);
const MAX_IMAGE_LENGTH = 3_000_000;

function sendError(response, status, message) {
  return response.status(status).json({ error: message });
}

function normalizeProduct(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Enter valid product details.');
  }

  const category = String(input.category || '');
  const name = String(input.name || '').trim();
  const desc = String(input.desc || '').trim();
  const price = Number(input.price);
  const image = typeof input.image === 'string' ? input.image.trim() : '';
  const inStock = input.inStock !== false;
  const inputAddons = Array.isArray(input.addons) ? input.addons : [];

  if (!ALLOWED_CATEGORIES.has(category) || !name || name.length > 200 || desc.length > 2000 || !Number.isFinite(price) || price < 0 || price > 1000000000) {
    throw new Error('Enter a valid name, category, description, and price.');
  }
  if (input.inStock !== undefined && typeof input.inStock !== 'boolean') {
    throw new Error('Choose a valid stock status.');
  }
  if (image.length > MAX_IMAGE_LENGTH || (image && !/^(https?:\/\/|data:image\/)/i.test(image))) {
    throw new Error('Use an HTTP(S) image URL or an image smaller than 2 MB.');
  }
  if (inputAddons.length > 30) throw new Error('A product can have at most 30 add-ons.');

  const addons = inputAddons.map((addon, index) => {
    const addonName = String(addon?.name || '').trim();
    const addonPrice = Number(addon?.price);
    if (!addonName || addonName.length > 120 || !Number.isFinite(addonPrice) || addonPrice < 0 || addonPrice > 1000000) {
      throw new Error('An add-on has invalid details.');
    }
    return {
      id: String(addon.id || `addon-${index}`).slice(0, 100),
      name: addonName,
      price: addonPrice
    };
  });

  return { category, name, desc, price, image, inStock, addons };
}

function withoutStorageFields(product) {
  const { _id, deleted, ...publicProduct } = product;
  return publicProduct;
}

async function cleanupUnusedProductImage(collection, imageUrl) {
  if (!imageUrl) return;
  try {
    const products = await listProducts(collection);
    if (products.some(product => product.image === imageUrl)) return;
    await require('../lib/edgestore').deleteProductImage(imageUrl);
  } catch (error) {
    console.error('EdgeStore image cleanup failed:', error);
  }
}

async function listProducts(collection) {
  const storedProducts = await collection.find({}).toArray();
  const storedById = new Map(storedProducts.map(product => [product.id, product]));
  const defaultIds = new Set(DEFAULT_PRODUCTS.map(product => product.id));
  const products = [];

  for (const defaultProduct of DEFAULT_PRODUCTS) {
    const storedProduct = storedById.get(defaultProduct.id);
    if (storedProduct?.deleted) continue;
    const product = storedProduct
      ? { ...defaultProduct, ...withoutStorageFields(storedProduct) }
      : { ...defaultProduct };
    products.push({ ...product, inStock: product.inStock !== false });
  }

  for (const storedProduct of storedProducts) {
    if (!defaultIds.has(storedProduct.id) && !storedProduct.deleted) {
      const product = withoutStorageFields(storedProduct);
      products.push({ ...product, inStock: product.inStock !== false });
    }
  }

  return products;
}

module.exports = async function products(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(request.method)) {
    response.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return sendError(response, 405, 'Method not allowed.');
  }

  if (request.method !== 'GET' && !isAdminRequest(request, process.env.ADMIN_PASSWORD || 'kapiaadmin')) {
    return sendError(response, 401, 'Admin login is required.');
  }
  if (!process.env.MONGODB_URI) {
    return sendError(response, 503, 'Product storage is not configured. Set MONGODB_URI in Vercel.');
  }

  try {
    const collection = await getProductsCollection();

    if (request.method === 'GET') {
      return response.status(200).json(await listProducts(collection));
    }

    if (request.method === 'POST') {
      let product;
      try {
        product = { id: `custom-${crypto.randomUUID()}`, ...normalizeProduct(request.body?.product) };
      } catch (error) {
        return sendError(response, 400, error.message);
      }
      await collection.insertOne(product);
      return response.status(201).json({ product });
    }

    const productId = String(request.body?.id || '').trim();
    if (!productId) return sendError(response, 400, 'A product ID is required.');

    if (request.method === 'PATCH') {
      let values;
      try {
        values = normalizeProduct(request.body?.product);
      } catch (error) {
        return sendError(response, 400, error.message);
      }
      const previousProduct = (await listProducts(collection)).find(product => product.id === productId);
      if (!previousProduct) return sendError(response, 404, 'Product not found.');
      const product = { id: productId, ...values };
      await collection.updateOne({ id: productId }, { $set: product, $unset: { deleted: '' } }, { upsert: true });
      if (previousProduct.image !== product.image) {
        await cleanupUnusedProductImage(collection, previousProduct.image);
      }
      return response.status(200).json({ product });
    }

    const previousProduct = (await listProducts(collection)).find(product => product.id === productId);
    if (DEFAULT_PRODUCTS.some(product => product.id === productId)) {
      await collection.updateOne({ id: productId }, { $set: { id: productId, deleted: true } }, { upsert: true });
    } else {
      await collection.deleteOne({ id: productId });
    }
    if (previousProduct) await cleanupUnusedProductImage(collection, previousProduct.image);
    return response.status(200).json({ success: true });
  } catch (error) {
    console.error('Product API error:', error);
    return sendError(response, 500, 'Could not access MongoDB. Check MONGODB_URI and the Atlas network access settings.');
  }
};