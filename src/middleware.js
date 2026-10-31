import { HttpError, forbidden } from './lib/errors.js';
import { verifyToken } from './lib/auth.js';
import * as users from './services/users.js';

export function authenticate(ctx) {
  const [scheme, token] = (ctx.req.headers.authorization ?? '').split(' ');
  const payload = scheme === 'Bearer' && token ? verifyToken(token, ctx.config.jwtSecret) : null;
  // Look the user up on every request so a changed role takes effect immediately.
  const user = payload ? users.getById(ctx.db, payload.sub) : null;
  if (!user) throw new HttpError(401, 'unauthenticated', 'Sign in to continue');
  ctx.user = user;
}

export function requireAdmin(ctx) {
  if (ctx.user.role !== 'admin') throw forbidden('This action is limited to administrators');
}
