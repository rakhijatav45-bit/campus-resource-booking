import { ApiError, api } from '../api.js';
import { availabilityPill, loadInto, stateBox, timeline, timelineLegend } from '../components.js';
import {
  TYPE_LABEL, clearFieldErrors, field, h, input, openDialog, select, showFieldErrors, toLocalInput,
  toDateInput, toTimeInput, toast, withBusy, fmtRange,
} from '../dom.js';

const DAY_START_HOUR = 8;
const DAY_END_HOUR = 20;

function defaultSlot() {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  if (start.getHours() >= DAY_END_HOUR - 1 || start.getHours() < DAY_START_HOUR) {
    if (start.getHours() >= DAY_END_HOUR - 1) start.setDate(start.getDate() + 1);
    start.setHours(10);
  }
  return { start, end: new Date(start.getTime() + 60 * 60 * 1000) };
}

function parseHashParams() {
  const query = window.location.hash.split('?')[1] ?? '';
  return Object.fromEntries(new URLSearchParams(query));
}

// Mirrors the server rules so people get feedback before sending. The server still decides.
function checkBooking({ start, end, purpose }, rules) {
  const errors = {};
  const now = new Date();
  if (!start || Number.isNaN(start.getTime())) errors.start_time = 'Choose a start time';
  if (!end || Number.isNaN(end.getTime())) errors.end_time = 'Choose an end time';
  if (!errors.start_time && !errors.end_time) {
    const minutes = (end - start) / 60000;
    if (end <= start) errors.end_time = 'The end must be after the start';
    else if (minutes < rules.minMinutes) errors.end_time = `Book at least ${rules.minMinutes} minutes`;
    else if (minutes > rules.maxMinutes) errors.end_time = `Book at most ${rules.maxMinutes / 60} hours at a time`;
    if (start <= now) errors.start_time = 'The start must be in the future';
    else if (start - now > rules.maxDaysAhead * 86400000) errors.start_time = `You can book up to ${rules.maxDaysAhead} days ahead`;
  }
  if (purpose.trim().length < 3) errors.purpose = 'Say briefly what it is for (3 characters or more)';
  return errors;
}

