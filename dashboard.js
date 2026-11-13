const SESSION_KEY = 'forno99_session';
const API = (window.API_BASE||'') + '/api/orders';

// Epson TM-m30III printer configuration (SOAP/ePOS-Print)
const PRINTER_IP = '192.168.178.148';
const PRINTER_URL = 'http://192.168.178.148/cgi-bin/epos/service.cgi';
const PRINTER_DEV_ID = 'local_printer';
// printerState: 'unknown' | 'printing' | 'last_ok' | 'unreachable' | 'paper_out' | 'cover_open' | 'uncertain' (set only from verified events)
let printerState = 'unknown';
let printerStateDetail = '';
let autoPrintEnabled = (function(){ try { const v = localStorage.getItem('autoPrintEnabled'); return v === null ? true : v === '1'; } catch(e){ return true; } })();
let printedOrders = new Map(); // orderId → {status:'pending'|'printed'|'failed'|'uncertain', attempts, error?, uncertain?}
let autoPrintedIds = new Set((function(){ try { return JSON.parse(localStorage.getItem('autoPrintedIds') || '[]'); } catch(e){ return []; } })());
let printedIdsPersist = new Set((function(){ try { return JSON.parse(localStorage.getItem('printedIds') || '[]'); } catch(e){ return []; } })());
let uncertainPrintIds = new Set((function(){ try { return JSON.parse(localStorage.getItem('uncertainPrintIds') || '[]'); } catch(e){ return []; } })());
const printTabId = Math.random().toString(36).slice(2);
let printChannel = null;
try { printChannel = ('BroadcastChannel' in window) ? new BroadcastChannel('ali-kebab-print') : null; } catch(e) { printChannel = null; }
function saveAutoPrintEnabled(){ try { localStorage.setItem('autoPrintEnabled', autoPrintEnabled ? '1' : '0'); } catch(e){} }
function saveAutoPrintedIds(){ try { localStorage.setItem('autoPrintedIds', JSON.stringify(Array.from(autoPrintedIds).slice(-500))); } catch(e){} }
function savePrintedIds(){ try { localStorage.setItem('printedIds', JSON.stringify(Array.from(printedIdsPersist).slice(-500))); } catch(e){} }
function saveUncertainPrintIds(){ try { localStorage.setItem('uncertainPrintIds', JSON.stringify(Array.from(uncertainPrintIds).slice(-500))); } catch(e){} }
function getPrintInfo(id){
  const key=String(id);
  const m=printedOrders.get(key); if(m) return m;
  if(uncertainPrintIds.has(key)) return {status:'uncertain', attempts:1, error:'Outcome uncertain. Check printer before retry.'};
  if(printedIdsPersist.has(key)) return {status:'printed', attempts:1};
  return null;
}
function broadcastPrint(msg){ try { if (printChannel) printChannel.postMessage(Object.assign({ from: printTabId }, msg)); } catch(e){} }
function markPrintedPersist(key){
  key=String(key);
  printedIdsPersist.add(key); uncertainPrintIds.delete(key);
  savePrintedIds(); saveUncertainPrintIds();
  broadcastPrint({ type:'printed', id:key });
}
function markUncertainPersist(key){
  key=String(key);
  uncertainPrintIds.add(key); saveUncertainPrintIds();
  broadcastPrint({ type:'uncertain', id:key });
}
if (printChannel) {
  printChannel.onmessage = (ev) => {
    const d = ev && ev.data; if (!d || d.from === printTabId) return;
    if (d.type === 'printed' && d.id) { printedIdsPersist.add(String(d.id)); uncertainPrintIds.delete(String(d.id)); const cur=printedOrders.get(String(d.id)); if (cur && cur.status !== 'printed') printedOrders.set(String(d.id), {status:'printed', attempts:cur.attempts||1}); renderOrders(); }
    if (d.type === 'uncertain' && d.id) { uncertainPrintIds.add(String(d.id)); const cur=printedOrders.get(String(d.id)); if (cur && cur.status === 'pending') printedOrders.set(String(d.id), {status:'uncertain', attempts:cur.attempts||1, error:cur.error||'Outcome uncertain.'}); renderOrders(); }
  };
}
window.addEventListener('storage', (e) => {
  if (e.key === 'printedIds') { try { printedIdsPersist = new Set(JSON.parse(e.newValue||'[]')); } catch(_){} renderOrders(); }
  if (e.key === 'uncertainPrintIds') { try { uncertainPrintIds = new Set(JSON.parse(e.newValue||'[]')); } catch(_){} renderOrders(); }
  if (e.key === 'autoPrintedIds') { try { autoPrintedIds = new Set(JSON.parse(e.newValue||'[]')); } catch(_){} }
});

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
  printerSettingsBtn: document.getElementById('printer-settings-btn'),
  printerSettingsModal: document.getElementById('printer-settings-modal'),
  printerStatusText: document.getElementById('printer-status-text'),
};

let orders = [];
let selectedNewOrder = null;
let modalShownIds = new Set();
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
function saveStatus(id, status) {
  const t = sessionStorage.getItem('forno99_token');
  return authFetch(API + '/' + id, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + t },
    body: JSON.stringify({ status })
  }).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r; });
}

function matchesDate(o) {
  const now = rome(new Date());
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
  return true;
}
function renderStats() {
  const c = { new: 0, accepted: 0, preparing: 0, ready: 0, out_for_delivery: 0, rejected: 0, completed: 0 };
  let revenue = 0, completedCount = 0;
  orders.forEach(o => {
    if (c[o.status] !== undefined) c[o.status]++;
    if (o.status === 'completed' && matchesDate(o)) { revenue += Number(o.total) || 0; completedCount++; }
  });
  document.getElementById('stat-new').textContent = c.new;
  document.getElementById('stat-accepted').textContent = c.accepted;
  document.getElementById('stat-rejected').textContent = c.rejected;
  document.getElementById('stat-completed').textContent = c.completed;
  const revEl = document.getElementById('stat-revenue');
  if (revEl) revEl.textContent = '€' + revenue.toFixed(2);
}

