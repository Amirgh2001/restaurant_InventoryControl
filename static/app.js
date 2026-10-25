/**
 * Restaurant Inventory System (سامانه مدیریت موجودی رستوران)
 * Pure Modern JavaScript Application with Touch-first UX and Comprehensive Business Logic
 */

const state = {
  token: localStorage.getItem('ctrl_token') || null,
  user: null,
  allowedLocations: [],
  meta: {
    items: [],
    categories: [],
    all_locations: [],
    user_locations: [],
    units: [],
    waste_reasons: []
  },
  activeTab: 'fast-actions', // fast-actions, matrix, transactions, stocktake, analytics, settings
  currentAction: null, // inbound, transfer, consumption, waste (selected in step 1)
  selectedItem: null,
  selectedCategory: null,
  searchQuery: '',
  touchQuantity: '1',
  numpadData: {
    from_location_id: null,
    to_location_id: null,
    location_id: null,
    unit_id: null,
    reason_id: null,
    notes: '',
    batch_number: '',
    expiry_date: ''
  },
  matrixData: [],
  alertsData: [],
  dashboardData: null,
  transactionsData: [],
  stocktakeList: [],
  currentStocktake: null,
  filterParams: {
    transaction_type: '',
    item_id: '',
    location_id: '',
    start_date: '',
    end_date: ''
  }
};

// ----------------- Persian Date & Live Clock Helpers -----------------
function getPersianFullDate(date = new Date()) {
  try {
    return new Intl.DateTimeFormat('fa-IR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    }).format(date);
  } catch (e) {
    return date.toLocaleDateString('fa-IR');
  }
}

function getPersianTime(date = new Date()) {
  try {
    return new Intl.DateTimeFormat('fa-IR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(date);
  } catch (e) {
    return date.toLocaleTimeString('fa-IR');
  }
}

function formatPersianDate(dateStr, includeTime = true) {
  if (!dateStr) return '-';
  try {
    const cleanStr = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T');
    const date = new Date(cleanStr);
    if (isNaN(date.getTime())) return dateStr;
    const options = {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    };
    if (includeTime) {
      options.hour = '2-digit';
      options.minute = '2-digit';
    }
    return new Intl.DateTimeFormat('fa-IR', options).format(date);
  } catch (e) {
    return dateStr;
  }
}

// ----------------- Persian Search & Text Normalization -----------------
function normalizePersianText(str) {
  if (!str) return '';
  return str.toString()
    .toLowerCase()
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, ' ') // zero-width non-joiner / joiner
    .replace(/\s+/g, ' ')
    .trim();
}

function matchesSearch(target, query) {
  if (!query) return true;
  const nTarget = normalizePersianText(target);
  const nQuery = normalizePersianText(query);
  if (!nQuery) return true;
  if (nTarget.includes(nQuery)) return true;
  const words = nQuery.split(' ').filter(Boolean);
  return words.every(w => nTarget.includes(w));
}

let liveClockInterval = null;
function startLiveClock() {
  if (liveClockInterval) clearInterval(liveClockInterval);
  liveClockInterval = setInterval(() => {
    const now = new Date();
    const dateStr = getPersianFullDate(now);
    const timeStr = getPersianTime(now);

    const hDate = document.getElementById('live-header-date');
    const hTime = document.getElementById('live-header-time');
    if (hDate) hDate.innerText = dateStr;
    if (hTime) hTime.innerText = timeStr;

    const fDate = document.getElementById('fast-actions-live-date');
    const fTime = document.getElementById('fast-actions-live-time');
    if (fDate) fDate.innerText = dateStr;
    if (fTime) fTime.innerText = timeStr;
  }, 1000);
}

// ----------------- API Client -----------------
async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) {
    headers['Authorization'] = `Bearer ${state.token}`;
  }

  try {
    const res = await fetch(path, { ...options, headers });
    
    // Check if response is file download
    const disposition = res.headers.get('Content-Disposition');
    if (disposition && disposition.includes('attachment')) {
      const blob = await res.blob();
      const filename = disposition.split('filename=')[1]?.replace(/"/g, '') || 'download.xlsx';
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      return { success: true };
    }

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'خطایی در ارتباط با سرور رخ داد.');
    }
    return data;
  } catch (err) {
    showToast(err.message, 'error');
    throw err;
  }
}

// ----------------- Notification / Toast -----------------
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let icon = '🔔';
  if (type === 'success') icon = '✅';
  if (type === 'error') icon = '⚠️';
  
  toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ----------------- Auth Functions -----------------
async function login(username, password) {
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    state.token = data.token;
    state.user = data.user;
    state.allowedLocations = data.allowed_locations;
    localStorage.setItem('ctrl_token', data.token);
    
    // Set default tab based on role
    if (state.user.role === 'operator') {
      state.activeTab = 'fast-actions';
    } else {
      state.activeTab = 'matrix';
    }

    showToast(data.message, 'success');
    await loadInitialData();
  } catch (err) {
    // Error handled in api()
  }
}

function logout() {
  state.token = null;
  state.user = null;
  localStorage.removeItem('ctrl_token');
  render();
}

async function checkAuth() {
  if (!state.token) {
    render();
    return;
  }
  try {
    const data = await api('/api/auth/me');
    state.user = data.user;
    state.allowedLocations = data.allowed_locations;
    await loadInitialData();
  } catch (e) {
    logout();
  }
}

// ----------------- Data Loaders -----------------
async function loadInitialData() {
  try {
    const meta = await api('/api/meta');
    state.meta = meta;

    if (state.activeTab === 'fast-actions') {
      await loadStockMatrix();
    } else if (state.activeTab === 'matrix') {
      await loadStockMatrix();
    } else if (state.activeTab === 'dashboard') {
      await loadDashboard();
    } else if (state.activeTab === 'transactions') {
      await loadTransactions();
    } else if (state.activeTab === 'stocktake') {
      await loadStocktakeList();
    }

    render();
  } catch (err) {
    console.error("Initial load failed", err);
  }
}

async function loadStockMatrix() {
  const data = await api('/api/inventory/matrix');
  state.matrixData = data.matrix;
  const alertData = await api('/api/inventory/alerts');
  state.alertsData = alertData.alerts;
}

async function loadDashboard() {
  const data = await api('/api/reports/dashboard');
  state.dashboardData = data;
}

async function loadTransactions() {
  const query = new URLSearchParams(state.filterParams).toString();
  const data = await api(`/api/reports/transactions?${query}`);
  state.transactionsData = data.transactions;
}

async function loadStocktakeList() {
  const data = await api('/api/stocktake/list');
  state.stocktakeList = data.sessions;
}

