// Pixel Wall server (Ko-fi edition)
// Ko-fi is the merchant of record. Users pay via Ko-fi and include a reservation token
// in the message. Our webhook receives the token and places the pixel.

import express from 'express';
import Database from 'better-sqlite3';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { fileURLToPath } from 'url';
import path from 'path';
import crypto from 'crypto';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'pixels.db');
const KOFI_TOKEN = process.env.KOFI_VERIFICATION_TOKEN;
const KOFI_USERNAME = process.env.KOFI_USERNAME;

const COLS = 1000;
const ROWS = 1000;
const RESERVATION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const PIXEL_PRICE_EUR = 1.00;

const PALETTE = [
  '#E24B4A', '#D85A30', '#EF9F27', '#97C459', '#1D9E75',
  '#378ADD', '#7F77DD', '#D4537E', '#F4C0D1', '#888780', '#2C2C2A'
];

if (!KOFI_TOKEN) {
  console.error('KOFI_VERIFICATION_TOKEN missing in .env');
  console.error('Get it from https://ko-fi.com/manage/webhooks');
  process.exit(1);
}
if (!KOFI_USERNAME) {
  console.error('KOFI_USERNAME missing in .env (your Ko-fi page username)');
  process.exit(1);
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS pixels (
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    color TEXT NOT NULL,
    name TEXT,
    message TEXT,
    placed_at INTEGER NOT NULL,
    PRIMARY KEY (x, y)
  );
  CREATE INDEX IF NOT EXISTS idx_pixels_placed_at ON pixels(placed_at);

  CREATE TABLE IF NOT EXISTS reservations (
    token TEXT PRIMARY KEY,
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    color TEXT NOT NULL,
    name TEXT,
    message TEXT,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_reservations_xy ON reservations(x, y);
  CREATE INDEX IF NOT EXISTS idx_reservations_expires ON reservations(expires_at);
`);

const stmtGetPixel = db.prepare('SELECT x, y, color, name, message, placed_at FROM pixels WHERE x = ? AND y = ?');
const stmtAllPixels = db.prepare('SELECT x, y, color FROM pixels');
const stmtCount = db.prepare('SELECT COUNT(*) as c FROM pixels');
const stmtRecentPixels = db.prepare('SELECT x, y, color, name, placed_at FROM pixels WHERE placed_at > ? ORDER BY placed_at ASC LIMIT 1000');
const stmtInsertPixel = db.prepare('INSERT OR IGNORE INTO pixels (x, y, color, name, message, placed_at) VALUES (?, ?, ?, ?, ?, ?)');

const stmtGetReservation = db.prepare('SELECT * FROM reservations WHERE token = ?');
const stmtGetActiveReservationXY = db.prepare('SELECT * FROM reservations WHERE x = ? AND y = ? AND expires_at > ?');
const stmtInsertReservation = db.prepare('INSERT INTO reservations (token, x, y, color, name, message, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
const stmtDeleteReservation = db.prepare('DELETE FROM reservations WHERE token = ?');
const stmtCleanExpiredReservations = db.prepare('DELETE FROM reservations WHERE expires_at < ?');

setInterval(() => {
  const r = stmtCleanExpiredReservations.run(Date.now());
  if (r.changes > 0) console.log(`[cleanup] freed ${r.changes} expired reservations`);
}, 60 * 1000);

const reserveSchema = z.object({
  x: z.number().int().min(0).max(COLS - 1),
  y: z.number().int().min(0).max(ROWS - 1),
  color: z.string().refine(c => PALETTE.includes(c), { message: 'Invalid color' }),
  name: z.string().max(40).optional().default(''),
  message: z.string().max(140).optional().default('')
});

// Generate a short, unambiguous token like PXL-A7K3MN5Q
function generateToken() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  let token = 'PXL-';
  for (let i = 0; i < 8; i++) {
    token += chars[bytes[i] % chars.length];
  }
  return token;
}

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '4kb' }));
// Ko-fi sends webhooks as application/x-www-form-urlencoded with single 'data' field.
app.use(express.urlencoded({ extended: true, limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.get('/api/snapshot', (req, res) => {
  const pixels = stmtAllPixels.all();
  const buf = Buffer.alloc(4 + pixels.length * 5);
  buf.writeUInt32LE(pixels.length, 0);
  let offset = 4;
  for (const p of pixels) {
    const ci = PALETTE.indexOf(p.color);
    if (ci < 0) continue;
    buf.writeUInt16LE(p.x, offset);
    buf.writeUInt16LE(p.y, offset + 2);
    buf.writeUInt8(ci, offset + 4);
    offset += 5;
  }
  res.set('Content-Type', 'application/octet-stream');
  res.set('Cache-Control', 'no-store');
  res.send(buf);
});

app.get('/api/recent', (req, res) => {
  const since = parseInt(req.query.since) || 0;
  const pixels = stmtRecentPixels.all(since);
  res.json({ pixels, now: Date.now() });
});

app.get('/api/pixel', (req, res) => {
  const x = parseInt(req.query.x);
  const y = parseInt(req.query.y);
  if (Number.isNaN(x) || Number.isNaN(y)) return res.status(400).json({ error: 'Invalid' });
  const p = stmtGetPixel.get(x, y);
  if (!p) return res.status(404).json({ error: 'Not placed' });
  res.json(p);
});

app.get('/api/stats', (req, res) => {
  res.json({ placed: stmtCount.get().c, total: COLS * ROWS });
});

app.get('/api/config', (req, res) => {
  res.json({ kofiUsername: KOFI_USERNAME });
});

const reserveLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, slow down' }
});

// Reserve a pixel and get a Ko-fi payment code.
app.post('/api/reserve', reserveLimiter, (req, res) => {
  let data;
  try {
    data = reserveSchema.parse(req.body);
  } catch (err) {
    return res.status(400).json({ error: 'Invalid input' });
  }

  const { x, y, color, name, message } = data;
  const now = Date.now();

  if (stmtGetPixel.get(x, y)) {
    return res.status(409).json({ error: 'This pixel is already placed' });
  }

  const active = stmtGetActiveReservationXY.get(x, y, now);
  if (active) {
    return res.status(409).json({ error: 'This pixel is reserved by someone else, try another' });
  }

  const token = generateToken();
  const expiresAt = now + RESERVATION_TTL_MS;

  try {
    stmtInsertReservation.run(token, x, y, color, name || null, message || null, expiresAt, now);
  } catch (err) {
    console.error('[reserve] insert failed:', err.message);
    return res.status(500).json({ error: 'Could not reserve, try again' });
  }

  res.json({
    token,
    kofiUrl: `https://ko-fi.com/${KOFI_USERNAME}`,
    expiresAt,
    amount: PIXEL_PRICE_EUR
  });
});