let earningsRange = 'today';
function revenueForRange(range) {
  const now = rome(new Date());
  let revenue = 0, count = 0;
  orders.forEach(o => {
    if (o.status !== 'completed') return;
    const od = rome(new Date(o.created_at));
    let ok = false;
    if (range === 'today') ok = startOfDay(od).getTime() === startOfDay(now).getTime();
    else if (range === 'yesterday') { const y = new Date(now); y.setDate(y.getDate() - 1); ok = startOfDay(od).getTime() === startOfDay(y).getTime(); }
    else if (range === '7d') { const t = new Date(now); t.setDate(t.getDate() - 7); ok = od >= t; }
    else if (range === '30d') { const t = new Date(now); t.setDate(t.getDate() - 30); ok = od >= t; }
    else if (range === 'month') ok = od.getMonth() === now.getMonth() && od.getFullYear() === now.getFullYear();
    else if (range === 'custom') { const from= document.getElementById('earn-from'); const to=document.getElementById('earn-to'); let f=from&&from.value?new Date(from.value):null; let t=to&&to.value?new Date(to.value):null; ok = (!f||od>=f)&&(!t||od<=t); }
    else if (range === 'total') ok = true;
    if (!ok) return;
    revenue += Number(o.total) || 0; count++;
  });
  return { revenue, count };
}
function renderEarnings() {
  const { revenue, count } = revenueForRange(earningsRange);
  const revEl = document.getElementById('earn-revenue');
  const cntEl = document.getElementById('earn-count');
  const avgEl = document.getElementById('earn-avg');
  if (revEl) revEl.textContent = '€' + revenue.toFixed(2);
  if (cntEl) cntEl.textContent = count;
  if (avgEl) avgEl.textContent = '€' + (count ? (revenue / count).toFixed(2) : '0.00');
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
    if (currentStatus === 'all' && (o.status === 'completed' || o.status === 'rejected')) return false;
    if (currentStatus !== 'all' && o.status !== currentStatus) return false;
    const od = rome(new Date(o.created_at));
    if (dateFilter === 'today' && startOfDay(od).getTime() !== startOfDay(now).getTime()) return false;
    if (dateFilter === 'yesterday') { const y = new Date(now); y.setDate(y.getDate() - 1); if (startOfDay(od).getTime() !== startOfDay(y).getTime()) return false; }
    if (dateFilter === '7d') { const t = new Date(now); t.setDate(t.getDate() - 7); if (od < t) return false; }
    if (dateFilter === '30d') { const t = new Date(now); t.setDate(t.getDate() - 30); if (od < t) return false; }
    if (dateFilter === 'month') { if (od.getMonth() !== now.getMonth() || od.getFullYear() !== now.getFullYear()) return false; }
    if (dateFilter === 'lastmonth') { const lm = new Date(now); lm.setMonth(lm.getMonth() - 1); if (od.getMonth() !== lm.getMonth() || od.getFullYear() !== lm.getFullYear()) return false; }
    if (dateFilter === 'custom') {
      if (els.dateFrom.value) { const from = new Date(els.dateFrom.value); if (od < from) return false; }
      if (els.dateTo.value) { const to = new Date(els.dateTo.value); if (od > to) return false; }
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

// ===== Epson Printer Functions (direct ePOS) =====
// Inspected: prior implementation handed off via tmprintassistant:// (external app) and had a
// browser window.print() fallback. Replaced with direct ePOS-Print attempts to printer IP
// PRINTER_IP:148 (TM-m30III, ePOS service /cgi-bin/epos/service.cgi) using ePOS SDK and HTTP.
// Browser security: from an HTTPS origin, direct fetch/XHR to http://PRINTER_IP is blocked by
// active mixed content, and cross-origin LAN requests face CORS/preflight limits. The SDK
// transport is subject to the same browser/network restrictions. This code attempts direct
// connection and reports the exact limitation; it does NOT use window.print() or external apps.

function fmtMoney(v) { const n = Number(v); return (isFinite(n) ? n : 0).toFixed(2); }
function fmtDateTime(v) {
  try { const d = v ? new Date(v) : new Date(); return isNaN(d) ? String(v || '') : d.toLocaleString('it-IT'); }
  catch(e) { return String(v || ''); }
}
function lineLR(left, right, width) {
  const l = String(left || ''), r = String(right || '');
  const pad = Math.max(1, (width || 32) - l.length - r.length);
  return l + ' '.repeat(pad) + r;
}

function buildReceiptXML(order) {
  const w = 32;
  const items = (order.items || []).map(i => {
    const qty = Number(i.qty) || 0;
    const price = Number(i.price) || 0;
    const name = String(i.name || '');
    const l1 = esc(lineLR(qty + 'x ' + name, 'EUR ' + fmtMoney(qty * price), w));
    const l2 = esc('  @ EUR ' + fmtMoney(price));
    return `<text>${l1}&#10;${l2}&#10;</text>`;
  }).join('');
  const total = fmtMoney(order.total != null ? order.total : (order.items || []).reduce((s, i) => s + (Number(i.qty)||0) * (Number(i.price)||0), 0));
  const dt = esc(fmtDateTime(order.created_at));
  const cust = esc(order.customer_name || 'N/A');
  const phone = esc(order.customer_phone || 'N/A');
  const notes = order.notes ? `<text>Note: ${esc(String(order.notes).slice(0, 120))}&#10;</text>` : '';
  let fulfill = '';
  if (order.order_type === 'delivery') {
    const addr = esc(String(order.delivery_address || order.address || 'N/A').slice(0, 80));
    const when = order.delivery_timing === 'later' ? esc(order.delivery_time || 'ASAP') : 'ASAP';
    fulfill = `<text>Consegna: ${addr}&#10;</text><text>Orario: ${when}&#10;</text>`;
  } else {
    const when = esc(order.pickup_time || 'ASAP');
    fulfill = `<text>Ritiro: ${when}&#10;</text>`;
  }
  return `<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">` +
    `<text align="center" dw="true">ALI KEBAB&#10;</text>` +
    `<text align="center">--------------------------------&#10;</text>` +
    `<text>Ordine: ${esc(order.order_number || order.id || '')}&#10;</text>` +
    `<text>Data: ${dt}&#10;</text>` +
    `<text>Cliente: ${cust}&#10;</text>` +
    `<text>Tel: ${phone}&#10;</text>` +
    fulfill +
    `<text align="center">--------------------------------&#10;</text>` +
    items +
    `<text align="center">--------------------------------&#10;</text>` +
    `<text align="right" dw="true">TOTALE: EUR ${esc(total)}&#10;</text>` +
    notes +
    `<feed line="5"/><cut type="feed"/></epos-print>`;
}

function buildSoapEnvelope(xmlBody) {
  return `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>${xmlBody}</s:Body></s:Envelope>`;
}

async function getLnaPermissionState() {
  try {
    if (!navigator.permissions || !navigator.permissions.query) return 'unsupported';
    const r = await navigator.permissions.query({ name: 'local-network' });
    return r && r.state || 'unknown';
  } catch(e) { return 'unsupported'; }
}

function lnaFetchSupported() {
  try { return typeof Request !== 'undefined' && 'targetAddressSpace' in Request.prototype; } catch(e) { return false; }
}

function soapPrint(xmlBody) {
  const soap = buildSoapEnvelope(xmlBody);
  const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 10000) : null;
  const opts = {
    method: 'POST',
    mode: 'cors',
    cache: 'no-store',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': '""',
      'If-Modified-Since': 'Thu, 01 Jan 1970 00:00:00 GMT'
    },
    body: soap,
    signal: ctrl ? ctrl.signal : undefined
  };
  // Chrome 142+ Local Network Access: declare target address space to allow prompt and
  // mixed-content exemption for local/private IP literals from a secure context.
  if (lnaFetchSupported()) opts.targetAddressSpace = 'local';
  return fetch(`${PRINTER_URL}?devid=${PRINTER_DEV_ID}&timeout=10000`, opts)
    .finally(() => { if (timer) clearTimeout(timer); });
}

