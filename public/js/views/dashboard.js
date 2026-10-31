import { api } from '../api.js';
import { boardLegend, campusBoard, errorBox, mountBookingList, pageHead, stateBox } from '../components.js';
import { h, icon, toDateInput, toTimeInput } from '../dom.js';

const DAY_START_HOUR = 8;
const DAY_END_HOUR = 20;

// The next whole hour if it falls in the working day, otherwise 10 am tomorrow.
function suggestSlot() {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  if (start.getHours() < DAY_START_HOUR || start.getHours() >= DAY_END_HOUR - 1) {
    if (start.getHours() >= DAY_END_HOUR - 1) start.setDate(start.getDate() + 1);
    start.setHours(10);
  }
  return { start, end: new Date(start.getTime() + 3600000) };
}

export function renderDashboard(root, app) {
  const isAdmin = app.user.role === 'admin';
  const r = app.rules;
  const today = new Date();
  const first = app.user.name.split(' ')[0];
  const greetingHeading = h('h1', {}, `Hello, ${first}`);
  const dateHeading = h('p', {}, today.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }));

  const stats = h('div', { class: 'stats' });
  const board = h('div');
  const listBox = h('div');
  const asideBox = h('div');

  root.append(
    h('div', { class: 'page-head' },
      h('div', {}, greetingHeading, dateHeading),
      h('a', { class: 'btn', href: '#/find' }, icon('search', 18), 'Find a slot')),
    stats,
    h('section', { class: 'panel-card', 'aria-labelledby': 'today-title' },
      h('header', {}, h('div', {}, h('h2', { id: 'today-title' }, 'Campus today'), h('p', {}, 'Select a resource to book it.')), boardLegend({ now: true })),
      board),
    h('div', { class: 'dash-grid two' },
      h('section', { class: 'panel-card' },
        h('header', {}, h('h2', {}, isAdmin ? 'Needs your decision' : 'Your upcoming bookings'), h('a', { href: isAdmin ? '#/admin' : '#/bookings' }, isAdmin ? 'Open admin' : 'All bookings')),
        listBox),
      h('section', { class: 'panel-card' },
        h('header', {}, h('h2', {}, 'Booking rules')),
        asideBox)),
  );

  function refreshHeaderClock() {
    if (!greetingHeading.isConnected) return;
    const now = new Date();
    dateHeading.textContent = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    window.setTimeout(refreshHeaderClock, 60000 - (Date.now() % 60000));
  }

  window.setTimeout(refreshHeaderClock, 60000 - (Date.now() % 60000));

  asideBox.append(
    h('ul', { class: 'rule-list' }, [
      `Each booking lasts ${r.minMinutes} minutes to ${r.maxMinutes / 60} hours`,
      `Book up to ${r.maxDaysAhead} days ahead`,
      'Back-to-back bookings are fine, overlaps are not',
      'Some resources need approval. Pending requests hold the slot',
      'Cancel any time before a booking ends',
    ].map((t) => h('li', {}, icon('check', 18), h('span', {}, t)))),
    ...(isAdmin ? [h('p', { class: 'section' }, h('a', { class: 'btn secondary', href: '#/admin?tab=resources' }, 'Manage resources'))] : []),
  );

  const stat = (label, value, hint) =>
    h('div', { class: 'stat' }, h('p', { class: 'label' }, label), h('p', { class: 'value' }, value), hint && h('p', { class: 'hint' }, hint));

  function statsLoading() {
    stats.replaceChildren(...[0, 1, 2].map(() => h('div', { class: 'stat' }, h('p', { class: 'label' }, '\u00a0'), h('p', { class: 'value' }, h('span', { class: 'skeleton' }, '\u00a0\u00a0\u00a0\u00a0')))));
  }

  async function loadOverview() {
    statsLoading();
    board.replaceChildren(h('p', { class: 'state' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Loading'));
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const nextMidnight = new Date(midnight.getTime() + 86400000);
    const adminScope = isAdmin ? { scope: 'all' } : {};
    try {
      const [upcoming, pending, resources, schedule] = await Promise.all([
        api('/api/bookings', { query: { upcoming: true, limit: 1, ...adminScope } }),
        api('/api/bookings', { query: { status: 'pending', upcoming: true, limit: 1, ...adminScope } }),
        api('/api/resources'),
        api('/api/schedule', { query: { from: midnight.toISOString(), to: nextMidnight.toISOString() } }),
      ]);

      const now = Date.now();
      const inHour = now + 3600000;
      const busyNow = (id) => schedule.slots.some((s) => s.resource_id === id && Date.parse(s.start_time) < inHour && Date.parse(s.end_time) > now);
      const free = resources.items.filter((x) => !busyNow(x.id)).length;

      stats.replaceChildren(
        isAdmin ? stat('Requests to decide', String(pending.total), pending.total ? h('a', { href: '#/admin' }, 'Review requests') : 'Nothing waiting') : stat('Upcoming bookings', String(upcoming.total), h('a', { href: '#/bookings' }, 'View all')),
        isAdmin ? stat('Upcoming bookings', String(upcoming.total), 'Across all students') : stat('Awaiting approval', String(pending.total), pending.total ? 'Held for you until decided' : 'Nothing pending'),
        stat('Free for the next hour', `${free} of ${resources.items.length}`, 'resources'),
      );

      if (resources.items.length === 0) {
        board.replaceChildren(stateBox('No resources yet', isAdmin ? 'Add the first room, lab or equipment in Admin.' : 'An administrator needs to add some first.'));
        return;
      }
      const suggestion = suggestSlot();
      const dayStart = new Date(today);
      dayStart.setHours(DAY_START_HOUR, 0, 0, 0);
      const dayEnd = new Date(today);
      dayEnd.setHours(DAY_END_HOUR, 0, 0, 0);
      const link = (name) =>
        `#/find?date=${toDateInput(suggestion.start)}&from=${toTimeInput(suggestion.start)}&to=${toTimeInput(suggestion.end)}&q=${encodeURIComponent(name)}`;
      board.replaceChildren(
        campusBoard({
          rows: resources.items.map((x) => ({
            name: x.name,
            sub: x.location,
            slots: schedule.slots.filter((s) => s.resource_id === x.id),
            href: link(x.name),
          })),
          dayStart: +dayStart,
          dayEnd: +dayEnd,
          nowMs: now,
        }),
      );
    } catch (err) {
      stats.replaceChildren(stat('Upcoming bookings', '\u2013'), stat('Awaiting approval', '\u2013'), stat('Free for the next hour', '\u2013'));
      board.replaceChildren(errorBox(err, loadOverview));
    }
  }

  const list = mountBookingList(listBox, isAdmin
    ? { query: () => ({ scope: 'all', status: 'pending', upcoming: true }), showUser: true, admin: true, emptyTitle: 'Nothing waiting', emptyText: 'New requests for approval will show up here.', onChange: loadOverview }
    : { query: () => ({ upcoming: true }), emptyTitle: 'Nothing booked yet', emptyText: 'Find a free slot and it will show up here.', onChange: loadOverview });

  list.reload();
  loadOverview();
}