// ----------------- Step 1 & 2 Fast Action Selection -----------------
function selectFastAction(action) {
  state.currentAction = action;
  render();
  setTimeout(() => {
    const el = document.getElementById('step2-items-container');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, 50);
}

function selectItemForAction(item) {
  if (!state.currentAction) {
    showToast('لطفاً ابتدا از گام ۱ نوع عملیات (ورود، انتقال، مصرف یا ضایعات) را انتخاب کنید.', 'error');
    const hero = document.querySelector('.action-hero');
    if (hero) {
      hero.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return;
  }
  openActionModal(state.currentAction, item);
}

// ----------------- Modal & Touch Numpad -----------------
function openActionModal(action, item = null) {
  state.currentAction = action;
  state.selectedItem = item || state.meta.items[0];
  state.touchQuantity = '1';

  const defaultLoc = state.meta.user_locations[0]?.id || state.meta.all_locations[0]?.id;
  const secondLoc = state.meta.all_locations.find(l => l.id !== defaultLoc)?.id || defaultLoc;

  state.numpadData = {
    location_id: defaultLoc,
    from_location_id: defaultLoc,
    to_location_id: secondLoc,
    unit_id: state.selectedItem?.base_unit_id || state.meta.units[0]?.id,
    reason_id: state.meta.waste_reasons[0]?.id,
    notes: '',
    batch_number: '',
    expiry_date: ''
  };

  renderActionModal();
}

function closeActionModal() {
  const modal = document.getElementById('action-modal-container');
  if (modal) modal.innerHTML = '';
}

function handleNumpadKey(key) {
  if (key === 'C') {
    state.touchQuantity = '0';
  } else if (key === 'DEL') {
    state.touchQuantity = state.touchQuantity.length > 1 ? state.touchQuantity.slice(0, -1) : '0';
  } else if (key === '.') {
    if (!state.touchQuantity.includes('.')) {
      state.touchQuantity += '.';
    }
  } else {
    // Digits
    if (state.touchQuantity === '0') {
      state.touchQuantity = key;
    } else {
      state.touchQuantity += key;
    }
  }
  updateNumpadDisplay();
}

function addQuickInc(amount) {
  let val = parseFloat(state.touchQuantity) || 0;
  val += amount;
  state.touchQuantity = (Math.round(val * 100) / 100).toString();
  updateNumpadDisplay();
}

function updateNumpadDisplay() {
  const el = document.getElementById('numpad-display-val');
  if (el) el.innerText = state.touchQuantity;
}

async function submitAction() {
  const qty = parseFloat(state.touchQuantity);
  if (!qty || qty <= 0) {
    showToast('لطفاً مقداری بزرگتر از صفر وارد کنید.', 'error');
    return;
  }

  const act = state.currentAction;
  let payload = {
    item_id: state.selectedItem.id,
    quantity: qty,
    unit_id: state.numpadData.unit_id,
    notes: state.numpadData.notes
  };

  let endpoint = '';
  if (act === 'inbound') {
    endpoint = '/api/inventory/inbound';
    payload.location_id = state.numpadData.location_id;
    payload.batch_number = state.numpadData.batch_number;
    payload.expiry_date = state.numpadData.expiry_date;
  } else if (act === 'transfer') {
    endpoint = '/api/inventory/transfer';
    payload.from_location_id = state.numpadData.from_location_id;
    payload.to_location_id = state.numpadData.to_location_id;
  } else if (act === 'consumption') {
    endpoint = '/api/inventory/consumption';
    payload.location_id = state.numpadData.location_id;
  } else if (act === 'waste') {
    endpoint = '/api/inventory/waste';
    payload.location_id = state.numpadData.location_id;
    payload.reason_id = state.numpadData.reason_id;
  }

  try {
    const res = await api(endpoint, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    showToast(res.message, 'success');
    closeActionModal();
    await loadInitialData();
  } catch (e) {
    // Error handled in api()
  }
}

// ----------------- Stocktake Workflow -----------------
async function openCreateStocktakeModal() {
  const locOptions = state.meta.all_locations.map(l => `<option value="${l.id}">${l.name}</option>`).join('');
  const modal = document.getElementById('action-modal-container');
  modal.innerHTML = `
    <div class="modal-overlay">
      <div class="modal-content" style="max-width: 480px;">
        <div class="modal-header">
          <h3>📋 آغاز دوره جدید انبارگردانی</h3>
          <button class="modal-close" onclick="closeActionModal()">✕</button>
        </div>
        <div class="modal-body">
          <div style="margin-bottom: 1rem;">
            <label style="font-weight:700; display:block; margin-bottom:0.4rem;">انتخاب مکان یا انبار جهت شمارش:</label>
            <select id="st-loc-id" class="search-input" style="padding: 0.6rem;">${locOptions}</select>
          </div>
          <div style="margin-bottom: 1rem;">
            <label style="font-weight:700; display:block; margin-bottom:0.4rem;">عنوان انبارگردانی:</label>
            <input type="text" id="st-title" class="search-input" value="انبارگردانی دوره ای - ${getPersianFullDate()}" style="padding: 0.6rem;" />
          </div>
          <div style="margin-bottom: 1.5rem;">
            <label style="font-weight:700; display:block; margin-bottom:0.4rem;">یادداشت یا توضیحات:</label>
            <textarea id="st-notes" class="search-input" style="height: 70px; padding: 0.6rem;" placeholder="توضیحات شیفت یا اعضای تیم شمارش..."></textarea>
          </div>
          <button class="btn-primary-action" onclick="submitCreateStocktake()">ایجاد و شروع شمارش اقلام</button>
        </div>
      </div>
    </div>
  `;
}

async function submitCreateStocktake() {
  const locId = document.getElementById('st-loc-id').value;
  const title = document.getElementById('st-title').value;
  const notes = document.getElementById('st-notes').value;

  try {
    const res = await api('/api/stocktake/create', {
      method: 'POST',
      body: JSON.stringify({ location_id: locId, title, notes })
    });
    showToast(res.message, 'success');
    closeActionModal();
    await viewStocktakeDetails(res.session_id);
  } catch (e) {}
}

async function viewStocktakeDetails(sessionId) {
  const details = await api(`/api/stocktake/${sessionId}`);
  state.currentStocktake = details;
  renderStocktakeSessionView();
}

async function saveStocktakeCounts(sessionId) {
  const inputs = document.querySelectorAll('.st-count-input');
  const counts = [];
  inputs.forEach(input => {
    const itemId = parseInt(input.dataset.itemId);
    const countedVal = parseFloat(input.value) || 0;
    const noteEl = document.querySelector(`.st-note-input[data-item-id="${itemId}"]`);
    counts.push({
      item_id: itemId,
      counted_quantity: countedVal,
      notes: noteEl ? noteEl.value : ''
    });
  });

  try {
    const res = await api(`/api/stocktake/${sessionId}/count`, {
      method: 'POST',
      body: JSON.stringify({ counts })
    });
    showToast(res.message, 'success');
    await viewStocktakeDetails(sessionId);
  } catch (e) {}
}

async function approveStocktake(sessionId) {
  if (!confirm('آیا مطمئن هستید؟ با تأیید این انبارگردانی، موجودی سیستم با مقادیر شمارش شده تطبیق داده شده و سند اصلاحی خودکار ثبت می‌شود.')) {
    return;
  }
  try {
    const res = await api(`/api/stocktake/${sessionId}/approve`, {
      method: 'POST'
    });
    showToast(res.message, 'success');
    await viewStocktakeDetails(sessionId);
    await loadStockMatrix();
  } catch (e) {}
}

// ----------------- Management (Add Items / Locations / Users) -----------------
function openAddItemModal() {
  const catOptions = state.meta.categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  const unitOptions = state.meta.units.map(u => `<option value="${u.id}">${u.name} (${u.symbol})</option>`).join('');

  const modal = document.getElementById('action-modal-container');
  modal.innerHTML = `
    <div class="modal-overlay">
      <div class="modal-content" style="max-width: 480px;">
        <div class="modal-header">
          <h3>📦 تعریف کالای جدید</h3>
          <button class="modal-close" onclick="closeActionModal()">✕</button>
        </div>
        <div class="modal-body">
          <div style="margin-bottom:0.8rem;">
            <label style="font-weight:700; display:block; margin-bottom:0.3rem;">نام کالا (مواد اولیه / ملزومات):</label>
            <input type="text" id="new-item-name" class="search-input" placeholder="مثلاً: فیله سالمون نروژی" required />
          </div>
          <div style="display:flex; gap:0.5rem; margin-bottom:0.8rem;">
            <div style="flex:1;">
              <label style="font-weight:700; display:block; margin-bottom:0.3rem;">کد کالا:</label>
              <input type="text" id="new-item-code" class="search-input" placeholder="ITM-021" />
            </div>
            <div style="flex:1;">
              <label style="font-weight:700; display:block; margin-bottom:0.3rem;">حداقل موجودی مجاز:</label>
              <input type="number" step="0.5" id="new-item-min" class="search-input" value="10" />
            </div>
          </div>
          <div style="display:flex; gap:0.5rem; margin-bottom:0.8rem;">
            <div style="flex:1;">
              <label style="font-weight:700; display:block; margin-bottom:0.3rem;">دسته‌بندی:</label>
              <select id="new-item-cat" class="search-input">${catOptions}</select>
            </div>
            <div style="flex:1;">
              <label style="font-weight:700; display:block; margin-bottom:0.3rem;">واحد اندازه‌گیری پایه:</label>
              <select id="new-item-unit" class="search-input">${unitOptions}</select>
            </div>
          </div>
          <div style="margin-bottom:1.2rem; display:flex; align-items:center; gap:0.5rem;">
            <input type="checkbox" id="new-item-quick" style="width: 18px; height: 18px;" />
            <label for="new-item-quick" style="font-weight:700;">افزودن به اقلام پرمصرف و سریع اپراتورها</label>
          </div>
          <button class="btn-primary-action" onclick="submitCreateItem()">ذخیره کالا</button>
        </div>
      </div>
    </div>
  `;
}

async function submitCreateItem() {
  const name = document.getElementById('new-item-name').value.trim();
  if (!name) {
    showToast('لطفاً نام کالا را وارد کنید.', 'error');
    return;
  }
  const payload = {
    name,
    code: document.getElementById('new-item-code').value.trim(),
    category_id: document.getElementById('new-item-cat').value,
    base_unit_id: document.getElementById('new-item-unit').value,
    min_stock_alert: parseFloat(document.getElementById('new-item-min').value) || 0,
    is_quick_access: document.getElementById('new-item-quick').checked
  };

  try {
    const res = await api('/api/manage/item', { method: 'POST', body: JSON.stringify(payload) });
    showToast(res.message, 'success');
    closeActionModal();
    await loadInitialData();
  } catch (e) {}
}

function openAddLocationModal() {
  const modal = document.getElementById('action-modal-container');
  modal.innerHTML = `
    <div class="modal-overlay">
      <div class="modal-content" style="max-width: 440px;">
        <div class="modal-header">
          <h3>🏢 تعریف مکان یا انبار جدید</h3>
          <button class="modal-close" onclick="closeActionModal()">✕</button>
        </div>
        <div class="modal-body">
          <div style="margin-bottom:0.8rem;">
            <label style="font-weight:700; display:block; margin-bottom:0.3rem;">نام مکان:</label>
            <input type="text" id="new-loc-name" class="search-input" placeholder="مثلاً: انبار خشکبار طبقه منفی یک" required />
          </div>
          <div style="margin-bottom:0.8rem;">
            <label style="font-weight:700; display:block; margin-bottom:0.3rem;">کد سیستمی مکان:</label>
            <input type="text" id="new-loc-code" class="search-input" placeholder="DRY_STORAGE" required />
          </div>
          <div style="margin-bottom:1.2rem;">
            <label style="font-weight:700; display:block; margin-bottom:0.3rem;">توضیحات و کاربرد:</label>
            <textarea id="new-loc-desc" class="search-input" style="height: 60px;"></textarea>
          </div>
          <button class="btn-primary-action" onclick="submitCreateLocation()">ثبت مکان جدید</button>
        </div>
      </div>
    </div>
  `;
}

async function submitCreateLocation() {
  const name = document.getElementById('new-loc-name').value.trim();
  const code = document.getElementById('new-loc-code').value.trim();
  if (!name || !code) {
    showToast('نام و کد مکان الزامی است.', 'error');
    return;
  }
  try {
    const res = await api('/api/manage/location', {
      method: 'POST',
      body: JSON.stringify({ name, code, description: document.getElementById('new-loc-desc').value.trim() })
    });
    showToast(res.message, 'success');
    closeActionModal();
    await loadInitialData();
  } catch (e) {}
}

// ----------------- Render Views -----------------

function render() {
  const activeEl = document.activeElement;
  const activeId = activeEl && activeEl.id ? activeEl.id : null;
  const selStart = (activeEl && typeof activeEl.selectionStart === 'number') ? activeEl.selectionStart : null;
  const selEnd = (activeEl && typeof activeEl.selectionEnd === 'number') ? activeEl.selectionEnd : null;

  const app = document.getElementById('app');
  if (!state.token || !state.user) {
    app.innerHTML = renderLogin();
    return;
  }

  app.innerHTML = `
    <!-- Top Header -->
    <header class="app-header">
      <div class="header-container">
        <div class="brand">
          <div class="brand-logo">🍽️</div>
          <div class="brand-text">
            <h1>کنترل هوشمند موجودی رستوران</h1>
            <span>سامانه عملیاتی و حسابداری انبارداری چندبخشی</span>
          </div>
        </div>

        <!-- Live Clock & Persian Calendar Widget -->
        <div class="header-datetime-widget">
          <div class="header-date">
            <span>🗓️</span>
            <span id="live-header-date">${getPersianFullDate()}</span>
          </div>
          <div class="header-time">
            <span>⏰</span>
            <span id="live-header-time">${getPersianTime()}</span>
          </div>
        </div>

        <div class="user-nav">
          <div class="user-badge">
            <span>👤 ${state.user.full_name}</span>
            <span class="role-pill role-${state.user.role}">${getRoleTitle(state.user.role)}</span>
          </div>
          <button class="btn-logout" onclick="logout()">
            <span>خروج</span>
            <span>🚪</span>
          </button>
        </div>
      </div>
    </header>

    <!-- Navigation Tabs -->
    <nav class="nav-tabs">
      <button class="tab-btn ${state.activeTab === 'fast-actions' ? 'active' : ''}" onclick="switchTab('fast-actions')">
        <span>⚡</span> <span>عملیات سریع لمسی</span>
      </button>
      <button class="tab-btn ${state.activeTab === 'matrix' ? 'active' : ''}" onclick="switchTab('matrix')">
        <span>🏢</span> <span>ماتریس موجودی انبارها</span>
      </button>
      ${['admin', 'supervisor', 'sysadmin'].includes(state.user.role) ? `
      <button class="tab-btn ${state.activeTab === 'item-registration' ? 'active' : ''}" onclick="switchTab('item-registration')">
        <span>📦</span> <span>ثبت کالا</span>
      </button>
      ` : ''}
      ${state.user.role !== 'operator' ? `
      <button class="tab-btn ${state.activeTab === 'dashboard' ? 'active' : ''}" onclick="switchTab('dashboard')">
        <span>📊</span> <span>داشبورد و آمار</span>
      </button>
      <button class="tab-btn ${state.activeTab === 'transactions' ? 'active' : ''}" onclick="switchTab('transactions')">
        <span>📜</span> <span>دفتر ثبت تراکنش‌ها</span>
      </button>
      <button class="tab-btn ${state.activeTab === 'stocktake' ? 'active' : ''}" onclick="switchTab('stocktake')">
        <span>🔍</span> <span>انبارگردانی و مغایرت</span>
      </button>
      <button class="tab-btn ${state.activeTab === 'analytics' ? 'active' : ''}" onclick="switchTab('analytics')">
        <span>📈</span> <span>تحلیل ضایعات و عملکرد</span>
      </button>
      ` : ''}
      ${['admin', 'sysadmin'].includes(state.user.role) ? `
      <button class="tab-btn ${state.activeTab === 'settings' ? 'active' : ''}" onclick="switchTab('settings')">
        <span>⚙️</span> <span>مدیریت و تنظیمات</span>
      </button>
      ` : ''}
    </nav>

    <!-- Main Dynamic Content -->
    <main class="main-content">
      ${renderActiveTab()}
    </main>

    <!-- Toast Notification Container -->
    <div id="toast-container"></div>

    <!-- Dynamic Modal Slot -->
    <div id="action-modal-container"></div>
  `;
  startLiveClock();

  if (activeId) {
    const el = document.getElementById(activeId);
    if (el) {
      el.focus();
      if (selStart !== null && selEnd !== null) {
        try { el.setSelectionRange(selStart, selEnd); } catch (e) {}
      }
    }
  }
}

function getRoleTitle(role) {
  const map = {
    admin: 'مدیر مجموعه',
    supervisor: 'سرپرست بخش',
    operator: 'اپراتور شیفت',
    auditor: 'انبارگردان',
    sysadmin: 'مدیر سیستم'
  };
  return map[role] || role;
}

function switchTab(tab) {
  state.activeTab = tab;
  state.currentStocktake = null;
  loadInitialData();
}

function renderLogin() {
  return `
    <div style="min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 1.5rem; background: linear-gradient(135deg, #0f172a, #1e293b);">
      <div style="background: white; border-radius: var(--radius-xl); padding: 2.2rem; width: 100%; max-width: 440px; box-shadow: var(--shadow-xl);">
        <div style="text-align: center; margin-bottom: 1.8rem;">
          <div style="width: 64px; height: 64px; background: linear-gradient(135deg, #2563eb, #1d4ed8); color: white; border-radius: var(--radius-lg); display: flex; align-items: center; justify-content: center; font-size: 2.2rem; margin: 0 auto 1rem; box-shadow: 0 8px 16px rgba(37,99,235,0.3);">
            🍽️
          </div>
          <h1 style="font-size: 1.4rem; font-weight: 800; color: var(--slate-900);">ورود به سامانه موجودی</h1>
          <p style="font-size: 0.85rem; color: var(--slate-500); margin-top: 0.25rem;">مدیریت یکپارچه انبار و لاین‌های تولید رستوران</p>
          
          <div style="margin-top: 0.85rem; display: inline-flex; align-items: center; gap: 0.4rem; background: var(--slate-100); padding: 0.3rem 0.75rem; border-radius: 9999px; font-size: 0.8rem; font-weight: 700; color: var(--slate-700);">
            <span>🗓️</span> <span>${getPersianFullDate()}</span>
          </div>
        </div>

        <form onsubmit="event.preventDefault(); login(document.getElementById('login-u').value, document.getElementById('login-p').value);">
          <div style="margin-bottom: 1rem;">
            <label style="font-size: 0.85rem; font-weight: 700; color: var(--slate-700); display: block; margin-bottom: 0.35rem;">نام کاربری:</label>
            <input type="text" id="login-u" class="search-input" value="admin" style="padding: 0.75rem 1rem;" required />
          </div>
          <div style="margin-bottom: 1.5rem;">
            <label style="font-size: 0.85rem; font-weight: 700; color: var(--slate-700); display: block; margin-bottom: 0.35rem;">رمز عبور:</label>
            <input type="password" id="login-p" class="search-input" value="admin123" style="padding: 0.75rem 1rem;" required />
          </div>
          <button type="submit" class="btn-primary-action" style="padding: 0.9rem;">
            <span>ورود به سیستم</span>
            <span>➔</span>
          </button>
        </form>

        <div style="margin-top: 1.5rem; padding-top: 1.25rem; border-top: 1px solid var(--slate-200);">
          <span style="font-size: 0.75rem; font-weight: 700; color: var(--slate-500); display: block; margin-bottom: 0.6rem; text-align: center;">⚡ ورود سریع با نقش‌های تستی (یک کلیک):</span>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem;">
            <button onclick="login('admin', 'admin123')" style="padding: 0.45rem; background: var(--slate-100); border-radius: var(--radius-sm); font-size: 0.75rem; font-weight: 700;">👑 مدیر مجموعه</button>
            <button onclick="login('supervisor', 'sup123')" style="padding: 0.45rem; background: var(--slate-100); border-radius: var(--radius-sm); font-size: 0.75rem; font-weight: 700;">🧑‍💼 سرپرست شیفت</button>
            <button onclick="login('operator', 'op123')" style="padding: 0.45rem; background: var(--slate-100); border-radius: var(--radius-sm); font-size: 0.75rem; font-weight: 700;">👨‍🍳 اپراتور آماده‌سازی</button>
            <button onclick="login('auditor', 'audit123')" style="padding: 0.45rem; background: var(--slate-100); border-radius: var(--radius-sm); font-size: 0.75rem; font-weight: 700;">📋 انبارگردان</button>
          </div>
        </div>
      </div>
      <div id="toast-container"></div>
    </div>
  `;
}

function renderActiveTab() {
  switch (state.activeTab) {
    case 'fast-actions': return renderFastActions();
    case 'matrix': return renderStockMatrixView();
    case 'item-registration': return renderItemRegistrationView();
    case 'dashboard': return renderDashboardView();
    case 'transactions': return renderTransactionsView();
    case 'stocktake': return state.currentStocktake ? renderStocktakeSessionView() : renderStocktakeListView();
    case 'analytics': return renderAnalyticsView();
    case 'settings': return renderSettingsView();
    default: return renderFastActions();
  }
}

// ----------------- View 1: Fast Action Touch UI -----------------
function renderFastActions() {
  const quickItems = state.meta.items.filter(i => i.is_quick_access && i.is_active !== 0);
  const filteredItems = state.meta.items.filter(i => {
    if (i.is_active === 0) return false;
    const matchCat = state.selectedCategory ? i.category_id === state.selectedCategory : true;
    const matchSearch = matchesSearch(`${i.name} ${i.code || ''}`, state.searchQuery);
    return matchCat && matchSearch;
  });

  const actionMeta = {
    inbound: { title: 'ورود کالا', icon: '📥', bg: '#f0fdf4', border: '#bbf7d0', color: '#166534', sub: 'دریافت بار و خرید' },
    transfer: { title: 'انتقال بین‌بخشی', icon: '🔄', bg: '#eff6ff', border: '#bfdbfe', color: '#1e40af', sub: 'جابجایی بین انبارها' },
    consumption: { title: 'ثبت مصرف', icon: '🍳', bg: '#fffbeb', border: '#fde68a', color: '#92400e', sub: 'پخت و آماده‌سازی' },
    waste: { title: 'ثبت ضایعات', icon: '🗑️', bg: '#fef2f2', border: '#fecaca', color: '#991b1b', sub: 'خرابی، فساد و سوختگی' }
  };

  const curr = state.currentAction ? actionMeta[state.currentAction] : null;

  return `
    <!-- Live Shift Time & Persian Calendar Banner -->
    <div class="shift-time-banner">
      <div style="display: flex; align-items: center; gap: 0.75rem;">
        <div style="width: 44px; height: 44px; border-radius: var(--radius-md); background: #eff6ff; color: #2563eb; display: flex; align-items: center; justify-content: center; font-size: 1.5rem;">
          🕒
        </div>
        <div>
          <div style="font-size: 0.8rem; color: var(--slate-500); font-weight: 600;">تقویم و زمان رسمی رستوران</div>
          <div style="font-size: 1.05rem; font-weight: 800; color: var(--slate-900);" id="fast-actions-live-date">${getPersianFullDate()}</div>
        </div>
      </div>
      <div style="text-align: left; background: var(--slate-50); padding: 0.35rem 0.85rem; border-radius: var(--radius-md); border: 1px solid var(--slate-200);">
        <span style="font-size: 0.7rem; color: var(--slate-500); display: block;">ساعت رسمی</span>
        <strong style="font-size: 1.3rem; font-family: monospace; color: #1e40af; letter-spacing: 1px;" id="fast-actions-live-time">${getPersianTime()}</strong>
      </div>
    </div>
    <!-- Step 1: Action Selection -->
    <div style="margin-bottom: 0.75rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;">
      <h2 style="font-size: 1.15rem; font-weight: 800; color: var(--slate-900); display: flex; align-items: center; gap: 0.4rem;">
        <span style="background: var(--primary); color: white; border-radius: 9999px; width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; font-size: 0.9rem;">۱</span>
        گام اول: ابتدا نوع عملیات مورد نظر را لمس کنید:
      </h2>
      ${state.currentAction ? `
        <span style="font-size: 0.85rem; font-weight: 700; color: ${curr.color}; background: ${curr.bg}; border: 1px solid ${curr.border}; padding: 0.3rem 0.8rem; border-radius: 9999px;">
          ✓ عملیات فعال: ${curr.icon} ${curr.title}
        </span>
      ` : `
        <span style="font-size: 0.8rem; font-weight: 700; color: var(--slate-500);">
          (هیچ عملیاتی انتخاب نشده است)
        </span>
      `}
    </div>

    <!-- 4 Big Action Cards -->
    <div class="action-hero">
      <div class="big-action-card inbound ${state.currentAction === 'inbound' ? 'active-op' : ''}" 
           onclick="selectFastAction('inbound')">
        ${state.currentAction === 'inbound' ? '<div class="action-selected-badge">✓ انتخاب شده</div>' : ''}
        <div class="big-action-icon">📥</div>
        <div class="big-action-info">
          <h3>ورود کالا</h3>
          <p>دریافت فاکتور، خرید روز و افزایش موجودی</p>
        </div>
      </div>

      <div class="big-action-card transfer ${state.currentAction === 'transfer' ? 'active-op' : ''}" 
           onclick="selectFastAction('transfer')">
        ${state.currentAction === 'transfer' ? '<div class="action-selected-badge">✓ انتخاب شده</div>' : ''}
        <div class="big-action-icon">🔄</div>
        <div class="big-action-info">
          <h3>انتقال بین‌بخشی</h3>
          <p>انتقال از سردخانه به یخچال یا خط آماده‌سازی</p>
        </div>
      </div>

      <div class="big-action-card consumption ${state.currentAction === 'consumption' ? 'active-op' : ''}" 
           onclick="selectFastAction('consumption')">
        ${state.currentAction === 'consumption' ? '<div class="action-selected-badge">✓ انتخاب شده</div>' : ''}
        <div class="big-action-icon">🍳</div>
        <div class="big-action-info">
          <h3>ثبت مصرف</h3>
          <p>مصرف مواد اولیه در شیفت کاری یا پخت</p>
        </div>
      </div>

      <div class="big-action-card waste ${state.currentAction === 'waste' ? 'active-op' : ''}" 
           onclick="selectFastAction('waste')">
        ${state.currentAction === 'waste' ? '<div class="action-selected-badge">✓ انتخاب شده</div>' : ''}
        <div class="big-action-icon">🗑️</div>
        <div class="big-action-info">
          <h3>ثبت ضایعات</h3>
          <p>خرابی، سوختگی، فساد یا تاریخ‌گذشتگی</p>
        </div>
      </div>
    </div>

    <!-- Step 2: Banner Guide & Item Selection -->
    <div id="step2-items-container">
      ${state.currentAction ? `
        <div class="step2-banner" style="background: ${curr.bg}; border: 2px solid ${curr.border}; color: ${curr.color};">
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <span style="font-size: 2.2rem;">${curr.icon}</span>
            <div>
              <div style="font-size: 1.15rem; font-weight: 800;">
                گام دوم: اکنون کالای مورد نظر (مثلاً بیکن گوساله) را برای «${curr.title}» لمس کنید:
              </div>
              <div style="font-size: 0.85rem; opacity: 0.95;">
                با لمس هر کالا، صفحه کلید عددی جهت تعیین مقدار و ثبت ${curr.title} باز خواهد شد.
              </div>
            </div>
          </div>
          <button style="background: white; border: 1px solid ${curr.border}; color: ${curr.color}; padding: 0.4rem 0.85rem; border-radius: var(--radius-md); font-weight: 700; font-size: 0.8rem;" 
                  onclick="state.currentAction = null; render();">
            تغییر عملیات ✕
          </button>
        </div>
      ` : `
        <div class="step2-banner" style="background: #ffffff; border: 2px dashed #94a3b8; color: #475569;">
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <span style="font-size: 2rem;">👆</span>
            <div>
              <div style="font-size: 1.1rem; font-weight: 800; color: var(--slate-900);">
                گام دوم: لطفاً ابتدا از دکمه‌های بالا یک عملیات را لمس و انتخاب کنید
              </div>
              <div style="font-size: 0.85rem; color: var(--slate-600);">
                برای ثبت کالا (مانند بیکن گوساله)، ابتدا مشخص کنید که قصد «ورود کالا»، «انتقال»، «ثبت مصرف» یا «ثبت ضایعات» را دارید.
              </div>
            </div>
          </div>
        </div>
      `}

      <!-- Quick Picks Section -->
      <h2 class="section-title">
        <span>⭐ کالاهای پرمصرف و پرتکرار رستوران</span>
        ${state.currentAction ? `<span style="font-size: 0.8rem; color: ${curr.color}; font-weight: 700;">(جهت ثبت ${curr.title})</span>` : ''}
      </h2>
      <div class="quick-picks-grid">
        ${quickItems.map(item => `
          <button class="quick-pick-btn" 
                  style="${state.currentAction ? `border-color: ${curr.border};` : ''}"
                  onclick="selectItemForAction(${JSON.stringify(item).replace(/"/g, '&quot;')})">
            <div class="quick-pick-header">
              <span class="quick-pick-icon">${item.category_icon || '📦'}</span>
              <span class="badge badge-info">${item.unit_name}</span>
            </div>
            <div class="quick-pick-name">${item.name}</div>
            <div class="quick-pick-meta">
              ${state.currentAction ? `<strong style="color: ${curr.color};">ثبت ${curr.title} ➔</strong>` : item.category_name}
            </div>
          </button>
        `).join('')}
      </div>

      <!-- Search & All Items -->
      <div class="card">
        <div class="card-header">
          <h2>
            <span>📦 انتخاب از کلیه اقلام انبار (<span id="fast-actions-filtered-count">${filteredItems.length} قلم</span>)</span>
            ${state.currentAction ? `<span style="font-size: 0.85rem; color: ${curr.color}; font-weight: 700;">(جهت ثبت ${curr.title})</span>` : ''}
          </h2>
        </div>

        <div class="search-bar">
          <div class="search-input-wrap">
            <span class="search-icon">🔍</span>
            <input type="text" id="fast-actions-search-input" class="search-input" placeholder="جستجوی سریع نام کالا (مثلاً نان، بیکن، گوشت، پنیر...) یا کد..." 
                   value="${state.searchQuery}" oninput="handleFastActionsSearch(this.value)" autocomplete="off" />
            <button id="fast-actions-clear-btn" type="button" class="btn-clear-search" 
                    style="display: ${state.searchQuery ? 'inline-flex' : 'none'};" 
                    onclick="clearFastActionsSearch()" title="پاک کردن جستجو">✕</button>
          </div>
        </div>

        <!-- Category Filter Pills -->
        <div class="category-bar">
          <button class="cat-pill ${state.selectedCategory === null ? 'active' : ''}" 
                  onclick="selectFastActionsCategory(null)">
            همه دسته‌ها
          </button>
          ${state.meta.categories.map(c => `
            <button class="cat-pill ${state.selectedCategory === c.id ? 'active' : ''}"
                    onclick="selectFastActionsCategory(${c.id})">
              <span>${c.icon || '🏷️'}</span>
              <span>${c.name}</span>
            </button>
          `).join('')}
        </div>

        <div class="quick-picks-grid" id="fast-actions-items-grid" style="margin-bottom:0;">
          ${renderFastActionItemCards(filteredItems, curr)}
        </div>
      </div>
    </div>
  `;
}

