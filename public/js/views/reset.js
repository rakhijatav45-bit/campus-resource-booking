import { ApiError, api } from '../api.js';
import { clearFieldErrors, field, h, input, showFieldErrors, withBusy } from '../dom.js';
import { passwordField, passwordProblem, passwordRules } from '../forms.js';
import { authShell } from './auth.js';

export function renderReset(root) {
  const email = input('email', { autocomplete: 'email', maxlength: '254', inputmode: 'email' });
  email.value = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('email') ?? '';
  const code = input('text', { inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', pattern: '[0-9]{6}' });
  const card = h('div');

  const pw = passwordField({ label: 'New password', name: 'password', autocomplete: 'new-password' });
  const confirm = passwordField({ label: 'Confirm new password', name: 'confirm', autocomplete: 'new-password' });
  const formError = h('p', { class: 'form-error', role: 'alert' });
  const submit = h('button', { class: 'btn block large', type: 'submit' }, 'Save new password');
  const form = h('form', { class: 'form-grid', novalidate: true },
    field({ label: 'Email', name: 'email', control: email }),
    field({ label: '6-digit OTP', name: 'code', control: code, hint: 'Check your email for the reset code.' }),
    pw.el, passwordRules(pw.input), confirm.el, formError, submit);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFieldErrors(form);
    formError.textContent = '';
    const bad = passwordProblem(pw.input.value);
    if (bad) return void showFieldErrors(form, { password: bad });
    if (confirm.input.value !== pw.input.value) return void showFieldErrors(form, { confirm: 'The two passwords do not match' });

    await withBusy(submit, async () => {
      try {
        await api('/api/auth/reset-password', { method: 'POST', body: { email: email.value.trim(), code: code.value.trim(), password: pw.input.value } });
        card.replaceChildren(
          h('h1', {}, 'Password updated'),
          h('p', { class: 'lead' }, 'You can sign in with your new password now.'),
          h('a', { class: 'btn large block', href: '#/login' }, 'Go to sign in'),
        );
      } catch (err) {
        if (!(err instanceof ApiError)) throw err;
        if (err.code === 'invalid_or_expired_code') {
          formError.replaceChildren(err.message, ' ', h('a', { href: '#/forgot' }, 'Request a new code'));
        } else {
          const leftover = showFieldErrors(form, err.details);
          formError.textContent = err.details ? leftover.join(' ') : err.message;
        }
      }
    });
  });

  card.append(h('h1', {}, 'Enter your reset code'), h('p', { class: 'lead' }, 'Enter the OTP from your email and choose a new password.'), form);
  authShell(root, card, { aside: false });
  if (email.value) code.focus();
  else email.focus();
}
