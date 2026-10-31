import crypto from 'node:crypto';

const KEY_LENGTH = 64;
const COST = { N: 16384, r: 8, p: 1 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEY_LENGTH, COST);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length, COST);
  return crypto.timingSafeEqual(actual, expected);
}

const encode = (value) => Buffer.from(value).toString('base64url');
const sign = (data, secret) => crypto.createHmac('sha256', secret).update(data).digest();

export function signToken(payload, secret, ttlHours) {
  const header = encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const exp = Math.floor(Date.now() / 1000) + Math.round(ttlHours * 3600);
  const body = encode(JSON.stringify({ ...payload, exp }));
  return `${header}.${body}.${sign(`${header}.${body}`, secret).toString('base64url')}`;
}

export function verifyToken(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;

  const given = Buffer.from(signature, 'base64url');
  const expected = sign(`${header}.${body}`, secret);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;

  try {
    if (JSON.parse(Buffer.from(header, 'base64url').toString()).alg !== 'HS256') return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (typeof payload.exp !== 'number' || payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}