function renderFastActionItemCards(items, curr) {
  if (!items || items.length === 0) {
    return `
      <div style="grid-column: 1 / -1; text-align: center; padding: 2.5rem 1rem; color: var(--slate-500); background: #f8fafc; border-radius: var(--radius-md); border: 1px dashed var(--slate-300);">
        <div style="font-size: 2.2rem; margin-bottom: 0.5rem;">🔍</div>
        <div style="font-weight: 700; font-size: 1.05rem; color: var(--slate-700);">هیچ کالایی با مشخصات جستجو یافت نشد</div>
        <div style="font-size: 0.85rem; margin-top: 0.25rem;">لطفاً کلمه دیگری را تایپ کنید یا فیلتر دسته‌بندی را تغییر دهید.</div>
      </div>
    `;
  }
  return items.map(item => `
    <button class="quick-pick-btn" 
            style="${state.currentAction && curr ? `border-color: ${curr.border};` : ''}"
            onclick="selectItemForAction(${JSON.stringify(item).replace(/"/g, '&quot;')})">
      <div class="quick-pick-header">
        <span class="quick-pick-icon">${item.category_icon || '📦'}</span>
        <span class="badge badge-info">${item.unit_name}</span>
      </div>
      <div class="quick-pick-name">${item.name}</div>
      <div class="quick-pick-meta">
        ${state.currentAction && curr ? `<strong style="color: ${curr.color};">ثبت ${curr.title} ➔</strong>` : item.category_name}
      </div>
    </button>
  `).join('');
}