function initPrinter() {
  printerState = 'unknown'; printerStateDetail = '';
  updatePrinterStatusUI();
  // Best-effort warmup: a successful SDK connect indicates reachability, but not full readiness.
  tryConnectPrinter().then(ok => {
    if (ok && printerState === 'unknown') { printerState = 'last_ok'; printerStateDetail = 'Recent connection succeeded'; }
    updatePrinterStatusUI();
  }).catch(() => { updatePrinterStatusUI(); });
  return true;
}

function setPrinterState(state, detail) {
  printerState = state || 'unknown';
  printerStateDetail = detail || '';
  updatePrinterStatusUI();
}

function updatePrinterStatusUI() {
  // States shown only when verifiable from SDK/HTTP events in this session.
  // "Reachable"/"Ready" are not continuously/independently verified from browser; shown as
  // "Last print OK" (confirmed) or "Unknown" rather than claiming current readiness.
  const indicator = document.getElementById('printer-status-indicator');
  const map = {
    unknown:     { cls: 'disconnected', text: 'Unknown', color: '#8b6f47', title: 'Printer status unknown (no continuous reachability/readiness check possible from browser)' },
    printing:    { cls: 'connected',    text: 'Printing...', color: '#1565c0', title: 'Print job in progress' },
    last_ok:     { cls: 'connected',    text: 'Last print OK', color: '#2e7d32', title: 'Last print confirmed by printer (current readiness not continuously verified)' },
    unreachable: { cls: 'disconnected', text: 'Unreachable', color: '#c0392b', title: 'Printer could not be reached (verified by failed connect/send)' },
    paper_out:   { cls: 'disconnected', text: 'Paper out', color: '#c0392b', title: 'Printer reported paper out (verified)' },
    cover_open:  { cls: 'disconnected', text: 'Cover open', color: '#c0392b', title: 'Printer reported cover open (verified)' },
    uncertain:   { cls: 'disconnected', text: 'Uncertain', color: '#b26a00', title: 'Last print outcome uncertain; check printer before retry' }
  };
  const s = map[printerState] || map.unknown;
  if (indicator) { indicator.className = 'printer-status ' + s.cls; indicator.title = (s.title + (printerStateDetail ? ' — ' + printerStateDetail : '')) + ' (' + PRINTER_IP + ')'; }
  if (els.printerStatusText) { els.printerStatusText.textContent = s.text; els.printerStatusText.style.color = s.color; }
}

function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error((label || 'Operazione') + ' timeout (' + ms + 'ms)')), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

let _eposDev = null, _eposPrinter = null, _eposConnecting = null;

function resetEposConnection() {
  try { if (_eposDev) _eposDev.disconnect(); } catch(e) {}
  _eposDev = null; _eposPrinter = null; _eposConnecting = null;
}

