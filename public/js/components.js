import { api } from './api.js';
import { confirmDialog, fmtRange, fmtTime, h, toast } from './dom.js';

export function stateBox(title, message, action) {
  return h('div', { class: 'state' }, h('strong', {}, title), message && h('p', {}, message), action);
}

export function errorBox(err, retry) {
  return h(
    'div',
    { class: 'state error', role: 'alert' },
    h('strong', {}, 'This could not be loaded'),
    h('p', {}, err.message),
    retry && h('button', { class: 'btn secondary', type: 'button', onclick: retry }, 'Try again'),
  );
}

export async function loadInto(el, loader, render) {
  el.setAttribute('aria-busy', 'true');
  el.replaceChildren(h('p', { class: 'state' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Loading'));
  try {
    const data = await loader();
    el.replaceChildren();
    render(el, data);
  } catch (err) {
    el.replaceChildren(errorBox(err, () => loadInto(el, loader, render)));
  } finally {
    el.removeAttribute('aria-busy');
  }
}

export const statusPill = (status) => h('span', { class: `pill ${status}` }, status[0].toUpperCase() + status.slice(1));

const AVAILABILITY = { available: 'Free', booked: 'Booked', inactive: 'Closed' };
export const availabilityPill = (value) => value && h('span', { class: `pill ${value}` }, AVAILABILITY[value]);

// A horizontal strip for one day: grey blocks are other people's bookings,
// green is the viewer's own, striped is waiting for approval.
export function timeline({ slots, dayStart, dayEnd, want }) {
  const span = dayEnd - dayStart;
  const percent = (ms) => Math.min(100, Math.max(0, ((ms - dayStart) / span) * 100));
  const place = (el, startMs, endMs) => {
    el.style.left = `${percent(startMs)}%`;
    el.style.width = `${percent(endMs) - percent(startMs)}%`;
    return el;
  };

  const visible = slots.filter((s) => Date.parse(s.end_time) > dayStart && Date.parse(s.start_time) < dayEnd);
  const bar = h('div', { class: 'tl', 'aria-hidden': 'true' });
  for (const s of visible) {
    const seg = h('span', { class: `tl-seg ${s.mine ? 'mine' : ''} ${s.status}`, title: `${fmtTime(s.start_time)} to ${fmtTime(s.end_time)}` });
    bar.append(place(seg, Date.parse(s.start_time), Date.parse(s.end_time)));
  }
  if (want) bar.append(place(h('span', { class: 'tl-want' }), want.start, want.end));

  const scale = h('div', { class: 'tl-scale', 'aria-hidden': 'true' });
  const hours = (dayEnd - dayStart) / 3600000;
  for (let i = 0; i <= hours; i += 2) {
    const label = new Date(dayStart + i * 3600000).toLocaleTimeString([], { hour: 'numeric' }).replace(' ', '').toLowerCase();
    const tick = h('span', {}, label);
    tick.style.left = `${(i / hours) * 100}%`;
    scale.append(tick);
  }

  const summary = visible.length
    ? `Booked: ${visible.map((s) => `${fmtTime(s.start_time)} to ${fmtTime(s.end_time)}`).join(', ')}`
    : 'No bookings on this day';
  return h('div', { class: 'tl-wrap' }, bar, scale, h('p', { class: 'small muted' }, summary));
}

export function timelineLegend() {
  return h(
    'p',
    { class: 'tl-legend' },
    h('span', {}, h('i', { class: 'swatch busy' }), 'Booked'),
    h('span', {}, h('i', { class: 'swatch mine' }), 'Yours'),
    h('span', {}, h('i', { class: 'swatch pending' }), 'Awaiting approval'),
    h('span', {}, h('i', { class: 'swatch want' }), 'Time you chose'),
  );
}

export function bookingItem(b, { showUser, actions }) {
  return h(
    'article',
    { class: 'booking card' },
    h(
      'div',
      {},
      h('p', { class: 'title' }, b.resource.name),
      h('p', { class: 'small muted' }, b.resource.location),
      showUser && h('p', { class: 'small' }, `Requested by ${b.user.name}${b.user.email ? ` (${b.user.email})` : ''}`),
    ),
    h('div', {}, h('p', { class: 'when' }, fmtRange(b.start_time, b.end_time)), h('p', { class: 'small muted' }, b.purpose)),
    h('div', { class: 'side' }, statusPill(b.status), actions),
    b.decision_note && h('p', { class: 'note' }, `Admin note: ${b.decision_note}`),
  );
}

export function actionButton(label, { kind = 'secondary', onClick }) {
  const button = h('button', { class: `btn small ${kind}`, type: 'button' }, label);
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await onClick();
    } finally {
      button.disabled = false;
    }
  });
  return button;
}

