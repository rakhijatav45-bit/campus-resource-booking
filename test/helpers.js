import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { signToken } from '../src/lib/auth.js';
import * as resources from '../src/services/resources.js';
import * as users from '../src/services/users.js';

export async function startTestServer(overrides = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'campusbook-'));
  const config = loadConfig({ dbPath: path.join(dir, 'test.db'), jwtSecret: 'test-secret', ...overrides });
  const db = openDb(config.dbPath);
  const mails = [];
  const server = createApp({ config, db, mailer: { send: async (mail) => mails.push(mail) } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function request(method, url, { token, body, raw } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined || raw !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + url, {
      method,
      headers,
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: res.status, body: json, text, headers: res.headers };
  }

  let counter = 0;
  function makeUser(role = 'student') {
    counter += 1;
    const user = users.create(db, {
      name: `${role} ${counter}`,
      email: `${role}${counter}@campus.test`,
      password: 'Passw0rd!',
      role,
    });
    return { user, token: signToken({ sub: user.id }, config.jwtSecret, 1) };
  }

  function makeResource(fields = {}) {
    counter += 1;
    return resources.create(db, {
      name: `Room ${counter}`,
      type: 'room',
      location: 'Test Block',
      capacity: 30,
      ...fields,
    });
  }

  return {
    request,
    mails,
    db,
    config,
    makeUser,
    makeResource,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

// A slot `days` from now, starting on the hour. Returns ISO strings.
export function slot(days, startHour, minutes = 60) {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + days);
  start.setUTCHours(startHour, 0, 0, 0);
  return {
    start_time: start.toISOString(),
    end_time: new Date(start.getTime() + minutes * 60000).toISOString(),
  };
}

export const bookingBody = (resource, when, purpose = 'Study group') => ({
  resource_id: resource.id,
  purpose,
  ...when,
});