function getEposPrinter() {
  if (_eposPrinter && _eposDev) return Promise.resolve(_eposPrinter);
  if (_eposConnecting) return _eposConnecting;
  const eps = window.epson;
  if (!eps || !eps.ePOSDevice) return Promise.reject(new Error('Epson ePOS SDK non disponibile'));
  _eposConnecting = new Promise((resolve, reject) => {
    let dev, settled = false;
    const fail = (msg, flags) => {
      if (settled) return; settled = true;
      try { dev && dev.disconnect(); } catch(e) {}
      _eposDev = null; _eposPrinter = null; _eposConnecting = null;
      const err = (msg && typeof msg === 'object') ? msg : new Error(String(msg));
      if (flags) Object.assign(err, flags);
      reject(err);
    };
    const timer = setTimeout(() => fail('Timeout connessione stampante (' + PRINTER_IP + ')', { beforeSend: true, printerState: 'unreachable' }), 8000);
    const wrap = (fn) => (...a) => { clearTimeout(timer); return fn(...a); };
    try {
      dev = new eps.ePOSDevice();
      const onConnect = wrap((res) => {
        if (!(res === 'OK' || res === 'SSL_CONNECT_OK')) return fail('Connessione stampante fallita: ' + res + ' (' + PRINTER_IP + ')', { beforeSend: true, printerState: 'unreachable' });
        dev.createDevice(PRINTER_DEV_ID, dev.DEVICE_TYPE_PRINTER, { crypto: false, buffer: false }, (p, code) => {
          if (code !== 'OK' || !p) return fail('Creazione device fallita: ' + code, { beforeSend: true, printerState: 'unreachable' });
          p.timeout = 10000;
          _eposDev = dev; _eposPrinter = p; _eposConnecting = null;
          resolve(p);
        });
      });
      dev.connect(PRINTER_IP, 80, (res) => {
        if (res === 'OK' || res === 'SSL_CONNECT_OK') return onConnect(res);
        dev.connect(PRINTER_IP, 8008, (res2) => {
          if (res2 === 'OK' || res2 === 'SSL_CONNECT_OK') return onConnect(res2);
          clearTimeout(timer);
          fail('Impossibile connettersi alla stampante ' + PRINTER_IP + ' (porte 80/8008): ' + res + '/' + res2, { beforeSend: true, printerState: 'unreachable' });
        });
      });
    } catch(e) { clearTimeout(timer); fail('Eccezione ePOS SDK: ' + (e && e.message || e), { beforeSend: true, printerState: 'unreachable' }); }
  });
  return _eposConnecting;
}

function tryConnectPrinter() {
  // warm up reusable SDK connection in background to reduce first-print delay
  return getEposPrinter().then(() => true).catch(() => false);
}

function printViaEposSDK(xml) {
  return getEposPrinter().then(printer => new Promise((resolve, reject) => {
    let settled = false;
    const fail = (msg, flags) => {
      if (settled) return; settled = true; resetEposConnection();
      const err = (msg && typeof msg === 'object') ? msg : new Error(String(msg));
      if (flags) Object.assign(err, flags);
      reject(err);
    };
    const ok = () => { if (settled) return; settled = true; resolve(true); };
    // Timeout after send started: response/confirmation lost -> uncertain (no blind retry)
    const timer = setTimeout(() => fail('Timeout stampa (' + PRINTER_IP + ')', { uncertain: true }), 10000);
    const done = (fn) => (...a) => { clearTimeout(timer); return fn(...a); };
    printer.onreceive = done((resp) => {
      if (resp && resp.success) ok();
      else {
        const code = (resp && (resp.code || resp.status)) || 'risposta non valida';
        const em = 'Errore stampante: ' + code;
        const e = new Error(em);
        if (/EPTR_COVER_OPEN|cover/i.test(String(code))) e.printerState = 'cover_open';
        else if (/EPTR_REC_EMPTY|paper/i.test(String(code))) e.printerState = 'paper_out';
        fail(e);
      }
    });
    printer.onerror = done((e) => {
      const msg = 'Errore ePOS: ' + (e && (e.message || e.status) || 'sconosciuto');
      const err = new Error(msg);
      if (/COVER_OPEN/i.test(String(e && (e.status || e.message || e)))) err.printerState = 'cover_open';
      if (/REC_EMPTY|PAPER/i.test(String(e && (e.status || e.message || e)))) err.printerState = 'paper_out';
      fail(err);
    });
    printer.oncoveropen = done(() => { const e = new Error('Errore stampante: coperchio aperto'); e.printerState = 'cover_open'; fail(e); });
    printer.onpaperend = done(() => { const e = new Error('Errore stampante: carta esaurita'); e.printerState = 'paper_out'; fail(e); });
    printer.onpapernearend = () => { /* warning only */ };
    try { printer.send(xml); }
    catch(e) { const err = new Error('Invio fallito: ' + (e && e.message || e)); err.beforeSend = true; done(fail)(err); }
  }));
}

