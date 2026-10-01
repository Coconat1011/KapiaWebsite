const CURRENCY = '\u20b1';
const PLACEHOLDER_IMAGE = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="256" viewBox="0 0 400 256"><rect width="100%" height="100%" fill="#eee"/><text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" fill="#888" font-family="sans-serif" font-size="16">Kapia Farm Cafe</text></svg>');
const LEGACY_CATEGORY_ADDONS = [
  { id: 'ad1', name: 'Extra Shot', price: 25 },
  { id: 'ad2', name: 'Oat Milk', price: 30 },
  { id: 'ad3', name: 'Extra Syrup', price: 15 },
  { id: 'ad4', name: 'Extra Cheese', price: 20 }
];

let editingImage = '';
let imageUploadPromise = null;
let cropSession = null;
let ordersCache = [];
let productsCache = [];

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
}

function formatPrice(value) {
  return CURRENCY + Number(value || 0).toFixed(2);
}

function getImageSource(source) {
  return /^(https?:\/\/|data:image\/)/i.test(source || '') ? source : PLACEHOLDER_IMAGE;
}

function categoryName(category) {
  return category === 'feeds' ? 'Feeds' : category === 'foods_drinks' ? 'Foods & Drinks' : 'Fertilizer';
}

function renderProducts() {
  const list = document.getElementById('admin-products-list');
  const products = productsCache;
  if (!products.length) {
    list.innerHTML = '<p class="empty-state">No products found. Add a product to get started.</p>';
    return;
  }
  list.innerHTML = products.map(product => `
    <article class="product-card" data-product-id="${escapeHTML(product.id)}">
      <img class="product-image" src="${escapeHTML(getImageSource(product.image))}" alt="${escapeHTML(product.name)}" loading="lazy">
      <div class="product-copy">
        <p class="eyebrow">${escapeHTML(categoryName(product.category))}</p>
        <h3>${escapeHTML(product.name)}</h3>
        <p class="product-price">${formatPrice(product.price)}</p>
        <p><span class="stock-label ${product.inStock === false ? 'stock-out' : 'stock-in'}">${product.inStock === false ? 'Out of stock' : 'In stock'}</span></p>
        <p class="product-description">${escapeHTML(product.desc || '')}</p>
        <div class="product-actions">
          <button type="button" class="button button-primary" data-action="edit-product">Edit</button>
          <button type="button" class="button button-danger" data-action="delete-product">Delete</button>
        </div>
      </div>
    </article>`).join('');
  list.querySelectorAll('.product-image').forEach(image => {
    image.addEventListener('error', () => { image.src = PLACEHOLDER_IMAGE; }, { once: true });
  });
}

async function loadProducts() {
  const list = document.getElementById('admin-products-list');
  list.textContent = 'Loading products...';
  try {
    const response = await fetch('/api/products', { cache: 'no-store' });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Could not load products.');
    productsCache = Array.isArray(result) ? result : [];
    renderProducts();
  } catch (error) {
    list.textContent = error.message || 'Could not connect to the product service.';
  }
}

