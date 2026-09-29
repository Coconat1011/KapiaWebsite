const CURRENCY = '\u20b1';
const ADMIN_PASSWORD = 'kapiaadmin';
const PLACEHOLDER_IMAGE = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="256" viewBox="0 0 400 256"><rect width="100%" height="100%" fill="#eee"/><text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" fill="#888" font-family="sans-serif" font-size="16">Kapia Farm Cafe</text></svg>');
const DEFAULT_PRODUCTS = [
  { id: 'f1', category: 'fertilizer', name: 'Complete Fertilizer 14-14-14', desc: 'Balanced fertilizer for healthy crop growth.', price: 850, image: 'https://images.pexels.com/photos/7768447/pexels-photo-7768447.jpeg' },
  { id: 'f2', category: 'fertilizer', name: 'Urea 46-0-0', desc: 'Nitrogen fertilizer for vigorous plant growth.', price: 900, image: 'https://images.pexels.com/photos/31673795/pexels-photo-31673795.jpeg' },
  { id: 'f3', category: 'fertilizer', name: 'Organic Compost', desc: 'Organic soil conditioner for garden and farm crops.', price: 250, image: 'https://images.pexels.com/photos/32938346/pexels-photo-32938346.jpeg' },
  { id: 'f4', category: 'fertilizer', name: 'Complete Fertilizer 16-16-16', desc: 'All-purpose fertilizer for a wide range of crops.', price: 880, image: 'https://images.pexels.com/photos/11996941/pexels-photo-11996941.jpeg' },
  { id: 'f5', category: 'fertilizer', name: 'Ammonium Phosphate', desc: 'Phosphorus and nitrogen fertilizer.', price: 950, image: 'https://images.pexels.com/photos/15388810/pexels-photo-15388810.jpeg' },
  { id: 'f6', category: 'fertilizer', name: 'Vermicast', desc: 'Natural organic fertilizer for healthier soil.', price: 180, image: 'https://images.pexels.com/photos/25974981/pexels-photo-25974981.jpeg' },
  { id: 'fd1', category: 'feeds', name: 'Hog Starter Feed', desc: 'Starter feed for young pigs.', price: 1200, image: 'https://images.pexels.com/photos/6192537/pexels-photo-6192537.jpeg' },
  { id: 'fd2', category: 'feeds', name: 'Hog Grower Feed', desc: 'Feed for growing pigs.', price: 1150, image: 'https://images.pexels.com/photos/5216150/pexels-photo-5216150.jpeg' },
  { id: 'fd3', category: 'feeds', name: 'Broiler Starter Feed', desc: 'Starter feed for young broilers.', price: 1100, image: 'https://images.pexels.com/photos/32653692/pexels-photo-32653692.jpeg' },
  { id: 'fd4', category: 'feeds', name: 'Broiler Finisher Feed', desc: 'Finisher feed for broilers.', price: 1050, image: 'https://images.pexels.com/photos/11350102/pexels-photo-11350102.jpeg' },
  { id: 'fd5', category: 'feeds', name: 'Layer Feed', desc: 'Feed formulated for laying hens.', price: 980, image: 'https://images.pexels.com/photos/6724094/pexels-photo-6724094.jpeg' },
  { id: 'fd6', category: 'feeds', name: 'Cattle Feed', desc: 'Nutritious feed for cattle.', price: 1300, image: 'https://images.pexels.com/photos/4840958/pexels-photo-4840958.jpeg' },
  { id: 'fdri1', category: 'foods_drinks', name: 'Kapia Farm Coffee', desc: 'Freshly brewed farm cafe coffee.', price: 80, image: 'https://images.pexels.com/photos/459489/pexels-photo-459489.jpeg' },
  { id: 'fdri2', category: 'foods_drinks', name: 'Iced Coffee', desc: 'Cold and refreshing coffee.', price: 95, image: 'https://images.pexels.com/photos/9715331/pexels-photo-9715331.jpeg' },
  { id: 'fdri3', category: 'foods_drinks', name: 'Farm Breakfast', desc: 'Hearty breakfast with local ingredients.', price: 180, image: 'https://images.pexels.com/photos/18972781/pexels-photo-18972781.jpeg' },
  { id: 'fdri4', category: 'foods_drinks', name: 'Chicken Sandwich', desc: 'Freshly prepared chicken sandwich.', price: 150, image: 'https://images.pexels.com/photos/9240536/pexels-photo-9240536.jpeg' },
  { id: 'fdri5', category: 'foods_drinks', name: 'Banana Bread', desc: 'Soft homemade banana bread.', price: 75, image: 'https://images.pexels.com/photos/5441033/pexels-photo-5441033.jpeg' },
  { id: 'fdri6', category: 'foods_drinks', name: 'Fresh Fruit Shake', desc: 'Refreshing shake made with fresh fruit.', price: 110, image: 'https://images.pexels.com/photos/8743884/pexels-photo-8743884.jpeg' }
];
const LEGACY_CATEGORY_ADDONS = [
  { id: 'ad1', name: 'Extra Shot', price: 25 },
  { id: 'ad2', name: 'Oat Milk', price: 30 },
  { id: 'ad3', name: 'Extra Syrup', price: 15 },
  { id: 'ad4', name: 'Extra Cheese', price: 20 }
];