function printViaHttp(xml) {
  return soapPrint(xml).then(r => {
    if (!r.ok) {
      const e = new Error('Printer HTTP error ' + r.status);
      e.uncertain = false;
      throw e;
    }
    return r.text().catch((readErr) => {
      // Response received but body unreadable: outcome uncertain (job may have been accepted/printed).
      const e = new Error('Printer response unreadable after send');
      e.uncertain = true;
      throw e;
    }).then(t => {
      const body = String(t || '');
      // Require positive confirmation; never mark printed without it.
      if (/success\s*=\s*["']?true["']?|<success>\s*true\s*<\/success>|<ePOSPrint>[\s\S]*?<response[^>]*success\s*=\s*["']?true/i.test(body)) return true;
      if (/code\s*=\s*["']?(?:OK|0|SUCCESS)["']?/i.test(body) && !/success\s*=\s*["']?false|<success>\s*false|error/i.test(body)) return true;
      if (/success\s*=\s*["']?false|<success>\s*false|<error|status\s*=\s*["']?(?:ERR|FAIL)/i.test(body)) {
        const m = body.match(/<status>([^<]+)<\/status>|code\s*=\s*["']?([^"'\s>]+)/i);
        const e = new Error('Printer error: ' + ((m && (m[1] || m[2])) || body.slice(0, 80)));
        if (/cover|EPTR_COVER_OPEN/i.test(body)) e.printerState = 'cover_open';
        if (/paper|empty|EPTR_REC_EMPTY/i.test(body)) e.printerState = 'paper_out';
        throw e;
      }
      // 2xx but no explicit success confirmation: uncertain (printer may have printed).
      const e = new Error('No print confirmation received from printer');
      e.uncertain = true;
      throw e;
    });
  }).catch(err => {
    if (err && err.uncertain) throw err;
    // Network/abort failures after request dispatch can mean request reached printer but response was lost.
    const msg = String(err && err.message || err || '');
    if (/AbortError|aborted|timeout|Timeout|NetworkError|Failed to fetch|Load failed/i.test(msg) || (err && err.name === 'AbortError')) {
      const e = new Error(msg || 'Connection lost during print');
      e.uncertain = true;
      throw e;
    }
    throw err;
  });
}

function isUncertainError(err) {
  if (!err) return false;
  if (err.beforeSend) return false;
  if (err.uncertain) return true;
  const msg = String(err.message || err || '');
  // Confirmation/response lost after dispatch: printer may have printed.
  return /No print confirmation|response unreadable|AbortError|aborted|NetworkError|Failed to fetch|Load failed/i.test(msg) || (/Timeout|timeout/i.test(msg) && !/Connessione stampante fallita|Impossibile connettersi|before sending/i.test(msg));
}
function friendlyPrintError(err) {
  const msg = String(err && err.message || err || 'Unknown error');
  if (/paper\s*(end|out)|carta esaurita|EPTR_REC_EMPTY/i.test(msg)) return 'Printer out of paper. Add paper and retry.';
  if (/paper\s*near/i.test(msg)) return 'Printer paper is low.';
  if (/cover\s*open|coperchio|EPTR_COVER_OPEN/i.test(msg)) return 'Printer cover is open. Close it and retry.';
  if (isUncertainError(err)) return 'Print outcome uncertain: confirmation was lost. Check the printer before retrying to avoid a duplicate receipt.';
  if (/Timeout|timeout/i.test(msg)) return 'Printer timed out before sending. Check connection/power and retry.';
  if (/Impossibile connettersi|Connessione stampante fallita|unreachable|not reachable|offline|disconnected/i.test(msg)) return 'Printer cannot be reached at ' + PRINTER_IP + '. Check Wi-Fi/power and retry.';
  if (/NetworkError|Failed to fetch|Load failed|TypeError:.*fetch|CORS/i.test(msg)) return 'Cannot reach printer from this browser/network. Check local network access or connection.';
  if (/HTTPS|mixed content|targetAddressSpace|local-network/i.test(msg)) return 'Browser blocked direct access to the local printer. Check local network permission and printer availability.';
  return msg.length > 140 ? msg.slice(0, 137) + '...' : msg;
}

function explainPrintBlock(err) {
  const msg = String(err && err.message || err || '');
  const https = (typeof location !== 'undefined' && location.protocol === 'https:');
  const lna = lnaFetchSupported();
  if (https) {
    let hint = msg;
    hint += ' (HTTPS to local printer ' + PRINTER_IP + '. On supported Chrome/Android, allow local network permission when prompted; if still blocked, printer/network may not allow browser access.)';
    hint += ' lna=' + lna;
    return hint;
  }
  if (/Failed to fetch|NetworkError|Load failed|CORS|TypeError/i.test(msg)) return msg + ' — Check that printer ' + PRINTER_IP + ' is reachable, ePOS enabled, and network allows connection.';
  return msg;
}

function directPrint(order) {
  const xml = buildReceiptXML(order);
  getLnaPermissionState().then(s => console.log('LNA local-network permission:', s, 'targetAddressSpace supported:', lnaFetchSupported(), 'secure:', (typeof isSecureContext !== 'undefined' ? isSecureContext : 'n/a')));
  // try HTTP ePOS endpoint first (fast success/fail), then reused SDK connection as fallback
  return printViaHttp(xml).catch(e1 => printViaEposSDK(xml).catch(e2 => {
    const err = new Error(explainPrintBlock(e2 && e2.message ? e2 : e1));
    err.primary = e1; err.secondary = e2;
    throw err;
  }));
}

function randomTestOrder() {
  const names = ['Mario Rossi','Luca Bianchi','Sara Verdi','Ali Khan','Giulia Neri','Paolo Conti'];
  const menu = [
    { name: 'Panino Kebab', price: 6.0 },
    { name: 'Piadina Kebab', price: 6.5 },
    { name: 'Kebab Box', price: 8.0 },
    { name: 'Patatine', price: 3.0 },
    { name: 'Coca Cola', price: 2.0 },
    { name: 'Acqua', price: 1.0 }
  ];
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const count = 1 + Math.floor(Math.random() * 4);
  const items = Array.from({ length: count }, () => {
    const m = pick(menu);
    return { qty: 1 + Math.floor(Math.random() * 3), name: m.name, price: m.price };
  });
  const total = items.reduce((s, i) => s + i.qty * i.price, 0);
  const isPickup = Math.random() < 0.5;
  const times = ['ASAP','19:30','20:00','20:30','21:00'];
  return {
    id: 'test-' + Date.now() + '-' + Math.random().toString(36).slice(2,6),
    order_number: 'TEST-' + String(Math.floor(1000 + Math.random() * 9000)),
    customer_name: pick(names),
    customer_phone: '3' + String(Math.floor(100000000 + Math.random() * 900000000)),
    order_type: isPickup ? 'pickup' : 'delivery',
    delivery_timing: isPickup ? null : (Math.random() < 0.5 ? 'later' : 'now'),
    delivery_time: !isPickup && Math.random() < 0.5 ? pick(times.slice(1)) : null,
    pickup_time: isPickup ? pick(times) : null,
    delivery_address: isPickup ? null : 'Via Roma ' + (1 + Math.floor(Math.random() * 50)) + ', Pescia',
    notes: Math.random() < 0.4 ? pick(['Senza cipolla','Extra piccante','Salsa a parte','Ben cotto']) : '',
    payment_method: pick(['Contanti', 'Carta', 'N/A']),
    created_at: new Date().toISOString(),
    items,
    total
  };
}

function testPrinterConnection() {
  const order = randomTestOrder();
  printOrder(order, { force: true });
}

function printOrder(order, opts) {
  if (!order) return Promise.resolve();
  opts = opts || {};
  const key = String(order.id);
  const prev = getPrintInfo(order.id);
  const isAuto = !!opts.auto;
  const force = !!opts.force;
  if (prev && prev.status === 'pending') {
    showToast('Stampa già in corso: ' + (order.order_number || order.id));
    return Promise.resolve();
  }
  if (isAuto && (autoPrintedIds.has(key) || printedIdsPersist.has(key) || (prev && prev.status === 'printed'))) {
    return Promise.resolve();
  }
  if (prev && prev.status === 'uncertain' && !force) {
    showToast('Stampa incerta per ' + (order.order_number || order.id) + ': verifica la stampante prima di riprovare.');
    return Promise.resolve();
  }
  if (isAuto) { autoPrintedIds.add(key); saveAutoPrintedIds(); }
  const attempts = ((prev && prev.attempts) || 0) + 1;
  if (force) { uncertainPrintIds.delete(key); saveUncertainPrintIds(); }
  printedOrders.set(key, { status: 'pending', attempts, error: null });
  setPrinterState('printing', 'Sending ' + (order.order_number || key));
  renderOrders();
  showToast('Stampa in corso: ' + (order.order_number || order.id) + '...');
  return directPrint(order).then(() => {
    printedOrders.set(key, { status: 'printed', attempts, error: null });
    markPrintedPersist(key);
    setPrinterState('last_ok', 'Last confirmed print succeeded');
    showToast('Stampato: ' + (order.order_number || order.id));
    return true;
  }).catch(err => {
    const friendly = friendlyPrintError(err);
    console.error('Print error', err);
    if (isUncertainError(err)) {
      printedOrders.set(key, { status: 'uncertain', attempts, error: friendly, uncertain: true });
      markUncertainPersist(key);
      setPrinterState('uncertain', friendly);
      showToast('Esito incerto: ' + friendly);
      return false;
    }
    printedOrders.set(key, { status: 'failed', attempts, error: friendly });
    if (err && err.printerState) setPrinterState(err.printerState, friendly);
    else if (/cannot be reached|Cannot reach printer/i.test(friendly)) setPrinterState('unreachable', friendly);
    else setPrinterState('unknown', friendly);
    showToast('Stampa non riuscita: ' + friendly);
    return false;
  }).finally(() => { renderOrders(); });
}

function printReceiptEpson(order) {
  printOrder(order);
}

function setStatus(id, status, btn) {
  const o = orders.find(x => String(x.id) === String(id));
  if (!o || o._saving) return;
  o._saving = true;
  const prev = o.status;
  o.status = status;
  renderStats();
  renderOrders();
  renderEarnings();
  if (btn) { btn.disabled = true; btn.textContent = '...'; }
  saveStatus(id, status).then(() => {
    o._saving = false;
    showToast('Ordine ' + o.order_number + ' \u2192 ' + status);
    // Auto-print is client-side; do not claim cross-device atomic locking without backend support.
    const _prevPS = String(prev || '').toLowerCase();
    const _newPS = String(status || '').toLowerCase();
    if (_newPS === 'preparing' && _prevPS !== 'preparing' && autoPrintEnabled) {
      printOrder(o, { auto: true });
    }
    if (currentStatus !== 'all') {
      currentStatus = status;
      els.filterTabs.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      const nt = els.filterTabs.querySelector('.filter-tab[data-status="' + status + '"]');
      if (nt) nt.classList.add('active');
      renderOrders();
    }
  }).catch(() => {
    o._saving = false;
    o.status = prev;
    renderStats();
    renderOrders();
    renderEarnings();
    if (btn) { btn.disabled = false; }
    showToast('Errore aggiornamento');
  });
}

function showLogin() { els.loginScreen.classList.remove('hidden'); els.dashboard.classList.add('hidden'); }
function showDashboard() { els.loginScreen.classList.add('hidden'); els.dashboard.classList.remove('hidden'); }

function loadAndRender() {
  const banner = document.getElementById('conn-banner');
  loadOrders().then(o => {
    if (banner) banner.classList.remove('show');
    const seen = new Map();
    o.forEach(x => { if (!seen.has(x.id)) seen.set(x.id, x); });
    o = Array.from(seen.values());
    const newOnes = o.filter(x => x.status === 'new' && !modalShownIds.has(x.id));
    const modal = document.getElementById('neworder-modal');
    if (newOnes.length && (!modal || modal.classList.contains('hidden'))) {
      const firstNew = newOnes[0];
      modalShownIds.add(firstNew.id);
      showNewOrderModal(firstNew);
    }
    o.forEach(x => knownIds.add(x.id));
    orders = o;
    renderStats();
    renderOrders();
    renderEarnings();
  }).catch(() => { if (banner) banner.classList.add('show'); showToast('Errore caricamento ordini'); });
}

function showNewOrderModal(o) {
  selectedNewOrder = o;
  const idEl = document.getElementById('no-id');
  if (idEl) idEl.textContent = 'Ordine #' + (o.order_number || o.id);
  const body = document.getElementById('no-body');
  if (body) {
    const items = (o.items || []).map(i => '<li>' + i.qty + '\u00d7 ' + esc(i.name) + ' \u20ac' + (i.qty * i.price).toFixed(2) + '</li>').join('');
    body.innerHTML = '<p><b>' + esc(o.customer_name) + '</b> \u2014 ' + esc(o.customer_phone) + '</p>' +
      '<p>' + (o.order_type === 'delivery' ? 'Consegna' : 'Ritiro') + (o.order_type === 'delivery' && o.delivery_timing === 'later' ? ' alle ' + esc(o.delivery_time) : (o.order_type === 'pickup' && o.pickup_time ? ' alle ' + esc(o.pickup_time) : '')) + '</p>' +
      '<p>Ordine effettuato: ' + new Date(o.created_at).toLocaleString('it-IT') + '</p>' +
      (o.delivery_address ? '<p>Indirizzo: ' + esc(o.delivery_address) + '</p>' : '') +
      (o.notes ? '<p><b>Note:</b> ' + esc(o.notes) + '</p>' : '') +
      '<ul>' + items + '</ul>' +
      '<p><b>Totale: \u20ac' + Number(o.total).toFixed(2) + '</b></p>';
  }
  const m = document.getElementById('neworder-modal');
  if (m) m.classList.remove('hidden');
}

let knownIds = new Set();
let unacceptedNew = new Set();
let alarmTimer = null;
let alarmAudio = null;
function playAlarm() { try { if (!alarmAudio) { alarmAudio = new Audio('ali_kebab_real_siren_alert.wav'); alarmAudio.loop = true; alarmAudio.preload = 'auto'; alarmAudio.load(); } alarmAudio.play(); } catch(e){ console.error('alarm', e); } }
function stopAlarm() { if (alarmAudio) { alarmAudio.pause(); alarmAudio.currentTime = 0; } }
let audioCtx = null;
function ensureAudio() {
  if (audioCtx) return audioCtx;
  try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) { audioCtx = null; }
  return audioCtx;
}
document.addEventListener('click', ensureAudio, { once: false });
document.addEventListener('keydown', ensureAudio, { once: false });

function renderOrders() {
  const filtered = getFiltered().sort((a, b) => {
    const pa = a.status === 'new' ? 0 : 1;
    const pb = b.status === 'new' ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return new Date(a.created_at) - new Date(b.created_at);
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
    const waiting = o.status === 'new' && (Date.now() - new Date(o.created_at).getTime()) > 300000;
    const pinfo = getPrintInfo(o.id);
    const pstatus = pinfo ? pinfo.status : null;
    let pbadge = '';
    if (pstatus === 'printed') pbadge = '<span class="print-badge printed" title="Confirmed printed">\u2705 Stampato</span>';
    else if (pstatus === 'failed') pbadge = '<span class="print-badge failed" title="' + esc((pinfo && pinfo.error) || 'Print failed') + '">Stampa fallita</span>';
    else if (pstatus === 'pending') pbadge = '<span class="print-badge pending" title="Print in progress">Stampa...</span>';
    else if (pstatus === 'uncertain') pbadge = '<span class="print-badge uncertain" title="' + esc((pinfo && pinfo.error) || 'Outcome uncertain. Check printer before retry.') + '">Esito incerto</span>';
    const printDisabled = pstatus === 'pending';
    const printLabel = pstatus === 'pending' ? 'Stampa...' : (pstatus === 'failed' ? 'Riprova' : (pstatus === 'uncertain' ? 'Verifica/Riprova' : 'Stampa'));
    card.className = 'order-card' + (highlightId && o.id == highlightId ? ' highlight' : '') + (waiting ? ' waiting' : '');
    if (o._saving) card.classList.add('saving');
    card.innerHTML = `
      <div class="order-head">
        <div class="order-number">${esc(o.order_number)} <span class="order-id">ID: ${o.id}</span></div>
        <span class="order-status ${statusClass(o.status)}">${o.status}</span>
        ${pbadge}
      </div>
      <div class="order-meta">
        <span>\ud83d\udc46 ${esc(o.customer_name)}</span>
        <span>\ud83d\udc4f ${esc(o.customer_phone)}</span>
        <span>\ud83d\ude9a ${o.order_type}</span>
        ${o.delivery_address ? '<span>\ud83d\udccd ' + esc(o.delivery_address) + '</span>' : ''}
        ${o.order_type === 'delivery' && o.delivery_timing ? '<span>\u23f1 Delivery: ' + esc(o.delivery_timing === 'later' ? (o.delivery_time || '') : 'Now') + '</span>' : ''}
        ${o.order_type === 'pickup' && o.pickup_time ? '<span>\u23f1 Ritiro: ' + esc(o.pickup_time) + '</span>' : ''}
        <span>\u23f1 ${timeAgo(o.created_at)}</span>
      </div>
      ${o.notes ? '<div class="order-meta"><span>\ud83d\udcdd ' + esc(o.notes) + '</span></div>' : ''}
      <ul class="order-items">${(o.items || []).map(i => '<li>' + i.qty + '\u00d7 ' + esc(i.name) + ' <span style="float:right">\u20ac' + (i.qty * i.price).toFixed(2) + '</span></li>').join('')}</ul>
      <div class="order-foot">
        <div class="order-total">\u20ac${Number(o.total).toFixed(2)}</div>
        <div class="order-actions">
          <button class="btn btn-ghost btn-sm" data-action="status" data-id="${o.id}">Aggiorna</button>
          <button class="btn btn-ghost btn-sm" data-action="print" data-id="${o.id}" ${printDisabled ? 'disabled' : ''}>${printLabel}</button>
          ${o.status === 'new' ? '<button class="btn btn-success btn-sm" data-action="accept" data-id="${o.id}">Accetta</button><button class="btn btn-danger btn-sm" data-action="reject" data-id="${o.id}">Rifiuta</button>' : ''}
          ${o.status === 'accepted' ? '<button class="btn btn-primary btn-sm" data-action="preparing" data-id="${o.id}">In preparazione</button>' : ''}
          ${o.status === 'preparing' ? '<button class="btn btn-primary btn-sm" data-action="ready" data-id="${o.id}" onclick="setStatus(\'' + o.id + '\',\'ready\',this)">Segna pronto</button>' : ''}
          ${o.status === 'ready' || o.status === 'out_for_delivery' ? '<button class="btn btn-success btn-sm" data-action="complete" data-id="${o.id}">Completa</button>' : ''}
        </div>
      </div>`;
    els.orderList.appendChild(card);
  });
}

els.loginForm.addEventListener('submit', e => {
  e.preventDefault();
  const user = document.getElementById('login-email').value.trim();
  const pass = document.getElementById('login-password').value;
  fetch((window.API_BASE || '') + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: user, password: pass }) }).then(r => {
    if (!r.ok) throw new Error('bad');
    return r.json();
  }).then(d => {
    sessionStorage.setItem(SESSION_KEY, '1');
    sessionStorage.setItem('forno99_token', d.token);
    els.loginError.classList.add('hidden');
    showDashboard();
    loadAndRender();
    initPrinter();
  }).catch(() => {
    els.loginError.textContent = 'Nome utente o password non validi.';
    els.loginError.classList.remove('hidden');
  });
});