function renderOrders() {
  const list = document.getElementById('admin-orders-list');
  const orders = ordersCache;
  document.getElementById('admin-order-count').textContent = orders.length;
  if (!orders.length) {
    list.innerHTML = '<p class="empty-state">No customer orders yet.</p>';
    return;
  }
  list.innerHTML = orders.map((order, index) => {
    const isCompleted = order.status === 'Completed';
    const isPaid = order.status === 'Paid - Verified';
    const isCod = order.status === 'Awaiting COD / Pickup';
    const statusClass = isPaid || isCompleted ? 'status-good' : isCod ? 'status-info' : 'status-pending';
    const items = (order.items || []).map(item => {
      const addons = item.addons?.length ? ` <span class="muted">(+ ${item.addons.map(addon => escapeHTML(addon.name)).join(', ')})</span>` : '';
      const total = item.lineTotal || (Number(item.unitPrice) || 0) * (Number(item.qty) || 1);
      return `<li><strong>${escapeHTML(item.name)}</strong>${addons} × ${Number(item.qty) || 1} <span class="line-total">${formatPrice(total)}</span></li>`;
    }).join('');
    return `
      <article class="order-card" data-order-id="${escapeHTML(order.id || index)}">
        <header class="order-heading">
          <div><h3>Order #${escapeHTML(order.id || index + 1)}</h3><p class="muted">${escapeHTML(order.date || '')}</p></div>
          <span class="status ${statusClass}">${escapeHTML(order.status || 'Awaiting Payment')}</span>
        </header>
        <div class="order-details">
          <p><strong>Customer</strong>${escapeHTML(order.customerName || 'Guest')}</p>
          <p><strong>Email</strong>${escapeHTML(order.customerEmail || '—')}</p>
          <p><strong>Payment</strong>${escapeHTML(order.paymentMethod || 'Checkout')}</p>
          <p><strong>Total</strong><span class="product-price">${formatPrice(order.total)}</span></p>
        </div>
        <div class="ordered-items"><strong>Ordered items</strong><ul>${items}</ul></div>
        <div class="order-actions">
          <button type="button" class="button button-primary" data-action="${isPaid ? 'mark-unpaid' : 'mark-paid'}">${isPaid ? 'Mark unpaid' : 'Confirm payment'}</button>
          <button type="button" class="button button-danger" data-action="delete-order">Delete order</button>
        </div>
      </article>`;
  }).join('');
}

async function loadOrders() {
  const list = document.getElementById('admin-orders-list');
  list.textContent = 'Loading orders...';
  try {
    const response = await fetch('/api/orders', {
      headers: { Authorization: `Bearer ${sessionStorage.getItem('kapia-admin-token') || ''}` }
    });
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) {
      sessionStorage.removeItem('kapia-admin-token');
      showLogin();
      throw new Error('Your admin session expired. Please sign in again.');
    }
    if (!response.ok) throw new Error(result.error || 'Could not load customer orders.');
    ordersCache = Array.isArray(result) ? result : [];
    renderOrders();
  } catch (error) {
    list.textContent = error.message || 'Could not connect to the order service.';
  }
}

function showTab(tab) {
  const productsSelected = tab === 'products';
  document.getElementById('admin-products-panel').hidden = !productsSelected;
  document.getElementById('admin-orders-panel').hidden = productsSelected;
  document.getElementById('admin-tab-products').classList.toggle('active', productsSelected);
  document.getElementById('admin-tab-orders').classList.toggle('active', !productsSelected);
  document.getElementById('admin-tab-products').setAttribute('aria-pressed', productsSelected);
  document.getElementById('admin-tab-orders').setAttribute('aria-pressed', !productsSelected);
  if (productsSelected) loadProducts();
  else loadOrders();
}

function showDashboard() {
  document.getElementById('admin-login-panel').hidden = true;
  document.getElementById('admin-dashboard').hidden = false;
  document.getElementById('admin-logout').hidden = false;
  showTab('orders');
}

function showLogin() {
  document.getElementById('admin-dashboard').hidden = true;
  document.getElementById('admin-login-panel').hidden = false;
  document.getElementById('admin-logout').hidden = true;
  document.getElementById('admin-password').value = '';
  document.getElementById('admin-password').focus();
}

function addAddonRow(addon = {}) {
  const row = document.createElement('div');
  row.className = 'addon-row';
  row.innerHTML = '<input class="addon-id" type="hidden"><label>Name<input class="addon-name" required></label><label>Price<input class="addon-price" type="number" min="0" step="any" required></label><button class="button button-danger" type="button" data-remove-addon>Remove</button>';
  row.querySelector('.addon-id').value = addon.id || '';
  row.querySelector('.addon-name').value = addon.name || '';
  row.querySelector('.addon-price').value = addon.price ?? '';
  document.getElementById('product-addons-list').appendChild(row);
}

function getFormAddons() {
  return [...document.querySelectorAll('#product-addons-list .addon-row')].map((row, index) => ({
    id: row.querySelector('.addon-id').value || `addon-${Date.now()}-${index}`,
    name: row.querySelector('.addon-name').value.trim(),
    price: Number(row.querySelector('.addon-price').value)
  })).filter(addon => addon.name && Number.isFinite(addon.price) && addon.price >= 0);
}

