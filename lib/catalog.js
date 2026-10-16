const DEFAULT_PRODUCTS = require('./default-products');

function withoutStorageFields(product) {
  const { _id, deleted, ...publicProduct } = product;
  return publicProduct;
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

module.exports = { listProducts };
