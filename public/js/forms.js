import { field, h, icon, input } from './dom.js';

// A password input with a show/hide button.
export function passwordField({ label, name, autocomplete, hint, labelExtra }) {
  const control = input('password', { autocomplete, maxlength: '128' });
  const toggle = h('button', { class: 'pw-toggle', type: 'button', 'aria-label': 'Show password', 'aria-pressed': 'false' }, icon('eye'));
  toggle.addEventListener('click', () => {
    const show = control.type === 'password';
    control.type = show ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', String(show));
    toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    toggle.replaceChildren(icon(show ? 'eyeOff' : 'eye'));
    control.focus();
  });

  const wrapper = h('div', { class: 'pw' }, control, toggle);
  const el = field({ label, name, control: wrapper, hint });
  // field() names and labels the wrapper; point the label and error at the real input instead.
  const id = wrapper.id;
  wrapper.removeAttribute('id');
  wrapper.removeAttribute('name');
  wrapper.removeAttribute('aria-describedby');
  control.id = id;
  control.name = name;
  control.setAttribute('aria-describedby', `${id}-error`);
  if (labelExtra) {
    const row = h('div', { class: 'label-row' }, el.querySelector('label'), labelExtra);
    el.prepend(row);
  }
  return { el, input: control };
}

const CHECKS = [
  ['At least 8 characters', (v) => v.length >= 8],
  ['A letter', (v) => /[A-Za-z]/.test(v)],
  ['A number', (v) => /\d/.test(v)],
];

// A small checklist that ticks off as the person types.
export function passwordRules(control) {
  const items = CHECKS.map(([text, test]) => ({
    test,
    li: h('li', {}, h('span', { class: 'dot' }, icon('check', 11)), text),
  }));
  const update = () => items.forEach(({ li, test }) => li.classList.toggle('met', test(control.value)));
  control.addEventListener('input', update);
  update();
  return h('ul', { class: 'rules', 'aria-label': 'Password requirements' }, items.map((i) => i.li));
}

export const passwordProblem = (value) =>
  CHECKS.map(([, test]) => test(value)).every(Boolean) ? null : 'Use at least 8 characters, with a letter and a number';
