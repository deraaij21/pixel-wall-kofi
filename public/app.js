// Pixel Wall frontend (Ko-fi edition)
// Canvas + zoom flow stays the same. Payment opens a modal with a Ko-fi token,
// then polls /api/check/:token until the webhook places the pixel.

const PALETTE = [
  '#E24B4A', '#D85A30', '#EF9F27', '#97C459', '#1D9E75',
  '#378ADD', '#7F77DD', '#D4537E', '#F4C0D1', '#888780', '#2C2C2A'
];

const COLS = 1000;
const ROWS = 1000;
const ZOOM_SIZE = 50;

const canvas = document.getElementById('wall');
const ctx = canvas.getContext('2d');
const placedEl = document.getElementById('placed');
const percentEl = document.getElementById('percent');
const counterEl = document.getElementById('counter');
const progressFill = document.getElementById('progress-fill');
const claimSection = document.getElementById('claim');
const paletteEl = document.getElementById('palette');
const coordsEl = document.getElementById('coords');
const cta = document.getElementById('cta');
const nameInput = document.getElementById('name');
const messageInput = document.getElementById('message');
const backBtn = document.getElementById('back');
const modeLabel = document.getElementById('mode');

const modal = document.getElementById('payment-modal');
const modalBackdrop = document.getElementById('modal-backdrop');
const modalClose = document.getElementById('modal-close');
const modalPending = document.getElementById('modal-pending');
const modalSuccess = document.getElementById('modal-success');
const modalExpired = document.getElementById('modal-expired');
const modalToken = document.getElementById('modal-token');
const copyTokenBtn = document.getElementById('copy-token');
const kofiLink = document.getElementById('kofi-link');
const modalStatusText = document.getElementById('modal-status-text');
const successCoords = document.getElementById('success-coords');
const modalDone = document.getElementById('modal-done');
const modalRetry = document.getElementById('modal-retry');

const master = document.createElement('canvas');
master.width = COLS;
master.height = ROWS;
const mctx = master.getContext('2d');
mctx.fillStyle = '#FFFFFF';
mctx.fillRect(0, 0, COLS, ROWS);

let mode = 'overview';
let zoomCx = 500;
let zoomCy = 500;
let selectedX = -1;
let selectedY = -1;
let selectedColor = PALETTE[0];
let placedCount = 0;
let lastUpdate = 0;
const filled = new Set();

let activePollInterval = null;
let activeToken = null;

PALETTE.forEach((c, i) => {
  const sw = document.createElement('div');
  sw.className = 'color' + (i === 0 ? ' selected' : '');
  sw.style.background = c;
  sw.setAttribute('role', 'button');
  sw.setAttribute('aria-label', `Color ${i + 1}`);
  sw.onclick = () => {
    document.querySelectorAll('.color').forEach(el => el.classList.remove('selected'));
    sw.classList.add('selected');
    selectedColor = c;
    render();
  };
  paletteEl.appendChild(sw);
});

function paint(x, y, color) {
  if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return;
  const idx = y * COLS + x;
  if (filled.has(idx)) return;
  filled.add(idx);
  mctx.fillStyle = color;
  mctx.fillRect(x, y, 1, 1);
  placedCount++;
}

function updateStats() {
  const formatted = placedCount.toLocaleString('en-US');
  placedEl.textContent = formatted;
  const pct = (placedCount / 1000000) * 100;
  percentEl.textContent = pct.toFixed(2) + '%';
  progressFill.style.width = Math.min(pct, 100) + '%';
  counterEl.textContent = formatted + ' / 1,000,000';
}

