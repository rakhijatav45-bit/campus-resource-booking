import { field, h, input, openDialog, withBusy } from '../dom.js';

export function askRejectReason(booking, onConfirm) {
  const reason = input('text', { maxlength: '300', placeholder: 'For example: hall is under maintenance' });
  const submit = h('button', { class: 'btn solid-danger', type: 'submit' }, 'Reject request');
  const form = h(
    'form',
    { class: 'form-grid', novalidate: true },
    h('p', {}, `${booking.resource.name} for ${booking.user.name}.`),
    field({ label: 'Reason (optional)', name: 'reason', control: reason, hint: 'The student can see this note.' }),
    h('div', { class: 'dialog-actions' }, h('button', { class: 'btn secondary', type: 'button', onclick: () => dialog.close() }, 'Back'), submit),
  );
  const dialog = openDialog('Reject this request?', form);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await withBusy(submit, () => onConfirm(reason.value.trim()));
    dialog.close();
  });
}
