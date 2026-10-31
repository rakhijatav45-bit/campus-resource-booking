import { transaction } from '../db.js';
import { HttpError, forbidden, notFound } from '../lib/errors.js';
import { Fields } from '../lib/validate.js';

export const STATUSES = ['pending', 'confirmed', 'rejected', 'cancelled'];

const BASE = `
  SELECT b.id, b.user_id, b.resource_id, b.start_time, b.end_time, b.purpose, b.status,
         b.decision_note, b.created_at, b.updated_at,
         r.name AS resource_name, r.type AS resource_type, r.location AS resource_location,
         u.name AS user_name, u.email AS user_email
  FROM bookings b
  JOIN resources r ON r.id = b.resource_id
  JOIN users u ON u.id = b.user_id`;

function present(row, viewer) {
  const user = { id: row.user_id, name: row.user_name };
  if (viewer.role === 'admin') user.email = row.user_email;
  return {
    id: row.id,
    status: row.status,
    start_time: row.start_time,
    end_time: row.end_time,
    purpose: row.purpose,
    decision_note: row.decision_note,
    created_at: row.created_at,
    updated_at: row.updated_at,
    resource: {
      id: row.resource_id,
      name: row.resource_name,
      type: row.resource_type,
      location: row.resource_location,
    },
    user,
  };
}

const fetchRow = (db, id) => db.prepare(`${BASE} WHERE b.id = ?`).get(id);

function findConflict(db, resourceId, startIso, endIso) {
  return db
    .prepare(
      `SELECT start_time, end_time FROM bookings
       WHERE resource_id = ? AND status IN ('pending', 'confirmed')
         AND start_time < ? AND end_time > ?
       ORDER BY start_time LIMIT 1`,
    )
    .get(resourceId, endIso, startIso);
}

const conflictError = (slot) =>
  new HttpError(
    409,
    'booking_conflict',
    'This resource is already booked for part of that time',
    slot && { conflicting_slot: { start_time: slot.start_time, end_time: slot.end_time } },
  );

const isOverlapAbort = (err) => typeof err?.message === 'string' && err.message.includes('booking_overlap');

function checkWindow(f, start, end, rules, now) {
  if (!start || !end) return;
  if (end <= start) return void f.fail('end_time', 'end_time must be after start_time');

  const minutes = (end - start) / 60000;
  if (start <= now) f.fail('start_time', 'start_time must be in the future');
  else if (start - now > rules.maxDaysAhead * 86400000) {
    f.fail('start_time', `Bookings can only be made up to ${rules.maxDaysAhead} days ahead`);
  }
  if (minutes < rules.minMinutes) f.fail('end_time', `A booking must be at least ${rules.minMinutes} minutes long`);
  else if (minutes > rules.maxMinutes) {
    f.fail('end_time', `A booking can be at most ${rules.maxMinutes / 60} hours long`);
  }
}

