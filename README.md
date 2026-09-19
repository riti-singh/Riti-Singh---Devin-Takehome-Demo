# Refund Operations (Milestone 1)

A small internal tool for reviewing customer refund requests: a queue, a detail
view, approve/reject with a **required reason**, and an **append-only audit
trail**. Deliberately time-boxed and minimal — one tool, not a framework.

## Stack

TypeScript + Node, Express with server-rendered HTML (no SPA build), SQLite via
`better-sqlite3` (hand-written schema + synthetic seed), Zod for request-body
validation, Vitest for unit tests, Playwright for browser tests.

## One-command setup

```bash
npm run setup     # install deps, install the Playwright chromium browser, seed data/refunds.db
npm start         # http://localhost:3000
```

Individual commands:

```bash
npm run seed        # (re)create and seed data/refunds.db with synthetic data
npm start           # run the server (PORT, DATABASE_FILE env vars supported)
npm test            # Vitest unit/integration tests
npm run test:e2e    # Playwright browser tests (starts its own server on :3100)
npm run test:all    # typecheck + unit + browser tests
```

Requires Node 22+. Log in by picking a seeded user — `Rhea Reviewer`
(reviewer), `Raj Reviewer` (reviewer), or `Vic Viewer` (viewer). No passwords:
this is a prototype using simple session-based login backed by seeded users.

`SESSION_SECRET` is optional in development (a random per-process secret is
generated) and **required** when `NODE_ENV=production` — startup fails without
it rather than falling back to a shared default.

## Domain

* `User(id, name, role)` — role is `reviewer` (view + approve/reject) or
  `viewer` (read-only).
* `RefundRequest(id, customerRef, amountCents, reason, status, createdAt)` —
  status is `PENDING`, `APPROVED`, or `REJECTED`.
* `AuditEvent(id, refundRequestId, actorUserId, action, fromStatus, toStatus,
  reasonNote, gatewayRef, createdAt)`.

Only two transitions exist: `PENDING -> APPROVED` and `PENDING -> REJECTED`.
Acting on a non-`PENDING` request is an error (HTTP 409). There are no
`FAILED`/`REFUNDED` states, retries, thresholds, or partial refunds.

## Guarantees

**Authorization is server-side.** `requireReviewer` runs before the mutation
handler; a viewer posting to `/refunds/:id/decision` gets HTTP 403 with no
status change and no audit write, even when the UI is bypassed entirely
(covered by a unit test and a Playwright test that posts directly). Hiding the
decision form for viewers is cosmetic only.

**Audit trail is append-only, enforced at two layers.**
1. Application: `insertAuditEvent` is the only audit write path — there is no
   update or delete code for `audit_events`.
2. Database: `BEFORE UPDATE` and `BEFORE DELETE` triggers on `audit_events`
   `RAISE(ABORT, ...)`, so a direct SQL `UPDATE`/`DELETE` fails even if the
   application is bypassed (see `tests/auditImmutability.test.ts`).

**One audit event per successful mutation, written atomically.** The status
update, the gateway call, and the audit insert happen inside a single immediate
`better-sqlite3` transaction — both commit or neither does. The status update
is a guarded `UPDATE ... WHERE id = ? AND status = 'PENDING'`; if it affects no
rows the request was decided concurrently, the transaction is rolled back and
the caller gets `NOT_PENDING` (HTTP 409). Two racing reviewers therefore
produce exactly one decision, one gateway call, and one audit event.

**External boundary.** `RefundGateway.issueRefund(request) -> { gatewayRef }`
has one implementation, `MockRefundGateway`, which is deterministic: it returns
`mock_gw_<requestId>` and always fails for the synthetic customer reference
`CUST-GATEWAY-FAIL` (seeded as `rr-1005`). On failure the transaction rolls
back: the request stays `PENDING`, no audit event is written, the reviewer sees
a non-destructive error and may retry the same decision later. A gateway
failure is *not* a lifecycle state.

## Known production limitations

* **External-system/database consistency is not actually solved.** Rolling back
  the local transaction when the gateway call throws only covers the case where
  the failure is observed synchronously. If the external side effect succeeds
  but the local commit then fails (crash, disk error, lost response), or the
  reverse, the gateway and this database diverge, and no amount of local
  transaction scoping fixes that. A production system would need idempotency
  keys on the gateway call, an outbox/saga with retries, and periodic
  reconciliation against the provider. Intentionally out of scope for this
  prototype. The same note appears as a comment on the approve path in
  `src/service/decide.ts`.
* **No real authentication.** Login is a picker over seeded users with no
  credentials, so anyone who can reach the app can assume a reviewer identity.
  This is an intentional prototype limitation: production needs real
  authentication (SSO/IdP or password + MFA), per-user accounts, and session
  revocation. Server-side *authorization* is real and enforced; only
  *authentication* is stubbed.
* **No CSRF protection.** The decision endpoint trusts the session cookie, so a
  cross-site POST from a logged-in reviewer's browser would be accepted.
  `sameSite=strict` cookies mitigate this in modern browsers but are not a
  substitute for CSRF tokens (or origin checks) on state-changing routes;
  broader CSRF hardening is out of scope for Milestone 1.
* Session cookies are `httpOnly`, `sameSite=strict`, and `secure` only when
  `NODE_ENV=production`; sessions live in the `express-session` MemoryStore, so
  they are lost on restart and do not work across multiple processes.
* SQLite single-file storage, no migrations tooling, no pagination on the
  queue, no rate limiting.

## Candidates for reuse when a second tool is added

Noted, deliberately **not** extracted or generalized yet:

* `src/auth.ts` — session loading plus `requireLogin`/`requireReviewer`. The
  role-check middleware is the obvious first thing a second tool would want,
  probably as `requireRole(role)`.
* `src/repo/refunds.ts` `insertAuditEvent` plus the `audit_events` table and its
  immutability triggers — a generic `audit(entityType, entityId, ...)` table
  would serve several tools, at the cost of typed per-entity columns.
* The "validate -> authorize -> side effect -> mutate + audit in one
  transaction" shape in `src/service/decide.ts` is the real reusable pattern; a
  shared helper only makes sense once a second caller exists.
* `src/views.ts` layout/escaping helpers — a shared layout + HTML escaping
  module is a cheap extraction when a second set of views appears.

## Layout

```
src/
  app.ts                  Express app: routes, Zod validation, status mapping
  auth.ts                 session user loading + role middleware (server-side enforcement)
  server.ts               entrypoint
  views.ts                server-rendered HTML
  db/schema.sql           tables + audit immutability triggers
  db/index.ts             connection + migrate
  db/seed.ts              synthetic users and refund requests
  domain/rules.ts         pure decision rules (reason required, PENDING-only, role)
  domain/types.ts
  gateway/refundGateway.ts RefundGateway interface + deterministic MockRefundGateway
  repo/refunds.ts         SQL access; audit inserts only
  service/decide.ts       transactional approve/reject
tests/                    Vitest
e2e/                      Playwright
```
