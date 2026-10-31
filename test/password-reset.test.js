import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { startTestServer } from './helpers.js';

describe('password reset', () => {
  let app;
  before(async () => {
    app = await startTestServer({ resetLimit: { max: 4, windowMs: 60000 } });
    await app.request('POST', '/api/auth/register', {
      body: { name: 'Isha Rao', email: 'isha@campus.test', password: 'OldPass123' },
    });
  });
  after(() => app.close());

  const forgot = (email) => app.request('POST', '/api/auth/forgot-password', { body: { email } });
  const codeFromLastMail = () => app.mails.at(-1).text.match(/\b\d{6}\b/)[0];
  const reset = (email, code, password = 'NewPass456') =>
    app.request('POST', '/api/auth/reset-password', { body: { email, code, password } });

  it('answers the same way for known and unknown emails', async () => {
    const known = await forgot('isha@campus.test');
    const unknown = await forgot('nobody@campus.test');
    assert.equal(known.status, 200);
    assert.equal(unknown.status, 200);
    assert.deepEqual(known.body, unknown.body);
    assert.equal(app.mails.length, 1, 'only the real account gets an email');
    assert.equal(app.mails[0].to, 'isha@campus.test');
    assert.match(app.mails[0].subject, /reset code/);
  });

  it('does not store the code itself', async () => {
    const code = codeFromLastMail();
    const rows = app.db.prepare('SELECT token_hash FROM password_resets').all();
    assert.ok(rows.length >= 1);
    assert.ok(rows.every((r) => r.token_hash !== code));
  });

  it('sets a new password with a valid code, once only', async () => {
    await forgot('isha@campus.test');
    const code = codeFromLastMail();

    const weak = await reset('isha@campus.test', code, 'short');
    assert.equal(weak.status, 400);

    const ok = await reset('isha@campus.test', code);
    assert.equal(ok.status, 200);

    const oldLogin = await app.request('POST', '/api/auth/login', { body: { email: 'isha@campus.test', password: 'OldPass123' } });
    const newLogin = await app.request('POST', '/api/auth/login', { body: { email: 'isha@campus.test', password: 'NewPass456' } });
    assert.equal(oldLogin.status, 401);
    assert.equal(newLogin.status, 200);

    const again = await reset('isha@campus.test', code, 'Another789');
    assert.equal(again.status, 400);
    assert.equal(again.body.error.code, 'invalid_or_expired_code');
  });

  it('only the newest code works after a second request', async () => {
    const app2 = await startTestServer();
    await app2.request('POST', '/api/auth/register', {
      body: { name: 'Kabir Das', email: 'kabir@campus.test', password: 'OldPass123' },
    });
    await app2.request('POST', '/api/auth/forgot-password', { body: { email: 'kabir@campus.test' } });
    await app2.request('POST', '/api/auth/forgot-password', { body: { email: 'kabir@campus.test' } });
    const [first, second] = app2.mails.map((mail) => mail.text.match(/\b\d{6}\b/)[0]);
    const stale = await app2.request('POST', '/api/auth/reset-password', {
      body: { email: 'kabir@campus.test', code: first, password: 'NewPass456' },
    });
    const good = await app2.request('POST', '/api/auth/reset-password', {
      body: { email: 'kabir@campus.test', code: second, password: 'NewPass456' },
    });
    assert.equal(stale.status, 400);
    assert.equal(good.status, 200);
    await app2.close();
  });

  it('rejects expired and made-up codes', async () => {
    await forgot('isha@campus.test');
    const code = codeFromLastMail();
    app.db.prepare("UPDATE password_resets SET expires_at = '2000-01-01T00:00:00.000Z'").run();
    const expired = await reset('isha@campus.test', code);
    assert.equal(expired.status, 400);
    const fake = await reset('isha@campus.test', '000000');
    assert.equal(fake.status, 400);
    const missing = await app.request('POST', '/api/auth/reset-password', { body: {} });
    assert.equal(missing.status, 400);
    const malformed = await reset('isha@campus.test', 'abcdef');
    assert.equal(malformed.status, 400);
  });

  it('limits incorrect code attempts', async () => {
    const app2 = await startTestServer();
    await app2.request('POST', '/api/auth/register', {
      body: { name: 'Code Limit', email: 'limit-code@campus.test', password: 'OldPass123' },
    });
    await app2.request('POST', '/api/auth/forgot-password', { body: { email: 'limit-code@campus.test' } });
    for (let i = 0; i < 10; i += 1) {
      const attempt = await app2.request('POST', '/api/auth/reset-password', {
        body: { email: 'limit-code@campus.test', code: '000000', password: 'NewPass456' },
      });
      assert.equal(attempt.status, 400);
    }
    const blocked = await app2.request('POST', '/api/auth/reset-password', {
      body: { email: 'limit-code@campus.test', code: app2.mails[0].text.match(/\b\d{6}\b/)[0], password: 'NewPass456' },
    });
    assert.equal(blocked.status, 429);
    await app2.close();
  });

  it('limits repeated requests for one email', async () => {
    const attempt = () => forgot('limit@campus.test');
    for (let i = 0; i < 4; i += 1) assert.equal((await attempt()).status, 200);
    const blocked = await attempt();
    assert.equal(blocked.status, 429);
    assert.ok(blocked.headers.get('retry-after'));
  });

  it('validates the email format', async () => {
    const res = await forgot('not-an-email');
    assert.equal(res.status, 400);
  });
});