let editingImage = '';

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
}

function getProducts() {
  try {
    const stored = JSON.parse(localStorage.getItem('kapia-products') || 'null');
    if (Array.isArray(stored)) return stored;
  } catch (error) {
    console.warn('Could not read saved products:', error);
  }
  return DEFAULT_PRODUCTS.map(product => ({ ...product }));
}

function saveProducts(products) {
  try {
    localStorage.setItem('kapia-products', JSON.stringify(products));
    renderProducts();
    return true;
  } catch (error) {
    alert('Could not save products. Try a smaller image or remove unused products.');
    return false;
  }
}

function getOrders() {
  try {
    const orders = JSON.parse(localStorage.getItem('kapia-orders') || '[]');
    return Array.isArray(orders) ? orders : [];
  } catch (error) {
    console.warn('Could not read saved orders:', error);
    return [];
  }
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
  const products = getProducts();
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

function renderOrders() {
  const list = document.getElementById('admin-orders-list');
  const orders = getOrders();
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
          <button type="button" class="button button-primary" data-action="toggle-status">${isCompleted ? 'Mark Pending' : 'Mark Completed'}</button>
          <button type="button" class="button button-danger" data-action="delete-order">Delete order</button>
        </div>
      </article>`;
  }).join('');
}

function showTab(tab) {
  const productsSelected = tab === 'products';
  document.getElementById('admin-products-panel').hidden = !productsSelected;
  document.getElementById('admin-orders-panel').hidden = productsSelected;
  document.getElementById('admin-tab-products').classList.toggle('active', productsSelected);
  document.getElementById('admin-tab-orders').classList.toggle('active', !productsSelected);
  document.getElementById('admin-tab-products').setAttribute('aria-pressed', productsSelected);
  document.getElementById('admin-tab-orders').setAttribute('aria-pressed', !productsSelected);
  if (productsSelected) renderProducts();
  else renderOrders();
}

function showDashboard() {
  document.getElementById('admin-login-panel').hidden = true;
  document.getElementById('admin-dashboard').hidden = false;
  document.getElementById('admin-logout').hidden = false;
  showTab('products');
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
  const product = getProducts().find(entry => entry.id === productId);
  const form = document.getElementById('product-form');
  form.reset();
  document.getElementById('product-edit-id').value = product?.id || '';
  document.getElementById('product-form-title').textContent = product ? 'Edit product' : 'Add product';
  document.getElementById('product-name-input').value = product?.name || '';
  document.getElementById('product-category-input').value = product?.category || 'fertilizer';
  document.getElementById('product-price-input').value = product?.price ?? '';
  document.getElementById('product-desc-input').value = product?.desc || '';
  const productAddons = Array.isArray(product?.addons)
    ? product.addons
    : product?.category === 'foods_drinks' ? LEGACY_CATEGORY_ADDONS : [];
  const addonList = document.getElementById('product-addons-list');
  addonList.replaceChildren();
  productAddons.forEach(addon => addAddonRow(addon));
  editingImage = product?.image || '';
  document.getElementById('product-image-url-input').value = editingImage.startsWith('data:') ? '' : editingImage;
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

function saveProduct(event) {
  event.preventDefault();
  const name = document.getElementById('product-name-input').value.trim();
  const price = Number(document.getElementById('product-price-input').value);
  if (!name || !Number.isFinite(price) || price < 0) return;
  const productId = document.getElementById('product-edit-id').value;
  const products = getProducts();
  const product = products.find(entry => entry.id === productId);
  const values = {
    category: document.getElementById('product-category-input').value,
    name,
    price,
    desc: document.getElementById('product-desc-input').value.trim(),
    image: editingImage,
    addons: getFormAddons()
  };
  if (product) Object.assign(product, values);
  else products.push({ id: 'custom-' + Date.now(), ...values });
  if (saveProducts(products)) closeProductForm();
}

function removeProduct(productId) {
  if (!confirm('Delete this product?')) return;
  saveProducts(getProducts().filter(product => product.id !== productId));
}

function updateOrder(orderId, action) {
  const orders = getOrders();
  const order = orders.find(entry => entry.id === orderId);
  if (!order) return;
  if (action === 'delete') {
    if (!confirm('Delete this order record?')) return;
    localStorage.setItem('kapia-orders', JSON.stringify(orders.filter(entry => entry.id !== orderId)));
  } else {
    order.status = order.status === 'Completed' ? 'Pending' : 'Completed';
    localStorage.setItem('kapia-orders', JSON.stringify(orders));
  }
  renderOrders();
}

function clearAllOrders() {
  if (!confirm('Delete all customer orders saved in this browser?')) return;
  localStorage.removeItem('kapia-orders');
  renderOrders();
}

document.getElementById('admin-login-form').addEventListener('submit', event => {
  event.preventDefault();
  const password = document.getElementById('admin-password').value;
  if (password === ADMIN_PASSWORD) {
    sessionStorage.setItem('kapia-admin', 'true');
    document.getElementById('admin-login-error').hidden = true;
    showDashboard();
  } else {
    document.getElementById('admin-login-error').hidden = false;
  }
});

document.getElementById('admin-logout').addEventListener('click', () => {
  sessionStorage.removeItem('kapia-admin');
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
  const action = button.dataset.action === 'delete-order' ? 'delete' : 'toggle';
  updateOrder(card.dataset.orderId, action);
});
document.getElementById('product-image-url-input').addEventListener('input', event => {
  editingImage = event.target.value.trim();
  updateImagePreview();
});
document.getElementById('product-image-input').addEventListener('change', event => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    alert('Choose an image file.');
    event.target.value = '';
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    alert('Choose an image smaller than 2 MB.');
    event.target.value = '';
    return;
  }
  const reader = new FileReader();
  reader.addEventListener('load', () => {
    editingImage = String(reader.result || '');
    document.getElementById('product-image-url-input').value = '';
    updateImagePreview();
  });
  reader.readAsDataURL(file);
});
document.getElementById('product-image-clear').addEventListener('click', () => {
  editingImage = '';
  document.getElementById('product-image-input').value = '';
  document.getElementById('product-image-url-input').value = '';
  updateImagePreview();
});
window.addEventListener('storage', event => {
  if (event.key === 'kapia-products') renderProducts();
  if (event.key === 'kapia-orders' && !document.getElementById('admin-orders-panel').hidden) renderOrders();
});

if (sessionStorage.getItem('kapia-admin') === 'true') showDashboard();
else showLogin();
