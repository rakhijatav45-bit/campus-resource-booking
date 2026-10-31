import { notFound } from '../lib/errors.js';
import { authenticate, requireAdmin } from '../middleware.js';
import * as bookings from '../services/bookings.js';

function idFrom(ctx) {
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id < 1) throw notFound('Booking');
  return id;
}

export function registerBookingRoutes(router) {
  router.add('POST', '/api/bookings', authenticate, (ctx) => {
    const booking = bookings.create(ctx.db, ctx.user, ctx.body, { rules: ctx.config.rules });
    ctx.status = 201;
    return { booking };
  });

  router.add('GET', '/api/bookings', authenticate, (ctx) => bookings.list(ctx.db, ctx.user, ctx.query));

  router.add('GET', '/api/bookings/:id', authenticate, (ctx) => ({
    booking: bookings.get(ctx.db, ctx.user, idFrom(ctx)),
  }));

  router.add('POST', '/api/bookings/:id/cancel', authenticate, (ctx) => ({
    booking: bookings.cancel(ctx.db, ctx.user, idFrom(ctx)),
  }));

  router.add('POST', '/api/bookings/:id/approve', authenticate, requireAdmin, (ctx) => ({
    booking: bookings.approve(ctx.db, ctx.user, idFrom(ctx)),
  }));

  router.add('POST', '/api/bookings/:id/reject', authenticate, requireAdmin, (ctx) => ({
    booking: bookings.reject(ctx.db, ctx.user, idFrom(ctx), ctx.body),
  }));
}
