# API reference

Base URL: `http://localhost:3000/api`. Requests and responses are JSON. Protected endpoints need the header `Authorization: Bearer <token>`, where the token comes from `/auth/register` or `/auth/login`.

Timestamps are ISO 8601 and must include a timezone, for example `2026-11-03T09:00:00Z` or `2026-11-03T14:30:00+05:30`. The server stores and returns UTC.

## Errors

Every error has the same shape. Validation errors list each bad field under `details`.

```json
{
  "error": {
    "code": "validation_error",
    "message": "Some fields are invalid",
    "details": {
      "purpose": "purpose is required",
      "end_time": "end_time must be after start_time"
    }
  }
}
```

| Status | Code examples | Meaning |
|---|---|---|
| 400 | `validation_error`, `invalid_json` | The request is malformed or breaks a rule |
| 401 | `unauthenticated`, `invalid_credentials` | No valid token, or wrong email or password |
| 403 | `forbidden` | Signed in, but not allowed to do this |
| 404 | `not_found` | Unknown route, resource or booking |
| 405 | `method_not_allowed` | The path exists but not for this method |
| 409 | `booking_conflict`, `resource_unavailable`, `invalid_transition`, `booking_ended`, `email_taken`, `resource_exists` | The request conflicts with current state |
| 413 / 415 | `payload_too_large`, `unsupported_media_type` | Body over 100 KB, or not `application/json` |
| 429 | `too_many_attempts` | Too many failed sign-ins. See the `Retry-After` header |
| 500 | `internal_error` | Unexpected. Details are only in the server log |

## Authentication

### POST /auth/register

Creates a student account and signs it in.

```json
{ "name": "Meera Joshi", "email": "meera@campus.test", "password": "Strong123" }
```

Response `201`:

```json
{
  "user": { "id": 5, "name": "Meera Joshi", "email": "meera@campus.test", "role": "student" },
  "token": "eyJhbGciOi..."
}
```

Rules: name 2 to 80 characters, a valid email, password 8 to 128 characters with at least one letter and one number. A duplicate email returns `409 email_taken`.

### POST /auth/login

```json
{ "email": "diya@campus.test", "password": "Demo@12345" }
```

Response `200` has the same shape as register. Ten failed attempts for the same address and email within 15 minutes return `429`.

### POST /auth/forgot-password

```json
{ "email": "diya@campus.test" }
```

Always returns `200` with the same message, whether or not the email has an account, so the endpoint cannot be used to find out who is registered:

```json
{ "message": "If an account exists for that email, a reset code has been sent." }
```

For a real account the server creates a six-digit, one-time code. Only a keyed hash is stored, and the code expires after `RESET_CODE_MINUTES`. The configured SMTP mailer sends it by email; without SMTP, it is printed in the server terminal for local demos. Requesting a new code invalidates the older one. Five requests per email and address in 15 minutes are allowed, then `429`.

### POST /auth/reset-password

```json
{ "email": "diya@campus.test", "code": "123456", "password": "NewPass456" }
```

Response `200`: `{ "message": "Password updated. You can sign in with it now." }`. The password follows the same rules as registration. An unknown, used or expired code returns `400 invalid_or_expired_code`. Ten code attempts per email and address in 15 minutes are allowed, then `429`.

### GET /auth/me

Returns `{ "user": { ... } }` for the token's owner.

### GET /config

Public. Returns `{ "booking_rules": { "maxDaysAhead": 30, "minMinutes": 15, "maxMinutes": 240 } }`.

## Resources

### GET /resources

Query parameters, all optional:

| Parameter | Meaning |
|---|---|
| `type` | `room`, `lab` or `equipment` |
| `min_capacity` | Minimum seats |
| `q` | Text search on name and location |
| `start`, `end` | Give both to get an `availability` value for that range |
| `available_only` | `true` to return only resources free for `start` to `end` |
| `include_inactive` | `true` to include deactivated resources (admin only) |

Example: `GET /resources?type=lab&start=2026-11-03T09:30:00Z&end=2026-11-03T10:00:00Z`

```json
{
  "items": [
    {
      "id": 6,
      "name": "Computer Lab 1",
      "type": "lab",
      "location": "CSE Department",
      "capacity": 40,
      "description": "40 workstations with Linux and Windows.",
      "requires_approval": true,
      "is_active": true,
      "created_at": "2026-10-29T19:03:31.661Z",
      "updated_at": "2026-10-29T19:03:31.661Z",
      "availability": "booked"
    }
  ],
  "total": 1
}
```