function handleFastActionsSearch(query) {
  state.searchQuery = query;
  const actionMeta = {
    inbound: { title: 'ورود کالا', icon: '📥', bg: '#f0fdf4', border: '#bbf7d0', color: '#166534', sub: 'دریافت بار و خرید' },
    transfer: { title: 'انتقال بین‌بخشی', icon: '🔄', bg: '#eff6ff', border: '#bfdbfe', color: '#1e40af', sub: 'جابجایی بین انبارها' },
    consumption: { title: 'ثبت مصرف', icon: '🍳', bg: '#fffbeb', border: '#fde68a', color: '#92400e', sub: 'پخت و آماده‌سازی' },
    waste: { title: 'ثبت ضایعات', icon: '🗑️', bg: '#fef2f2', border: '#fecaca', color: '#991b1b', sub: 'خرابی، فساد و سوختگی' }
  };
  const curr = state.currentAction ? actionMeta[state.currentAction] : null;

  const filteredItems = state.meta.items.filter(i => {
    if (i.is_active === 0) return false;
    const matchCat = state.selectedCategory ? i.category_id === state.selectedCategory : true;
    const matchSearch = matchesSearch(`${i.name} ${i.code || ''}`, state.searchQuery);
    return matchCat && matchSearch;
  });

  const gridEl = document.getElementById('fast-actions-items-grid');
  if (gridEl) {
    gridEl.innerHTML = renderFastActionItemCards(filteredItems, curr);
  }
  const countEl = document.getElementById('fast-actions-filtered-count');
  if (countEl) {
    countEl.innerText = `${filteredItems.length} قلم`;
  }
  const clearBtn = document.getElementById('fast-actions-clear-btn');
  if (clearBtn) {
    clearBtn.style.display = query ? 'inline-flex' : 'none';
  }
}

function clearFastActionsSearch() {
  state.searchQuery = '';
  const input = document.getElementById('fast-actions-search-input');
  if (input) {
    input.value = '';
    input.focus();
  }
  handleFastActionsSearch('');
}

function selectFastActionsCategory(catId) {
  state.selectedCategory = catId;
  handleFastActionsSearch(state.searchQuery);
  const pills = document.querySelectorAll('.category-bar .cat-pill');
  pills.forEach((p, idx) => {
    if (idx === 0) {
      if (catId === null) p.classList.add('active'); else p.classList.remove('active');
    } else {
      const c = state.meta.categories[idx - 1];
      if (c && c.id === catId) p.classList.add('active'); else p.classList.remove('active');
    }
  });
}

