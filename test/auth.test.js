import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { startTestServer } from './helpers.js';

describe('authentication', () => {
  let app;
  before(async () => {
    app = await startTestServer({ loginLimit: { max: 3, windowMs: 60000 } });
  });
  after(() => app.close());

  const valid = { name: 'Meera Joshi', email: 'meera@campus.test', password: 'Strong123' };

  it('registers a student and returns a token', async () => {
    const res = await app.request('POST', '/api/auth/register', { body: valid });
    assert.equal(res.status, 201);
    assert.equal(res.body.user.role, 'student');
    assert.ok(res.body.token);
    assert.equal(res.body.user.password_hash, undefined);
  });

  it('rejects a duplicate email regardless of case', async () => {
    const res = await app.request('POST', '/api/auth/register', {
      body: { ...valid, email: 'MEERA@campus.test' },
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'email_taken');
  });

  it('rejects weak or malformed registration input', async () => {
    const res = await app.request('POST', '/api/auth/register', {
      body: { name: 'A', email: 'not-an-email', password: 'short' },
    });
    assert.equal(res.status, 400);
    assert.deepEqual(Object.keys(res.body.error.details).sort(), ['email', 'name', 'password']);
  });

  it('requires a letter and a number in the password', async () => {
    const res = await app.request('POST', '/api/auth/register', {
      body: { ...valid, email: 'other@campus.test', password: 'onlyletters' },
    });
    assert.equal(res.status, 400);
    assert.ok(res.body.error.details.password);
  });

  it('signs in with correct credentials', async () => {
    const res = await app.request('POST', '/api/auth/login', {
      body: { email: valid.email, password: valid.password },
    });
    assert.equal(res.status, 200);
    const me = await app.request('GET', '/api/auth/me', { token: res.body.token });
    assert.equal(me.body.user.email, valid.email);
  });

  it('gives the same error for a wrong password and an unknown email', async () => {
    const wrong = await app.request('POST', '/api/auth/login', {
      body: { email: valid.email, password: 'Wrong1234' },
    });
    const unknown = await app.request('POST', '/api/auth/login', {
      body: { email: 'nobody@campus.test', password: 'Wrong1234' },
    });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrong.body.error.message, unknown.body.error.message);
  });

  it('locks out repeated failed sign-ins', async () => {
    const attempt = () =>
      app.request('POST', '/api/auth/login', { body: { email: 'locked@campus.test', password: 'Wrong1234' } });
    for (let i = 0; i < 3; i += 1) assert.equal((await attempt()).status, 401);
    const blocked = await attempt();
    assert.equal(blocked.status, 429);
    assert.ok(blocked.headers.get('retry-after'));
  });

  it('protects routes without a valid token', async () => {
    assert.equal((await app.request('GET', '/api/resources')).status, 401);
    assert.equal((await app.request('GET', '/api/bookings', { token: 'garbage' })).status, 401);
    const tampered = (await app.request('POST', '/api/auth/login', {
      body: { email: valid.email, password: valid.password },
    })).body.token.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a'));
    assert.equal((await app.request('GET', '/api/auth/me', { token: tampered })).status, 401);
  });

  it('answers bad requests with JSON errors and no stack traces', async () => {
    const malformed = await app.request('POST', '/api/auth/login', { raw: '{"email":' });
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.error.code, 'invalid_json');

    const missing = await app.request('GET', '/api/nope');
    assert.equal(missing.status, 404);

    const wrongMethod = await app.request('PUT', '/api/health');
    assert.equal(wrongMethod.status, 405);

    for (const res of [malformed, missing, wrongMethod]) {
      assert.ok(!/node_modules|\n\s+at /.test(res.text), 'response leaked internals');
    }
  });

  it('sends security headers', async () => {
    const res = await app.request('GET', '/api/health');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  });
});
