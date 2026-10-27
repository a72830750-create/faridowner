const SESSION_KEY = 'forno99_session';
const API = (window.API_BASE||'') + '/api/orders';
function authFetch(url, opts={}) {
  return fetch(url, opts).then(r => {
    if (r.status === 401 && !String(url).includes('/api/login')) {
      sessionStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem('forno99_token');
      showLogin();
      if (els.loginError) { els.loginError.textContent = 'Sessione scaduta. Effettua di nuovo il login.'; els.loginError.classList.remove('hidden'); }
      throw new Error('unauthorized');
    }
    return r;
  });
}

const els = {
  loginScreen: document.getElementById('login-screen'),
  dashboard: document.getElementById('dashboard'),
  loginForm: document.getElementById('login-form'),
  loginError: document.getElementById('login-error'),
  orderList: document.getElementById('order-list'),
  emptyState: document.getElementById('empty-state'),
  emptyText: document.getElementById('empty-text'),
  searchInput: document.getElementById('search-input'),
  filterTabs: document.getElementById('filter-tabs'),
  statusModal: document.getElementById('status-modal'),
  statusOrderInfo: document.getElementById('status-order-info'),
  toast: document.getElementById('toast'),
  dateFilter: document.getElementById('date-filter'),
  customPanel: document.getElementById('custom-panel'),
  dateFrom: document.getElementById('date-from'),
  dateTo: document.getElementById('date-to'),
  applyRange: document.getElementById('apply-range'),
  cancelRange: document.getElementById('cancel-range'),
  selectedRange: document.getElementById('selected-range'),
  resetBtn: document.getElementById('reset-filters'),
  resultCount: document.getElementById('result-count'),
  refreshBtn: document.getElementById('refresh-btn'),
  signoutBtn: document.getElementById('signout-btn'),
};

let orders = [];
let currentStatus = 'new';
let dateFilter = 'today';
let searchQuery = '';
let selectedOrder = null;
let highlightId = null;
let highlightTimer = null;

function showToast(msg) { els.toast.textContent = msg; els.toast.classList.remove('hidden'); clearTimeout(showToast._t); showToast._t = setTimeout(() => els.toast.classList.add('hidden'), 2500); }

