import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { bookingBody, slot, startTestServer } from './helpers.js';

describe('resources', () => {
  let app;
  let admin;
  let student;
  before(async () => {
    app = await startTestServer();
    admin = app.makeUser('admin');
    student = app.makeUser('student');
  });
  after(() => app.close());

  const payload = {
    name: 'Seminar Hall B',
    type: 'room',
    location: 'Admin Block',
    capacity: 100,
    description: 'Large hall',
    requires_approval: true,
  };

  it('lets an admin create a resource', async () => {
    const res = await app.request('POST', '/api/resources', { token: admin.token, body: payload });
    assert.equal(res.status, 201);
    assert.equal(res.body.resource.requires_approval, true);
    assert.equal(res.body.resource.is_active, true);
  });

  it('blocks students from creating, editing or deactivating', async () => {
    const created = app.makeResource();
    const post = await app.request('POST', '/api/resources', { token: student.token, body: payload });
    const patch = await app.request('PATCH', `/api/resources/${created.id}`, {
      token: student.token,
      body: { capacity: 5 },
    });
    const del = await app.request('DELETE', `/api/resources/${created.id}`, { token: student.token });
    assert.deepEqual([post.status, patch.status, del.status], [403, 403, 403]);
  });

  it('validates input and rejects duplicates', async () => {
    const bad = await app.request('POST', '/api/resources', {
      token: admin.token,
      body: { name: 'X', type: 'spaceship', location: '', capacity: 0 },
    });
    assert.equal(bad.status, 400);
    assert.ok(bad.body.error.details.type);
    assert.ok(bad.body.error.details.capacity);

    const dup = await app.request('POST', '/api/resources', { token: admin.token, body: payload });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error.code, 'resource_exists');
  });

  it('edits a resource and refuses an empty update', async () => {
    const r = app.makeResource();
    const ok = await app.request('PATCH', `/api/resources/${r.id}`, { token: admin.token, body: { capacity: 45 } });
    assert.equal(ok.body.resource.capacity, 45);
    const empty = await app.request('PATCH', `/api/resources/${r.id}`, { token: admin.token, body: {} });
    assert.equal(empty.status, 400);
    const missing = await app.request('PATCH', '/api/resources/99999', { token: admin.token, body: { capacity: 3 } });
    assert.equal(missing.status, 404);
  });

  it('filters by type, capacity and text', async () => {
    const lab = app.makeResource({ name: 'Zeta Lab', type: 'lab', capacity: 80 });
    app.makeResource({ name: 'Tiny Booth', type: 'room', capacity: 2 });

    const byType = await app.request('GET', '/api/resources?type=lab', { token: student.token });
    assert.ok(byType.body.items.length >= 1);
    assert.ok(byType.body.items.every((r) => r.type === 'lab'));

    const byCapacity = await app.request('GET', '/api/resources?min_capacity=80', { token: student.token });
    assert.ok(byCapacity.body.items.every((r) => r.capacity >= 80));

    const byText = await app.request('GET', '/api/resources?q=zeta', { token: student.token });
    assert.deepEqual(byText.body.items.map((r) => r.id), [lab.id]);

    const wildcard = await app.request('GET', '/api/resources?q=%25', { token: student.token });
    assert.equal(wildcard.body.items.length, 0, '% must be treated as a literal character');

    const invalid = await app.request('GET', '/api/resources?type=bogus', { token: student.token });
    assert.equal(invalid.status, 400);
  });

  it('reports availability for a time range', async () => {
    const r = app.makeResource();
    const when = slot(3, 10, 60);
    const booked = await app.request('POST', '/api/bookings', { token: student.token, body: bookingBody(r, when) });
    assert.equal(booked.status, 201);

    const overlapping = slot(3, 10, 30);
    const url = (w, extra = '') =>
      `/api/resources?start=${encodeURIComponent(w.start_time)}&end=${encodeURIComponent(w.end_time)}${extra}`;

    const busy = await app.request('GET', url(overlapping), { token: student.token });
    assert.equal(busy.body.items.find((x) => x.id === r.id).availability, 'booked');

    const adjacent = await app.request('GET', url(slot(3, 11, 60)), { token: student.token });
    assert.equal(adjacent.body.items.find((x) => x.id === r.id).availability, 'available');

    const onlyFree = await app.request('GET', url(overlapping, '&available_only=true'), { token: student.token });
    assert.ok(!onlyFree.body.items.some((x) => x.id === r.id));

    const half = await app.request('GET', `/api/resources?start=${encodeURIComponent(when.start_time)}`, {
      token: student.token,
    });
    assert.equal(half.status, 400);
  });

  it('hides deactivated resources from students and blocks new bookings', async () => {
    const r = app.makeResource();
    const off = await app.request('DELETE', `/api/resources/${r.id}`, { token: admin.token });
    assert.equal(off.body.resource.is_active, false);

    const again = await app.request('DELETE', `/api/resources/${r.id}`, { token: admin.token });
    assert.equal(again.status, 200, 'deactivating twice is harmless');

    const list = await app.request('GET', '/api/resources', { token: student.token });
    assert.ok(!list.body.items.some((x) => x.id === r.id));
    assert.equal((await app.request('GET', `/api/resources/${r.id}`, { token: student.token })).status, 404);
    assert.equal((await app.request('GET', '/api/resources?include_inactive=true', { token: student.token })).status, 403);

    const adminList = await app.request('GET', '/api/resources?include_inactive=true', { token: admin.token });
    assert.ok(adminList.body.items.some((x) => x.id === r.id));

    const book = await app.request('POST', '/api/bookings', {
      token: student.token,
      body: bookingBody(r, slot(2, 9)),
    });
    assert.equal(book.status, 409);
    assert.equal(book.body.error.code, 'resource_unavailable');

    const back = await app.request('PATCH', `/api/resources/${r.id}`, { token: admin.token, body: { is_active: true } });
    assert.equal(back.body.resource.is_active, true);
  });

  it('exposes busy slots without revealing who booked', async () => {
    const r = app.makeResource();
    const when = slot(4, 9);
    await app.request('POST', '/api/bookings', { token: student.token, body: bookingBody(r, when) });
    const other = app.makeUser('student');
    const url = `/api/schedule?from=${encodeURIComponent(slot(4, 0).start_time)}&to=${encodeURIComponent(slot(4, 23).end_time)}`;
    const res = await app.request('GET', url, { token: other.token });
    const found = res.body.slots.find((s) => s.resource_id === r.id);
    assert.ok(found);
    assert.equal(found.mine, false);
    assert.equal(found.user_id, undefined);
    assert.equal(found.purpose, undefined);
  });
});