function openProductForm(productId = '') {
  const product = productsCache.find(entry => entry.id === productId);
  const form = document.getElementById('product-form');
  form.reset();
  document.getElementById('product-edit-id').value = product?.id || '';
  document.getElementById('product-form-title').textContent = product ? 'Edit product' : 'Add product';
  document.getElementById('product-name-input').value = product?.name || '';
  document.getElementById('product-category-input').value = product?.category || 'fertilizer';
  document.getElementById('product-price-input').value = product?.price ?? '';
  document.getElementById('product-desc-input').value = product?.desc || '';
  document.getElementById('product-stock-input').value = product?.inStock === false ? 'out' : 'in';
  const productAddons = Array.isArray(product?.addons)
    ? product.addons
    : product?.category === 'foods_drinks' ? LEGACY_CATEGORY_ADDONS : [];
  const addonList = document.getElementById('product-addons-list');
  addonList.replaceChildren();
  productAddons.forEach(addon => addAddonRow(addon));
  editingImage = product?.image || '';
  document.getElementById('product-image-url-input').value = editingImage.startsWith('data:') ? '' : editingImage;
  imageUploadPromise = null;
  const uploadStatus = document.getElementById('product-image-upload-status');
  uploadStatus.textContent = '';
  uploadStatus.hidden = true;
  delete uploadStatus.dataset.state;
  updateImagePreview();
  document.getElementById('product-form-modal').hidden = false;
  document.getElementById('product-name-input').focus();
}

function updateImagePreview() {
  const image = document.getElementById('product-image-preview');
  const container = document.getElementById('product-image-container');
  container.hidden = !editingImage;
  image.src = getImageSource(editingImage);
}

function closeProductForm() {
  document.getElementById('product-form-modal').hidden = true;
}

async function saveProduct(event) {
  event.preventDefault();
  if (imageUploadPromise) return;
  const name = document.getElementById('product-name-input').value.trim();
  const price = Number(document.getElementById('product-price-input').value);
  if (!name || !Number.isFinite(price) || price < 0) return;
  const productId = document.getElementById('product-edit-id').value;
  const values = {
    category: document.getElementById('product-category-input').value,
    name,
    price,
    desc: document.getElementById('product-desc-input').value.trim(),
    image: editingImage,
    inStock: document.getElementById('product-stock-input').value === 'in',
    addons: getFormAddons()
  };
  const submitButton = document.querySelector('#product-form button[type="submit"]');
  submitButton.disabled = true;
  try {
    const response = await fetch('/api/products', {
      method: productId ? 'PATCH' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionStorage.getItem('kapia-admin-token') || ''}`
      },
      body: JSON.stringify(productId ? { id: productId, product: values } : { product: values })
    });
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) {
      sessionStorage.removeItem('kapia-admin-token');
      closeProductForm();
      showLogin();
      throw new Error('Your admin session expired. Please sign in again.');
    }
    if (!response.ok) throw new Error(result.error || 'Could not save this product.');
    closeProductForm();
    await loadProducts();
  } catch (error) {
    alert(error.message || 'Could not connect to the product service.');
  } finally {
    submitButton.disabled = false;
  }
}

async function removeProduct(productId) {
  if (!confirm('Delete this product?')) return;
  try {
    const response = await fetch('/api/products', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionStorage.getItem('kapia-admin-token') || ''}`
      },
      body: JSON.stringify({ id: productId })
    });
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) {
      sessionStorage.removeItem('kapia-admin-token');
      showLogin();
      throw new Error('Your admin session expired. Please sign in again.');
    }
    if (!response.ok) throw new Error(result.error || 'Could not delete this product.');
    await loadProducts();
  } catch (error) {
    alert(error.message || 'Could not connect to the product service.');
  }
}

