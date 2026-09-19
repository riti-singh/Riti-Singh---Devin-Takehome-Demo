# Internal Tools: Refund Operations + Feature Flag Administration

Two small internal tools sharing one Express app:

* **Refund Operations** (`/refunds`) — a queue, a detail view, approve/reject
  with a **required reason**, and an **append-only audit trail**.
* **Feature Flag Administration** (`/flags`) — flags and their per-environment
  state, changes gated by environment-scoped roles with a **required reason**,
  and its own **append-only audit trail**.

Deliberately time-boxed prototypes, not a platform.

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
(reviewer), `Raj Reviewer` (reviewer), `Vic Viewer` (viewer), `Dev Developer`
(developer), `Dana Developer` (developer), or `Ada Admin` (admin). No passwords:
this is a prototype using simple session-based login backed by seeded users.

`SESSION_SECRET` is optional in development (a random per-process secret is
generated) and **required** when `NODE_ENV=production` — startup fails without
it rather than falling back to a shared default.

## Domain

* `User(id, name, role)` — role is `reviewer` (view + approve/reject refunds),
  `viewer` (read-only), `developer` (change flags in `development`), or `admin`
  (change flags in any environment).
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

## Feature Flag Administration

Routes: `GET /flags` (all flags with per-environment state), `GET /flags/:id`
(per-environment state, a change form only for environments the signed-in user
may change, and the flag's audit trail), `POST /flags/:id/change` (body:
`environment`, `enabled`, `reasonNote`).

* `FeatureFlag(id, key, description, createdAt)`.
* `FeatureFlagState(flagId, environment, enabled, updatedAt)` — environments
  are fixed: exactly `development` and `production`.
* `FlagAuditEvent(id, flagId, environment, actorUserId, fromEnabled, toEnabled,
  reasonNote, externalRef, createdAt)`.

**Environment-scoped authorization, server-side.** `canChangeFlag(role,
environment)` is the single rule: `developer` → `development` only, `admin` →
both, every other role → none. It backs both the middleware
(`requireFlagChangePermission`, keyed on the posted environment) and the view
that decides which change forms to render; hiding a form is cosmetic only. A
developer posting directly to a production flag gets HTTP 403 with no state
change and no audit write (`tests/flagHttp.test.ts`, `e2e/flagFlows.spec.ts`).

**Dedicated append-only audit table.** `flag_audit_events` has its own
`BEFORE UPDATE`/`BEFORE DELETE` `RAISE(ABORT, ...)` triggers, and
`insertFlagAuditEvent` is the only write path — the same two-layer guarantee
the refund tool has, with per-tool columns instead of a shared generic table.

**External boundary.** `FeatureFlagSystem.applyFlag({flagKey, environment,
enabled}) -> { externalRef }` has one deterministic implementation,
`MockFeatureFlagSystem`: it returns `mock_ff_<flagKey>_<environment>` and
always throws for the synthetic key `flag-apply-fail` (seeded as
`ff-apply-fail`). On failure the transaction rolls back — state unchanged, no
audit event, retryable (HTTP 502).

**Concurrency-safe compare-and-swap.**

Every read the decision depends on happens **inside** one immediate SQLite
transaction, so a concurrent writer cannot change the value between the read
and the decision it justifies:

* The current state is re-read under the write lock. If it still equals the
  requested value the change is a confirmed **NO_OP**: the transaction rolls
  back having written nothing, no external call is made, no audit event is
  written, and the caller is redirected back to the detail page as with a
  successful change. A *stale* apparent no-op — the caller asks for the value
  it read a moment ago, but another writer has since changed it — is not a
  no-op and proceeds through the normal change path.
* Otherwise, still inside that transaction, a guarded
  `UPDATE feature_flag_states SET enabled = @desired ... WHERE flag_id = ? AND
  environment = ? AND enabled = @expectedCurrent` runs first. The external
  system is called **only after** that update reports exactly one changed row,
  mirroring how the refund gateway call sits after `claimPendingRefund`.
* If the guarded update changes no rows, another writer got there first:
  `StaleFlagChangeError` rolls the transaction back and the caller gets
  **CONFLICT** (HTTP 409) with no state change, no audit event and no external
  call — a stale change is never issued externally
  (`tests/flagConcurrency.test.ts`).

The known production limitations below apply to this tool as well: no real
authentication, no CSRF protection, and no external-system/database
reconciliation.

## Database upgrades are out of scope

The schema for this milestone (the new role values, `feature_flags`,
`feature_flag_states`, `flag_audit_events` and its triggers) is applied by
`src/db/schema.sql` at creation time only — there is no migration framework and
`npm run seed` recreates the database from scratch. **A fresh seeded prototype
database is assumed.** Upgrading an existing Milestone 1 `data/refunds.db`
in place is unsupported: it will lack the flag tables and still carry the
narrower `users.role` CHECK. Delete it and re-seed. A production system would
need versioned, reversible migrations applied as part of deployment;
intentionally out of scope for this time-boxed prototype.

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

## Reuse between the two tools

Extracted, because the second tool genuinely needed it:

* `src/auth.ts` — `loadCurrentUser` and `requireLogin` are shared as-is. The
  role check is parameterized per tool rather than generalized into one
  middleware: `requireReviewer` (refunds) and `requireFlagChangePermission`
  (flags, keyed on role **and** target environment), both delegating to a pure
  rule in `src/domain/`.
* `src/views.ts` — `escapeHtml` and `layout` are shared; the previously
  hardcoded `· Refund Operations` title and header are now a per-tool
  parameter, so refund pages render byte-identically.

Deliberately **not** extracted:

* **No generic transaction/service helper.** The "validate → authorize →
  guarded update → external call → audit, in one immediate transaction" shape
  is duplicated between `src/service/decide.ts` and `src/service/changeFlag.ts`
  on purpose: the guard column, the external payload and the audit columns all
  differ, and a shared helper would abstract over the very details that make
  each one correct.
* **No generic audit table.** `flag_audit_events` is its own table with its own
  immutability triggers rather than a shared
  `audit(entityType, entityId, ...)`, keeping typed per-entity columns and
  per-tool constraints.
* **No shared gateway abstraction.** `RefundGateway` and `FeatureFlagSystem`
  are separate interfaces with separate error types and synthetic failure
  fixtures.

## Layout

```
src/
  app.ts                  Express app: routes, Zod validation, status mapping
  auth.ts                 session user loading + role middleware (server-side enforcement)
  server.ts               entrypoint
  views.ts                server-rendered HTML
  db/schema.sql           tables + audit immutability triggers
  db/index.ts             connection + migrate
  db/seed.ts              synthetic users, refund requests, feature flags
  domain/rules.ts         pure decision rules (reason required, PENDING-only, role)
  domain/flagRules.ts     pure flag rules (role x environment, reason required)
  domain/types.ts
  gateway/refundGateway.ts RefundGateway interface + deterministic MockRefundGateway
  gateway/featureFlagSystem.ts FeatureFlagSystem interface + MockFeatureFlagSystem
  repo/refunds.ts         SQL access; audit inserts only
  repo/flags.ts           SQL access incl. guarded flag compare-and-swap; audit inserts only
  service/decide.ts       transactional approve/reject
  service/changeFlag.ts   transactional flag change (compare-and-swap, NO_OP, CONFLICT)
tests/                    Vitest
e2e/                      Playwright
```