export function renderFind(root, app) {
  const params = parseHashParams();
  const fallback = defaultSlot();
  const results = h('div', { 'aria-live': 'polite' });

  const date = input('date', { value: params.date ?? toDateInput(fallback.start), required: true });
  const from = input('time', { value: params.from ?? toTimeInput(fallback.start), required: true, step: '300' });
  const to = input('time', { value: params.to ?? toTimeInput(fallback.end), required: true, step: '300' });
  const type = select([['', 'Any type'], ...Object.entries(TYPE_LABEL)]);
  const capacity = input('number', { min: '1', max: '10000', inputmode: 'numeric', placeholder: 'Any', value: params.capacity });
  const text = input('search', { maxlength: '80', placeholder: 'Name or building', value: params.q });
  const submit = h('button', { class: 'btn', type: 'submit' }, 'Search');

  const form = h(
    'form',
    { class: 'filters card panel', novalidate: true },
    field({ label: 'Date', name: 'date', control: date }),
    field({ label: 'From', name: 'from', control: from }),
    field({ label: 'To', name: 'to', control: to }),
    field({ label: 'Type', name: 'type', control: type }),
    field({ label: 'Seats needed', name: 'capacity', control: capacity }),
    h('div', { class: 'wide' }, field({ label: 'Search', name: 'q', control: text })),
    h('div', { class: 'actions' }, submit),
  );

  root.append(
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Find a slot'), h('p', {}, 'Pick a date and time, then book anything marked Free.'))),
    form,
    h('div', { class: 'section' }, timelineLegend(), results),
  );

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    search();
  });

  function readRange() {
    clearFieldErrors(form);
    const errors = {};
    const start = new Date(`${date.value}T${from.value}`);
    const end = new Date(`${date.value}T${to.value}`);
    if (!date.value) errors.date = 'Choose a date';
    if (!from.value) errors.from = 'Choose a start';
    if (!to.value) errors.to = 'Choose an end';
    if (!errors.from && !errors.to && end <= start) errors.to = 'End must be after start';
    if (Object.keys(errors).length) {
      showFieldErrors(form, errors);
      return null;
    }
    return { start, end };
  }

  function search() {
    const range = readRange();
    if (!range) return;
    const dayStart = new Date(`${date.value}T00:00`);
    dayStart.setHours(DAY_START_HOUR);
    const dayEnd = new Date(dayStart);
    dayEnd.setHours(DAY_END_HOUR);

    withBusy(submit, () =>
      loadInto(
        results,
        () =>
          Promise.all([
            api('/api/resources', {
              query: { start: range.start.toISOString(), end: range.end.toISOString(), type: type.value, min_capacity: capacity.value, q: text.value.trim() },
            }),
            api('/api/schedule', { query: { from: dayStart.toISOString(), to: dayEnd.toISOString() } }),
          ]),
        (el, [found, schedule]) => draw(el, found.items, schedule.slots, range, { dayStart: +dayStart, dayEnd: +dayEnd }),
      ),
    );
  }

  function draw(el, items, slots, range, day) {
    if (items.length === 0) {
      el.append(stateBox('Nothing matches these filters', 'Try a different type, fewer seats, or clear the search box.'));
      return;
    }
    const free = items.filter((r) => r.availability === 'available').length;
    const list = h('div', { class: 'res-list' });
    el.append(h('p', { class: 'muted' }, `${free} of ${items.length} free for ${fmtRange(range.start.toISOString(), range.end.toISOString())}`), h('div', { class: 'section' }, list));

    for (const r of items) {
      const mine = slots.filter((s) => s.resource_id === r.id);
      const canBook = r.availability === 'available';
      const book = h('button', { class: 'btn', type: 'button', disabled: !canBook }, canBook ? (r.requires_approval ? 'Request booking' : 'Book') : 'Not free');
      book.addEventListener('click', () => openBookDialog(r, range, search));
      list.append(
        h(
          'article',
          { class: 'res-card card' },
          h(
            'header',
            {},
            h('div', {}, h('h3', {}, r.name), h('p', { class: 'meta' }, `${TYPE_LABEL[r.type]}, ${r.location}${r.type === 'equipment' ? '' : `, up to ${r.capacity}`}`)),
            availabilityPill(r.availability),
          ),
          timeline({ slots: mine, ...day, want: { start: +range.start, end: +range.end } }),
          h(
            'div',
            { class: 'res-foot' },
            h('span', { class: 'small muted' }, r.requires_approval ? 'Needs admin approval' : 'Confirmed straight away'),
            book,
          ),
        ),
      );
    }
  }

  function openBookDialog(resource, range, refresh) {
    const rules = app.rules;
    const start = input('datetime-local', { value: toLocalInput(range.start), required: true, step: '300' });
    const end = input('datetime-local', { value: toLocalInput(range.end), required: true, step: '300' });
    const purpose = input('text', { maxlength: '200', placeholder: 'For example: group study for DBMS' });
    const formError = h('p', { class: 'form-error', role: 'alert' });
    const submitBtn = h('button', { class: 'btn', type: 'submit' }, resource.requires_approval ? 'Send request' : 'Confirm booking');

    const bookForm = h(
      'form',
      { class: 'form-grid', novalidate: true },
      h('p', { class: 'muted' }, `${resource.name}, ${resource.location}. ${resource.requires_approval ? 'An administrator reviews this request before it is confirmed.' : 'It is confirmed as soon as you submit.'}`),
      field({ label: 'Starts', name: 'start_time', control: start }),
      field({ label: 'Ends', name: 'end_time', control: end }),
      field({ label: 'Purpose', name: 'purpose', control: purpose }),
      formError,
      h('div', { class: 'dialog-actions' }, h('button', { class: 'btn secondary', type: 'button', onclick: () => dialog.close() }, 'Cancel'), submitBtn),
    );
    const dialog = openDialog(`Book ${resource.name}`, bookForm);

    bookForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      formError.textContent = '';
      const startDate = new Date(start.value);
      const endDate = new Date(end.value);
      const problems = checkBooking({ start: startDate, end: endDate, purpose: purpose.value }, rules);
      if (Object.keys(problems).length) {
        showFieldErrors(bookForm, problems);
        return;
      }
      clearFieldErrors(bookForm);

      await withBusy(submitBtn, async () => {
        try {
          const { booking } = await api('/api/bookings', {
            method: 'POST',
            body: { resource_id: resource.id, start_time: startDate.toISOString(), end_time: endDate.toISOString(), purpose: purpose.value.trim() },
          });
          toast(booking.status === 'pending' ? 'Request sent. You will see the decision under My bookings.' : 'Booking confirmed.');
          dialog.close();
          refresh();
        } catch (err) {
          if (!(err instanceof ApiError)) throw err;
          const extra = showFieldErrors(bookForm, err.details?.conflicting_slot ? null : err.details);
          const slot = err.details?.conflicting_slot;
          formError.textContent = slot
            ? `${err.message}: ${fmtRange(slot.start_time, slot.end_time)}. Pick a time outside that window.`
            : [err.message, ...extra].join(' ');
        }
      });
    });
    start.focus();
  }

  search();
}