function statusClass(s) { return 'status-' + s; }
function esc(v){ return String(v||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function rome(d) { const x = new Date(d.toLocaleString('en-US', { timeZone: 'Europe/Rome' })); if (x.getHours() < 11) x.setDate(x.getDate() - 1); return x; }
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

async function loadOrders() { const t = sessionStorage.getItem('forno99_token'); const r = await fetch(API, { headers: { 'Authorization': 'Bearer ' + t } }); if (!r.ok) throw new Error('API error'); return r.json(); }
function saveStatus(id, status) { const t=sessionStorage.getItem('forno99_token'); return authFetch(API + '/' + id, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization':'Bearer '+t }, body: JSON.stringify({ status }) }); }

function renderStats() {
  const c = { new: 0, accepted: 0, preparing: 0, ready: 0, out_for_delivery: 0, rejected: 0, completed: 0 };
  orders.forEach(o => { if (c[o.status] !== undefined) c[o.status]++; });
  document.getElementById('stat-new').textContent = c.new;
  document.getElementById('stat-accepted').textContent = c.accepted;
  document.getElementById('stat-rejected').textContent = c.rejected;
  document.getElementById('stat-completed').textContent = c.completed;
}

function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'ora';
  if (diff < 3600) return Math.floor(diff / 60) + 'm fa';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h fa';
  return Math.floor(diff / 86400) + 'g fa';
}

function getFiltered() {
  const now = rome(new Date());
  return orders.filter(o => {
    if (currentStatus !== 'all' && o.status !== currentStatus) return false;
    const od = rome(new Date(o.created_at));
    if (dateFilter === 'today' && startOfDay(od).getTime() !== startOfDay(now).getTime()) return false;
    if (dateFilter === 'yesterday') { const y = new Date(now); y.setDate(y.getDate() - 1); if (startOfDay(od).getTime() !== startOfDay(y).getTime()) return false; }
    if (dateFilter === '7d') { const t = new Date(now); t.setDate(t.getDate() - 7); if (od < t) return false; }
    if (dateFilter === '30d') { const t = new Date(now); t.setDate(t.getDate() - 30); if (od < t) return false; }
    if (dateFilter === 'month') { if (od.getMonth() !== now.getMonth() || od.getFullYear() !== now.getFullYear()) return false; }
    if (dateFilter === 'lastmonth') { const lm = new Date(now); lm.setMonth(lm.getMonth() - 1); if (od.getMonth() !== lm.getMonth() || od.getFullYear() !== lm.getFullYear()) return false; }
    if (dateFilter === 'custom') {
      if (els.dateFrom.value) { const from = new Date(els.dateFrom.value + 'T00:00:00'); if (od < from) return false; }
      if (els.dateTo.value) { const to = new Date(els.dateTo.value + 'T23:59:59'); if (od > to) return false; }
    }
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      const normPhone = (o.customer_phone || '').replace(/\D/g, '');
      const qPhone = q.replace(/\D/g, '');
      const matchNum = (o.order_number || '').toString().toLowerCase().includes(q) || String(o.id || '').includes(q);
      const matchName = (o.customer_name || '').toLowerCase().includes(q);
      const matchPhone = qPhone ? normPhone.includes(qPhone) : (o.customer_phone || '').toLowerCase().includes(q);
      if (!(matchNum || matchName || matchPhone)) return false;
    }
    return true;
  });
}

async function printReceipt(order) {
  if (!navigator.bluetooth) {
    // Fallback to browser print dialog
    const items = (order.items || []).map(i => `<tr><td>${i.qty}x ${esc(i.name)}</td><td style="text-align:right">€${(i.qty*i.price).toFixed(2)}</td></tr>`).join('');
    const html = `<!DOCTYPE html><html><head><title>Receipt</title><style>
      @page{size:80mm auto;margin:0}
      body{font-family:'Courier New',monospace;width:80mm;margin:0;padding:16px;color:#111;font-size:16px;font-weight:bold}
      h3{margin:0;font-size:26px;letter-spacing:1px}
      h4{margin:4px 0 8px;font-size:14px}
      .line{border-top:1px dashed #000;margin:12px 0}
      table{width:100%;border-collapse:collapse}
      td{padding:6px 0;font-size:13px}
      .total{font-weight:bold;font-size:20px;margin-top:8px;padding-top:8px;border-top:2px solid #000}
      .center{text-align:center}
      .muted{font-size:11px;color:#555}
    </style></head><body>
      <h3>FARID KEBAB</h3><h4>Order #${esc(order.order_number)}</h4>
      <div>${esc(order.customer_name)} — ${esc(order.customer_phone)}</div>
      <div>Via Leopoldo Galeotti, 51017 Pescia PT</div>
      <div>${order.order_type}</div>
      ${order.order_type === 'delivery' ? `<div>Delivery: ${order.delivery_timing === 'later' ? esc(order.delivery_time) : 'Now'}</div>` : ''}
      ${order.order_type === 'pickup' && order.pickup_time ? `<div style="font-size:24px;font-weight:900">Pickup: ${esc(order.pickup_time)}</div>` : ''}
      ${order.notes ? `<div class="line"></div><div>Note: ${esc(order.notes)}</div>` : ''}
      <div class="line"></div>
      <table>${items}</table>
      <div class="total">Total €${Number(order.total).toFixed(2)}</div>
      <div>Questo scontrino non ha valore fiscale.</div>
      ${order.order_type === 'delivery' ? `<div style="text-align:center;margin-top:8px"><img src="https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent('https://www.google.com/maps/search/?api=1&query=' + (order.delivery_address || ''))}" alt="QR"></div>` : ''}
      <div class="muted" style="font-weight:900">Servizio non incluso. Conservare lo scontrino.</div>
      <div style="height:140px"></div>
    </body></html>`;
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);
    iframe.contentWindow.document.open();
    iframe.contentWindow.document.write(html);
    iframe.contentWindow.document.close();
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
    setTimeout(() => document.body.removeChild(iframe), 1000);
    return;
  }
  try {
    // 1. Try already-granted devices first
    let device = null;
    if (navigator.bluetooth.getDevices) {
      const devices = await navigator.bluetooth.getDevices();
      if (devices && devices.length) device = devices[0];
    }
    if (!device) {
      device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [
        '000018f0-0000-1000-8000-00805f9b34fb',
        '49535343-fe7d-41aa-a73b-222c547d4140'
      ]
      });
    }

    // 2. Connect to the GATT Server
    const server = await device.gatt.connect();

    // 3. Locate the Service and Write Characteristic
    const services = await server.getPrimaryServices();
    const service = services[0]; 
    const characteristics = await service.getCharacteristics();
    const writeCharacteristic = characteristics.find(c => c.properties.write || c.properties.writeWithoutResponse);

    if (!writeCharacteristic) {
      throw new Error('No writable characteristic found on this device.');
    }

    // 4. Construct the ESC/POS Command Stream
    const escposData = new Uint8Array([
      0x1B, 0x40,                             // Initialize
      0x1B, 0x61, 0x01,                       // Center Align
      ...new TextEncoder().encode("FARID KEBAB\n\n"),
      0x1B, 0x61, 0x00,                       // Left Align
      ...new TextEncoder().encode(`Order #: ${order.order_number}\n`),
      ...new TextEncoder().encode(`Type: ${order.order_type}\n`),
      ...(order.order_type === 'delivery' ? [ ...new TextEncoder().encode(`Delivery: ${order.delivery_timing === 'later' ? order.delivery_time : 'Now'}\n`) ] : []),
      ...(order.order_type === 'pickup' && order.pickup_time ? [ ...new TextEncoder().encode(`Pickup: ${order.pickup_time}\n`) ] : []),
      ...new TextEncoder().encode(`Name: ${order.customer_name}\n`),
      ...new TextEncoder().encode("Via Leopoldo Galeotti, 51017 Pescia PT\n"),
      ...new TextEncoder().encode("--------------------------------\n"),
      ...order.items.flatMap(item => 
        Array.from(new TextEncoder().encode(`${item.qty}x ${item.name} - €${item.price}\n`))
      ),
      ...new TextEncoder().encode("--------------------------------\n"),
      ...new TextEncoder().encode("Questo scontrino non ha valore fiscale.\n\n\n"),
      0x1D, 0x56, 0x42, 0x00                   // Cut Paper
    ]);

    // 5. Send payload to printer
    await writeCharacteristic.writeValue(escposData);
    console.log('Order sent to printer successfully.');

  } catch (error) {
    console.error('Bluetooth Print Error:', error);
    alert('Bluetooth print failed: ' + (error && error.message ? error.message : error));
  }
}

