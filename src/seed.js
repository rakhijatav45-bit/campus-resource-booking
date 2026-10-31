import fs from 'node:fs';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import * as bookings from './services/bookings.js';
import * as resources from './services/resources.js';
import * as users from './services/users.js';

const config = loadConfig();
const password = process.env.SEED_PASSWORD || 'Demo@12345';

if (process.argv.includes('--reset')) {
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(config.dbPath + suffix, { force: true });
}

const db = openDb(config.dbPath);
if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) {
  console.log('Database already has data. Run `npm run seed:reset` to start over.');
  process.exit(0);
}

const admin = users.create(db, { name: 'Campus Admin', email: 'admin@campus.test', password, role: 'admin' });
const students = [
  ['Aarav Sharma', 'aarav@campus.test'],
  ['Diya Patel', 'diya@campus.test'],
  ['Rohan Verma', 'rohan@campus.test'],
].map(([name, email]) => users.create(db, { name, email, password }));

const catalogue = [
  ['Seminar Hall A', 'room', 'Administrative Block, ground floor', 120, 'Stage, PA system and projector.', true],
  ['Classroom 204', 'room', 'Academic Block, 2nd floor', 60, 'Whiteboard and ceiling projector.', false],
  ['Classroom 305', 'room', 'Academic Block, 3rd floor', 60, 'Whiteboard and ceiling projector.', false],
  ['Discussion Room 1', 'room', 'Central Library', 8, 'Glass-walled group study room.', false],
  ['Discussion Room 2', 'room', 'Central Library', 8, 'Glass-walled group study room.', false],
  ['Computer Lab 1', 'lab', 'CSE Department', 40, '40 workstations with Linux and Windows.', true],
  ['Electronics Lab', 'lab', 'ECE Department', 30, 'Oscilloscopes and bench power supplies.', true],
  ['Projector P1', 'equipment', 'Store room, Academic Block', 1, 'Portable HDMI projector with screen.', false],
  ['Projector P2', 'equipment', 'Store room, Academic Block', 1, 'Portable HDMI projector with screen.', false],
  ['Portable PA System', 'equipment', 'Student Activity Centre', 1, 'Speaker with two wireless microphones.', true],
].map(([name, type, location, capacity, description, requires_approval]) =>
  resources.create(db, { name, type, location, capacity, description, requires_approval }),
);
const byName = Object.fromEntries(catalogue.map((r) => [r.name, r]));

// A few bookings in the coming days so the UI has something to show.
function at(daysFromNow, hour, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

const [aarav, diya, rohan] = students;
const plan = [
  [aarav, 'Classroom 204', 1, [10, 0], [11, 30], 'DSA doubt-clearing session'],
  [diya, 'Computer Lab 1', 1, [14, 0], [16, 0], 'Mini-project demo practice'],
  [rohan, 'Discussion Room 1', 1, [11, 0], [12, 0], 'Group study for DBMS'],
  [aarav, 'Discussion Room 1', 1, [15, 0], [16, 30], 'Placement preparation'],
  [admin, 'Seminar Hall A', 2, [9, 30], [12, 30], 'Technical talk by alumni'],
  [diya, 'Projector P1', 2, [10, 0], [13, 0], 'Club orientation'],
  [rohan, 'Electronics Lab', 3, [13, 0], [15, 0], 'Circuit design practice'],
  [aarav, 'Classroom 305', 3, [9, 0], [10, 0], 'Mock interview round'],
];

for (const [user, name, day, [sh, sm], [eh, em], purpose] of plan) {
  bookings.create(
    db,
    user,
    { resource_id: byName[name].id, start_time: at(day, sh, sm), end_time: at(day, eh, em), purpose },
    { rules: { ...config.rules, minMinutes: 1 } },
  );
}

console.log(`Seeded ${students.length + 1} users, ${catalogue.length} resources and ${plan.length} bookings.`);
console.log('Sign in as admin@campus.test or aarav@campus.test (password from SEED_PASSWORD, default Demo@12345).');
db.close();
