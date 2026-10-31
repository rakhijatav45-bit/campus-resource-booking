import { HttpError } from '../lib/errors.js';
import { hashPassword, signToken, verifyPassword } from '../lib/auth.js';
import { Fields } from '../lib/validate.js';
import { authenticate } from '../middleware.js';
import * as users from '../services/users.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Checked against when the email is unknown, so response time does not reveal which emails exist.
const DUMMY_HASH = hashPassword('not-a-real-password-1');

function readPassword(f, name = 'password') {
  const password = f.string(name, { min: 8, max: 128, trim: false });
  if (password && !(/[A-Za-z]/.test(password) && /\d/.test(password))) {
    f.fail(name, `${name} must contain at least one letter and one number`);
  }
  return password;
}

const session = (ctx, user) => ({
  user,
  token: signToken({ sub: user.id }, ctx.config.jwtSecret, ctx.config.tokenTtlHours),
});

export function registerAuthRoutes(router) {
  router.add('POST', '/api/auth/register', (ctx) => {
    const f = new Fields(ctx.body);
    const name = f.string('name', { min: 2, max: 80 });
    const email = f.string('email', { max: 254 });
    const password = readPassword(f);
    if (email && !EMAIL.test(email)) f.fail('email', 'email must be a valid address');
    f.done();

    const user = users.create(ctx.db, { name, email, password });
    ctx.status = 201;
    return session(ctx, user);
  });

  router.add('POST', '/api/auth/login', (ctx) => {
    const f = new Fields(ctx.body);
    const email = f.string('email', { max: 254 });
    const password = f.string('password', { max: 128, trim: false });
    f.done();

    const key = `${ctx.ip}|${email.toLowerCase()}`;
    const wait = ctx.loginLimiter.retryAfterSeconds(key);
    if (wait > 0) {
      ctx.res.setHeader('Retry-After', String(wait));
      throw new HttpError(429, 'too_many_attempts', 'Too many failed sign-in attempts. Try again later.');
    }

    const row = users.findByEmail(ctx.db, email);
    const valid = verifyPassword(password, row ? row.password_hash : DUMMY_HASH);
    if (!row || !valid) {
      ctx.loginLimiter.recordFailure(key);
      throw new HttpError(401, 'invalid_credentials', 'Email or password is incorrect');
    }
    ctx.loginLimiter.clear(key);
    return session(ctx, users.toPublic(row));
  });

  // Always answers the same way, whether or not the email has an account.
  router.add('POST', '/api/auth/forgot-password', async (ctx) => {
    const f = new Fields(ctx.body);
    const email = f.string('email', { max: 254 });
    if (email && !EMAIL.test(email)) f.fail('email', 'email must be a valid address');
    f.done();

    const key = `${ctx.ip}|${email.toLowerCase()}`;
    const wait = ctx.resetLimiter.retryAfterSeconds(key);
    if (wait > 0) {
      ctx.res.setHeader('Retry-After', String(wait));
      throw new HttpError(429, 'too_many_attempts', 'Too many reset requests. Try again later.');
    }
    ctx.resetLimiter.recordFailure(key);

    const result = users.createResetCode(ctx.db, email, {
      ttlMinutes: ctx.config.resetCodeMinutes,
      secret: ctx.config.jwtSecret,
    });
    if (result) {
      try {
        await ctx.mailer.send({
          to: email,
          subject: 'Your CampusBook password reset code',
          text: `Hello ${result.user.name},\n\nYour CampusBook password reset code is: ${result.code}\n\nIt works once and expires in ${ctx.config.resetCodeMinutes} minutes. If you did not ask for this, ignore this message.`,
        });
      } catch (err) {
        console.error('Could not send password reset code email', err);
      }
    }
    return { message: 'If an account exists for that email, a reset code has been sent.' };
  });

  router.add('POST', '/api/auth/reset-password', (ctx) => {
    const f = new Fields(ctx.body);
    const email = f.string('email', { max: 254 });
    const code = f.string('code', { min: 6, max: 6 });
    const password = readPassword(f);
    if (email && !EMAIL.test(email)) f.fail('email', 'email must be a valid address');
    if (code && !/^\d{6}$/.test(code)) f.fail('code', 'code must contain six digits');
    f.done();
    const key = `${ctx.ip}|${email.toLowerCase()}`;
    const wait = ctx.resetCodeLimiter.retryAfterSeconds(key);
    if (wait > 0) {
      ctx.res.setHeader('Retry-After', String(wait));
      throw new HttpError(429, 'too_many_attempts', 'Too many code attempts. Request a new code later.');
    }
    ctx.resetCodeLimiter.recordFailure(key);
    users.resetPassword(ctx.db, email, code, password, { secret: ctx.config.jwtSecret });
    ctx.resetCodeLimiter.clear(key);
    return { message: 'Password updated. You can sign in with it now.' };
  });

  router.add('GET', '/api/auth/me', authenticate, (ctx) => ({ user: ctx.user }));
}
