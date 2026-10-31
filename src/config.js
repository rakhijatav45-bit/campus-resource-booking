import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Tiny .env reader so the project runs without extra packages.
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}

loadEnvFile(path.join(root, '.env'));

function number(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number`);
  return value;
}

export function loadConfig(overrides = {}) {
  const env = process.env.NODE_ENV ?? 'development';
  const secret = process.env.JWT_SECRET ?? '';
  if (env === 'production' && secret.length < 32) {
    throw new Error('JWT_SECRET must be set to 32 or more characters in production');
  }

  return {
    env,
    port: number('PORT', 3000),
    dbPath: path.resolve(root, process.env.DB_PATH ?? 'data/campus.db'),
    publicDir: path.join(root, 'public'),
    jwtSecret: secret || 'dev-only-secret-do-not-use-in-production',
    usingDefaultSecret: !secret,
    tokenTtlHours: number('TOKEN_TTL_HOURS', 8),
    rules: {
      maxDaysAhead: number('BOOKING_MAX_DAYS_AHEAD', 30),
      minMinutes: number('BOOKING_MIN_MINUTES', 15),
      maxMinutes: number('BOOKING_MAX_MINUTES', 240),
    },
    resetCodeMinutes: number('RESET_CODE_MINUTES', number('RESET_TOKEN_MINUTES', 30)),
    smtpHost: process.env.SMTP_HOST ?? '',
    smtpPort: number('SMTP_PORT', 587),
    smtpSecure: process.env.SMTP_SECURE === undefined
      ? number('SMTP_PORT', 587) === 465
      : process.env.SMTP_SECURE === 'true',
    smtpUser: process.env.SMTP_USER ?? '',
    smtpPass: process.env.SMTP_PASS ?? '',
    smtpFrom: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? '',
    loginLimit: { max: 10, windowMs: 15 * 60 * 1000 },
    resetLimit: { max: 5, windowMs: 15 * 60 * 1000 },
    resetCodeLimit: { max: 10, windowMs: 15 * 60 * 1000 },
    ...overrides,
  };
}