els.signoutBtn.addEventListener('click', () => {
  const t = sessionStorage.getItem('forno99_token');
  fetch((window.API_BASE || '') + '/api/logout', { method: 'POST', headers: { 'Authorization': 'Bearer ' + t } }).finally(() => {
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
  if (els.dateFrom.value && els.dateTo.value && els.dateFrom.value > els.dateTo.value) { showToast('Data fine precedente alla data inizio'); return; }
  if (els.selectedRange) els.selectedRange.textContent = (els.dateFrom.value || '') + ' \u2192 ' + (els.dateTo.value || '');
  renderOrders();
});
if (els.cancelRange) els.cancelRange.addEventListener('click', () => {
  if (els.customPanel) els.customPanel.classList.add('hidden');
  dateFilter = 'today';
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
    if (selectedOrder) els.statusOrderInfo.textContent = selectedOrder.order_number + ' \u2014 ' + selectedOrder.customer_name;
    els.statusModal.classList.remove('hidden');
  } else if (action === 'accept') setStatus(id, 'preparing', btn);
  else if (action === 'reject') setStatus(id, 'rejected', btn);
  else if (action === 'preparing') setStatus(id, 'preparing', btn);
  else if (action === 'ready') { const oo = orders.find(x => String(x.id) === String(id)); setStatus(id, oo && oo.order_type === 'pickup' ? 'ready' : 'out_for_delivery', btn); }
  else if (action === 'complete') setStatus(id, 'completed', btn);
  else if (action === 'print') {
    const o = orders.find(x => String(x.id) === String(id));
    if (!o) return;
    const pi = getPrintInfo(o.id);
    if (pi && pi.status === 'uncertain') {
      const ok = window.confirm('Last print outcome is uncertain (printer may have printed). Check the printer first. Retry printing anyway?');
      if (!ok) return;
      printOrder(o, { force: true });
    } else {
      printOrder(o);
    }
  }
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

// Expose printer functions globally for inline HTML onclick
window.initPrinter = initPrinter;
window.setStatus = setStatus;
window.testPrinterConnection = testPrinterConnection;
window.printReceiptEpson = printReceiptEpson;
window.printOrder = printOrder;

// Toggle accepting orders
const toggleBtn = document.createElement("button"); toggleBtn.textContent = "Toggle Orders"; toggleBtn.className = "btn btn-ghost btn-sm"; toggleBtn.style.position = "fixed"; toggleBtn.style.bottom = "20px"; toggleBtn.style.right = "20px"; toggleBtn.style.zIndex = "9999"; document.body.appendChild(toggleBtn);
toggleBtn.addEventListener("click", async () => { if (!confirm("Sei sicuro?")) return; const t = sessionStorage.getItem("forno99_token"); const r = await fetch((window.API_BASE || "") + "/api/settings", { headers: { Authorization: "Bearer " + t } }); const d = await r.json(); const next = d.accepting_orders === "false" ? "true" : "false"; await fetch((window.API_BASE || "") + "/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + t }, body: JSON.stringify({ key: "accepting_orders", value: next }) }); });

const earningsTabs = document.getElementById('earnings-tabs');
if (earningsTabs) earningsTabs.addEventListener('click', e => {
  const tab = e.target.closest('.earnings-tab');
  if (!tab) return;
  earningsTabs.querySelectorAll('.earnings-tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  earningsRange = tab.dataset.range;
  const ec = document.getElementById('earn-custom'); if (ec) ec.classList.toggle('hidden', earningsRange !== 'custom');
  renderEarnings();
});
const ef = document.getElementById('earn-from'); const et = document.getElementById('earn-to');
if (ef) ef.addEventListener('change', renderEarnings);
if (et) et.addEventListener('change', renderEarnings);
function initAuth() {
  if (sessionStorage.getItem(SESSION_KEY) === '1') { showDashboard(); loadAndRender(); initPrinter(); }
  else showLogin();
}
const noAccept = document.getElementById('no-accept');
const noReject = document.getElementById('no-reject');
if (noAccept) noAccept.addEventListener('click', () => { if (selectedNewOrder) { setStatus(selectedNewOrder.id, 'preparing'); document.getElementById('neworder-modal').classList.add('hidden'); } });
if (noReject) noReject.addEventListener('click', () => { if (selectedNewOrder) { setStatus(selectedNewOrder.id, 'rejected'); document.getElementById('neworder-modal').classList.add('hidden'); } });

// Printer settings modal handlers
if (els.printerSettingsBtn) els.printerSettingsBtn.addEventListener('click', () => {
  if (els.printerSettingsModal) els.printerSettingsModal.classList.remove('hidden');
});
const printerSettingsClose = document.getElementById('printer-settings-close');
if (printerSettingsClose) printerSettingsClose.addEventListener('click', () => {
  if (els.printerSettingsModal) els.printerSettingsModal.classList.add('hidden');
});
const printerSettingsModal = document.getElementById('printer-settings-modal');
if (printerSettingsModal) printerSettingsModal.addEventListener('click', (e) => {
  if (e.target === printerSettingsModal) printerSettingsModal.classList.add('hidden');
});
const printerTestBtn = document.getElementById('printer-test-btn');
if (printerTestBtn) printerTestBtn.addEventListener('click', testPrinterConnection);
const autoPrintToggle = document.getElementById('auto-print-toggle');
if (autoPrintToggle) {
  autoPrintToggle.checked = !!autoPrintEnabled;
  autoPrintToggle.addEventListener('change', () => { autoPrintEnabled = !!autoPrintToggle.checked; saveAutoPrintEnabled(); showToast(autoPrintEnabled ? 'Stampa automatica attiva' : 'Stampa automatica disattiva'); });
}
