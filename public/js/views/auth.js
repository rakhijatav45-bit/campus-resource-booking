import { api, session } from '../api.js';
import { campusBoard } from '../components.js';
import { clearFieldErrors, field, h, icon, input, showFieldErrors, withBusy } from '../dom.js';
import { passwordField, passwordProblem, passwordRules } from '../forms.js';

function asideBoard() {
  const start = new Date();
  start.setHours(8, 0, 0, 0);
  const at = (hour, minute = 0) => new Date(new Date(start).setHours(hour, minute, 0, 0)).toISOString();
  const slot = (a, b, extra = {}) => ({ start_time: at(...a), end_time: at(...b), status: 'confirmed', mine: false, ...extra });
  return campusBoard({
    rows: [
      { name: 'Classroom 204', slots: [slot([10], [11, 30], { mine: true }), slot([14], [15])] },
      { name: 'Computer Lab 1', slots: [slot([9], [11]), slot([13], [15, 30], { status: 'pending' })] },
      { name: 'Projector P1', slots: [slot([11], [13])] },
    ],
    dayStart: +start,
    dayEnd: +new Date(new Date(start).setHours(20, 0, 0, 0)),
    nowMs: 0,
  });
}

export function authShell(root, content, { aside = true } = {}) {
  root.append(
    h(
      'div',
      { class: 'auth-page' },
      aside &&
        h(
          'aside',
          { class: 'auth-aside' },
          h('h2', {}, 'Know what is free before you walk over.'),
          h('div', { class: 'mini' }, asideBoard()),
          h('ul', {}, ['See a day timeline for every room, lab and projector', 'Book in under a minute', 'Overlapping bookings are impossible'].map((t) => h('li', {}, t))),
        ),
      h('div', { class: 'auth-main' }, h('div', { class: 'auth-card' }, content)),
    ),
  );
}

export function renderAuth(root, app, mode) {
  const signingIn = mode === 'login';
  const name = input('text', { autocomplete: 'name', maxlength: '80' });
  const email = input('email', { autocomplete: 'email', maxlength: '254', inputmode: 'email' });
  const pw = passwordField({
    label: 'Password',
    name: 'password',
    autocomplete: signingIn ? 'current-password' : 'new-password',
    labelExtra: signingIn ? h('a', { href: '#/forgot' }, 'Forgot password?') : null,
  });
  const confirm = signingIn ? null : passwordField({ label: 'Confirm password', name: 'confirm', autocomplete: 'new-password' });
  const formError = h('p', { class: 'form-error', role: 'alert' });
  const submit = h('button', { class: 'btn block large', type: 'submit' }, signingIn ? 'Sign in' : 'Create account');

  const form = h(
    'form',
    { class: 'form-grid', novalidate: true },
    !signingIn && field({ label: 'Full name', name: 'name', control: name }),
    field({ label: 'Email', name: 'email', control: email }),
    pw.el,
    !signingIn && passwordRules(pw.input),
    confirm && confirm.el,
    formError,
    submit,
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFieldErrors(form);
    formError.textContent = '';

    if (!signingIn) {
      const problems = {};
      if (name.value.trim().length < 2) problems.name = 'Enter your full name';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) problems.email = 'Enter a valid email address';
      const bad = passwordProblem(pw.input.value);
      if (bad) problems.password = bad;
      else if (confirm.input.value !== pw.input.value) problems.confirm = 'The two passwords do not match';
      if (Object.keys(problems).length) {
        showFieldErrors(form, problems);
        return;
      }
    }

    const body = { email: email.value.trim(), password: pw.input.value };
    if (!signingIn) body.name = name.value.trim();
    await withBusy(submit, async () => {
      try {
        const result = await api(signingIn ? '/api/auth/login' : '/api/auth/register', { method: 'POST', body });
        session.set(result.token);
        app.signedIn(result.user);
      } catch (err) {
        // Keep what the person typed and show only what went wrong.
        const leftover = showFieldErrors(form, err.details);
        formError.textContent = err.details ? leftover.join(' ') : err.message;
      }
    });
  });

  authShell(
    root,
    [
      h('h1', {}, signingIn ? 'Welcome back' : 'Create your account'),
      h('p', { class: 'lead' }, signingIn ? 'Sign in to see what is free and manage your bookings.' : 'It takes under a minute. You can book straight after.'),
      form,
      h(
        'p',
        { class: 'auth-switch' },
        signingIn ? 'New to CampusBook? ' : 'Already have an account? ',
        h('a', { href: signingIn ? '#/register' : '#/login' }, signingIn ? 'Create an account' : 'Sign in'),
      ),
      signingIn && h('p', { class: 'demo-note' }, icon('info', 16), ' Trying the demo? Run the seed script, then use the demo accounts listed in the README.'),
    ],
  );
  (signingIn ? email : name).focus();
}