// Poll endpoint: returns 'paid' once the webhook places the pixel.
app.get('/api/check/:token', (req, res) => {
  const token = req.params.token;
  if (!token || !token.startsWith('PXL-')) {
    return res.status(400).json({ error: 'Invalid token' });
  }

  const reservation = stmtGetReservation.get(token);
  if (reservation) {
    // Reservation still active. Check if pixel got placed (race condition safety).
    const pixel = stmtGetPixel.get(reservation.x, reservation.y);
    if (pixel && pixel.color === reservation.color) {
      return res.json({ status: 'paid', x: pixel.x, y: pixel.y, color: pixel.color });
    }
    if (reservation.expires_at < Date.now()) {
      return res.json({ status: 'expired' });
    }
    return res.json({ status: 'pending', expiresAt: reservation.expires_at });
  }

  // Reservation gone: either webhook processed (success) or it expired and got cleaned up.
  // If a pixel exists at any color (we can't easily look up by token here), assume paid.
  // For simplicity: tell the client it's done and they can refresh to see the wall update.
  res.json({ status: 'unknown' });
});

// Ko-fi webhook handler.
// Ko-fi sends application/x-www-form-urlencoded with a single 'data' field containing JSON.
app.post('/api/webhook/kofi', (req, res) => {
  let data;
  try {
    data = JSON.parse(req.body.data || '{}');
  } catch (err) {
    return res.status(400).send('Invalid payload');
  }

  if (data.verification_token !== KOFI_TOKEN) {
    console.warn('[kofi] invalid verification token');
    return res.status(401).send('Unauthorized');
  }

  // Only process payment-type events
  const validTypes = ['Donation', 'Shop Order', 'Subscription'];
  if (!validTypes.includes(data.type)) {
    return res.status(200).send('OK');
  }

  const amount = parseFloat(data.amount);
  if (Number.isNaN(amount) || amount < PIXEL_PRICE_EUR) {
    console.warn(`[kofi] amount too low: ${data.amount}`);
    return res.status(200).send('OK');
  }

  if (data.currency && data.currency !== 'EUR') {
    console.warn(`[kofi] non-EUR currency: ${data.currency}`);
    return res.status(200).send('OK');
  }

  // Look for a token in the message field
  const message = data.message || '';
  const match = message.match(/PXL-[A-Z0-9]{6,12}/i);
  if (!match) {
    console.warn(`[kofi] no token found in message: "${message}"`);
    return res.status(200).send('OK');
  }

  const token = match[0].toUpperCase();
  const reservation = stmtGetReservation.get(token);
  if (!reservation) {
    console.warn(`[kofi] reservation not found for token: ${token}`);
    return res.status(200).send('OK');
  }

  if (reservation.expires_at < Date.now()) {
    console.warn(`[kofi] reservation expired for token: ${token}`);
    stmtDeleteReservation.run(token);
    return res.status(200).send('OK');
  }

  const tx = db.transaction(() => {
    if (stmtGetPixel.get(reservation.x, reservation.y)) {
      return; // pixel already placed (race condition); reservation will expire naturally
    }
    stmtInsertPixel.run(
      reservation.x, reservation.y, reservation.color,
      reservation.name, reservation.message, Date.now()
    );
    // Keep the reservation in DB until it expires, so /api/check can return 'paid'
    // to the polling frontend. The cleanup sweep removes it after 30 minutes.
  });
  tx();

  console.log(`[placed] (${reservation.x}, ${reservation.y}) via Ko-fi token ${token} from ${data.from_name || 'anon'}`);
  res.status(200).send('OK');
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Pixel Wall (Ko-fi edition) running at ${BASE_URL}`);
  console.log(`Ko-fi page: https://ko-fi.com/${KOFI_USERNAME}`);
  console.log(`Webhook URL: ${BASE_URL}/api/webhook/kofi`);
  const placed = stmtCount.get().c;
  console.log(`${placed.toLocaleString()} of ${(COLS * ROWS).toLocaleString()} pixels placed`);
});
