import { forbidden, notFound } from '../lib/errors.js';
import { Fields } from '../lib/validate.js';
import { authenticate, requireAdmin } from '../middleware.js';
import * as resources from '../services/resources.js';

const MAX_SCHEDULE_DAYS = 8;

function idFrom(ctx) {
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id < 1) throw notFound('Resource');
  return id;
}

export function registerResourceRoutes(router) {
  router.add('GET', '/api/resources', authenticate, (ctx) => {
    const f = new Fields(ctx.query);
    const type = f.oneOf('type', resources.RESOURCE_TYPES, { required: false });
    const minCapacity = f.integer('min_capacity', { min: 1, max: 10000, required: false, coerce: true });
    const q = f.string('q', { max: 80, required: false });
    const start = f.instant('start', { required: false });
    const end = f.instant('end', { required: false });
    const includeInactive = f.boolean('include_inactive', { required: false, coerce: true });
    const availableOnly = f.boolean('available_only', { required: false, coerce: true });

    if (Boolean(start) !== Boolean(end)) f.fail('start', 'start and end must be given together');
    if (start && end && end <= start) f.fail('end', 'end must be after start');
    if (availableOnly && !start) f.fail('available_only', 'available_only needs start and end');
    f.done();
    if (includeInactive && ctx.user.role !== 'admin') throw forbidden('Only administrators can list inactive resources');

    const items = resources.list(ctx.db, { type, minCapacity, q, includeInactive, start, end, availableOnly });
    return { items, total: items.length };
  });

  router.add('GET', '/api/schedule', authenticate, (ctx) => {
    const f = new Fields(ctx.query);
    const from = f.instant('from');
    const to = f.instant('to');
    const resourceId = f.integer('resource_id', { min: 1, required: false, coerce: true });
    if (from && to && to <= from) f.fail('to', 'to must be after from');
    if (from && to && to - from > MAX_SCHEDULE_DAYS * 86400000) {
      f.fail('to', `The range can cover at most ${MAX_SCHEDULE_DAYS} days`);
    }
    f.done();
    return { slots: resources.busySlots(ctx.db, ctx.user.id, from, to, resourceId) };
  });

  router.add('GET', '/api/resources/:id', authenticate, (ctx) => {
    const resource = resources.get(ctx.db, idFrom(ctx));
    if (!resource || (!resource.is_active && ctx.user.role !== 'admin')) throw notFound('Resource');
    return { resource };
  });

  router.add('POST', '/api/resources', authenticate, requireAdmin, (ctx) => {
    ctx.status = 201;
    return { resource: resources.create(ctx.db, ctx.body) };
  });

  router.add('PATCH', '/api/resources/:id', authenticate, requireAdmin, (ctx) => ({
    resource: resources.update(ctx.db, idFrom(ctx), ctx.body),
  }));

  router.add('DELETE', '/api/resources/:id', authenticate, requireAdmin, (ctx) => ({
    resource: resources.deactivate(ctx.db, idFrom(ctx)),
  }));
}
