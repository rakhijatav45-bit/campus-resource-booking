import { ApiError, api } from '../api.js';
import { clearFieldErrors, field, h, input, showFieldErrors, withBusy } from '../dom.js';
import { authShell } from './auth.js';

export function renderForgot(root) {
  const email = input('email', { autocomplete: 'email', maxlength: '254', inputmode: 'email' });
  const formError = h('p', { class: 'form-error', role: 'alert' });
  const submit = h('button', { class: 'btn block large', type: 'submit' }, 'Send OTP');
  const card = h('div');

  const form = h(
    'form',
    { class: 'form-grid', novalidate: true },
    field({ label: 'Email', name: 'email', control: email, hint: 'Use the email you registered with.' }),
    formError,
    submit,
  );
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFieldErrors(form);
    formError.textContent = '';
    await withBusy(submit, async () => {
      try {
        await api('/api/auth/forgot-password', { method: 'POST', body: { email: email.value.trim() } });
        card.replaceChildren(
          h('h1', {}, 'Check your email'),
          h('p', { class: 'lead' }, `If an account exists for ${email.value.trim()}, a one-time reset code is on its way. It expires soon.`),
          h('p', { class: 'demo-note' }, 'If email delivery is not configured, the demo code appears in the server terminal.'),
          h('a', { class: 'btn large block', href: `#/reset?email=${encodeURIComponent(email.value.trim())}` }, 'Enter OTP'),
          h('p', { class: 'auth-switch' }, h('a', { href: '#/login' }, 'Back to sign in')),
        );
      } catch (err) {
        if (!(err instanceof ApiError)) throw err;
        const leftover = showFieldErrors(form, err.details);
        formError.textContent = err.details ? leftover.join(' ') : err.message;
      }
    });
  });

  card.append(
    h('h1', {}, 'Forgot your password?'),
    h('p', { class: 'lead' }, 'Enter your email and we will send you a one-time password reset code.'),
    form,
    h('p', { class: 'auth-switch' }, h('a', { href: '#/login' }, 'Back to sign in')),
  );
  authShell(root, card, { aside: false });
  email.focus();
}
