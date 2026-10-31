export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

// Builds elements with textContent only, so user-supplied text can never become markup.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  let value;
  for (const [key, val] of Object.entries(attrs ?? {})) {
    if (val === null || val === undefined || val === false) continue;
    if (key === 'class') el.className = val;
    else if (key === 'value') value = val;
    else if (key.startsWith('on') && typeof val === 'function') el.addEventListener(key.slice(2), val);
    else el.setAttribute(key, val === true ? '' : val);
  }
  append(el, children);
  if (value !== undefined) el.value = value;
  return el;
}

const pad = (n) => String(n).padStart(2, '0');
export const toDateInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const toTimeInput = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const toLocalInput = (d) => `${toDateInput(d)}T${toTimeInput(d)}`;

const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
export const fmtTime = (iso) => timeFormat.format(new Date(iso));
export const fmtDay = (iso) => dayFormat.format(new Date(iso));

export function fmtRange(startIso, endIso) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (start.toDateString() === end.toDateString()) {
    return `${fmtDay(startIso)}, ${fmtTime(startIso)} to ${fmtTime(endIso)}`;
  }
  return `${fmtDay(startIso)} ${fmtTime(startIso)} to ${fmtDay(endIso)} ${fmtTime(endIso)}`;
}

export const TYPE_LABEL = { room: 'Room', lab: 'Lab', equipment: 'Equipment' };

export function toast(message, kind = 'success') {
  const el = h('div', { class: `toast ${kind}`, role: kind === 'error' ? 'alert' : 'status' }, message);
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), 4500);
}

export function openDialog(title, body) {
  const dialog = h(
    'dialog',
    { class: 'dialog', 'aria-labelledby': 'dialog-title' },
    h(
      'div',
      { class: 'dialog-head' },
      h('h2', { id: 'dialog-title' }, title),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: () => dialog.close() }, '\u00d7'),
    ),
    h('div', { class: 'dialog-body' }, body),
  );
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

export function confirmDialog({ title, message, confirmLabel, danger = false }) {
  return new Promise((resolve) => {
    let answer = false;
    const dialog = openDialog(title, [
      h('p', {}, message),
      h(
        'div',
        { class: 'dialog-actions' },
        h('button', { class: 'btn secondary', type: 'button', onclick: () => dialog.close() }, 'Keep it'),
        h(
          'button',
          {
            class: `btn ${danger ? 'solid-danger' : ''}`,
            type: 'button',
            onclick: () => {
              answer = true;
              dialog.close();
            },
          },
          confirmLabel,
        ),
      ),
    ]);
    dialog.addEventListener('close', () => resolve(answer));
  });
}

let fieldCounter = 0;
export function field({ label, name, control, hint }) {
  fieldCounter += 1;
  const id = `field-${name}-${fieldCounter}`;
  control.id = id;
  control.name = name;
  const error = h('p', { class: 'field-error', id: `${id}-error`, 'data-error-for': name });
  control.setAttribute('aria-describedby', `${id}-error`);
  return h('div', { class: 'field' }, h('label', { for: id }, label), control, hint && h('p', { class: 'field-hint' }, hint), error);
}

export function input(type, attrs = {}) {
  return h('input', { type, ...attrs });
}

export function select(options, attrs = {}) {
  return h('select', attrs, options.map(([value, label]) => h('option', { value }, label)));
}

export function clearFieldErrors(form) {
  for (const el of form.querySelectorAll('[data-error-for]')) el.textContent = '';
  for (const el of form.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
}

// Puts each message next to its field. Returns messages that matched no field.
export function showFieldErrors(form, errors) {
  clearFieldErrors(form);
  const unmatched = [];
  for (const [name, message] of Object.entries(errors ?? {})) {
    const slot = form.querySelector(`[data-error-for="${name}"]`);
    const control = form.elements[name];
    if (!slot) {
      unmatched.push(message);
      continue;
    }
    slot.textContent = message;
    control?.setAttribute('aria-invalid', 'true');
  }
  return unmatched;
}

export async function withBusy(button, work) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Please wait';
  try {
    return await work();
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONS = {
  home: ['M3 11l9-8 9 8', 'M5 10v10h5v-6h4v6h5V10'],
  search: ['M11 4a7 7 0 100 14 7 7 0 000-14z', 'M21 21l-5-5'],
  calendar: ['M4 6h16v14H4z', 'M4 10h16', 'M8 3v4', 'M16 3v4'],
  shield: ['M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', 'M9 12l2 2 4-4'],
  logout: ['M9 4H5v16h4', 'M16 8l4 4-4 4', 'M20 12H9'],
  eye: ['M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z', 'M12 9a3 3 0 100 6 3 3 0 000-6z'],
  eyeOff: ['M3 3l18 18', 'M10.6 6.1A9.8 9.8 0 0112 6c6 0 10 6 10 6a17 17 0 01-3 3.6', 'M6.5 7.5C3.8 9.3 2 12 2 12s4 7 10 7c1.6 0 3-.4 4.3-1', 'M9.9 9.9a3 3 0 004.2 4.2'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  clock: ['M12 4a8 8 0 100 16 8 8 0 000-16z', 'M12 8v4l3 2'],
  plus: ['M12 5v14', 'M5 12h14'],
  info: ['M12 4a8 8 0 100 16 8 8 0 000-16z', 'M12 11v5', 'M12 8h.01'],
};

export function icon(name, size = 20) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [key, value] of Object.entries({
    viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor',
    'stroke-width': 1.9, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'icon',
  })) svg.setAttribute(key, value);
  for (const d of ICONS[name]) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}
