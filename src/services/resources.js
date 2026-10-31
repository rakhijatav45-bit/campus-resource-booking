import { HttpError, notFound } from '../lib/errors.js';
import { Fields } from '../lib/validate.js';

export const RESOURCE_TYPES = ['room', 'lab', 'equipment'];

const COLUMNS = `r.id, r.name, r.type, r.location, r.capacity, r.description,
  r.requires_approval, r.is_active, r.created_at, r.updated_at`;

const present = (row) =>
  row && { ...row, requires_approval: Boolean(row.requires_approval), is_active: Boolean(row.is_active) };

const likePattern = (text) => `%${text.replace(/[\\%_]/g, '\\$&')}%`;

export function get(db, id) {
  return present(db.prepare(`SELECT ${COLUMNS} FROM resources r WHERE r.id = ?`).get(id)) ?? null;
}

export function list(db, { type, minCapacity, q, includeInactive, start, end, availableOnly }) {
  const where = [];
  const params = [];
  let availability = 'NULL';

  if (start && end) {
    const clash = `EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.resource_id = r.id AND b.status IN ('pending', 'confirmed')
        AND b.start_time < ? AND b.end_time > ?)`;
    availability = `CASE WHEN r.is_active = 0 THEN 'inactive' WHEN ${clash} THEN 'booked' ELSE 'available' END`;
    params.push(end.toISOString(), start.toISOString());
    if (availableOnly) {
      where.push(`r.is_active = 1 AND NOT ${clash}`);
      params.push(end.toISOString(), start.toISOString());
    }
  }
  if (!includeInactive) where.push('r.is_active = 1');
  if (type) {
    where.push('r.type = ?');
    params.push(type);
  }
  if (minCapacity) {
    where.push('r.capacity >= ?');
    params.push(minCapacity);
  }
  if (q) {
    where.push("(r.name LIKE ? ESCAPE '\\' OR r.location LIKE ? ESCAPE '\\')");
    params.push(likePattern(q), likePattern(q));
  }

  const sql = `SELECT ${COLUMNS}, ${availability} AS availability FROM resources r
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY r.type, r.name`;
  return db.prepare(sql).all(...params).map(present);
}

// Busy slots only: no names, so students cannot see who booked what.
export function busySlots(db, viewerId, from, to, resourceId) {
  const params = [to.toISOString(), from.toISOString()];
  let filter = '';
  if (resourceId) {
    filter = 'AND b.resource_id = ?';
    params.push(resourceId);
  }
  const rows = db
    .prepare(
      `SELECT b.resource_id, b.start_time, b.end_time, b.status, b.user_id
       FROM bookings b JOIN resources r ON r.id = b.resource_id
       WHERE b.status IN ('pending', 'confirmed') AND r.is_active = 1
         AND b.start_time < ? AND b.end_time > ? ${filter}
       ORDER BY b.start_time`,
    )
    .all(...params);
  return rows.map(({ user_id, ...slot }) => ({ ...slot, mine: user_id === viewerId }));
}

function readFields(body, { partial }) {
  const f = new Fields(body);
  const required = !partial;
  const data = {
    name: f.string('name', { min: 2, max: 80, required }),
    type: f.oneOf('type', RESOURCE_TYPES, { required }),
    location: f.string('location', { min: 2, max: 120, required }),
    capacity: f.integer('capacity', { min: 1, max: 10000, required }),
    description: f.string('description', { max: 500, required: false, allowEmpty: true }),
    requires_approval: f.boolean('requires_approval', { required: false }),
    is_active: f.boolean('is_active', { required: false }),
  };
  f.done();
  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
}

function duplicateGuard(err) {
  if (/UNIQUE constraint failed: resources\.name, resources\.location/.test(err.message)) {
    return new HttpError(409, 'resource_exists', 'A resource with this name already exists at this location');
  }
  return err;
}

export function create(db, body) {
  const data = readFields(body, { partial: false });
  try {
    const result = db
      .prepare(
        `INSERT INTO resources (name, type, location, capacity, description, requires_approval)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(data.name, data.type, data.location, data.capacity, data.description ?? '', data.requires_approval ? 1 : 0);
    return get(db, Number(result.lastInsertRowid));
  } catch (err) {
    throw duplicateGuard(err);
  }
}

export function update(db, id, body) {
  if (!get(db, id)) throw notFound('Resource');
  const data = readFields(body, { partial: true });
  const entries = Object.entries(data);
  if (entries.length === 0) {
    throw new HttpError(400, 'validation_error', 'Send at least one field to update');
  }
  const assignments = entries.map(([key]) => `${key} = ?`).join(', ');
  const values = entries.map(([, value]) => (typeof value === 'boolean' ? Number(value) : value));
  try {
    db.prepare(`UPDATE resources SET ${assignments}, updated_at = ? WHERE id = ?`).run(
      ...values,
      new Date().toISOString(),
      id,
    );
  } catch (err) {
    throw duplicateGuard(err);
  }
  return get(db, id);
}

// Soft delete: bookings keep pointing at a real row.
export function deactivate(db, id) {
  return update(db, id, { is_active: false });
}