// ----------------- Action Modal with Touch Numpad -----------------
function renderActionModal() {
  const item = state.selectedItem;
  if (!item) return;

  const act = state.currentAction;
  const actionTitles = {
    inbound: '📥 ورود کالا به انبار',
    transfer: '🔄 انتقال کالا بین بخش‌ها',
    consumption: '🍳 ثبت مصرف مواد اولیه',
    waste: '🗑️ ثبت ضایعات و دورریز'
  };

  const actionColors = {
    inbound: '#16a34a',
    transfer: '#2563eb',
    consumption: '#d97706',
    waste: '#dc2626'
  };

  const locOptions = state.meta.user_locations.map(l => 
    `<option value="${l.id}" ${state.numpadData.location_id === l.id ? 'selected' : ''}>${l.name}</option>`
  ).join('');

  const allLocOptions = state.meta.all_locations.map(l => 
    `<option value="${l.id}" ${state.numpadData.to_location_id === l.id ? 'selected' : ''}>${l.name}</option>`
  ).join('');

  const reasonOptions = state.meta.waste_reasons.map(r => 
    `<option value="${r.id}">${r.title}</option>`
  ).join('');

  const modal = document.getElementById('action-modal-container');
  modal.innerHTML = `
    <div class="modal-overlay">
      <div class="modal-content">
        <div class="modal-header" style="border-right: 6px solid ${actionColors[act]};">
          <div>
            <h3>${actionTitles[act]}</h3>
            <span style="font-size: 0.8rem; color: var(--slate-500);">${item.name} (${item.category_name})</span>
          </div>
          <button class="modal-close" onclick="closeActionModal()">✕</button>
        </div>

        <div class="modal-body">
          <!-- Location Pickers -->
          ${act === 'transfer' ? `
            <div style="display: flex; gap: 0.5rem; margin-bottom: 0.85rem;">
              <div style="flex: 1;">
                <label style="font-size: 0.75rem; font-weight: 700; display: block; margin-bottom: 0.2rem;">از مبدأ (کسر):</label>
                <select class="search-input" style="padding: 0.5rem;" onchange="state.numpadData.from_location_id = parseInt(this.value)">
                  ${locOptions}
                </select>
              </div>
              <div style="flex: 1;">
                <label style="font-size: 0.75rem; font-weight: 700; display: block; margin-bottom: 0.2rem;">به مقصد (افزایش):</label>
                <select class="search-input" style="padding: 0.5rem;" onchange="state.numpadData.to_location_id = parseInt(this.value)">
                  ${allLocOptions}
                </select>
              </div>
            </div>
          ` : `
            <div style="margin-bottom: 0.85rem;">
              <label style="font-size: 0.75rem; font-weight: 700; display: block; margin-bottom: 0.2rem;">محل عملیات (انبار/بخش):</label>
              <select class="search-input" style="padding: 0.5rem;" onchange="state.numpadData.location_id = parseInt(this.value)">
                ${locOptions}
              </select>
            </div>
          `}

          <!-- Waste Reason Picker (Only if Waste) -->
          ${act === 'waste' ? `
            <div style="margin-bottom: 0.85rem;">
              <label style="font-size: 0.75rem; font-weight: 700; display: block; margin-bottom: 0.2rem;">علت ثبت ضایعات (الزامی):</label>
              <select class="search-input" style="padding: 0.5rem; border-color: #fca5a5;" onchange="state.numpadData.reason_id = parseInt(this.value)">
                ${reasonOptions}
              </select>
            </div>
          ` : ''}

          <!-- Inbound Batch/Expiry (Optional) -->
          ${act === 'inbound' ? `
            <div style="display: flex; gap: 0.5rem; margin-bottom: 0.85rem;">
              <div style="flex: 1;">
                <label style="font-size: 0.75rem; font-weight: 700; display: block; margin-bottom: 0.2rem;">شماره فاکتور / بچ:</label>
                <input type="text" class="search-input" style="padding: 0.5rem;" placeholder="اختیاری" oninput="state.numpadData.batch_number = this.value" />
              </div>
              <div style="flex: 1;">
                <label style="font-size: 0.75rem; font-weight: 700; display: block; margin-bottom: 0.2rem;">تاریخ انقضا:</label>
                <input type="date" class="search-input" style="padding: 0.5rem;" oninput="state.numpadData.expiry_date = this.value" />
              </div>
            </div>
          ` : ''}

          <!-- Numpad Display -->
          <div class="numpad-display">
            <span class="numpad-val" id="numpad-display-val">${state.touchQuantity}</span>
            <span class="numpad-unit">${item.unit_name}</span>
          </div>

          <!-- Quick Increment Buttons (+1, +5, +10, +25) -->
          <div class="quick-inc-row">
            <button class="quick-inc-btn" onclick="addQuickInc(1)">+۱</button>
            <button class="quick-inc-btn" onclick="addQuickInc(5)">+۵</button>
            <button class="quick-inc-btn" onclick="addQuickInc(10)">+۱۰</button>
            <button class="quick-inc-btn" onclick="addQuickInc(25)">+۲۵</button>
          </div>

          <!-- Touch Numpad Grid -->
          <div class="numpad-grid">
            <button class="num-btn" onclick="handleNumpadKey('1')">۱</button>
            <button class="num-btn" onclick="handleNumpadKey('2')">۲</button>
            <button class="num-btn" onclick="handleNumpadKey('3')">۳</button>
            <button class="num-btn" onclick="handleNumpadKey('4')">۴</button>
            <button class="num-btn" onclick="handleNumpadKey('5')">۵</button>
            <button class="num-btn" onclick="handleNumpadKey('6')">۶</button>
            <button class="num-btn" onclick="handleNumpadKey('7')">۷</button>
            <button class="num-btn" onclick="handleNumpadKey('8')">۸</button>
            <button class="num-btn" onclick="handleNumpadKey('9')">۹</button>
            <button class="num-btn fn" onclick="handleNumpadKey('.')">.</button>
            <button class="num-btn" onclick="handleNumpadKey('0')">۰</button>
            <button class="num-btn fn" onclick="handleNumpadKey('DEL')">⌫ پاک</button>
          </div>

          <div style="margin-bottom: 1rem;">
            <input type="text" class="search-input" style="padding: 0.6rem;" placeholder="توضیحات اختیاری..." 
                   oninput="state.numpadData.notes = this.value" />
          </div>

          <!-- Final Submit Button -->
          <button class="btn-primary-action" style="background: ${actionColors[act]};" onclick="submitAction()">
            <span>تأیید و ثبت نهایی</span>
            <span>✓</span>
          </button>
        </div>
      </div>
    </div>
  `;
}