function renderOrders() {
  const filtered = getFiltered().sort((a, b) => {
    const pa = a.status === 'new' ? 0 : 1;
    const pb = b.status === 'new' ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return new Date(b.created_at) - new Date(a.created_at);
  });
  els.orderList.innerHTML = '';
  els.resultCount.textContent = filtered.length + ' ordini';
  if (filtered.length === 0) {
    els.emptyState.classList.remove('hidden');
    els.emptyText.textContent = orders.length === 0 ? 'Nessun ordine ancora.' : 'Nessun ordine corrisponde al filtro.';
    els.orderList.appendChild(els.emptyState);
    return;
  }
  els.emptyState.classList.add('hidden');
  filtered.forEach(o => {
    const card = document.createElement('div');
    card.className = 'order-card' + (highlightId && o.id == highlightId ? ' highlight' : '');
    card.innerHTML = `
      <div class="order-head">
        <div class="order-number">${esc(o.order_number)} <span class="order-id">ID: ${o.id}</span></div>
        <span class="order-status ${statusClass(o.status)}">${o.status}</span>
      </div>
      <div class="order-meta">
        <span>👤 ${esc(o.customer_name)}</span>
        <span>📞 ${esc(o.customer_phone)}</span>
        <span>🚚 ${o.order_type}</span>
        ${o.delivery_address ? `<span>📍 ${esc(o.delivery_address)}</span>` : ''}
        ${o.order_type === 'delivery' && o.delivery_timing ? `<span>⏱ Delivery: ${esc(o.delivery_timing === 'later' ? (o.delivery_time || '') : 'Now')}</span>` : ''}
        ${o.order_type === 'pickup' && o.pickup_time ? `<span>⏱ Pickup: ${esc(o.pickup_time)}</span>` : ''}
        <span>⏱ ${timeAgo(o.created_at)}</span>
      </div>
      ${o.notes ? `<div class="order-meta"><span>📝 ${esc(o.notes)}</span></div>` : ''}
      <ul class="order-items">${(o.items || []).map(i => `<li>${i.qty}× ${esc(i.name)} <span style="float:right">€${(i.qty * i.price).toFixed(2)}</span></li>`).join('')}</ul>
      <div class="order-foot">
        <div class="order-total">€${Number(o.total).toFixed(2)}</div>
        <div class="order-actions">
          <button class="btn btn-ghost btn-sm" data-action="status" data-id="${o.id}">Update</button>
          <button class="btn btn-ghost btn-sm" data-action="print" data-id="${o.id}">Print</button>
          ${o.status === 'new' ? `<button class="btn btn-success btn-sm" data-action="accept" data-id="${o.id}">Accept</button><button class="btn btn-danger btn-sm" data-action="reject" data-id="${o.id}">Reject</button>` : ''}
          ${o.status === 'accepted' ? `<button class="btn btn-primary btn-sm" data-action="preparing" data-id="${o.id}">Preparing</button>` : ''}
          ${o.status === 'preparing' ? `<button class="btn btn-primary btn-sm" data-action="ready" data-id="${o.id}">${o.order_type === 'pickup' ? 'Ready for pickup' : 'Out for delivery'}</button>` : ''}
          ${o.status === 'ready' || o.status === 'out_for_delivery' ? `<button class="btn btn-success btn-sm" data-action="complete" data-id="${o.id}">Complete</button>` : ''}
        </div>
      </div>`;
    els.orderList.appendChild(card);
  });
}