async function updateOrder(orderId, action) {
  if (action === 'delete-order' && !confirm('Delete this order record?')) return;
  const isDelete = action === 'delete-order';
  try {
    const response = await fetch('/api/orders', {
      method: isDelete ? 'DELETE' : 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionStorage.getItem('kapia-admin-token') || ''}`
      },
      body: JSON.stringify(isDelete
        ? { id: orderId }
        : { id: orderId, status: action === 'mark-paid' ? 'Paid - Verified' : 'Awaiting Payment' })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Could not update this order.');
    await loadOrders();
  } catch (error) {
    alert(error.message || 'Could not connect to the order service.');
  }
}

async function clearAllOrders() {
  if (!confirm('Delete all customer orders from the shared dashboard?')) return;
  try {
    const response = await fetch('/api/orders', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${sessionStorage.getItem('kapia-admin-token') || ''}` }
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Could not clear customer orders.');
    await loadOrders();
  } catch (error) {
    alert(error.message || 'Could not connect to the order service.');
  }
}

document.getElementById('admin-login-form').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget;
  const loginButton = form.querySelector('button[type="submit"]');
  const errorMessage = document.getElementById('admin-login-error');
  loginButton.disabled = true;
  errorMessage.hidden = true;
  fetch('/api/admin-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: document.getElementById('admin-password').value })
  }).then(async response => {
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Admin sign-in failed.');
    sessionStorage.setItem('kapia-admin-token', result.token);
    showDashboard();
  }).catch(error => {
    errorMessage.textContent = error.message || 'Could not connect to admin sign-in.';
    errorMessage.hidden = false;
  }).finally(() => {
    loginButton.disabled = false;
  });
});

document.getElementById('admin-logout').addEventListener('click', () => {
  sessionStorage.removeItem('kapia-admin-token');
  showLogin();
});
document.getElementById('admin-tab-products').addEventListener('click', () => showTab('products'));
document.getElementById('admin-tab-orders').addEventListener('click', () => showTab('orders'));
document.getElementById('add-product').addEventListener('click', () => openProductForm());
document.getElementById('add-product-addon').addEventListener('click', () => addAddonRow());
document.getElementById('product-addons-list').addEventListener('click', event => {
  if (event.target.closest('[data-remove-addon]')) event.target.closest('.addon-row').remove();
});
document.getElementById('clear-orders').addEventListener('click', clearAllOrders);
document.getElementById('product-form').addEventListener('submit', saveProduct);
document.querySelectorAll('[data-close-product-form]').forEach(button => button.addEventListener('click', closeProductForm));
document.getElementById('admin-products-list').addEventListener('click', event => {
  const button = event.target.closest('button[data-action]');
  const card = button?.closest('[data-product-id]');
  if (!button || !card) return;
  if (button.dataset.action === 'edit-product') openProductForm(card.dataset.productId);
  else if (button.dataset.action === 'delete-product') removeProduct(card.dataset.productId);
});
document.getElementById('admin-orders-list').addEventListener('click', event => {
  const button = event.target.closest('button[data-action]');
  const card = button?.closest('[data-order-id]');
  if (!button || !card) return;
  updateOrder(card.dataset.orderId, button.dataset.action);
});
document.getElementById('product-image-url-input').addEventListener('input', event => {
  editingImage = event.target.value.trim();
  updateImagePreview();
});
document.getElementById('product-image-input').addEventListener('change', event => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
    alert('Choose a JPEG, PNG, WebP, or GIF image.');
    event.target.value = '';
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    alert('Choose an image smaller than 2 MB.');
    event.target.value = '';
    return;
  }
  imageUploadPromise = prepareAndUploadProductImage(file);
});

function renderCropImage(session, preserveCenter = false) {
  const viewport = session.viewport.getBoundingClientRect();
  const centerX = preserveCenter ? session.x + session.width / 2 : viewport.width / 2;
  const centerY = preserveCenter ? session.y + session.height / 2 : viewport.height / 2;
  session.viewportWidth = viewport.width;
  session.viewportHeight = viewport.height;
  session.baseScale = Math.max(viewport.width / session.image.naturalWidth, viewport.height / session.image.naturalHeight);
  session.scale = session.baseScale * Number(document.getElementById('image-crop-zoom').value);
  session.width = session.image.naturalWidth * session.scale;
  session.height = session.image.naturalHeight * session.scale;
  session.x = Math.min(0, Math.max(viewport.width - session.width, centerX - session.width / 2));
  session.y = Math.min(0, Math.max(viewport.height - session.height, centerY - session.height / 2));
  session.image.style.width = `${session.width}px`;
  session.image.style.height = `${session.height}px`;
  session.image.style.left = `${session.x}px`;
  session.image.style.top = `${session.y}px`;
}

