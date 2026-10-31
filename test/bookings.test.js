import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { bookingBody, slot, startTestServer } from './helpers.js';

describe('bookings', () => {
  let app;
  let admin;
  let alice;
  let bob;

  before(async () => {
    app = await startTestServer();
    admin = app.makeUser('admin');
    alice = app.makeUser('student');
    bob = app.makeUser('student');
  });
  after(() => app.close());

  const create = (token, resource, when, purpose) =>
    app.request('POST', '/api/bookings', { token, body: bookingBody(resource, when, purpose) });

  describe('creating', () => {
    it('confirms immediately when the resource needs no approval', async () => {
      const r = app.makeResource();
      const res = await create(alice.token, r, slot(2, 9));
      assert.equal(res.status, 201);
      assert.equal(res.body.booking.status, 'confirmed');
      assert.equal(res.body.booking.resource.id, r.id);
      assert.equal(res.body.booking.user.id, alice.user.id);
    });

    it('holds the request as pending when approval is required', async () => {
      const r = app.makeResource({ requires_approval: true });
      const res = await create(alice.token, r, slot(2, 9));
      assert.equal(res.body.booking.status, 'pending');
    });

    it('skips the approval queue for admins', async () => {
      const r = app.makeResource({ requires_approval: true });
      const res = await create(admin.token, r, slot(2, 9));
      assert.equal(res.body.booking.status, 'confirmed');
    });

    it('rejects an overlapping booking with 409 and the conflicting slot', async () => {
      const r = app.makeResource();
      await create(alice.token, r, slot(2, 10, 60));
      const res = await create(bob.token, r, slot(2, 10, 30));
      assert.equal(res.status, 409);
      assert.equal(res.body.error.code, 'booking_conflict');
      assert.ok(res.body.error.details.conflicting_slot.start_time);
    });

    it('rejects every kind of overlap', async () => {
      const r = app.makeResource();
      await create(alice.token, r, slot(2, 10, 120)); // 10:00 to 12:00
      const cases = {
        'starts inside': slot(2, 11, 120),
        'ends inside': slot(2, 9, 120),
        'wraps the existing booking': slot(2, 9, 240),
        'sits inside the existing booking': { ...slot(2, 10, 30) },
        'identical': slot(2, 10, 120),
      };
      for (const [label, when] of Object.entries(cases)) {
        const res = await create(bob.token, r, when);
        assert.equal(res.status, 409, label);
      }
    });

    it('allows adjacent slots on both sides', async () => {
      const r = app.makeResource();
      assert.equal((await create(alice.token, r, slot(2, 10, 60))).status, 201);
      assert.equal((await create(bob.token, r, slot(2, 11, 60))).status, 201);
      assert.equal((await create(bob.token, r, slot(2, 9, 60))).status, 201);
    });

    it('allows the same time on different resources', async () => {
      const a = app.makeResource();
      const b = app.makeResource();
      assert.equal((await create(alice.token, a, slot(2, 10))).status, 201);
      assert.equal((await create(bob.token, b, slot(2, 10))).status, 201);
    });

    it('treats a pending request as holding the slot', async () => {
      const r = app.makeResource({ requires_approval: true });
      await create(alice.token, r, slot(2, 10));
      assert.equal((await create(bob.token, r, slot(2, 10))).status, 409);
    });

    it('returns 404 for an unknown resource', async () => {
      const res = await app.request('POST', '/api/bookings', {
        token: alice.token,
        body: { resource_id: 99999, purpose: 'Study', ...slot(2, 9) },
      });
      assert.equal(res.status, 404);
    });

    it('requires authentication', async () => {
      const r = app.makeResource();
      const res = await app.request('POST', '/api/bookings', { body: bookingBody(r, slot(2, 9)) });
      assert.equal(res.status, 401);
    });
  });

  describe('validation', () => {
    const r = () => app.makeResource();

    const expectInvalid = async (label, mutate, field) => {
      const resource = r();
      const body = bookingBody(resource, slot(2, 9));
      mutate(body);
      const res = await app.request('POST', '/api/bookings', { token: alice.token, body });
      assert.equal(res.status, 400, label);
      assert.equal(res.body.error.code, 'validation_error', label);
      assert.ok(res.body.error.details[field], `${label}: expected an error on ${field}`);
    };

    it('rejects an end time before or equal to the start', async () => {
      await expectInvalid('end before start', (b) => ([b.start_time, b.end_time] = [b.end_time, b.start_time]), 'end_time');
      await expectInvalid('zero length', (b) => (b.end_time = b.start_time), 'end_time');
    });

    it('rejects times in the past', async () => {
      await expectInvalid('past', (b) => Object.assign(b, slot(-1, 9)), 'start_time');
    });

    it('rejects bookings outside the booking window', async () => {
      await expectInvalid('too far ahead', (b) => Object.assign(b, slot(45, 9)), 'start_time');
    });

    it('rejects durations that are too short or too long', async () => {
      await expectInvalid('too short', (b) => Object.assign(b, slot(2, 9, 5)), 'end_time');
      await expectInvalid('too long', (b) => Object.assign(b, slot(2, 9, 600)), 'end_time');
    });

    it('rejects malformed timestamps', async () => {
      await expectInvalid('no timezone', (b) => (b.start_time = '2030-01-01T10:00:00'), 'start_time');
      await expectInvalid('not a date', (b) => (b.start_time = 'tomorrow'), 'start_time');
      await expectInvalid('impossible date', (b) => (b.start_time = '2030-02-30T10:00:00Z'), 'start_time');
      await expectInvalid('wrong type', (b) => (b.end_time = 12345), 'end_time');
    });

    it('rejects missing or malformed fields and reports them together', async () => {
      const res = await app.request('POST', '/api/bookings', { token: alice.token, body: { resource_id: 'abc' } });
      assert.equal(res.status, 400);
      assert.deepEqual(Object.keys(res.body.error.details).sort(), ['end_time', 'purpose', 'resource_id', 'start_time']);
    });

    it('accepts times written with a UTC offset', async () => {
      const resource = r();
      const when = slot(2, 9);
      const shifted = {
        start_time: new Date(Date.parse(when.start_time) + 330 * 60000).toISOString().replace('Z', '+05:30'),
        end_time: new Date(Date.parse(when.end_time) + 330 * 60000).toISOString().replace('Z', '+05:30'),
      };
      const res = await create(alice.token, resource, shifted);
      assert.equal(res.status, 201);
      assert.equal(res.body.booking.start_time, when.start_time);
    });
  });

  describe('permissions', () => {
    it("stops a student from viewing or cancelling someone else's booking", async () => {
      const r = app.makeResource();
      const { body } = await create(alice.token, r, slot(3, 9));
      const id = body.booking.id;
      assert.equal((await app.request('GET', `/api/bookings/${id}`, { token: bob.token })).status, 403);
      const cancel = await app.request('POST', `/api/bookings/${id}/cancel`, { token: bob.token });
      assert.equal(cancel.status, 403);
      const check = await app.request('GET', `/api/bookings/${id}`, { token: alice.token });
      assert.equal(check.body.booking.status, 'confirmed');
    });

    it('stops students from approving or rejecting', async () => {
      const r = app.makeResource({ requires_approval: true });
      const { body } = await create(alice.token, r, slot(3, 9));
      const id = body.booking.id;
      assert.equal((await app.request('POST', `/api/bookings/${id}/approve`, { token: alice.token })).status, 403);
      assert.equal((await app.request('POST', `/api/bookings/${id}/reject`, { token: alice.token })).status, 403);
      const check = await app.request('GET', `/api/bookings/${id}`, { token: admin.token });
      assert.equal(check.body.booking.status, 'pending');
    });

    it("lets an admin see and cancel any student's booking", async () => {
      const r = app.makeResource();
      const { body } = await create(alice.token, r, slot(3, 9));
      const id = body.booking.id;
      assert.equal((await app.request('GET', `/api/bookings/${id}`, { token: admin.token })).status, 200);
      const res = await app.request('POST', `/api/bookings/${id}/cancel`, { token: admin.token });
      assert.equal(res.body.booking.status, 'cancelled');
    });

    it('scopes listings to the signed-in student', async () => {
      const r = app.makeResource();
      await create(alice.token, r, slot(5, 9));
      const mine = await app.request('GET', '/api/bookings', { token: bob.token });
      assert.ok(mine.body.items.every((b) => b.user.id === bob.user.id));
      const all = await app.request('GET', '/api/bookings?scope=all', { token: bob.token });
      assert.equal(all.status, 403);
      const adminAll = await app.request('GET', '/api/bookings?scope=all', { token: admin.token });
      assert.ok(adminAll.body.items.some((b) => b.user.id === alice.user.id));
    });

    it('shows requester emails to admins only', async () => {
      const r = app.makeResource();
      const { body } = await create(alice.token, r, slot(6, 9));
      const asAdmin = await app.request('GET', `/api/bookings/${body.booking.id}`, { token: admin.token });
      const asOwner = await app.request('GET', `/api/bookings/${body.booking.id}`, { token: alice.token });
      assert.ok(asAdmin.body.booking.user.email);
      assert.equal(asOwner.body.booking.user.email, undefined);
    });
  });

  describe('status changes', () => {
    it('approves a pending request', async () => {
      const r = app.makeResource({ requires_approval: true });
      const { body } = await create(alice.token, r, slot(3, 9));
      const res = await app.request('POST', `/api/bookings/${body.booking.id}/approve`, { token: admin.token });
      assert.equal(res.body.booking.status, 'confirmed');
    });

    it('rejects a pending request with a reason and frees the slot', async () => {
      const r = app.makeResource({ requires_approval: true });
      const { body } = await create(alice.token, r, slot(3, 9));
      const res = await app.request('POST', `/api/bookings/${body.booking.id}/reject`, {
        token: admin.token,
        body: { reason: 'Hall is under maintenance' },
      });
      assert.equal(res.body.booking.status, 'rejected');
      assert.equal(res.body.booking.decision_note, 'Hall is under maintenance');
      assert.equal((await create(bob.token, r, slot(3, 9))).status, 201);
    });

    it('is idempotent: repeating approve, reject or cancel changes nothing', async () => {
      const r = app.makeResource({ requires_approval: true });
      const { body } = await create(alice.token, r, slot(3, 9));
      const id = body.booking.id;

      const first = await app.request('POST', `/api/bookings/${id}/approve`, { token: admin.token });
      const second = await app.request('POST', `/api/bookings/${id}/approve`, { token: admin.token });
      assert.equal(second.status, 200);
      assert.equal(second.body.booking.updated_at, first.body.booking.updated_at);

      const c1 = await app.request('POST', `/api/bookings/${id}/cancel`, { token: alice.token });
      const c2 = await app.request('POST', `/api/bookings/${id}/cancel`, { token: alice.token });
      assert.equal(c1.status, 200);
      assert.equal(c2.status, 200);
      assert.equal(c2.body.booking.status, 'cancelled');
      assert.equal(c2.body.booking.updated_at, c1.body.booking.updated_at);
    });

    it('refuses impossible moves with 409', async () => {
      const r = app.makeResource({ requires_approval: true });
      const { body } = await create(alice.token, r, slot(3, 9));
      const id = body.booking.id;
      await app.request('POST', `/api/bookings/${id}/cancel`, { token: alice.token });
      const approve = await app.request('POST', `/api/bookings/${id}/approve`, { token: admin.token });
      assert.equal(approve.status, 409);
      assert.equal(approve.body.error.code, 'invalid_transition');

      const second = await create(alice.token, r, slot(4, 9));
      await app.request('POST', `/api/bookings/${second.body.booking.id}/reject`, { token: admin.token });
      const cancelRejected = await app.request('POST', `/api/bookings/${second.body.booking.id}/cancel`, {
        token: alice.token,
      });
      assert.equal(cancelRejected.status, 409);

      const confirmed = await create(admin.token, app.makeResource(), slot(4, 9));
      const reject = await app.request('POST', `/api/bookings/${confirmed.body.booking.id}/reject`, {
        token: admin.token,
      });
      assert.equal(reject.status, 409);
    });

    it('frees the slot when a booking is cancelled', async () => {
      const r = app.makeResource();
      const { body } = await create(alice.token, r, slot(3, 9));
      assert.equal((await create(bob.token, r, slot(3, 9))).status, 409);
      await app.request('POST', `/api/bookings/${body.booking.id}/cancel`, { token: alice.token });
      assert.equal((await create(bob.token, r, slot(3, 9))).status, 201);
    });

    it('cannot cancel a booking that has already ended', async () => {
      const r = app.makeResource();
      const when = slot(-2, 9);
      app.db
        .prepare(
          `INSERT INTO bookings (user_id, resource_id, start_time, end_time, purpose, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'Past session', 'confirmed', ?, ?)`,
        )
        .run(alice.user.id, r.id, when.start_time, when.end_time, when.start_time, when.start_time);
      const id = app.db.prepare('SELECT MAX(id) AS id FROM bookings').get().id;
      const res = await app.request('POST', `/api/bookings/${id}/cancel`, { token: alice.token });
      assert.equal(res.status, 409);
      assert.equal(res.body.error.code, 'booking_ended');
    });

    it('returns 404 for unknown booking ids', async () => {
      assert.equal((await app.request('POST', '/api/bookings/99999/cancel', { token: alice.token })).status, 404);
      assert.equal((await app.request('GET', '/api/bookings/abc', { token: alice.token })).status, 404);
    });
  });

  describe('listing and history', () => {
    it('filters by status and returns upcoming bookings soonest first', async () => {
      const user = app.makeUser('student');
      const r = app.makeResource();
      const later = await create(user.token, r, slot(8, 9));
      const sooner = await create(user.token, r, slot(7, 9));
      await app.request('POST', `/api/bookings/${later.body.booking.id}/cancel`, { token: user.token });

      const upcoming = await app.request('GET', '/api/bookings?upcoming=true', { token: user.token });
      assert.deepEqual(upcoming.body.items.map((b) => b.id), [sooner.body.booking.id]);

      const cancelled = await app.request('GET', '/api/bookings?status=cancelled', { token: user.token });
      assert.deepEqual(cancelled.body.items.map((b) => b.id), [later.body.booking.id]);

      const all = await app.request('GET', '/api/bookings', { token: user.token });
      assert.equal(all.body.total, 2);
      assert.equal(all.body.items[0].id, later.body.booking.id, 'history is newest first');
    });

    it('paginates', async () => {
      const user = app.makeUser('student');
      const r = app.makeResource();
      for (let day = 10; day < 13; day += 1) await create(user.token, r, slot(day, 9));
      const page = await app.request('GET', '/api/bookings?limit=2&offset=2', { token: user.token });
      assert.equal(page.body.items.length, 1);
      assert.equal(page.body.total, 3);
    });

    it('rejects bad filters', async () => {
      assert.equal((await app.request('GET', '/api/bookings?status=maybe', { token: alice.token })).status, 400);
      assert.equal((await app.request('GET', '/api/bookings?limit=0', { token: alice.token })).status, 400);
    });
  });

  describe('double-booking protection', () => {
    it('lets exactly one of many simultaneous requests win', async () => {
      const r = app.makeResource();
      const people = Array.from({ length: 12 }, () => app.makeUser('student'));
      const when = slot(9, 9);
      const results = await Promise.all(people.map((p) => create(p.token, r, when)));

      const statuses = results.map((res) => res.status).sort();
      assert.equal(statuses.filter((s) => s === 201).length, 1);
      assert.equal(statuses.filter((s) => s === 409).length, 11);

      const rows = app.db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE resource_id = ? AND status IN ('pending','confirmed')").get(r.id);
      assert.equal(rows.n, 1);
    });

    it('lets overlapping-but-different requests resolve to a consistent schedule', async () => {
      const r = app.makeResource();
      const people = Array.from({ length: 8 }, () => app.makeUser('student'));
      const requests = people.map((p, i) => create(p.token, r, slot(9, 9 + (i % 4), 90)));
      await Promise.all(requests);

      const rows = app.db
        .prepare("SELECT start_time, end_time FROM bookings WHERE resource_id = ? AND status IN ('pending','confirmed') ORDER BY start_time")
        .all(r.id);
      for (let i = 1; i < rows.length; i += 1) {
        assert.ok(rows[i - 1].end_time <= rows[i].start_time, 'two active bookings overlap');
      }
    });

    it('is enforced by the database itself, even when the API is bypassed', async () => {
      const r = app.makeResource();
      const when = slot(11, 9);
      await create(alice.token, r, when);

      // A second, independent connection, as another process would use.
      const other = new DatabaseSync(app.config.dbPath);
      other.exec('PRAGMA busy_timeout = 5000');
      const insert = other.prepare(
        `INSERT INTO bookings (user_id, resource_id, start_time, end_time, purpose, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'raw insert', 'confirmed', ?, ?)`,
      );
      assert.throws(
        () => insert.run(bob.user.id, r.id, when.start_time, when.end_time, when.start_time, when.start_time),
        /booking_overlap/,
      );
      other.close();
    });

    it('also blocks re-activating a cancelled booking into a taken slot', async () => {
      const r = app.makeResource();
      const when = slot(12, 9);
      const first = await create(alice.token, r, when);
      await app.request('POST', `/api/bookings/${first.body.booking.id}/cancel`, { token: alice.token });
      await create(bob.token, r, when);
      assert.throws(
        () => app.db.prepare("UPDATE bookings SET status = 'confirmed' WHERE id = ?").run(first.body.booking.id),
        /booking_overlap/,
      );
    });
  });
});