function render() {
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, COLS, ROWS);

  if (mode === 'overview') {
    ctx.drawImage(master, 0, 0);
    return;
  }

  const sx = Math.max(0, Math.min(COLS - ZOOM_SIZE, zoomCx - Math.floor(ZOOM_SIZE / 2)));
  const sy = Math.max(0, Math.min(ROWS - ZOOM_SIZE, zoomCy - Math.floor(ZOOM_SIZE / 2)));
  ctx.drawImage(master, sx, sy, ZOOM_SIZE, ZOOM_SIZE, 0, 0, COLS, ROWS);

  const cell = COLS / ZOOM_SIZE;
  ctx.strokeStyle = 'rgba(0,0,0,0.08)';
  ctx.lineWidth = 1;
  for (let i = 1; i < ZOOM_SIZE; i++) {
    const p = i * cell;
    ctx.beginPath();
    ctx.moveTo(p, 0); ctx.lineTo(p, ROWS);
    ctx.moveTo(0, p); ctx.lineTo(COLS, p);
    ctx.stroke();
  }

  if (selectedX >= 0) {
    const rx = (selectedX - sx) * cell;
    const ry = (selectedY - sy) * cell;
    ctx.fillStyle = selectedColor;
    ctx.fillRect(rx, ry, cell, cell);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 4;
    ctx.strokeRect(rx, ry, cell, cell);
  }
}

function enterZoom(cx, cy) {
  zoomCx = cx;
  zoomCy = cy;
  mode = 'zoom';
  selectedX = -1;
  selectedY = -1;
  modeLabel.textContent = 'Pick a pixel';
  backBtn.hidden = false;
  claimSection.hidden = false;
  coordsEl.textContent = `near (${cx}, ${cy})`;
  cta.disabled = true;
  cta.textContent = 'Click an empty pixel above';
  render();
}

function exitZoom() {
  mode = 'overview';
  selectedX = -1;
  selectedY = -1;
  modeLabel.textContent = 'Click to zoom in';
  backBtn.hidden = true;
  claimSection.hidden = true;
  render();
}

canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const u = (e.clientX - rect.left) / rect.width;
  const v = (e.clientY - rect.top) / rect.height;

  if (mode === 'overview') {
    enterZoom(Math.floor(u * COLS), Math.floor(v * ROWS));
    setTimeout(() => {
      claimSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  } else {
    const sx = Math.max(0, Math.min(COLS - ZOOM_SIZE, zoomCx - Math.floor(ZOOM_SIZE / 2)));
    const sy = Math.max(0, Math.min(ROWS - ZOOM_SIZE, zoomCy - Math.floor(ZOOM_SIZE / 2)));
    const px = sx + Math.floor(u * ZOOM_SIZE);
    const py = sy + Math.floor(v * ZOOM_SIZE);
    if (filled.has(py * COLS + px)) return;
    selectedX = px;
    selectedY = py;
    coordsEl.textContent = `at (${px}, ${py})`;
    cta.disabled = false;
    cta.textContent = 'Place this pixel for €1.00';
    render();
  }
});

backBtn.addEventListener('click', exitZoom);

cta.addEventListener('click', async () => {
  if (selectedX < 0) return;
  cta.disabled = true;
  const original = cta.textContent;
  cta.textContent = 'Reserving…';

  try {
    const res = await fetch('/api/reserve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x: selectedX,
        y: selectedY,
        color: selectedColor,
        name: nameInput.value.trim(),
        message: messageInput.value.trim()
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || 'Could not reserve this pixel. Try another one.');
      cta.disabled = false;
      cta.textContent = original;
      return;
    }

    const data = await res.json();
    openPaymentModal(data, selectedX, selectedY);
  } catch (err) {
    alert('Network error. Check your connection and try again.');
    cta.disabled = false;
    cta.textContent = original;
  }
});

function openPaymentModal(reservation, x, y) {
  modalToken.textContent = reservation.token;
  kofiLink.href = reservation.kofiUrl;
  modalStatusText.textContent = 'Waiting for your payment';
  modalPending.hidden = false;
  modalSuccess.hidden = true;
  modalExpired.hidden = true;
  modal.hidden = false;

  activeToken = reservation.token;
  startPolling(reservation.token, x, y, reservation.expiresAt);
}