function setStatus(id, status) {
  const o = orders.find(x => String(x.id) === String(id));
  if (!o) return;
  saveStatus(id, status).then(() => {
    o.status = status;
    renderStats();
    renderOrders();
    showToast(`Ordine ${o.order_number} → ${status}`);
  }).catch(() => showToast('Errore aggiornamento'));
}

function showLogin() { els.loginScreen.classList.remove('hidden'); els.dashboard.classList.add('hidden'); }
function showDashboard() { els.loginScreen.classList.add('hidden'); els.dashboard.classList.remove('hidden'); }

function initAuth() {
  if (sessionStorage.getItem(SESSION_KEY) === '1') { showDashboard(); loadAndRender(); }
  else showLogin();
}

let knownIds = new Set();
let unacceptedNew = new Set();
let alarmTimer = null;
function playAlarm() { const ctx = ensureAudio(); if(!ctx) return; try { if(ctx.state==='suspended') ctx.resume(); const o=ctx.createOscillator(); const g=ctx.createGain(); o.connect(g); g.connect(ctx.destination); o.type='sawtooth'; const now=ctx.currentTime; o.frequency.setValueAtTime(600, now); o.frequency.linearRampToValueAtTime(1200, now+0.5); o.frequency.linearRampToValueAtTime(600, now+1.0); o.frequency.linearRampToValueAtTime(1200, now+1.5); g.gain.setValueAtTime(0.4, now); g.gain.exponentialRampToValueAtTime(0.001, now+1.5); o.start(now); o.stop(now+1.5); } catch(e){ console.error('alarm',e); } }
let audioCtx = null;
function ensureAudio() {
  if (audioCtx) return audioCtx;
  try { audioCtx = new (window.AudioContext||window.webkitAudioContext)(); } catch(e){ audioCtx=null; }
  return audioCtx;
}
document.addEventListener('click', ensureAudio, {once:false});
document.addEventListener('keydown', ensureAudio, {once:false});

function loadAndRender() {
  loadOrders().then(o => {
    const newOnes = o.filter(x => !knownIds.has(x.id));
    if (knownIds.size && newOnes.length) { showToast(newOnes.length + ' nuovo/i ordine/i'); }
    o.forEach(x => knownIds.add(x.id));
    // track unaccepted new orders
    unacceptedNew = new Set(o.filter(x=>x.status==='new').map(x=>x.id));
    if (unacceptedNew.size && !alarmTimer) {
      playAlarm();
      alarmTimer = setInterval(()=>{ if(unacceptedNew.size) playAlarm(); else { clearInterval(alarmTimer); alarmTimer=null; } }, 2500);
    }
    if (!unacceptedNew.size && alarmTimer) { clearInterval(alarmTimer); alarmTimer=null; }
    orders = o; renderStats(); renderOrders();
  }).catch(() => showToast('Errore caricamento ordini'));
}

els.loginForm.addEventListener('submit', e => {
  e.preventDefault();
  const user = document.getElementById('login-email').value.trim();
  const pass = document.getElementById('login-password').value;
  fetch((window.API_BASE||'') + '/api/login', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username:user,password:pass})}).then(r=>{
    if(!r.ok) throw new Error('bad');
    return r.json();
  }).then(d=>{
    sessionStorage.setItem(SESSION_KEY,'1');
    sessionStorage.setItem('forno99_token', d.token);
    els.loginError.classList.add('hidden');
    showDashboard();
    loadAndRender();
  }).catch(()=>{
    els.loginError.textContent = 'Nome utente o password non validi.';
    els.loginError.classList.remove('hidden');
  });
});

els.signoutBtn.addEventListener('click', () => {
  const t = sessionStorage.getItem('forno99_token');
  fetch((window.API_BASE||'') + '/api/logout', {method:'POST', headers:{'Authorization':'Bearer '+t}}).finally(()=>{
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem('forno99_token');
    showLogin();
  });
});

els.filterTabs.addEventListener('click', e => {
  const tab = e.target.closest('.filter-tab');
  if (!tab) return;
  els.filterTabs.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  currentStatus = tab.dataset.status;
  renderOrders();
});