function finishProductImageCrop(file, error) {
  if (!cropSession) return;
  const session = cropSession;
  cropSession = null;
  URL.revokeObjectURL(session.objectUrl);
  document.getElementById('image-crop-modal').hidden = true;
  document.getElementById('image-crop-status').hidden = true;
  if (error) session.reject(error);
  else session.resolve(file);
}

function openProductImageCrop(file) {
  return new Promise((resolve, reject) => {
    const image = document.getElementById('image-crop-preview');
    const viewport = document.getElementById('image-crop-viewport');
    const objectUrl = URL.createObjectURL(file);
    cropSession = { file, image, viewport, objectUrl, resolve, reject, x: 0, y: 0, width: 0, height: 0 };
    document.getElementById('image-crop-zoom').value = '1';
    document.getElementById('image-crop-status').hidden = true;
    document.getElementById('image-crop-modal').hidden = false;
    image.onload = () => {
      if (!cropSession) return;
      renderCropImage(cropSession);
      document.getElementById('image-crop-zoom').focus();
    };
    image.onerror = () => finishProductImageCrop(null, new Error('Could not open this photo.'));
    image.src = objectUrl;
  });
}

function canvasToBlob(canvas) {
  return new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.84));
}

async function createCroppedProductImage(session) {
  const sourceX = -session.x / session.scale;
  const sourceY = -session.y / session.scale;
  const sourceWidth = session.viewportWidth / session.scale;
  const sourceHeight = session.viewportHeight / session.scale;
  let canvas = document.createElement('canvas');
  canvas.width = 900;
  canvas.height = 600;
  let context = canvas.getContext('2d');
  context.drawImage(session.image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
  let blob = await canvasToBlob(canvas);

  if (!blob) throw new Error('Could not crop this photo.');
  if (blob.size > 2 * 1024 * 1024) {
    canvas = document.createElement('canvas');
    canvas.width = 720;
    canvas.height = 480;
    context = canvas.getContext('2d');
    context.drawImage(session.image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
    blob = await canvasToBlob(canvas);
  }
  if (!blob || blob.size > 2 * 1024 * 1024) throw new Error('The cropped photo is still larger than 2 MB. Zoom in and try again.');

  const extension = blob.type === 'image/webp' ? 'webp' : blob.type === 'image/jpeg' ? 'jpg' : 'png';
  const name = session.file.name.replace(/\.[^.]+$/, '') || 'product-photo';
  return new File([blob], `${name}-cropped.${extension}`, { type: blob.type || 'image/png' });
}

async function applyProductImageCrop() {
  if (!cropSession) return;
  const applyButton = document.getElementById('image-crop-apply');
  const status = document.getElementById('image-crop-status');
  applyButton.disabled = true;
  status.hidden = true;
  try {
    const croppedFile = await createCroppedProductImage(cropSession);
    finishProductImageCrop(croppedFile);
  } catch (error) {
    status.textContent = error.message || 'Could not crop this photo.';
    status.dataset.state = 'error';
    status.hidden = false;
  } finally {
    applyButton.disabled = false;
  }
}

async function prepareAndUploadProductImage(file) {
  const fileInput = document.getElementById('product-image-input');
  try {
    const croppedFile = await openProductImageCrop(file);
    if (croppedFile) await uploadProductImage(croppedFile);
    else fileInput.value = '';
  } catch (error) {
    const status = document.getElementById('product-image-upload-status');
    status.textContent = error.message || 'Could not prepare this photo.';
    status.dataset.state = 'error';
    status.hidden = false;
    fileInput.value = '';
  } finally {
    imageUploadPromise = null;
  }
}

const cropViewport = document.getElementById('image-crop-viewport');
cropViewport.addEventListener('pointerdown', event => {
  if (!cropSession) return;
  event.preventDefault();
  cropViewport.setPointerCapture(event.pointerId);
  cropViewport.classList.add('is-dragging');
  cropSession.drag = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: cropSession.x, y: cropSession.y };
});
cropViewport.addEventListener('pointermove', event => {
  if (!cropSession?.drag || cropSession.drag.pointerId !== event.pointerId) return;
  cropSession.x = cropSession.drag.x + event.clientX - cropSession.drag.clientX;
  cropSession.y = cropSession.drag.y + event.clientY - cropSession.drag.clientY;
  renderCropImage(cropSession, true);
});
function endCropDrag() {
  cropViewport.classList.remove('is-dragging');
  if (cropSession) cropSession.drag = null;
}
cropViewport.addEventListener('pointerup', endCropDrag);
cropViewport.addEventListener('pointercancel', endCropDrag);
document.getElementById('image-crop-zoom').addEventListener('input', () => {
  if (cropSession) renderCropImage(cropSession, true);
});
window.addEventListener('resize', () => {
  if (cropSession?.image.naturalWidth) renderCropImage(cropSession, true);
});
document.getElementById('image-crop-apply').addEventListener('click', applyProductImageCrop);
document.getElementById('image-crop-cancel').addEventListener('click', () => finishProductImageCrop(null));
document.getElementById('image-crop-close').addEventListener('click', () => finishProductImageCrop(null));

async function uploadProductImage(file) {
  const status = document.getElementById('product-image-upload-status');
  const fileInput = document.getElementById('product-image-input');
  const urlInput = document.getElementById('product-image-url-input');
  const saveButton = document.querySelector('#product-form button[type="submit"]');
  const closeButtons = document.querySelectorAll('[data-close-product-form]');
  const clearButton = document.getElementById('product-image-clear');
  status.textContent = 'Uploading photo...';
  status.hidden = false;
  status.dataset.state = 'uploading';
  fileInput.disabled = true;
  urlInput.disabled = true;
  clearButton.disabled = true;
  saveButton.disabled = true;
  closeButtons.forEach(button => { button.disabled = true; });

  try {
    const image = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener('load', () => resolve(String(reader.result || '')));
      reader.addEventListener('error', () => reject(new Error('Could not read the selected photo.')));
      reader.readAsDataURL(file);
    });
    const response = await fetch('/api/upload-image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionStorage.getItem('kapia-admin-token') || ''}`
      },
      body: JSON.stringify({ image })
    });
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) {
      sessionStorage.removeItem('kapia-admin-token');
      closeProductForm();
      showLogin();
      throw new Error('Your admin session expired. Please sign in again.');
    }
    if (!response.ok || typeof result.url !== 'string') {
      throw new Error(result.error || 'Could not upload this photo.');
    }

    editingImage = result.url;
    urlInput.value = result.url;
    updateImagePreview();
    status.textContent = 'Photo uploaded to EdgeStore.';
    status.dataset.state = 'success';
  } catch (error) {
    status.textContent = error.message || 'Could not upload this photo.';
    status.dataset.state = 'error';
    fileInput.value = '';
  } finally {
    fileInput.disabled = false;
    urlInput.disabled = false;
    clearButton.disabled = false;
    saveButton.disabled = false;
    closeButtons.forEach(button => { button.disabled = false; });
  }
}

document.getElementById('product-image-clear').addEventListener('click', () => {
  editingImage = '';
  imageUploadPromise = null;
  document.getElementById('product-image-input').value = '';
  document.getElementById('product-image-url-input').value = '';
  const uploadStatus = document.getElementById('product-image-upload-status');
  uploadStatus.textContent = '';
  uploadStatus.hidden = true;
  delete uploadStatus.dataset.state;
  updateImagePreview();
});
async function restoreAdminSession() {
  const token = sessionStorage.getItem('kapia-admin-token');
  if (!token) {
    showLogin();
    return;
  }
  const response = await fetch('/api/orders', { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
  if (response?.ok) showDashboard();
  else {
    sessionStorage.removeItem('kapia-admin-token');
    showLogin();
  }
}

restoreAdminSession();
window.setInterval(() => {
  if (!document.getElementById('admin-dashboard').hidden && !document.getElementById('admin-orders-panel').hidden) loadOrders();
}, 20000);