// ----------------- View: Item Registration (مدیر و سرپرست شیفت) -----------------
function renderItemRegistrationView() {
  const nextIdx = (state.meta.items.length + 1).toString().padStart(3, '0');
  const suggestedCode = `ITM-${nextIdx}`;
  
  const catOptions = state.meta.categories.map(c => 
    `<option value="${c.id}">${c.icon || '🏷️'} ${c.name}</option>`
  ).join('');

  const unitOptions = state.meta.units.map(u => 
    `<option value="${u.id}">${u.name} (${u.symbol})</option>`
  ).join('');

  state.itemStatusFilter = state.itemStatusFilter || 'all';

  const filteredItems = state.meta.items.filter(i => {
    const matchCat = state.selectedCategory ? i.category_id === state.selectedCategory : true;
    const matchSearch = matchesSearch(`${i.name} ${i.code || ''}`, state.searchQuery);
    let matchStatus = true;
    if (state.itemStatusFilter === 'active') matchStatus = i.is_active !== 0;
    if (state.itemStatusFilter === 'inactive') matchStatus = i.is_active === 0;
    return matchCat && matchSearch && matchStatus;
  });

  const isAdmin = ['admin', 'sysadmin'].includes(state.user.role);

  return `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; flex-wrap: wrap; gap: 0.75rem;">
      <div>
        <h2 style="font-size: 1.3rem; font-weight: 800; color: var(--slate-900); display: flex; align-items: center; gap: 0.5rem;">
          <span>📦</span> <span>ثبت، تعریف و مدیریت کالاها</span>
        </h2>
        <span style="font-size: 0.85rem; color: var(--slate-500);">
          تعریف کالا توسط مدیر و سرپرست شیفت | <strong>غیرفعال‌سازی (آرشیو) کالاها صرفاً توسط مدیر مجموعه</strong>
        </span>
      </div>
      <div>
        <span class="badge badge-info" style="font-size: 0.85rem; padding: 0.4rem 0.8rem;">
          تعداد کل اقلام در سیستم: ${state.meta.items.length} کالا
        </span>
      </div>
    </div>

    <!-- Main Container: Form on top/right, List on bottom/left -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 1.5rem; margin-bottom: 1.5rem;">
      
      <!-- New Item Creation Card Form -->
      <div class="card" style="border-top: 4px solid var(--primary);">
        <div class="card-header">
          <h2>
            <span>✨</span> <span>فرم تعریف کالای جدید</span>
          </h2>
          <span style="font-size: 0.75rem; color: var(--slate-500);">فیلدهای دارای ستاره الزامی هستند</span>
        </div>

        <form id="new-item-form" onsubmit="event.preventDefault(); submitNewItemFromTab();">
          <div style="margin-bottom: 1rem;">
            <label style="font-weight: 700; font-size: 0.9rem; color: var(--slate-800); display: block; margin-bottom: 0.35rem;">
              نام کالا یا ماده اولیه: <span style="color: #dc2626;">*</span>
            </label>
            <input type="text" id="tab-item-name" class="search-input" 
                   placeholder="مثلاً: بیکن گوساله ۹۰٪، فیله مرغ، پنیر پارمزان..." required style="padding: 0.75rem 1rem;" />
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-bottom: 1rem;">
            <div>
              <label style="font-weight: 700; font-size: 0.85rem; color: var(--slate-800); display: block; margin-bottom: 0.35rem;">
                کد اختصاصی کالا:
              </label>
              <input type="text" id="tab-item-code" class="search-input" 
                     value="${suggestedCode}" style="padding: 0.65rem 0.85rem; font-family: monospace; font-weight: 700;" />
            </div>

            <div>
              <label style="font-weight: 700; font-size: 0.85rem; color: var(--slate-800); display: block; margin-bottom: 0.35rem;">
                حداقل موجودی مجاز (حد هشدار):
              </label>
              <input type="number" step="0.5" min="0" id="tab-item-min" class="search-input" 
                     value="10" style="padding: 0.65rem 0.85rem; font-weight: 700;" />
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-bottom: 1rem;">
            <div>
              <label style="font-weight: 700; font-size: 0.85rem; color: var(--slate-800); display: block; margin-bottom: 0.35rem;">
                دسته‌بندی: <span style="color: #dc2626;">*</span>
              </label>
              <select id="tab-item-cat" class="search-input" style="padding: 0.65rem 0.85rem;" required>
                ${catOptions}
              </select>
            </div>

            <div>
              <label style="font-weight: 700; font-size: 0.85rem; color: var(--slate-800); display: block; margin-bottom: 0.35rem;">
                واحد اندازه‌گیری پایه: <span style="color: #dc2626;">*</span>
              </label>
              <select id="tab-item-unit" class="search-input" style="padding: 0.65rem 0.85rem;" required>
                ${unitOptions}
              </select>
            </div>
          </div>

          <!-- Quick access switch -->
          <div style="background: var(--slate-50); border: 1px solid var(--slate-200); border-radius: var(--radius-md); padding: 0.85rem 1rem; margin-bottom: 1.1rem; display: flex; align-items: center; gap: 0.75rem;">
            <input type="checkbox" id="tab-item-quick" style="width: 22px; height: 22px; cursor: pointer;" checked />
            <label for="tab-item-quick" style="cursor: pointer; font-weight: 700; font-size: 0.9rem; color: var(--slate-900);">
              ⭐ افزودن به اقلام پرمصرف و پرتکرار (دسترسی سریع با ۱ لمس در پنل کارکنان)
            </label>
          </div>

          <div style="margin-bottom: 1.25rem;">
            <label style="font-weight: 700; font-size: 0.85rem; color: var(--slate-800); display: block; margin-bottom: 0.35rem;">
              توضیحات و مشخصات کالا (اختیاری):
            </label>
            <textarea id="tab-item-notes" class="search-input" style="height: 65px; padding: 0.6rem;" 
                      placeholder="توضیحات مربوط به نگهداری، برند تامین‌کننده، دمای مطلوب یا محل مصرف..."></textarea>
          </div>

          <button type="submit" class="btn-primary-action" style="padding: 0.95rem; background: var(--success);">
            <span>✓ ثبت و افزودن به انبار رستوران</span>
          </button>
        </form>
      </div>

      <!-- Quick Guidance & Categories Summary -->
      <div style="display: flex; flex-direction: column; gap: 1rem;">
        <div class="card" style="background: #eff6ff; border: 1px solid #bfdbfe;">
          <h3 style="font-size: 1.05rem; font-weight: 800; color: #1e40af; margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.4rem;">
            <span>🛡️</span> <span>قوانین مدیریت و غیرفعال‌سازی کالا:</span>
          </h3>
          <ul style="padding-right: 1.2rem; font-size: 0.85rem; color: #1e3a8a; line-height: 1.8;">
            <li><strong>حفظ کامل تاریخچه:</strong> با غیرفعال‌سازی، هیچ‌گونه سابقه مصرف یا فاکتوری حذف نمی‌شود تا تراز حسابداری و گزارش‌های مالی رستوران همیشه دقیق بماند.</li>
            <li><strong>خروج از دید پرسنل:</strong> به محض غیرفعال‌سازی، کالا از تب‌های عملیاتی و کیپد لمسی پرسنل حذف می‌شود و امکان ثبت مصرف یا ضایعات نخواهد داشت.</li>
            <li><strong>سطح دسترسی اختصاصی:</strong> فقط <strong>مدیر مجموعه</strong> می‌تواند کالا را غیرفعال یا مجدداً فعال کند.</li>
          </ul>
        </div>

        <div class="card">
          <div class="card-header">
            <h2>🏷️ دسته‌بندی‌های فعال در رستوران</h2>
          </div>
          <div style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
            ${state.meta.categories.map(c => `
              <div style="background: var(--slate-100); border: 1px solid var(--slate-200); padding: 0.4rem 0.8rem; border-radius: var(--radius-sm); font-size: 0.85rem; font-weight: 600; display: flex; align-items: center; gap: 0.35rem;">
                <span>${c.icon}</span> <span>${c.name}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    </div>

    <!-- Existing Items List Table with Active/Inactive Management -->
    <div class="card">
      <div class="card-header" style="flex-wrap: wrap; gap: 0.75rem;">
        <div>
          <h2>📋 فهرست کالاها و وضعیت فعالیت (<span id="items-mgmt-count">${filteredItems.length} کالا</span>)</h2>
        </div>

        <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
          <!-- Active/Inactive Filter Tabs -->
          <div style="display: flex; background: var(--slate-100); border-radius: var(--radius-sm); padding: 0.2rem;">
            <button style="padding: 0.3rem 0.75rem; border-radius: var(--radius-sm); font-size: 0.8rem; font-weight: 700; background: ${state.itemStatusFilter === 'all' ? 'white' : 'transparent'}; box-shadow: ${state.itemStatusFilter === 'all' ? 'var(--shadow-sm)' : 'none'};" 
                    onclick="state.itemStatusFilter = 'all'; render();">همه</button>
            <button style="padding: 0.3rem 0.75rem; border-radius: var(--radius-sm); font-size: 0.8rem; font-weight: 700; color: #166534; background: ${state.itemStatusFilter === 'active' ? 'white' : 'transparent'}; box-shadow: ${state.itemStatusFilter === 'active' ? 'var(--shadow-sm)' : 'none'};" 
                    onclick="state.itemStatusFilter = 'active'; render();">فقط فعال‌ها</button>
            ${isAdmin ? `
            <button style="padding: 0.3rem 0.75rem; border-radius: var(--radius-sm); font-size: 0.8rem; font-weight: 700; color: #991b1b; background: ${state.itemStatusFilter === 'inactive' ? 'white' : 'transparent'}; box-shadow: ${state.itemStatusFilter === 'inactive' ? 'var(--shadow-sm)' : 'none'};" 
                    onclick="state.itemStatusFilter = 'inactive'; render();">غیرفعال (آرشیو)</button>
            ` : ''}
          </div>

          <div class="search-input-wrap" style="width: 220px;">
            <input type="text" id="items-mgmt-search-input" class="search-input" style="padding: 0.45rem 0.8rem; font-size: 0.85rem;" 
                   placeholder="جستجوی کالا یا کد..." 
                   value="${state.searchQuery}" oninput="handleItemsMgmtSearch(this.value)" autocomplete="off" />
          </div>
        </div>
      </div>

      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>ردیف</th>
              <th>کد کالا</th>
              <th>نام کالا</th>
              <th>دسته‌بندی</th>
              <th>واحد پایه</th>
              <th>حداقل هشدار</th>
              <th>پرمصرف</th>
              <th>وضعیت کالا</th>
              <th>مدیریت وضعیت</th>
            </tr>
          </thead>
          <tbody id="items-mgmt-tbody">
            ${renderItemMgmtTableRows(filteredItems, isAdmin)}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderItemMgmtTableRows(items, isAdmin) {
  if (!items || items.length === 0) {
    return `
      <tr>
        <td colspan="9" style="text-align: center; padding: 2rem; color: var(--slate-500); font-weight: 600;">
          🔍 هیچ کالایی با مشخصات جستجو یافت نشد.
        </td>
      </tr>
    `;
  }
  return items.map((itm, idx) => {
    const isActive = itm.is_active !== 0;
    return `
      <tr style="${!isActive ? 'background: #f8fafc; opacity: 0.85;' : ''}">
        <td>${idx + 1}</td>
        <td><code>${itm.code || '-'}</code></td>
        <td>
          <strong>${itm.name}</strong>
          ${!isActive ? '<span style="color:#b91c1c; font-size:0.75rem; margin-right:4px;">(غیرفعال)</span>' : ''}
        </td>
        <td>
          <span style="display: inline-flex; align-items: center; gap: 0.25rem;">
            <span>${itm.category_icon || '🏷️'}</span>
            <span>${itm.category_name}</span>
          </span>
        </td>
        <td><span class="badge badge-info">${itm.unit_name} (${itm.unit_symbol})</span></td>
        <td><strong>${itm.min_stock_alert}</strong> ${itm.unit_symbol}</td>
        <td>
          ${itm.is_quick_access && isActive ? '<span class="badge badge-success">⭐ بله</span>' : '<span style="color:var(--slate-400);">خیر</span>'}
        </td>
        <td>
          ${isActive 
            ? '<span class="badge badge-success">✓ فعال</span>' 
            : '<span class="badge" style="background:#fee2e2; color:#991b1b;">✕ غیرفعال</span>'}
        </td>
        <td>
          ${isAdmin ? `
            ${isActive ? `
              <button style="padding: 0.3rem 0.75rem; background: #fee2e2; color: #b91c1c; border: 1px solid #fecaca; border-radius: var(--radius-sm); font-size: 0.75rem; font-weight: 800;"
                      onclick="toggleItemActiveStatus(${itm.id}, false, '${itm.name}')">
                ⛔ غیرفعال‌سازی
              </button>
            ` : `
              <button style="padding: 0.3rem 0.75rem; background: #dcfce7; color: #166534; border: 1px solid #bbf7d0; border-radius: var(--radius-sm); font-size: 0.75rem; font-weight: 800;"
                      onclick="toggleItemActiveStatus(${itm.id}, true, '${itm.name}')">
                ✓ فعال‌سازی مجدد
              </button>
            `}
          ` : `
            <span style="font-size:0.75rem; color:var(--slate-400);" title="فقط مدیر مجموعه اجازه غیرفعال‌سازی کالا را دارد">🔒 دسترسی مدیر</span>
          `}
        </td>
      </tr>
    `;
  }).join('');
}

function handleItemsMgmtSearch(query) {
  state.searchQuery = query;
  const isAdmin = ['admin', 'sysadmin'].includes(state.user.role);
  const filteredItems = state.meta.items.filter(i => {
    const matchCat = state.selectedCategory ? i.category_id === state.selectedCategory : true;
    const matchSearch = matchesSearch(`${i.name} ${i.code || ''}`, state.searchQuery);
    let matchStatus = true;
    if (state.itemStatusFilter === 'active') matchStatus = i.is_active !== 0;
    if (state.itemStatusFilter === 'inactive') matchStatus = i.is_active === 0;
    return matchCat && matchSearch && matchStatus;
  });

  const tbody = document.getElementById('items-mgmt-tbody');
  if (tbody) {
    tbody.innerHTML = renderItemMgmtTableRows(filteredItems, isAdmin);
  }
  const countEl = document.getElementById('items-mgmt-count');
  if (countEl) {
    countEl.innerText = `${filteredItems.length} کالا`;
  }
}

async function toggleItemActiveStatus(itemId, newStatus, itemName) {
  const actionText = newStatus ? 'فعال‌سازی مجدد' : 'غیرفعال‌سازی و خروج از چرخه';
  const confirmMsg = newStatus 
    ? `آیا مایلید کالای «${itemName}» مجدداً فعال شده و در دسترس کلیه کارکنان قرار گیرد؟`
    : `آیا مطمئن هستید که می‌خواهید کالای «${itemName}» را غیرفعال کنید؟\n\n📌 توجه: سوابق و دیتای این کالا حفظ خواهد شد، اما امکان دیدن و ثبت آن دیگر برای پرسنل وجود نخواهد داشت.`;

  if (!confirm(confirmMsg)) {
    return;
  }

  try {
    const res = await api('/api/manage/item/toggle-active', {
      method: 'POST',
      body: JSON.stringify({ item_id: itemId, is_active: newStatus })
    });
    showToast(res.message, 'success');
    await loadInitialData();
  } catch (err) {
    // Handled in api()
  }
}

async function submitNewItemFromTab() {
  const nameEl = document.getElementById('tab-item-name');
  const codeEl = document.getElementById('tab-item-code');
  const catEl = document.getElementById('tab-item-cat');
  const unitEl = document.getElementById('tab-item-unit');
  const minEl = document.getElementById('tab-item-min');
  const quickEl = document.getElementById('tab-item-quick');
  const notesEl = document.getElementById('tab-item-notes');

  const name = nameEl.value.trim();
  if (!name) {
    showToast('لطفاً نام کالا را وارد کنید.', 'error');
    nameEl.focus();
    return;
  }

  const payload = {
    name,
    code: codeEl.value.trim(),
    category_id: parseInt(catEl.value),
    base_unit_id: parseInt(unitEl.value),
    min_stock_alert: parseFloat(minEl.value) || 0,
    is_quick_access: quickEl.checked,
    notes: notesEl.value.trim()
  };

  try {
    const res = await api('/api/manage/item', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    showToast(`کالای «${name}» با موفقیت در انبار ثبت شد.`, 'success');
    
    // Clear form
    nameEl.value = '';
    notesEl.value = '';
    
    // Reload metadata and re-render
    await loadInitialData();
  } catch (err) {
    // Handled in api()
  }
}

// ----------------- View 2: Stock Matrix View -----------------
function renderStockMatrixView() {
  const locs = state.meta.all_locations;
  const filtered = state.matrixData.filter(i => {
    const matchCat = state.selectedCategory ? i.category_id === state.selectedCategory : true;
    const matchSearch = matchesSearch(`${i.name} ${i.code || ''}`, state.searchQuery);
    return matchCat && matchSearch;
  });

  return `
    <!-- Top Action Bar -->
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; flex-wrap: wrap; gap: 0.75rem;">
      <div>
        <h2 style="font-size: 1.3rem; font-weight: 800; color: var(--slate-900);">🏢 ماتریس لحظه‌ای موجودی انبارها</h2>
        <span style="font-size: 0.8rem; color: var(--slate-500);">تفکیک کالاها بر اساس مکان‌های فیزیکی و سطح کل رستوران</span>
      </div>
      <div style="display: flex; gap: 0.5rem;">
        ${['admin', 'sysadmin', 'supervisor'].includes(state.user.role) ? `
          <button class="btn-primary-action" style="padding: 0.5rem 1rem; font-size: 0.9rem; background: #0f766e;" 
                  onclick="api('/api/export/excel/stock')">
            <span>📊 دریافت خروجی اکسل (Excel)</span>
          </button>
        ` : ''}
        ${['admin', 'sysadmin'].includes(state.user.role) ? `
          <button class="btn-primary-action" style="padding: 0.5rem 1rem; font-size: 0.9rem; background: var(--primary);" 
                  onclick="openAddItemModal()">
            <span>+ تعریف کالای جدید</span>
          </button>
        ` : ''}
      </div>
    </div>

    <!-- Alert Box if low stock items exist -->
    ${state.alertsData.length > 0 ? `
      <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: var(--radius-md); padding: 1rem; margin-bottom: 1.25rem;">
        <div style="display: flex; align-items: center; gap: 0.5rem; color: #991b1b; font-weight: 700; margin-bottom: 0.4rem;">
          <span>⚠️</span> <span>هشدار کسری موجودی (${state.alertsData.length} مورد کالا به زیر حداقل مجاز رسیده‌اند):</span>
        </div>
        <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
          ${state.alertsData.slice(0, 6).map(a => `
            <span style="background: white; border: 1px solid #fca5a5; padding: 0.2rem 0.6rem; border-radius: 9999px; font-size: 0.75rem; color: #b91c1c;">
              <strong>${a.item_name}</strong> در ${a.location_name}: موجودی ${a.current_quantity} ${a.unit_name} (حداقل: ${a.min_stock})
            </span>
          `).join('')}
        </div>
      </div>
    ` : ''}

    <div class="card">
      <div class="search-bar">
        <div class="search-input-wrap">
          <span class="search-icon">🔍</span>
          <input type="text" id="matrix-search-input" class="search-input" placeholder="جستجوی سریع کالا یا کد..." 
                 value="${state.searchQuery}" oninput="handleMatrixSearch(this.value)" autocomplete="off" />
        </div>
      </div>

      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>کد کالا</th>
              <th>نام کالا</th>
              <th>دسته</th>
              <th>واحد</th>
              ${locs.map(l => `<th>موجودی ${l.name}</th>`).join('')}
              <th style="background: #e2e8f0;">مجموع کل</th>
              <th>حداقل هشدار</th>
              <th>عملیات سریع</th>
            </tr>
          </thead>
          <tbody id="matrix-tbody">
            ${renderMatrixTableRows(filtered, locs)}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderMatrixTableRows(filtered, locs) {
  if (!filtered || filtered.length === 0) {
    return `
      <tr>
        <td colspan="${locs.length + 6}" style="text-align: center; padding: 2rem; color: var(--slate-500); font-weight: 600;">
          🔍 هیچ کالایی با مشخصات جستجو یافت نشد.
        </td>
      </tr>
    `;
  }
  return filtered.map(item => {
    const isAlert = item.is_overall_low || item.has_location_alert;
    return `
      <tr class="${isAlert ? 'alert-row' : ''}">
        <td><code>${item.code || '-'}</code></td>
        <td>
          <strong>${item.name}</strong>
          ${item.is_quick_access ? '<span title="کالای پرمصرف" style="margin-right:4px;">⭐</span>' : ''}
        </td>
        <td>${item.category_name}</td>
        <td>${item.unit_symbol}</td>
        ${locs.map(l => {
          const st = item.location_stocks[l.id];
          const isLow = st?.is_low;
          return `
            <td style="${isLow ? 'color:#b91c1c; font-weight:800;' : ''}">
              ${st ? st.quantity : 0}
              ${isLow ? '<span title="کسری موجودی"> ⚠️</span>' : ''}
            </td>
          `;
        }).join('')}
        <td style="background: ${isAlert ? '#fee2e2' : '#f1f5f9'}; font-weight: 800;">
          ${item.total_quantity}
        </td>
        <td>${item.min_stock_alert}</td>
        <td>
          <button style="padding: 0.25rem 0.6rem; background: var(--primary-light); color: var(--primary); border-radius: var(--radius-sm); font-size: 0.75rem; font-weight: 700;"
                  onclick="openActionModal('transfer', ${JSON.stringify(item).replace(/"/g, '&quot;')})">
            🔄 انتقال
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function handleMatrixSearch(query) {
  state.searchQuery = query;
  const locs = state.meta.all_locations;
  const filtered = state.matrixData.filter(i => {
    const matchCat = state.selectedCategory ? i.category_id === state.selectedCategory : true;
    const matchSearch = matchesSearch(`${i.name} ${i.code || ''}`, state.searchQuery);
    return matchCat && matchSearch;
  });
  const tbody = document.getElementById('matrix-tbody');
  if (tbody) {
    tbody.innerHTML = renderMatrixTableRows(filtered, locs);
  }
}

