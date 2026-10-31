# Design decisions

## Plain Node, no framework

The project needs Node 22.13 or newer and Nodemailer for SMTP delivery. `node:sqlite` gives a real SQL database, `node:crypto` handles password hashing and tokens, and `node:test` runs the tests. The router, validation and error handling are small files in `src/lib`, easy to read end to end.

The trade-off is that a larger team would normally pick Express or Fastify and a library for validation. The structure here (routes call services, services hold the rules) would carry over to either.

## Layers

- **Routes** read the request and shape the response. No business rules.
- **Services** hold the rules: validation, permissions on a booking, status changes, the overlap check.
- **Database** holds the constraints and the overlap trigger, so correctness does not depend on every caller being careful.

## Booking status

| From | Allowed next states |
|---|---|
| pending | confirmed (admin approves), rejected (admin rejects), cancelled (owner or admin) |
| confirmed | cancelled (owner or admin) |
| cancelled | none |
| rejected | none |

`pending` and `confirmed` both hold the slot. If pending requests did not hold it, two students could request the same hall and the admin would have to pick a winner after the fact.

## Concurrency

The booking check and insert run inside `BEGIN IMMEDIATE`. SQLite then allows a single writer, and a competing request waits (up to 5 seconds) for the lock and re-checks after the first one commits. The trigger is the backstop for anything that skips the service layer. See `test/bookings.test.js` for the 12-requests-at-once test and the second-connection test.

## Idempotent actions

Repeating a cancel or approve returns the current booking with `200` and changes nothing. An action that cannot apply returns `409`. A retry after a dropped connection is therefore always safe.

## Permissions

| Action | Student | Admin |
|---|---|---|
| Browse and search resources | yes | yes, plus deactivated ones |
| Create, edit, deactivate resources | no | yes |
| Create a booking | yes | yes (confirmed immediately) |
| View or cancel a booking | own only | any |
| Approve or reject | no | yes |
| List everyone's bookings | no | yes |

The role is read from the database on every request, not from the token, so changing a user's role takes effect at once.

## Security notes

- Passwords: scrypt with a random salt, compared in constant time. A dummy hash is checked for unknown emails so response time does not reveal which emails exist.
- Tokens: HS256 JWT with an expiry, verified with a constant-time comparison, and the algorithm in the header is checked.
- Sign-in lockout after 10 failures per address and email.
- Password reset: the six-digit OTP is stored as a keyed HMAC, works once, expires after 30 minutes, and a newer request cancels older codes. The request endpoint answers identically for unknown emails, and code attempts are rate-limited.
- All SQL uses bound parameters. User text is searched with `LIKE` after escaping `%` and `_`.
- The UI builds the page with `textContent` and never inserts user text as HTML. The Content-Security-Policy forbids inline scripts and styles.
- Request bodies are capped at 100 KB. Unexpected errors are logged on the server and return a generic message.
- Static files are served from `public/` only, and path traversal attempts return 404.

## The schedule endpoint

Students need to see when a resource is busy, but not who booked it. `/schedule` returns times and a `mine` flag only. A conflict response also reveals just the clashing time window.

## Frontend

Plain JavaScript modules with hash routing, so there is nothing to build. Signed-out visitors see a public home page; signed-in users get an app layout with a sidebar on laptops and a bottom tab bar on phones. The day timeline (one coloured strip per resource) is the main visual idea and is reused on the home page, dashboard and search results. The browser checks the same rules as the server (taken from `/api/config`) to give quick feedback, but the server is always the authority. Forms keep what was typed when the server rejects them, buttons are disabled while a request is in flight, and every list has loading, error with retry, and empty states.