`availability` is `available`, `booked`, `inactive`, or `null` when no range was given.

### GET /resources/:id

Returns `{ "resource": { ... } }`. Students get `404` for deactivated resources.

### POST /resources (admin)

```json
{
  "name": "Seminar Hall B",
  "type": "room",
  "location": "Administrative Block",
  "capacity": 100,
  "description": "Large hall",
  "requires_approval": true
}
```

Response `201` with `{ "resource": { ... } }`. The same name at the same location returns `409 resource_exists`.

### PATCH /resources/:id (admin)

Send any of the fields above plus `is_active`. At least one field is required. Use `{ "is_active": true }` to reactivate.

### DELETE /resources/:id (admin)

Deactivates the resource (soft delete) and returns it. Repeating the call is harmless. New bookings are refused with `409 resource_unavailable`. Existing bookings are left alone.

### GET /schedule

Busy slots for a time window, for drawing availability. It contains no names or purposes.

Query: `from` and `to` (required, at most 8 days apart), `resource_id` (optional).

```json
{
  "slots": [
    { "resource_id": 6, "start_time": "2026-11-03T09:00:00.000Z", "end_time": "2026-11-03T11:00:00.000Z", "status": "pending", "mine": true }
  ]
}
```

## Bookings

### POST /bookings

```json
{
  "resource_id": 6,
  "start_time": "2026-11-03T09:00:00Z",
  "end_time": "2026-11-03T11:00:00Z",
  "purpose": "Lab revision"
}
```

Response `201`. The status is `pending` when the resource needs approval, otherwise `confirmed`. Admins' own bookings are always `confirmed`.

```json
{
  "booking": {
    "id": 11,
    "status": "pending",
    "start_time": "2026-11-03T09:00:00.000Z",
    "end_time": "2026-11-03T11:00:00.000Z",
    "purpose": "Lab revision",
    "decision_note": null,
    "created_at": "2026-10-29T19:05:06.534Z",
    "updated_at": "2026-10-29T19:05:06.534Z",
    "resource": { "id": 6, "name": "Computer Lab 1", "type": "lab", "location": "CSE Department" },
    "user": { "id": 3, "name": "Diya Patel" }
  }
}
```

Rules:

- `start_time` must be in the future and no more than 30 days ahead.
- `end_time` must be after `start_time`. The length must be 15 minutes to 4 hours.
- The resource must exist (`404`) and be active (`409 resource_unavailable`).
- The slot must not overlap an active booking (`409 booking_conflict`). Back-to-back slots are allowed.

Conflict response `409`:

```json
{
  "error": {
    "code": "booking_conflict",
    "message": "This resource is already booked for part of that time",
    "details": { "conflicting_slot": { "start_time": "2026-11-03T09:00:00.000Z", "end_time": "2026-11-03T11:00:00.000Z" } }
  }
}
```

### GET /bookings

| Parameter | Meaning |
|---|---|
| `scope` | `mine` (default) or `all`. `all` is admin only and returns `403` otherwise |
| `status` | `pending`, `confirmed`, `rejected` or `cancelled` |
| `upcoming` | `true` for active bookings that have not ended, soonest first |
| `resource_id` | Filter by resource |
| `from`, `to` | Bookings that end after `from` and start before `to` |
| `limit`, `offset` | Pagination. `limit` is 1 to 100, default 50 |

Response: `{ "items": [ ...bookings ], "total": 12, "limit": 50, "offset": 0 }`. Without `upcoming`, newest first. Requester emails appear only for admins.

### GET /bookings/:id

The owner or an admin. Anyone else gets `403`.

### POST /bookings/:id/cancel

The owner or an admin. Allowed from `pending` or `confirmed`, and only before the booking ends.

### POST /bookings/:id/approve (admin)

Allowed from `pending`.

### POST /bookings/:id/reject (admin)

Allowed from `pending`. Optional body: `{ "reason": "Hall is under maintenance" }`, shown to the student.

### Status changes are idempotent

| Current status | cancel | approve | reject |
|---|---|---|---|
| pending | cancelled | confirmed | rejected |
| confirmed | cancelled | `200`, unchanged | `409` |
| cancelled | `200`, unchanged | `409` | `409` |
| rejected | `409` | `409` | `200`, unchanged |

Repeating a request that already took effect returns `200` with the booking as it is and does not touch `updated_at`. A move that is not possible returns `409 invalid_transition`.
