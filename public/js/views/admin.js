import { api } from '../api.js';
import { loadInto, mountBookingList, stateBox } from '../components.js';
import { TYPE_LABEL, clearFieldErrors, confirmDialog, field, h, input, openDialog, select, showFieldErrors, toast, withBusy } from '../dom.js';

export function renderAdmin(root, app) {
  if (app.user.role !== 'admin') {
    root.append(stateBox('Administrators only', 'Your account does not have access to this page.', h('a', { class: 'btn secondary', href: '#/' }, 'Back to dashboard')));
    return;
  }

  const tabs = [
    ['requests', 'Requests'],
    ['bookings', 'All bookings'],
    ['resources', 'Resources'],
  ];
  const panel = h('div', { role: 'tabpanel' });
  const tabBar = h('div', { class: 'tabs', role: 'tablist' });
  let active = window.location.hash.includes('tab=') ? new URLSearchParams(window.location.hash.split('?')[1]).get('tab') : 'requests';
  if (!tabs.some(([id]) => id === active)) active = 'requests';

  root.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Administration'), h('p', {}, 'Decide on requests, oversee bookings and manage resources.'))), tabBar, panel);
  show(active);

  function show(id) {
    active = id;
    tabBar.replaceChildren(
      ...tabs.map(([tabId, label]) =>
        h('button', { type: 'button', role: 'tab', 'aria-selected': String(tabId === id), onclick: () => show(tabId) }, label),
      ),
    );
    panel.replaceChildren();
    if (id === 'requests') requests();
    if (id === 'bookings') allBookings();
    if (id === 'resources') resourcesTab();
  }

  function requests() {
    const box = h('div');
    panel.append(box);
    mountBookingList(box, {
      query: () => ({ scope: 'all', status: 'pending', upcoming: true }),
      showUser: true,
      admin: true,
      emptyTitle: 'No requests waiting',
      emptyText: 'New requests for approval-only resources will appear here.',
    }).reload();
  }

  async function allBookings() {
    const status = select([['', 'Any status'], ['pending', 'Pending'], ['confirmed', 'Confirmed'], ['cancelled', 'Cancelled'], ['rejected', 'Rejected']]);
    const resource = select([['', 'All resources']]);
    const box = h('div');
    const list = mountBookingList(box, {
      query: () => ({ scope: 'all', status: status.value, resource_id: resource.value }),
      showUser: true,
      admin: true,
      emptyTitle: 'No bookings found',
      emptyText: 'Try a different status or resource.',
    });
    panel.append(
      h('div', { class: 'filters card panel' }, field({ label: 'Status', name: 'status', control: status }), field({ label: 'Resource', name: 'resource', control: resource })),
      h('div', { class: 'section' }, box),
    );
    status.addEventListener('change', () => list.reload());
    resource.addEventListener('change', () => list.reload());
    try {
      const { items } = await api('/api/resources', { query: { include_inactive: true } });
      for (const r of items) resource.append(h('option', { value: r.id }, r.name));
    } catch {
      /* the resource filter is a convenience; the list below reports real errors */
    }
    list.reload();
  }

  function resourcesTab() {
    const box = h('div');
    const add = h('button', { class: 'btn', type: 'button', onclick: () => editResource(null) }, 'Add resource');
    panel.append(h('div', { class: 'page-head' }, h('p', { class: 'muted' }, 'Deactivated resources stay in history but cannot be booked.'), add), box);
    reload();

    function reload() {
      loadInto(box, () => api('/api/resources', { query: { include_inactive: true } }), (el, data) => {
        if (data.items.length === 0) {
          el.append(stateBox('No resources yet', 'Add the first room, lab or piece of equipment.'));
          return;
        }
        const rows = data.items.map((r) =>
          h(
            'tr',
            {},
            h('td', {}, h('strong', {}, r.name), h('div', { class: 'small muted' }, r.location)),
            h('td', {}, TYPE_LABEL[r.type]),
            h('td', {}, String(r.capacity)),
            h('td', {}, r.requires_approval ? 'Approval needed' : 'Instant'),
            h('td', {}, h('span', { class: `pill ${r.is_active ? 'available' : 'inactive'}` }, r.is_active ? 'Active' : 'Deactivated')),
            h(
              'td',
              {},
              h(
                'div',
                { class: 'row-actions' },
                h('button', { class: 'btn small secondary', type: 'button', onclick: () => editResource(r) }, 'Edit'),
                r.is_active
                  ? h('button', { class: 'btn small danger', type: 'button', onclick: () => toggle(r, false) }, 'Deactivate')
                  : h('button', { class: 'btn small secondary', type: 'button', onclick: () => toggle(r, true) }, 'Reactivate'),
              ),
            ),
          ),
        );
        el.append(
          h(
            'div',
            { class: 'card table-wrap' },
            h(
              'table',
              {},
              h('thead', {}, h('tr', {}, ...['Resource', 'Type', 'Capacity', 'Booking', 'Status', ''].map((t) => h('th', { scope: 'col' }, t)))),
              h('tbody', {}, rows),
            ),
          ),
        );
      });
    }

    async function toggle(r, makeActive) {
      if (!makeActive) {
        const ok = await confirmDialog({
          title: `Deactivate ${r.name}?`,
          message: 'Nobody can make new bookings for it. Existing bookings stay as they are.',
          confirmLabel: 'Deactivate',
          danger: true,
        });
        if (!ok) return;
      }
      try {
        await api(`/api/resources/${r.id}`, makeActive ? { method: 'PATCH', body: { is_active: true } } : { method: 'DELETE' });
        toast(makeActive ? 'Resource reactivated' : 'Resource deactivated');
        reload();
      } catch (err) {
        toast(err.message, 'error');
      }
    }

    function editResource(existing) {
      const name = input('text', { maxlength: '80', value: existing?.name });
      const type = select(Object.entries(TYPE_LABEL), { value: existing?.type });
      const location = input('text', { maxlength: '120', value: existing?.location });
      const capacity = input('number', { min: '1', max: '10000', value: existing?.capacity ?? '' });
      const description = h('textarea', { rows: '3', maxlength: '500' }, existing?.description ?? '');
      const approval = h('input', { type: 'checkbox', id: 'needs-approval', name: 'requires_approval', checked: existing?.requires_approval });
      const formError = h('p', { class: 'form-error', role: 'alert' });
      const save = h('button', { class: 'btn', type: 'submit' }, existing ? 'Save changes' : 'Add resource');

      const form = h(
        'form',
        { class: 'form-grid', novalidate: true },
        field({ label: 'Name', name: 'name', control: name }),
        field({ label: 'Type', name: 'type', control: type }),
        field({ label: 'Location', name: 'location', control: location }),
        field({ label: existing?.type === 'equipment' ? 'Units' : 'Capacity', name: 'capacity', control: capacity }),
        field({ label: 'Description', name: 'description', control: description }),
        h('div', { class: 'field check' }, approval, h('label', { for: 'needs-approval' }, 'Bookings need administrator approval')),
        formError,
        h('div', { class: 'dialog-actions' }, h('button', { class: 'btn secondary', type: 'button', onclick: () => dialog.close() }, 'Cancel'), save),
      );
      const dialog = openDialog(existing ? `Edit ${existing.name}` : 'Add a resource', form);

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearFieldErrors(form);
        formError.textContent = '';
        const body = {
          name: name.value.trim(),
          type: type.value,
          location: location.value.trim(),
          capacity: capacity.value === '' ? undefined : Number(capacity.value),
          description: description.value.trim(),
          requires_approval: approval.checked,
        };
        await withBusy(save, async () => {
          try {
            await api(existing ? `/api/resources/${existing.id}` : '/api/resources', { method: existing ? 'PATCH' : 'POST', body });
            toast(existing ? 'Changes saved' : 'Resource added');
            dialog.close();
            reload();
          } catch (err) {
            const rest = showFieldErrors(form, err.details);
            formError.textContent = err.details ? rest.join(' ') : err.message;
          }
        });
      });
      name.focus();
    }
  }
}
