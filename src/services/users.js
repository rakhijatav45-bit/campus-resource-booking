import crypto from 'node:crypto';
import { transaction } from '../db.js';
import { HttpError } from '../lib/errors.js';
import { hashPassword } from '../lib/auth.js';

// A keyed hash prevents a leaked database from revealing six-digit reset codes.
const hashResetCode = (userId, code, secret) =>
  crypto.createHmac('sha256', secret).update(`${userId}:${code}`).digest('hex');

export const toPublic = (row) => ({ id: row.id, name: row.name, email: row.email, role: row.role });

export function getById(db, id) {
  const row = db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(id);
  return row ? toPublic(row) : null;
}

export function findByEmail(db, email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email) ?? null;
}

export function create(db, { name, email, password, role = 'student' }) {
  try {
    const result = db
      .prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(name, email.toLowerCase(), hashPassword(password), role);
    return getById(db, Number(result.lastInsertRowid));
  } catch (err) {
    if (/UNIQUE constraint failed: users\.email/.test(err.message)) {
      throw new HttpError(409, 'email_taken', 'An account with this email already exists');
    }
    throw err;
  }
}

export function createResetCode(db, email, { ttlMinutes, secret, now = new Date() }) {
  const row = findByEmail(db, email);
  if (!row) return null;

  const created = now.toISOString();
  const expires = new Date(now.getTime() + ttlMinutes * 60000).toISOString();
  let code;
  let tokenHash;
  do {
    code = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
    tokenHash = hashResetCode(row.id, code, secret);
  } while (db.prepare('SELECT 1 FROM password_resets WHERE token_hash = ?').get(tokenHash));

  transaction(db, () => {
    db.prepare('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(created, row.id);
    db.prepare('INSERT INTO password_resets (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)').run(
      row.id,
      tokenHash,
      expires,
      created,
    );
  });
  return { code, user: toPublic(row) };
}

export function resetPassword(db, email, code, password, { secret, now = new Date() }) {
  return transaction(db, () => {
    const user = findByEmail(db, email);
    if (!user) {
      throw new HttpError(400, 'invalid_or_expired_code', 'This code is invalid or has expired. Request a new one.');
    }
    const found = db
      .prepare('SELECT user_id, expires_at, used_at FROM password_resets WHERE token_hash = ?')
      .get(hashResetCode(user.id, code, secret));
    if (!found || found.used_at || found.expires_at <= now.toISOString()) {
      throw new HttpError(400, 'invalid_or_expired_code', 'This code is invalid or has expired. Request a new one.');
    }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), found.user_id);
    db.prepare('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(
      now.toISOString(),
      found.user_id,
    );
  });
}