// Shared by the student list and the admin tabs. `query` is re-read on every reload.
export function mountBookingList(el, { query, showUser = false, emptyTitle, emptyText, admin = false, onChange }) {
  const pageSize = 20;
  let items = [];

  async function fetchPage(offset) {
    return api('/api/bookings', { query: { ...query(), limit: pageSize, offset } });
  }

  const actionsFor = (b) => {
    const live = (b.status === 'pending' || b.status === 'confirmed') && Date.parse(b.end_time) > Date.now();
    const buttons = [];
    if (admin && b.status === 'pending' && live) {
      buttons.push(
        actionButton('Approve', {
          kind: '',
          onClick: async () => {
            await run(() => api(`/api/bookings/${b.id}/approve`, { method: 'POST' }), 'Booking approved');
          },
        }),
        actionButton('Reject', { kind: 'danger', onClick: () => rejectFlow(b) }),
      );
    }
    if (live) {
      buttons.push(
        actionButton('Cancel', {
          kind: 'danger',
          onClick: async () => {
            const ok = await confirmDialog({
              title: 'Cancel this booking?',
              message: `${b.resource.name}, ${fmtRange(b.start_time, b.end_time)}. The slot becomes free for others.`,
              confirmLabel: 'Cancel booking',
              danger: true,
            });
            if (ok) await run(() => api(`/api/bookings/${b.id}/cancel`, { method: 'POST' }), 'Booking cancelled');
          },
        }),
      );
    }
    return buttons;
  };

  async function run(request, doneMessage) {
    try {
      await request();
      toast(doneMessage);
      await reload();
      onChange?.();
    } catch (err) {
      toast(err.message, 'error');
      await reload();
    }
  }

  function rejectFlow(b) {
    return import('./views/rejectDialog.js').then(({ askRejectReason }) =>
      askRejectReason(b, (reason) => run(() => api(`/api/bookings/${b.id}/reject`, { method: 'POST', body: reason ? { reason } : {} }), 'Request rejected')),
    );
  }

  function draw(total) {
    el.replaceChildren();
    if (items.length === 0) {
      el.append(stateBox(emptyTitle, emptyText));
      return;
    }
    el.append(h('div', { class: 'booking-list' }, items.map((b) => bookingItem(b, { showUser, actions: actionsFor(b) }))));
    if (items.length < total) {
      const more = h('button', { class: 'btn secondary', type: 'button' }, `Show more (${total - items.length} left)`);
      more.addEventListener('click', async () => {
        more.disabled = true;
        try {
          const page = await fetchPage(items.length);
          items = items.concat(page.items);
          draw(page.total);
        } catch (err) {
          toast(err.message, 'error');
          more.disabled = false;
        }
      });
      el.append(h('p', { class: 'state' }, more));
    }
  }

  async function reload() {
    await loadInto(el, () => fetchPage(0), (_, page) => {
      items = page.items;
      draw(page.total);
    });
  }

  return { reload };
}

export function pageHead({ title, subtitle, actions }) {
  return h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, title), subtitle && h('p', {}, subtitle)), actions);
}

export function boardLegend({ now = false } = {}) {
  return h(
    'p',
    { class: 'legend' },
    h('span', {}, h('i', { class: 'swatch busy' }), 'Booked'),
    h('span', {}, h('i', { class: 'swatch mine' }), 'Yours'),
    h('span', {}, h('i', { class: 'swatch pending' }), 'Awaiting approval'),
    now && h('span', {}, h('i', { class: 'swatch now' }), 'Now'),
  );
}

// One row per resource across a day. rows: [{ name, sub, slots, href?, free? }]
// free is an optional { start, end } window drawn as a highlighted outline.
export function campusBoard({ rows, dayStart, dayEnd, nowMs }) {
  const span = dayEnd - dayStart;
  const percent = (ms) => Math.min(100, Math.max(0, ((ms - dayStart) / span) * 100));
  const place = (el, a, b) => {
    el.style.left = `${percent(a)}%`;
    el.style.width = `${percent(b) - percent(a)}%`;
    return el;
  };
  const hours = (dayEnd - dayStart) / 3600000;

  const scale = h('div', { class: 'board-scale', 'aria-hidden': 'true' });
  for (let i = 0; i <= hours; i += 2) {
    const label = new Date(dayStart + i * 3600000).toLocaleTimeString([], { hour: 'numeric' }).replace(' ', '').toLowerCase();
    const tick = h('span', {}, label);
    tick.style.left = `${(i / hours) * 100}%`;
    scale.append(tick);
  }
  const showNow = nowMs > dayStart && nowMs < dayEnd;

  const body = rows.map((row) => {
    const track = h('div', { class: 'board-track', 'aria-hidden': 'true' });
    for (const s of row.slots) {
      const a = Date.parse(s.start_time);
      const b = Date.parse(s.end_time);
      if (b <= dayStart || a >= dayEnd) continue;
      track.append(place(h('span', { class: `tl-seg ${s.mine ? 'mine' : ''} ${s.status}`, title: `${fmtTime(s.start_time)} to ${fmtTime(s.end_time)}` }), a, b));
    }
    if (row.free) track.append(place(h('span', { class: 'tl-want free' }), row.free.start, row.free.end));
    if (showNow) {
      const marker = h('span', { class: 'board-now' });
      marker.style.left = `${percent(nowMs)}%`;
      track.append(marker);
    }
    const busy = row.slots.filter((s) => Date.parse(s.end_time) > dayStart && Date.parse(s.start_time) < dayEnd);
    const summary = busy.length ? `Booked ${busy.map((s) => `${fmtTime(s.start_time)} to ${fmtTime(s.end_time)}`).join(', ')}` : 'No bookings today';
    const label = h('div', { class: 'board-name' }, h('strong', {}, row.name), row.sub && h('small', {}, row.sub));
    const content = [label, track, h('span', { class: 'visually-hidden' }, summary)];
    return row.href ? h('a', { class: 'board-row', href: row.href }, content) : h('div', { class: 'board-row' }, content);
  });

  return h('div', { class: 'board' }, h('div', { class: 'board-head' }, h('span', { class: 'board-spacer' }), scale), body);
}
