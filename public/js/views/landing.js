import { boardLegend, campusBoard } from '../components.js';
import { h, icon } from '../dom.js';

// Sample day for the hero board. It is an illustration, not live data.
function sampleDay() {
  const start = new Date();
  start.setHours(8, 0, 0, 0);
  const at = (hour, minute = 0) => new Date(new Date(start).setHours(hour, minute, 0, 0)).toISOString();
  const slot = (a, b, extra = {}) => ({ start_time: at(...a), end_time: at(...b), status: 'confirmed', mine: false, ...extra });
  return {
    dayStart: +start,
    dayEnd: +new Date(new Date(start).setHours(20, 0, 0, 0)),
    free: { start: Date.parse(at(14)), end: Date.parse(at(16)) },
    rows: [
      { name: 'Seminar Hall A', sub: 'Administrative Block', slots: [slot([9, 30], [12, 30]), slot([16, 30], [18], { status: 'pending' })] },
      { name: 'Computer Lab 1', sub: 'CSE Department', slots: [slot([9], [11, 30]), slot([16], [18, 30])], highlight: true },
      { name: 'Classroom 204', sub: 'Academic Block', slots: [slot([10], [11, 30], { mine: true }), slot([13], [14])] },
      { name: 'Discussion Room 2', sub: 'Central Library', slots: [slot([11], [12]), slot([15], [16, 30])] },
      { name: 'Projector P1', sub: 'Store room', slots: [slot([10], [13])] },
    ],
  };
}