export function create(db, user, body, { rules, now = new Date() }) {
  const f = new Fields(body);
  const resourceId = f.integer('resource_id', { min: 1 });
  const start = f.instant('start_time');
  const end = f.instant('end_time');
  const purpose = f.string('purpose', { min: 3, max: 200 });
  checkWindow(f, start, end, rules, now);
  f.done();

  const startIso = start.toISOString();
  const endIso = end.toISOString();

  return transaction(db, () => {
    const resource = db.prepare('SELECT id, is_active, requires_approval FROM resources WHERE id = ?').get(resourceId);
    if (!resource) throw notFound('Resource');
    if (!resource.is_active) {
      throw new HttpError(409, 'resource_unavailable', 'This resource is not open for booking');
    }

    const clash = findConflict(db, resourceId, startIso, endIso);
    if (clash) throw conflictError(clash);

    // Admins approve requests, so their own bookings skip the queue.
    const status = resource.requires_approval && user.role !== 'admin' ? 'pending' : 'confirmed';
    const stamp = now.toISOString();
    try {
      const result = db
        .prepare(
          `INSERT INTO bookings (user_id, resource_id, start_time, end_time, purpose, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(user.id, resourceId, startIso, endIso, purpose, status, stamp, stamp);
      return present(fetchRow(db, Number(result.lastInsertRowid)), user);
    } catch (err) {
      if (isOverlapAbort(err)) throw conflictError();
      throw err;
    }
  });
}

export function get(db, user, id) {
  const row = fetchRow(db, id);
  if (!row) throw notFound('Booking');
  if (row.user_id !== user.id && user.role !== 'admin') throw forbidden('You can only view your own bookings');
  return present(row, user);
}

export function list(db, user, query, now = new Date()) {
  const f = new Fields(query);
  const status = f.oneOf('status', STATUSES, { required: false });
  const resourceId = f.integer('resource_id', { min: 1, required: false, coerce: true });
  const scope = f.oneOf('scope', ['mine', 'all'], { required: false }) ?? 'mine';
  const from = f.instant('from', { required: false });
  const to = f.instant('to', { required: false });
  const upcoming = f.boolean('upcoming', { required: false, coerce: true });
  const limit = f.integer('limit', { min: 1, max: 100, required: false, coerce: true }) ?? 50;
  const offset = f.integer('offset', { min: 0, required: false, coerce: true }) ?? 0;
  f.done();

  if (scope === 'all' && user.role !== 'admin') throw forbidden('Only administrators can list everyone\'s bookings');

  const where = [];
  const params = [];
  if (scope === 'mine') {
    where.push('b.user_id = ?');
    params.push(user.id);
  }
  if (status) {
    where.push('b.status = ?');
    params.push(status);
  }
  if (resourceId) {
    where.push('b.resource_id = ?');
    params.push(resourceId);
  }
  if (from) {
    where.push('b.end_time > ?');
    params.push(from.toISOString());
  }
  if (to) {
    where.push('b.start_time < ?');
    params.push(to.toISOString());
  }
  if (upcoming) {
    where.push("b.end_time > ? AND b.status IN ('pending', 'confirmed')");
    params.push(now.toISOString());
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM bookings b ${clause}`).get(...params).n;
  const order = upcoming ? 'b.start_time ASC, b.id ASC' : 'b.start_time DESC, b.id DESC';
  const rows = db.prepare(`${BASE} ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, limit, offset);

  return { items: rows.map((row) => present(row, user)), total, limit, offset };
}

// Status changes are written so that repeating the same request is harmless:
// asking for a state the booking is already in returns it unchanged (200),
// asking for an impossible move returns 409.
function transition(db, user, id, { to, from, allowedFor, note, now = new Date() }) {
  return transaction(db, () => {
    const row = fetchRow(db, id);
    if (!row) throw notFound('Booking');
    if (!allowedFor(row)) throw forbidden('You can only manage your own bookings');
    if (row.status === to) return present(row, user);

    if (!from.includes(row.status)) {
      throw new HttpError(409, 'invalid_transition', `A ${row.status} booking cannot be ${to === 'confirmed' ? 'approved' : to}`);
    }
    if (row.end_time <= now.toISOString()) {
      throw new HttpError(409, 'booking_ended', 'This booking is already in the past');
    }
    if (to === 'confirmed') {
      const active = db.prepare('SELECT is_active FROM resources WHERE id = ?').get(row.resource_id);
      if (!active.is_active) {
        throw new HttpError(409, 'resource_unavailable', 'This resource is no longer open for booking');
      }
    }

    try {
      db.prepare(
        `UPDATE bookings SET status = ?, decided_by = CASE WHEN ? THEN ? ELSE decided_by END,
           decision_note = COALESCE(?, decision_note), updated_at = ? WHERE id = ?`,
      ).run(to, to === 'cancelled' ? 0 : 1, user.id, note ?? null, now.toISOString(), id);
    } catch (err) {
      if (isOverlapAbort(err)) throw conflictError();
      throw err;
    }
    return present(fetchRow(db, id), user);
  });
}

export function cancel(db, user, id, now) {
  return transition(db, user, id, {
    to: 'cancelled',
    from: ['pending', 'confirmed'],
    allowedFor: (row) => row.user_id === user.id || user.role === 'admin',
    now,
  });
}

export function approve(db, user, id, now) {
  return transition(db, user, id, { to: 'confirmed', from: ['pending'], allowedFor: () => user.role === 'admin', now });
}

export function reject(db, user, id, body, now) {
  const f = new Fields(body);
  const note = f.string('reason', { max: 300, required: false });
  f.done();
  return transition(db, user, id, {
    to: 'rejected',
    from: ['pending'],
    allowedFor: () => user.role === 'admin',
    note,
    now,
  });
}