function closeModal() {
  modal.hidden = true;
  if (activePollInterval) {
    clearInterval(activePollInterval);
    activePollInterval = null;
  }
  activeToken = null;
  cta.disabled = false;
  cta.textContent = selectedX >= 0 ? 'Place this pixel for €1.00' : 'Click an empty pixel above';
}

function showSuccess(x, y, color) {
  modalPending.hidden = true;
  modalExpired.hidden = true;
  modalSuccess.hidden = false;
  successCoords.textContent = `(${x}, ${y})`;

  paint(x, y, color);
  updateStats();
  selectedX = -1;
  selectedY = -1;
  cta.textContent = 'Click an empty pixel above';
  render();
}

function showExpired() {
  modalPending.hidden = true;
  modalSuccess.hidden = true;
  modalExpired.hidden = false;
}

function startPolling(token, x, y, expiresAt) {
  if (activePollInterval) clearInterval(activePollInterval);

  let attempts = 0;
  activePollInterval = setInterval(async () => {
    attempts++;

    if (Date.now() > expiresAt) {
      clearInterval(activePollInterval);
      activePollInterval = null;
      showExpired();
      return;
    }

    try {
      const res = await fetch(`/api/check/${token}`);
      if (!res.ok) return;
      const data = await res.json();

      if (data.status === 'paid') {
        clearInterval(activePollInterval);
        activePollInterval = null;
        showSuccess(data.x, data.y, data.color);
      } else if (data.status === 'expired') {
        clearInterval(activePollInterval);
        activePollInterval = null;
        showExpired();
      } else if (attempts > 5 && attempts % 5 === 0) {
        modalStatusText.textContent = 'Still waiting. Did you paste the code?';
      }
    } catch (err) {
      // ignore, retry
    }
  }, 3000);
}

copyTokenBtn.onclick = async () => {
  const token = modalToken.textContent;
  try {
    await navigator.clipboard.writeText(token);
    const original = copyTokenBtn.textContent;
    copyTokenBtn.textContent = 'Copied';
    setTimeout(() => { copyTokenBtn.textContent = original; }, 1500);
  } catch (err) {
    const range = document.createRange();
    range.selectNode(modalToken);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
  }
};

modalClose.onclick = closeModal;
modalBackdrop.onclick = closeModal;
modalDone.onclick = closeModal;
modalRetry.onclick = closeModal;

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !modal.hidden) closeModal();
});

async function loadSnapshot() {
  try {
    const res = await fetch('/api/snapshot');
    const buf = new Uint8Array(await res.arrayBuffer());
    const dv = new DataView(buf.buffer);
    if (buf.byteLength < 4) return;
    const count = dv.getUint32(0, true);
    let offset = 4;
    for (let i = 0; i < count; i++) {
      if (offset + 5 > buf.byteLength) break;
      const x = dv.getUint16(offset, true);
      const y = dv.getUint16(offset + 2, true);
      const ci = dv.getUint8(offset + 4);
      const color = PALETTE[ci];
      if (color) paint(x, y, color);
      offset += 5;
    }
    lastUpdate = Date.now();
    updateStats();
    render();
  } catch (err) {
    console.error('Snapshot load failed:', err);
  }
}

async function pollUpdates() {
  try {
    const res = await fetch(`/api/recent?since=${lastUpdate}`);
    if (!res.ok) return;
    const data = await res.json();
    let dirty = false;
    for (const p of data.pixels) {
      paint(p.x, p.y, p.color);
      dirty = true;
    }
    lastUpdate = data.now;
    if (dirty) {
      updateStats();
      render();
    }
  } catch (err) {
    // ignore
  }
}

const params = new URLSearchParams(location.search);
const directX = parseInt(params.get('x'));
const directY = parseInt(params.get('y'));

loadSnapshot().then(() => {
  if (!Number.isNaN(directX) && !Number.isNaN(directY)) {
    enterZoom(directX, directY);
  }
  setInterval(pollUpdates, 5000);
});