function go(el) {
  el.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

const tick = (text) => h('li', {}, icon('check', 18), h('span', {}, text));

export function renderLanding(root, app) {
  const r = app.rules;
  const day = sampleDay();
  const sections = {};
  const section = (id, el) => ((sections[id] = el), el);

  const hero = h(
    'section',
    { class: 'hero' },
    h(
      'div',
      { class: 'hero-inner' },
      h(
        'div',
        {},
        h('h1', {}, 'Every room, lab and projector. ', h('em', {}, 'One schedule.')),
        h('p', { class: 'lead' }, 'See what is free, book it in under a minute, and never walk in to find someone else already there.'),
        h(
          'div',
          { class: 'hero-cta' },
          h('a', { class: 'btn accent large', href: '#/register' }, 'Create a free account'),
          h('a', { class: 'btn on-dark large', href: '#/login' }, 'Sign in'),
        ),
        h('p', { class: 'hero-note' }, 'Built for students and staff. No double bookings, ever.'),
      ),
      h(
        'div',
        { class: 'hero-board', 'aria-label': 'Example of the day schedule' },
        h('header', {}, h('h2', {}, 'Today on campus'), h('span', { class: 'small muted' }, 'Example schedule')),
        campusBoard({
          rows: day.rows.map((row) => (row.highlight ? { ...row, free: day.free } : row)),
          dayStart: day.dayStart,
          dayEnd: day.dayEnd,
          nowMs: 0,
        }),
        h('div', { class: 'free-callout' }, icon('clock', 18), 'Computer Lab 1 is free from 2 pm to 4 pm. Book it with two taps.'),
        boardLegend(),
      ),
    ),
  );

  const how = section(
    'how',
    h(
      'section',
      { class: 'band white', id: 'how' },
      h(
        'div',
        { class: 'wrap' },
        h('div', { class: 'band-head' }, h('h2', {}, 'From search to confirmed in three steps'), h('p', {}, 'No messages to chase and no spreadsheets to check.')),
        h(
          'ol',
          { class: 'steps' },
          h('li', {}, h('span', { class: 'num' }, '1'), h('h3', {}, 'Search by date and time'), h('p', {}, 'Pick the day, the hours you need, and optionally a type or the number of seats. Every result shows that day as a timeline, so free gaps are obvious.')),
          h('li', {}, h('span', { class: 'num' }, '2'), h('h3', {}, 'Book a free slot'), h('p', {}, 'Choose a resource marked Free, say what it is for, and confirm. If someone took it a moment earlier, you are told straight away and nothing is double-booked.')),
          h('li', {}, h('span', { class: 'num' }, '3'), h('h3', {}, 'Get confirmed or approved'), h('p', {}, 'Everyday rooms confirm instantly. Big halls and labs go to an administrator, who approves or declines with a note. You see the status on your bookings page.')),
        ),
      ),
    ),
  );

  const kinds = h(
    'section',
    { class: 'band' },
    h(
      'div',
      { class: 'wrap' },
      h('div', { class: 'band-head' }, h('h2', {}, 'Rooms, labs and equipment'), h('p', {}, 'Administrators decide what is listed. Typical examples:')),
      h(
        'div',
        { class: 'kinds' },
        h('div', {}, h('h3', {}, 'Rooms'), h('p', { class: 'sub' }, 'Where you meet and teach'), h('ul', {}, ['Classrooms', 'Seminar halls', 'Library discussion rooms'].map((t) => h('li', {}, t)))),
        h('div', {}, h('h3', {}, 'Labs'), h('p', { class: 'sub' }, 'Where you build and test'), h('ul', {}, ['Computer labs', 'Electronics labs', 'Project workspaces'].map((t) => h('li', {}, t)))),
        h('div', {}, h('h3', {}, 'Equipment'), h('p', { class: 'sub' }, 'What you borrow for an event'), h('ul', {}, ['Projectors and screens', 'Sound systems', 'Cameras and tripods'].map((t) => h('li', {}, t)))),
      ),
    ),
  );

  const features = section(
    'features',
    h(
      'section',
      { class: 'band white', id: 'features' },
      h(
        'div',
        { class: 'wrap' },
        h('div', { class: 'band-head' }, h('h2', {}, 'Made for both sides of the counter')),
        h(
          'div',
          { class: 'audience' },
          h('div', {}, h('h3', {}, 'For students'), h('ul', { class: 'ticks' }, [
            'Search by date, time range, type and seats needed',
            'See a day timeline for every resource before you book',
            'Book instantly, or send a request when approval is needed',
            'Cancel any time before the booking ends',
            'Track status and read the administrator\'s note on declined requests',
            'Reset your password yourself if you forget it',
          ].map(tick))),
          h('div', {}, h('h3', {}, 'For administrators'), h('ul', { class: 'ticks' }, [
            'Add, edit and deactivate rooms, labs and equipment',
            'Choose which resources need approval',
            'Approve or decline requests, with a reason students can read',
            'See everyone\'s bookings and filter by status or resource',
            'Your own bookings are confirmed immediately',
            'Deactivated resources stay in history but cannot be booked',
          ].map(tick))),
        ),
      ),
    ),
  );

  const rules = h(
    'section',
    { class: 'band night' },
    h(
      'div',
      { class: 'wrap split' },
      h('div', { class: 'band-head' }, h('h2', {}, 'One slot, one booking'), h('p', {}, 'The system checks every request against the existing schedule. Two people clicking at the same second cannot both win: one is confirmed, the other is told at once. Back-to-back bookings are fine.')),
      h(
        'dl',
        { class: 'facts' },
        h('div', {}, h('dt', {}, 'Length of a booking'), h('dd', {}, `${r.minMinutes} minutes to ${r.maxMinutes / 60} hours`)),
        h('div', {}, h('dt', {}, 'How far ahead'), h('dd', {}, `Up to ${r.maxDaysAhead} days`)),
        h('div', {}, h('dt', {}, 'Cancelling'), h('dd', {}, 'Any time before it ends')),
        h('div', {}, h('dt', {}, 'Pending requests'), h('dd', {}, 'Hold the slot until decided')),
        h('div', {}, h('dt', {}, 'Overlaps'), h('dd', {}, 'Never allowed')),
      ),
    ),
  );

  const faqItems = [
    ['Do I need an account?', 'Yes. Students create a free account with an email address and a password. Administrator accounts are set up by whoever runs the system.'],
    ['Why does my booking say Pending?', 'Some resources, such as large halls and labs, need an administrator to approve each request. Your slot is held for you while they decide, and you will see the result under My bookings.'],
    ['What if two people book the same slot at once?', 'Only one booking is accepted. The other person sees a message with the clashing time and can pick another slot. A booking that starts exactly when another ends is allowed.'],
    ['How long can I book for, and how far ahead?', `Between ${r.minMinutes} minutes and ${r.maxMinutes / 60} hours, starting up to ${r.maxDaysAhead} days from now.`],
    ['Can I cancel?', 'Yes, any time before the booking ends. The slot becomes free for others straight away.'],
    ['I forgot my password. What now?', 'Choose Forgot password on the sign-in page and enter your email. You get a one-time link that lets you set a new password.'],
  ];
  const faq = section(
    'faq',
    h(
      'section',
      { class: 'band', id: 'faq' },
      h(
        'div',
        { class: 'wrap' },
        h('div', { class: 'band-head' }, h('h2', {}, 'Questions people ask')),
        h('div', { class: 'faq' }, faqItems.map(([q, a]) => h('details', {}, h('summary', {}, q), h('p', {}, a)))),
      ),
    ),
  );

  const cta = h(
    'section',
    { class: 'band night cta-band' },
    h(
      'div',
      { class: 'wrap' },
      h('h2', {}, 'Ready to find a free room?'),
      h('p', {}, 'Create an account in under a minute and see what is free right now.'),
      h('div', { class: 'hero-cta' }, h('a', { class: 'btn accent large', href: '#/register' }, 'Create a free account'), h('a', { class: 'btn on-dark large', href: '#/login' }, 'Sign in')),
    ),
  );

  const footer = h(
    'footer',
    { class: 'site-footer' },
    h('div', { class: 'wrap' }, h('span', {}, 'CampusBook, a COSMOS JEC Backend Development project (BD-01).'), h('span', {}, h('a', { href: '#/login' }, 'Sign in'), '   ', h('a', { href: '#/register' }, 'Create account'))),
  );

  root.append(hero, how, kinds, features, rules, faq, cta, footer);
  return { go: (id) => sections[id] && go(sections[id]) };
}
