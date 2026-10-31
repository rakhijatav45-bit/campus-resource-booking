import { ApiError, api, session } from './api.js';
import { h, icon, toast } from './dom.js';
import { renderAdmin } from './views/admin.js';
import { renderAuth } from './views/auth.js';
import { renderBookings } from './views/bookings.js';
import { renderDashboard } from './views/dashboard.js';
import { renderFind } from './views/find.js';
import { renderForgot } from './views/forgot.js';
import { renderLanding } from './views/landing.js';
import { renderReset } from './views/reset.js';

const root = document.getElementById('app');

const app = {
  user: null,
  rules: { maxDaysAhead: 30, minMinutes: 15, maxMinutes: 240 },
  signedIn(user) {
    this.user = user;
    go('/');
  },
};

const PUBLIC_ROUTES = {
  '/': ['CampusBook, campus resource booking', (main) => renderLanding(main, app)],
  '/login': ['Sign in', (main) => renderAuth(main, app, 'login')],
  '/register': ['Create account', (main) => renderAuth(main, app, 'register')],
  '/forgot': ['Forgot password', (main) => renderForgot(main, app)],
  '/reset': ['Choose a new password', (main) => renderReset(main, app)],
};

const PRIVATE_ROUTES = {
  '/': ['Dashboard', renderDashboard, 'home'],
  '/find': ['Find a slot', renderFind, 'search'],
  '/bookings': ['My bookings', renderBookings, 'calendar'],
  '/admin': ['Admin', renderAdmin, 'shield'],
};

function go(path) {
  const target = `#${path}`;
  if (window.location.hash === target) route();
  else window.location.hash = target;
}

function signOut() {
  session.clear();
  app.user = null;
  go('/');
}

const initial = (name) => name.trim().charAt(0).toUpperCase();

function publicLayout(path, content) {
  let landing = null;
  const onLanding = path === '/';
  const jump = (id) => () => landing?.go(id);
  const main = h('main', { id: 'main', tabindex: '-1' });
  root.replaceChildren(
    h('header', { class: 'pub-nav' }, h('div', { class: 'pub-nav-inner' },
      h('a', { class: 'brand', href: '#/' }, h('img', { class: 'brand-mark', src: '/favicon.svg', alt: '' }), 'CampusBook'),
      onLanding && h('nav', { class: 'pub-links', 'aria-label': 'Sections' },
        h('button', { type: 'button', onclick: jump('how') }, 'How it works'),
        h('button', { type: 'button', onclick: jump('features') }, 'Features'),
        h('button', { type: 'button', onclick: jump('faq') }, 'FAQ')),
      h('div', { class: 'pub-actions' },
        h('a', { class: 'btn on-dark', href: '#/login' }, 'Sign in'),
        h('a', { class: 'btn accent', href: '#/register' }, 'Create account')))),
    main,
  );
  landing = content(main);
}

function privateLayout(path, entry) {
  const links = Object.entries(PRIVATE_ROUTES).filter(([p]) => p !== '/admin' || app.user.role === 'admin');
  const link = (cls, p, [label, , iconName]) =>
    h('a', { class: cls, href: `#${p}`, 'aria-current': p === path ? 'page' : null }, icon(iconName, cls === 'side-link' ? 20 : 22), h('span', {}, label));
  const main = h('main', { id: 'main', class: 'content', tabindex: '-1' });

  root.replaceChildren(
    h('div', { class: 'shell' },
      h('aside', { class: 'sidebar' },
        h('a', { class: 'brand', href: '#/' }, h('img', { class: 'brand-mark', src: '/favicon.svg', alt: '' }), 'CampusBook'),
        h('nav', { class: 'side-nav', 'aria-label': 'Main' }, links.map(([p, e]) => link('side-link', p, e))),
        h('div', { class: 'side-user' },
          h('div', { class: 'who-row' }, h('span', { class: 'avatar', 'aria-hidden': 'true' }, initial(app.user.name)),
            h('div', {}, h('strong', {}, app.user.name), h('span', {}, app.user.role === 'admin' ? 'Administrator' : 'Student'))),
          h('button', { class: 'btn on-dark small', type: 'button', onclick: signOut }, icon('logout', 16), 'Sign out'))),
      h('div', {},
        h('header', { class: 'mobile-top' },
          h('a', { class: 'brand', href: '#/' }, h('img', { class: 'brand-mark', src: '/favicon.svg', alt: '' }), 'CampusBook'),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Sign out', onclick: signOut }, icon('logout', 22))),
        main),
      h('nav', { class: 'tabbar', 'aria-label': 'Main' }, links.map(([p, e]) => link('', p, e)))),
  );
  entry[1](main, app);
}

function route() {
  const [rawPath] = (window.location.hash.slice(1) || '/').split('?');
  const path = rawPath || '/';
  const authOnly = ['/login', '/register', '/forgot'];

  if (path === '/reset' || (!app.user && PUBLIC_ROUTES[path])) {
    const entry = PUBLIC_ROUTES[path];
    document.title = `${entry[0]} | CampusBook`;
    publicLayout(path, entry[1]);
  } else if (!app.user) {
    go('/login');
    return;
  } else if (authOnly.includes(path)) {
    go('/');
    return;
  } else {
    const resolved = PRIVATE_ROUTES[path] ? path : '/';
    const entry = PRIVATE_ROUTES[resolved];
    document.title = `${entry[0]} | CampusBook`;
    privateLayout(resolved, entry);
  }
  document.getElementById('main')?.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);
window.addEventListener('session-expired', () => {
  app.user = null;
  toast('Your session expired. Please sign in again.', 'error');
  go('/login');
});

async function start() {
  try {
    app.rules = (await api('/api/config')).booking_rules;
    if (session.token) app.user = (await api('/api/auth/me')).user;
  } catch (err) {
    if (!(err instanceof ApiError) || err.status === 0) {
      root.replaceChildren(h('main', { id: 'main', class: 'content' }, h('div', { class: 'state error', role: 'alert' }, h('strong', {}, 'CampusBook cannot reach its server'), h('p', {}, err.message), h('button', { class: 'btn secondary', type: 'button', onclick: () => window.location.reload() }, 'Try again'))));
      return;
    }
  }
  route();
}

start();