// ----------------- View 3: Dashboard & Analytics -----------------
function renderDashboardView() {
  const d = state.dashboardData;
  if (!d) return '<div>در حال بارگذاری داشبورد...</div>';

  return `
    <div style="margin-bottom: 1.25rem;">
      <h2 style="font-size: 1.3rem; font-weight: 800; color: var(--slate-900);">📊 داشبورد و آمار مدیریتی</h2>
      <span style="font-size: 0.8rem; color: var(--slate-500);">شاخص‌های کلیدی، ضایعات، هشدارهای بحرانی و پرمصرف‌ترین اقلام</span>
    </div>

    <!-- KPI Grid -->
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-icon kpi-blue">📦</div>
        <div class="kpi-details">
          <span>تنوع اقلام تعریف شده</span>
          <strong>${d.total_items} قلم کالا</strong>
        </div>
      </div>

      <div class="kpi-card">
        <div class="kpi-icon kpi-red">⚠️</div>
        <div class="kpi-details">
          <span>کالاهای در وضعیت بحرانی</span>
          <strong style="color: #b91c1c;">${d.low_stock_count} کالا</strong>
        </div>
      </div>

      <div class="kpi-card">
        <div class="kpi-icon kpi-green">📝</div>
        <div class="kpi-details">
          <span>تراکنش‌های ثبت شده امروز</span>
          <strong>${d.tx_today_count} عملیات</strong>
        </div>
      </div>

      <div class="kpi-card">
        <div class="kpi-icon kpi-amber">🏢</div>
        <div class="kpi-details">
          <span>انبارها و مکان‌های فعال</span>
          <strong>${d.total_locations} بخش</strong>
        </div>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 1.25rem;">
      <!-- Waste Breakdown -->
      <div class="card">
        <div class="card-header">
          <h2>🗑️ تحلیل دلایل ضایعات (۷ روز گذشته)</h2>
        </div>
        <div>
          ${d.waste_breakdown.length === 0 ? '<p style="color:var(--slate-400);">هیچ ضایعاتی در هفته اخیر ثبت نشده است.</p>' : `
            <table class="data-table">
              <thead>
                <tr>
                  <th>دلیل ضایعات</th>
                  <th>دفعات وقوع</th>
                  <th>مجموع مقدار</th>
                </tr>
              </thead>
              <tbody>
                ${d.waste_breakdown.map(w => `
                  <tr>
                    <td><strong>${w.reason}</strong></td>
                    <td>${w.count} بار</td>
                    <td style="color:#b91c1c; font-weight:700;">${w.total_qty.toFixed(2)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          `}
        </div>
      </div>

      <!-- Top Consumed -->
      <div class="card">
        <div class="card-header">
          <h2>🍳 پرمصرف‌ترین اقلام (۷ روز گذشته)</h2>
        </div>
        <div>
          ${d.top_consumed.length === 0 ? '<p style="color:var(--slate-400);">داده‌ای موجود نیست.</p>' : `
            <table class="data-table">
              <thead>
                <tr>
                  <th>نام کالا</th>
                  <th>میزان مصرف</th>
                  <th>واحد</th>
                </tr>
              </thead>
              <tbody>
                ${d.top_consumed.map(c => `
                  <tr>
                    <td><strong>${c.item_name}</strong></td>
                    <td style="color:#15803d; font-weight:700;">${c.total_consumed.toFixed(2)}</td>
                    <td>${c.unit_name}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          `}
        </div>
      </div>
    </div>
  `;
}

// ----------------- View 4: Transactions Log -----------------
function renderTransactionsView() {
  const typeMap = {
    INBOUND: { title: 'ورود کالا', badge: 'badge-success' },
    TRANSFER: { title: 'انتقال بین‌بخشی', badge: 'badge-info' },
    CONSUMPTION: { title: 'ثبت مصرف', badge: 'badge-warning' },
    WASTE: { title: 'ثبت ضایعات', badge: 'badge-danger' },
    ADJUSTMENT_ADD: { title: 'اصلاح انبارگردانی (+)', badge: 'badge-success' },
    ADJUSTMENT_SUB: { title: 'اصلاح انبارگردانی (-)', badge: 'badge-danger' }
  };

  return `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; flex-wrap: wrap; gap: 0.75rem;">
      <div>
        <h2 style="font-size: 1.3rem; font-weight: 800; color: var(--slate-900);">📜 دفتر کل و تاریخچه تراکنش‌ها</h2>
        <span style="font-size: 0.8rem; color: var(--slate-500);">ردیابی کامل و غیرقابل تغییر عملیات (چه کسی، چه کالایی، چه مقداری و در چه مکانی)</span>
      </div>
      <div>
        <button class="btn-primary-action" style="padding: 0.5rem 1rem; font-size: 0.9rem; background: #0f766e;" 
                onclick="exportFilteredTransactions()">
          <span>📊 خروجی اکسل فیلترشده</span>
        </button>
      </div>
    </div>

    <!-- Filters Bar -->
    <div class="card" style="padding: 1rem; margin-bottom: 1rem;">
      <div style="display: flex; gap: 0.75rem; flex-wrap: wrap;">
        <select class="search-input" style="width: auto; padding: 0.5rem;" 
                onchange="state.filterParams.transaction_type = this.value; loadTransactions().then(render);">
          <option value="">همه انواع تراکنش‌ها</option>
          <option value="INBOUND">ورود کالا</option>
          <option value="TRANSFER">انتقال</option>
          <option value="CONSUMPTION">مصرف</option>
          <option value="WASTE">ضایعات</option>
          <option value="ADJUSTMENT_ADD">اصلاح افزایش</option>
          <option value="ADJUSTMENT_SUB">اصلاح کاهش</option>
        </select>

        <select class="search-input" style="width: auto; padding: 0.5rem;" 
                onchange="state.filterParams.location_id = this.value; loadTransactions().then(render);">
          <option value="">همه مکان‌ها</option>
          ${state.meta.all_locations.map(l => `<option value="${l.id}">${l.name}</option>`).join('')}
        </select>

        <button class="btn-logout" style="background: var(--slate-200);" onclick="state.filterParams = {}; loadTransactions().then(render);">
          پاک کردن فیلترها
        </button>
      </div>
    </div>

    <div class="card">
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>شناسه</th>
              <th>نوع عملیات</th>
              <th>نام کالا</th>
              <th>مقدار</th>
              <th>مبدأ</th>
              <th>مقصد</th>
              <th>دلیل / جزئیات</th>
              <th>کاربر ثبت‌کننده</th>
              <th>زمان ثبت</th>
            </tr>
          </thead>
          <tbody>
            ${state.transactionsData.map(tx => {
              const info = typeMap[tx.transaction_type] || { title: tx.transaction_type, badge: 'badge-info' };
              return `
                <tr>
                  <td><code>#${tx.id}</code></td>
                  <td><span class="badge ${info.badge}">${info.title}</span></td>
                  <td><strong>${tx.item_name}</strong></td>
                  <td><strong>${tx.quantity}</strong> ${tx.unit_symbol}</td>
                  <td>${tx.from_location_name || '-'}</td>
                  <td>${tx.to_location_name || '-'}</td>
                  <td>${tx.waste_reason ? `<span style="color:#b91c1c;">علت: ${tx.waste_reason}</span>` : (tx.notes || '-')}</td>
                  <td>👤 ${tx.user_name}</td>
                  <td><small style="font-weight:600; color:var(--slate-700);">${formatPersianDate(tx.created_at, true)}</small></td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function exportFilteredTransactions() {
  const query = new URLSearchParams(state.filterParams).toString();
  api(`/api/export/excel/transactions?${query}`);
}

// ----------------- View 5: Stocktake Management -----------------
function renderStocktakeListView() {
  return `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem;">
      <div>
        <h2 style="font-size: 1.3rem; font-weight: 800; color: var(--slate-900);">🔍 انبارگردانی و اصلاح مغایرت‌ها</h2>
        <span style="font-size: 0.8rem; color: var(--slate-500);">شمارش واقعی کالاها، مقایسه با سیستم و اعمال اصلاحیه با تأیید مدیر</span>
      </div>
      <div>
        <button class="btn-primary-action" style="padding: 0.5rem 1.1rem; font-size: 0.9rem;" onclick="openCreateStocktakeModal()">
          <span>+ شروع دوره انبارگردانی جدید</span>
        </button>
      </div>
    </div>

    <div class="card">
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>شناسه</th>
              <th>عنوان انبارگردانی</th>
              <th>مکان شمارش</th>
              <th>وضعیت</th>
              <th>شروع‌کننده</th>
              <th>تاریخ ایجاد</th>
              <th>عملیات</th>
            </tr>
          </thead>
          <tbody>
            ${state.stocktakeList.map(s => {
              const statusPills = {
                DRAFT: { label: 'پیش‌نویس / در حال شمارش', badge: 'badge-warning' },
                SUBMITTED: { label: 'شمارش شده (در انتظار تأیید مدیر)', badge: 'badge-info' },
                APPROVED: { label: 'تأیید و اصلاح شده', badge: 'badge-success' }
              };
              const pill = statusPills[s.status] || { label: s.status, badge: 'badge-info' };
              return `
                <tr>
                  <td><code>#${s.id}</code></td>
                  <td><strong>${s.title}</strong></td>
                  <td>${s.location_name}</td>
                  <td><span class="badge ${pill.badge}">${pill.label}</span></td>
                  <td>${s.creator_name}</td>
                  <td><small style="font-weight:600; color:var(--slate-700);">${formatPersianDate(s.created_at, false)}</small></td>
                  <td>
                    <button class="btn-logout" style="background: var(--primary-light); color: var(--primary); padding: 0.25rem 0.6rem;" 
                            onclick="viewStocktakeDetails(${s.id})">
                      ورود به جلسه ➔
                    </button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderStocktakeSessionView() {
  const d = state.currentStocktake;
  if (!d || !d.session) return '<div>جلسه یافت نشد.</div>';

  const sess = d.session;
  const items = d.items || [];
  const isApproved = sess.status === 'APPROVED';

  return `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; flex-wrap: wrap; gap: 0.75rem;">
      <div>
        <button class="btn-logout" style="margin-bottom: 0.5rem;" onclick="state.currentStocktake = null; loadStocktakeList().then(render);">
          ➔ بازگشت به لیست انبارگردانی‌ها
        </button>
        <h2 style="font-size: 1.3rem; font-weight: 800; color: var(--slate-900);">${sess.title}</h2>
        <span style="font-size: 0.85rem; color: var(--slate-600);">مکان: <strong>${sess.location_name}</strong> | وضعیت: <span class="badge ${isApproved ? 'badge-success' : 'badge-warning'}">${sess.status}</span></span>
      </div>

      <div style="display: flex; gap: 0.5rem;">
        ${!isApproved ? `
          <button class="btn-primary-action" style="padding: 0.5rem 1rem; font-size: 0.9rem; background: #2563eb;" onclick="saveStocktakeCounts(${sess.id})">
            💾 ذخیره مقادیر شمارش
          </button>
          ${['admin', 'sysadmin'].includes(state.user.role) ? `
            <button class="btn-primary-action" style="padding: 0.5rem 1rem; font-size: 0.9rem; background: #16a34a;" onclick="approveStocktake(${sess.id})">
              ✓ تأیید نهایی و اصلاح خودکار موجودی
            </button>
          ` : ''}
        ` : `
          <div style="background: #f0fdf4; border: 1px solid #bbf7d0; padding: 0.5rem 1rem; border-radius: var(--radius-md); color: #166534; font-weight: 700;">
            ✓ تأیید شده توسط ${sess.approver_name || 'مدیر'} در تاریخ ${formatPersianDate(sess.approved_at, true)}
          </div>
        `}
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h2>جدول مقایسه موجودی سیستم و شمارش واقعی فیزیکی</h2>
      </div>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>ردیف</th>
              <th>کد کالا</th>
              <th>نام کالا</th>
              <th>موجودی سیستم</th>
              <th>شمارش واقعی (فیزیکی)</th>
              <th>مغایرت (اختلاف)</th>
              <th>وضعیت مغایرت</th>
              <th>توضیحات</th>
            </tr>
          </thead>
          <tbody>
            ${items.map((itm, idx) => {
              const diff = itm.difference;
              let diffText = 'تطابق کامل';
              let diffClass = 'badge-success';
              if (diff > 0.001) {
                diffText = `اضافه (${diff.toFixed(2)}+)`;
                diffClass = 'badge-warning';
              } else if (diff < -0.001) {
                diffText = `کسری (${Math.abs(diff).toFixed(2)}-)`;
                diffClass = 'badge-danger';
              }

              return `
                <tr style="${Math.abs(diff) > 0.001 ? 'background:#fff1f2;' : ''}">
                  <td>${idx + 1}</td>
                  <td><code>${itm.item_code || '-'}</code></td>
                  <td><strong>${itm.item_name}</strong> (${itm.category_name})</td>
                  <td style="font-weight:700;">${itm.system_quantity} ${itm.unit_name}</td>
                  <td>
                    ${!isApproved ? `
                      <input type="number" step="0.1" class="search-input st-count-input" 
                             style="width: 110px; padding: 0.35rem; font-weight: 700;" 
                             data-item-id="${itm.item_id}" value="${itm.counted_quantity}" />
                    ` : `
                      <strong>${itm.counted_quantity} ${itm.unit_name}</strong>
                    `}
                  </td>
                  <td style="font-weight: 800; direction: ltr; text-align: right;">
                    ${diff > 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2)}
                  </td>
                  <td><span class="badge ${diffClass}">${diffText}</span></td>
                  <td>
                    ${!isApproved ? `
                      <input type="text" class="search-input st-note-input" style="padding: 0.35rem;" 
                             data-item-id="${itm.item_id}" value="${itm.notes || ''}" placeholder="علت مغایرت..." />
                    ` : (itm.notes || '-')}
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ----------------- View 6: Advanced Analytics & Staff Performance -----------------
async function renderAnalyticsView() {
  const container = document.querySelector('.main-content');
  container.innerHTML = '<div>در حال پردازش تحلیل‌ها...</div>';

  const [abnormalData, usersPerf] = await Promise.all([
    api('/api/reports/abnormal'),
    api('/api/reports/users')
  ]);

  container.innerHTML = `
    <div style="margin-bottom: 1.25rem;">
      <h2 style="font-size: 1.3rem; font-weight: 800; color: var(--slate-900);">📈 تحلیل‌های پیشرفته، ضایعات غیرعادی و ارزیابی پرسنل</h2>
      <span style="font-size: 0.8rem; color: var(--slate-500);">شناسایی هدررفت مواد اولیه و مانیتورینگ فعالیت کارکنان</span>
    </div>

    <!-- Abnormal Waste Warning -->
    <div class="card">
      <div class="card-header">
        <h2>⚠️ شناسایی اقلام با نسبت ضایعات بالا (۱۴ روز اخیر)</h2>
      </div>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>نام کالا</th>
              <th>دسته</th>
              <th>کل مصرف</th>
              <th>کل ضایعات</th>
              <th>درصد ضایعات</th>
              <th>ارزیابی سیستم</th>
            </tr>
          </thead>
          <tbody>
            ${abnormalData.analysis.map(a => `
              <tr class="${a.is_abnormal ? 'alert-row' : ''}">
                <td><strong>${a.item_name}</strong></td>
                <td>${a.category_name}</td>
                <td>${a.total_consumed} ${a.unit_name}</td>
                <td style="color:#b91c1c; font-weight:700;">${a.total_waste} ${a.unit_name}</td>
                <td><strong>${a.waste_percentage}%</strong></td>
                <td>
                  <span class="badge ${a.is_abnormal ? 'badge-danger' : 'badge-success'}">
                    ${a.is_abnormal ? 'نیازمند بررسی و کنترل سرآشپز' : 'در محدوده نرمال'}
                  </span>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Staff Performance Activity -->
    <div class="card">
      <div class="card-header">
        <h2>👥 عملکرد و آمار ثبت پرسنل در سیستم</h2>
      </div>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>نام کاربر</th>
              <th>نقش سازمانی</th>
              <th>تعداد کل ثبت‌ها</th>
              <th>ورود</th>
              <th>انتقال</th>
              <th>مصرف</th>
              <th>ضایعات</th>
              <th>آخرین فعالیت</th>
            </tr>
          </thead>
          <tbody>
            ${usersPerf.users_report.map(u => `
              <tr>
                <td><strong>${u.full_name}</strong> (<code>${u.username}</code>)</td>
                <td><span class="role-pill role-${u.role}">${getRoleTitle(u.role)}</span></td>
                <td><strong style="color:var(--primary); font-size:1.05rem;">${u.total_transactions}</strong></td>
                <td>${u.inbound_count}</td>
                <td>${u.transfer_count}</td>
                <td>${u.consumption_count}</td>
                <td>${u.waste_count}</td>
                <td><small style="color:var(--slate-500);">${u.last_activity ? formatPersianDate(u.last_activity, true) : 'نداشته'}</small></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ----------------- View 7: Settings & Definitions -----------------
async function renderSettingsView() {
  const container = document.querySelector('.main-content');
  container.innerHTML = '<div>در حال بارگذاری تنظیمات...</div>';

  const data = await api('/api/manage/users');
  const users = data.users;

  container.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem;">
      <div>
        <h2 style="font-size: 1.3rem; font-weight: 800; color: var(--slate-900);">⚙️ تعاریف پایه و مدیریت کاربران</h2>
        <span style="font-size: 0.8rem; color: var(--slate-500);">مدیریت انبارها، کاربران، سطوح دسترسی و اقلام رستوران</span>
      </div>
      <div style="display:flex; gap:0.5rem;">
        <button class="btn-primary-action" style="padding: 0.5rem 1rem; font-size: 0.9rem;" onclick="openAddLocationModal()">
          + افزودن مکان/انبار جدید
        </button>
        <button class="btn-primary-action" style="padding: 0.5rem 1rem; font-size: 0.9rem; background: var(--primary);" onclick="openAddItemModal()">
          + افزودن کالای جدید
        </button>
      </div>
    </div>

    <!-- Locations List -->
    <div class="card">
      <div class="card-header">
        <h2>🏢 انبارها و مکان‌های عملیاتی تعریف شده (${state.meta.all_locations.length} مکان)</h2>
      </div>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>شناسه</th>
              <th>نام مکان / بخش</th>
              <th>کد سیستمی</th>
              <th>توضیحات و کاربرد</th>
              <th>وضعیت</th>
            </tr>
          </thead>
          <tbody>
            ${state.meta.all_locations.map(l => `
              <tr>
                <td><code>#${l.id}</code></td>
                <td><strong>${l.name}</strong></td>
                <td><code>${l.code}</code></td>
                <td>${l.description || '-'}</td>
                <td><span class="badge badge-success">فعال</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Users & Access Control -->
    <div class="card">
      <div class="card-header">
        <h2>👥 کاربران و مجوزهای دسترسی مکانی و عملیاتی</h2>
      </div>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>نام کاربر</th>
              <th>نام کاربری</th>
              <th>نقش سازمانی</th>
              <th>دسترسی‌های مکانی مجاز</th>
              <th>وضعیت</th>
            </tr>
          </thead>
          <tbody>
            ${users.map(u => {
              const allowedLocNames = u.location_ids?.length 
                ? u.location_ids.map(lid => state.meta.all_locations.find(l => l.id === lid)?.name).filter(Boolean).join('، ')
                : 'دسترسی نامحدود به کلیه انبارها';

              return `
                <tr>
                  <td><strong>${u.full_name}</strong></td>
                  <td><code>${u.username}</code></td>
                  <td><span class="role-pill role-${u.role}">${getRoleTitle(u.role)}</span></td>
                  <td><small>${allowedLocNames}</small></td>
                  <td><span class="badge badge-success">فعال</span></td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ----------------- App Boot -----------------
window.addEventListener('DOMContentLoaded', () => {
  checkAuth();
});
