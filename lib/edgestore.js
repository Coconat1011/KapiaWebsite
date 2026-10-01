const { initEdgeStore } = require('@edgestore/server');
const { initEdgeStoreClient } = require('@edgestore/server/core');

const MAX_IMAGE_SIZE = 2 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const FILE_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif'
};

const edgeStore = initEdgeStore.create();
const router = edgeStore.router({
  productImages: edgeStore.imageBucket({ maxSize: MAX_IMAGE_SIZE, accept: IMAGE_TYPES })
});
const client = initEdgeStoreClient({ router });

async function uploadProductImage(buffer, contentType) {
  const result = await client.productImages.upload({
    content: {
      blob: new Blob([buffer], { type: contentType }),
      extension: FILE_EXTENSIONS[contentType]
    }
  });
  return result.url;
}

async function deleteProductImage(url) {
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return false;
  }
  if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== 'files.edgestore.dev') return false;

  await client.productImages.deleteFile({ url });
  return true;
}

module.exports = { IMAGE_TYPES, MAX_IMAGE_SIZE, deleteProductImage, uploadProductImage };