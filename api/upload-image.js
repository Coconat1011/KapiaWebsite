const { getAdminPassword, isAdminRequest } = require('../lib/admin-auth');

const MAX_IMAGE_SIZE = 2 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function sendError(response, status, message) {
  return response.status(status).json({ error: message });
}

module.exports = async function uploadImage(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return sendError(response, 405, 'Method not allowed.');
  }
  if (!isAdminRequest(request, getAdminPassword())) {
    return sendError(response, 401, 'Admin login is required.');
  }
  if (!process.env.EDGE_STORE_ACCESS_KEY || !process.env.EDGE_STORE_SECRET_KEY) {
    return sendError(response, 503, 'Photo storage is not configured. Set EDGE_STORE_ACCESS_KEY and EDGE_STORE_SECRET_KEY.');
  }

  const dataUrl = typeof request.body?.image === 'string' ? request.body.image : '';
  const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match || !SUPPORTED_IMAGE_TYPES.has(match[1])) {
    return sendError(response, 400, 'Choose a JPEG, PNG, WebP, or GIF image.');
  }

  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > MAX_IMAGE_SIZE || buffer.toString('base64') !== match[2]) {
    return sendError(response, 400, 'Choose an image no larger than 2 MB.');
  }

  try {
    const { uploadProductImage } = require('../lib/edgestore');
    const url = await uploadProductImage(buffer, match[1]);
    return response.status(201).json({ url });
  } catch (error) {
    console.error('EdgeStore image upload failed:', error);
    return sendError(response, 502, 'Could not upload the photo to EdgeStore. Check the storage credentials and try again.');
  }
};