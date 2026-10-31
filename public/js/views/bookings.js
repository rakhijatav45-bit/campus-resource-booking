import { mountBookingList } from '../components.js';
import { field, h, select } from '../dom.js';

const FILTERS = [
  ['upcoming', 'Upcoming'],
  ['all', 'Everything'],
  ['pending', 'Awaiting approval'],
  ['confirmed', 'Confirmed'],
  ['cancelled', 'Cancelled'],
  ['rejected', 'Rejected'],
];

export function renderBookings(root) {
  const filter = select(FILTERS);
  const container = h('div');
  const list = mountBookingList(container, {
    query: () => {
      if (filter.value === 'upcoming') return { upcoming: true };
      if (filter.value === 'all') return {};
      return { status: filter.value };
    },
    emptyTitle: 'No bookings here',
    emptyText: 'Change the filter, or find a slot to book.',
  });

  filter.addEventListener('change', () => list.reload());
  root.append(
    h(
      'div',
      { class: 'page-head' },
      h('div', {}, h('h1', {}, 'My bookings'), h('p', {}, 'Your upcoming and past bookings.')),
      h('div', {}, field({ label: 'Show', name: 'filter', control: filter })),
    ),
    container,
  );
  list.reload();
}