els.searchInput.addEventListener('input', e => { searchQuery = e.target.value; renderOrders(); });

function setDateFilter(v) {
  dateFilter = v;
  if (els.dateFilter) els.dateFilter.value = v;
  if (els.customPanel) els.customPanel.classList.toggle('hidden', v !== 'custom');
  if (v !== 'custom') renderOrders();
}
if (els.dateFilter) els.dateFilter.addEventListener('change', e => { setDateFilter(e.target.value); });

if (els.applyRange) els.applyRange.addEventListener('click', () => {
  if (els.dateFrom.value && els.dateTo.value && els.dateFrom.value > els.dateTo.value) { alert('Data fine precedente alla data inizio'); return; }
  if (els.selectedRange) els.selectedRange.textContent = (els.dateFrom.value || '') + ' → ' + (els.dateTo.value || '');
  renderOrders();
});
if (els.cancelRange) els.cancelRange.addEventListener('click', () => {
  if (els.customPanel) els.customPanel.classList.add('hidden');
  dateFilter = 'today';
  // = '📅 Oggi';
  if (els.dateFrom) els.dateFrom.value = '';
  if (els.dateTo) els.dateTo.value = '';
  if (els.selectedRange) els.selectedRange.textContent = '';
  renderOrders();
});
setDateFilter('today');

if (els.resetBtn) els.resetBtn.addEventListener('click', () => {
  currentStatus = 'all';
  els.filterTabs.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
  const allTab = els.filterTabs.querySelector('.filter-tab[data-status="all"]');
  if (allTab) allTab.classList.add('active');
  setDateFilter('today');
  if (els.dateFrom) els.dateFrom.value = '';
  if (els.dateTo) els.dateTo.value = '';
  if (els.selectedRange) els.selectedRange.textContent = '';
  els.searchInput.value = '';
  searchQuery = '';
  renderOrders();
});

els.orderList.addEventListener('click', e => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.action;
  if (action === 'status') {
    selectedOrder = orders.find(x => String(x.id) === String(id));
    if (selectedOrder) els.statusOrderInfo.textContent = `${selectedOrder.order_number} — ${selectedOrder.customer_name}`;
    els.statusModal.classList.remove('hidden');
  } else if (action === 'accept') setStatus(id, 'accepted');
  else if (action === 'reject') setStatus(id, 'rejected');
  else if (action === 'preparing') setStatus(id, 'preparing');
  else if (action === 'ready') { const oo = orders.find(x => String(x.id) === String(id)); setStatus(id, oo && oo.order_type === 'pickup' ? 'ready' : 'out_for_delivery'); }
  else if (action === 'complete') setStatus(id, 'completed');
  else if (action === 'print') { const o = orders.find(x => String(x.id) === String(id)); if (o) printReceipt(o); }
});

if (els.statusModal) {
  els.statusModal.querySelectorAll('button[data-status]').forEach(b => {
    b.addEventListener('click', () => {
      if (selectedOrder) setStatus(selectedOrder.id, b.dataset.status);
      els.statusModal.classList.add('hidden');
    });
  });
}
const statusClose = document.getElementById('status-close');
const statusCancel = document.getElementById('status-cancel');
if (statusClose) statusClose.addEventListener('click', () => els.statusModal.classList.add('hidden'));
if (statusCancel) statusCancel.addEventListener('click', () => els.statusModal.classList.add('hidden'));

if (els.refreshBtn) els.refreshBtn.addEventListener('click', () => {
  loadAndRender();
  showToast('Aggiornato');
});

setInterval(() => {
  if (!els.dashboard.classList.contains('hidden')) {
    loadAndRender();
  }
}, 5000);


// Toggle accepting orders
const toggleBtn=document.createElement("button");toggleBtn.textContent="Toggle Orders";toggleBtn.className="btn btn-ghost btn-sm";toggleBtn.style.position="fixed";toggleBtn.style.bottom="20px";toggleBtn.style.right="20px";toggleBtn.style.zIndex="9999";document.body.appendChild(toggleBtn);
toggleBtn.addEventListener("click",async()=>{const t=sessionStorage.getItem("forno99_token");const r=await fetch((window.API_BASE||"")+"/api/settings",{headers:{Authorization:"Bearer "+t}});const d=await r.json();const next=d.accepting_orders==="false"?"true":"false";await fetch((window.API_BASE||"")+"/api/settings",{method:"PATCH",headers:{"Content-Type":"application/json","Authorization":"Bearer "+t},body:JSON.stringify({key:"accepting_orders",value:next})});alert("Orders "+(next==="true"?"ON":"OFF"));});

initAuth();