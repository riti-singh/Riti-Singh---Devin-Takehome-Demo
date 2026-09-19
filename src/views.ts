import { describeAccess } from './domain/access.js';
import type { FlagQuery } from './domain/flagQuery.js';
import { canChangeFlag, ENVIRONMENTS } from './domain/flagRules.js';
import type { RefundQuery, StatusCounts } from './domain/refundQuery.js';
import { effectiveSortDirection, REFUND_STATUSES } from './domain/refundQuery.js';
import type {
  AuditEvent,
  Environment,
  FeatureFlag,
  FeatureFlagState,
  FlagAuditEvent,
  RefundRequest,
  User,
} from './domain/types.js';

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function money(amountCents: number): string {
  return `$${(amountCents / 100).toFixed(2)}`;
}

interface Tool {
  name: string;
  href: string;
}

const HOME_TOOL: Tool = { name: 'Internal Tools', href: '/' };
const REFUND_TOOL: Tool = { name: 'Refund Operations', href: '/refunds' };
const FLAGS_TOOL: Tool = { name: 'Feature Flag Administration', href: '/flags' };

const NAV_ITEMS: { label: string; href: string; testId: string }[] = [
  { label: 'Home', href: HOME_TOOL.href, testId: 'nav-home' },
  { label: REFUND_TOOL.name, href: REFUND_TOOL.href, testId: 'nav-refunds' },
  { label: FLAGS_TOOL.name, href: FLAGS_TOOL.href, testId: 'nav-flags' },
];

function nav(tool: Tool): string {
  const links = NAV_ITEMS.map((item) => {
    const active = item.href === tool.href;
    return `<a href="${escapeHtml(item.href)}" data-testid="${item.testId}"${
      active ? ' aria-current="page" class="active"' : ''
    }>${escapeHtml(item.label)}</a>`;
  }).join('\n  ');
  return `<nav data-testid="nav">\n  ${links}\n</nav>`;
}

/** Cross-tool capability summary, derived from the enforced pure rules. */
export function accessPanel(user: User, short = false): string {
  const access = describeAccess(user.role);
  if (short) {
    return `<span data-testid="access-summary-short">${escapeHtml(access.summary)}</span>`;
  }
  return `<section class="panel access" data-testid="access-panel">
  <h3>Your access</h3>
  <p>Signed in as <strong>${escapeHtml(user.name)}</strong> (${escapeHtml(user.role)}): <span data-testid="access-summary">${escapeHtml(access.summary)}</span></p>
  <ul>
    <li data-testid="access-refunds">Refund Operations: ${escapeHtml(access.refunds)}</li>
    <li data-testid="access-flags">Feature Flag Administration: ${escapeHtml(access.flags)}</li>
  </ul>
</section>`;
}

function layout(title: string, user: User | undefined, body: string, tool: Tool = REFUND_TOOL): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)} · ${escapeHtml(tool.name)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root {
    --bg: #f7f8fa;
    --surface: #fff;
    --line: #e3e6ea;
    --line-strong: #cfd4da;
    --ink: #14171a;
    --muted: #5b6672;
    --accent: #1f4e79;
    --danger: #9b2c2c;
    --radius: .5rem;
  }
  * { box-sizing: border-box; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    margin: 0; background: var(--bg); color: var(--ink);
    font-size: 15px; line-height: 1.5;
  }
  a { color: var(--accent); }
  h1, h2, h3 { line-height: 1.25; }
  h2 { font-size: 1.3rem; margin: 0 0 .25rem; letter-spacing: -.01em; }
  h3 { font-size: 1rem; margin: 0 0 .5rem; }
  main { max-width: 64rem; margin: 0 auto; padding: 1.5rem 1.25rem 4rem; }
  .page-head { margin-bottom: 1rem; }
  .page-head p { margin: 0; color: var(--muted); font-size: .9rem; }

  header.app { background: var(--surface); border-bottom: 1px solid var(--line); }
  .app__bar, .app__nav {
    max-width: 64rem; margin: 0 auto; padding: 0 1.25rem;
    display: flex; align-items: center; gap: 1rem;
  }
  .app__bar { justify-content: space-between; padding-top: .85rem; padding-bottom: .5rem; }
  .brand { margin: 0; font-size: 1.05rem; letter-spacing: -.01em; }
  .brand a { color: inherit; text-decoration: none; }
  .user { display: flex; align-items: center; gap: .6rem; font-size: .85rem; color: var(--muted); }
  .user strong { color: var(--ink); font-weight: 600; }
  .role { border: 1px solid var(--line-strong); border-radius: 999px; padding: .05rem .5rem; font-size: .75rem; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }

  nav { display: flex; gap: .25rem; flex-wrap: wrap; }
  nav a {
    display: inline-block; padding: .5rem .1rem; margin-right: 1rem;
    color: var(--muted); text-decoration: none; font-size: .9rem;
    border-bottom: 2px solid transparent;
  }
  nav a:hover { color: var(--ink); }
  nav a.active { color: var(--accent); font-weight: 600; border-bottom-color: var(--accent); }

  .context { color: var(--muted); font-size: .85rem; margin: 0 0 1.25rem; }
  .panel { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 1rem 1.15rem; margin-bottom: 1.25rem; }
  .panel > :first-child { margin-top: 0; }
  .panel > :last-child { margin-bottom: 0; }

  .cards { list-style: none; padding: 0; margin: 0 0 1.5rem; display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr)); }
  .card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 1.1rem 1.15rem; }
  .card h3 { margin: 0 0 .35rem; font-size: 1.02rem; }
  .card h3 a { text-decoration: none; }
  .card h3 a:hover { text-decoration: underline; }
  .card p { margin: 0 0 .75rem; color: var(--muted); font-size: .9rem; }
  .card .open { font-size: .85rem; color: var(--muted); }

  .access ul { margin: .5rem 0 0; padding-left: 1.1rem; color: var(--muted); font-size: .9rem; }
  .access li { margin-bottom: .2rem; }
  .access p { margin: 0; }

  .toolbar {
    background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius);
    padding: .85rem 1rem; display: flex; gap: 1rem 1.25rem; align-items: flex-end; flex-wrap: wrap;
    margin-bottom: .85rem;
  }
  .field { display: flex; flex-direction: column; gap: .25rem; }
  .field label { font-size: .75rem; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
  .toolbar .actions { display: flex; align-items: center; gap: .6rem; margin-left: auto; }
  input[type=text], select {
    font: inherit; font-size: .9rem; padding: .4rem .55rem;
    border: 1px solid var(--line-strong); border-radius: .35rem; background: var(--surface); color: var(--ink);
  }
  input[type=text] { min-width: 18rem; }
  .toolbar input[type=text] { min-width: 16rem; }
  input[type=text]:focus, select:focus, button:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

  button {
    font: inherit; font-size: .9rem; padding: .45rem .9rem; cursor: pointer;
    border-radius: .35rem; border: 1px solid var(--line-strong); background: var(--surface); color: var(--ink);
  }
  button:hover { border-color: var(--muted); }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  button.primary:hover { background: #1a4266; }
  button.danger { background: var(--surface); border-color: #d9b3b3; color: var(--danger); }
  button.danger:hover { background: #fdf3f3; border-color: var(--danger); }
  .link-button { font-size: .85rem; color: var(--muted); }

  .counts {
    margin: 0 0 .85rem; font-size: .85rem; color: var(--muted);
    background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius);
    padding: .5rem .85rem; font-variant-numeric: tabular-nums; letter-spacing: .01em;
  }

  .table-wrap { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: .6rem .85rem; border-bottom: 1px solid var(--line); font-size: .9rem; vertical-align: top; }
  thead th {
    font-size: .72rem; text-transform: uppercase; letter-spacing: .06em; color: var(--muted);
    background: #fafbfc; border-bottom: 1px solid var(--line-strong); font-weight: 600; white-space: nowrap;
  }
  thead th a { color: inherit; text-decoration: none; }
  thead th a:hover { color: var(--ink); }
  tbody tr:last-child td { border-bottom: none; }
  tbody tr:hover { background: #fafbfc; }
  table[data-testid="queue"] td:nth-child(3) { font-variant-numeric: tabular-nums; }
  table[data-testid="queue"] td:first-child,
  table[data-testid="queue"] td:nth-child(3),
  table[data-testid="queue"] td:last-child { white-space: nowrap; }
  td time, .stamp { font-variant-numeric: tabular-nums; }
  .kv th { width: 12rem; background: #fafbfc; font-weight: 600; text-transform: none; letter-spacing: 0; font-size: .85rem; color: var(--muted); }

  .status {
    display: inline-block; font-weight: 600; font-size: .72rem; letter-spacing: .04em;
    padding: .15rem .5rem; border-radius: 999px; border: 1px solid var(--line-strong); background: #f2f4f6; color: var(--muted);
    white-space: nowrap;
  }
  .PENDING { background: #fdf6e3; border-color: #e6d5a8; color: #7a5c12; }
  .APPROVED { background: #eef7ee; border-color: #b9dcb9; color: #2f6b34; }
  .REJECTED { background: #fdf2f2; border-color: #e3bdbd; color: var(--danger); }
  .on { background: #eef7ee; border-color: #b9dcb9; color: #2f6b34; }
  .off { background: #f2f4f6; border-color: var(--line-strong); color: var(--muted); }

  .error { background: #fdf2f2; border: 1px solid #e3bdbd; color: var(--danger); padding: .7rem .9rem; border-radius: var(--radius); margin-bottom: 1rem; }
  form.decision { margin: 0; display: flex; gap: .6rem; align-items: flex-end; flex-wrap: wrap; }
  .back { display: inline-block; font-size: .85rem; margin-bottom: .75rem; }
  .muted { color: var(--muted); font-size: .9rem; }

  @media (max-width: 720px) {
    .app__bar { flex-wrap: wrap; gap: .5rem; }
    .toolbar { align-items: stretch; }
    .field, .toolbar input[type=text], .field select { width: 100%; }
    .toolbar .actions { margin-left: 0; }
    input[type=text] { min-width: 0; width: 100%; }
    .kv th { width: auto; }
    th, td { padding: .5rem .6rem; }
  }
</style>
</head>
<body>
<header class="app">
  <div class="app__bar">
    <h1 class="brand"><a href="${escapeHtml(tool.href)}">${escapeHtml(tool.name)}</a></h1>
    <div class="user">${
      user
        ? `<strong data-testid="current-user">${escapeHtml(user.name)}</strong><span class="role">${escapeHtml(user.role)}</span><a href="/logout">Log out</a>`
        : '<a href="/login">Log in</a>'
    }</div>
  </div>
  ${user ? `<div class="app__nav">${nav(tool)}</div>` : ''}
</header>
<main>
${user && tool !== HOME_TOOL ? `<p class="context">Access: ${accessPanel(user, true)}</p>` : ''}
${body}
</main>
</body>
</html>`;
}

export function loginPage(users: User[], error?: string): string {
  const options = users
    .map((u) => `<option value="${escapeHtml(u.id)}">${escapeHtml(u.name)} (${escapeHtml(u.role)})</option>`)
    .join('');
  return layout('Log in', undefined, `
<div class="page-head">
  <h2>Log in</h2>
  <p>Pick a seeded user to explore the internal tools.</p>
</div>
${error ? `<p class="error" data-testid="error">${escapeHtml(error)}</p>` : ''}
<form class="panel toolbar" method="post" action="/login">
  <div class="field">
    <label for="userId">User</label>
    <select id="userId" name="userId" data-testid="user-select">${options}</select>
  </div>
  <div class="actions"><button class="primary" type="submit" data-testid="login">Log in</button></div>
</form>`, HOME_TOOL);
}

export function homePage(user: User): string {
  const tools = [
    {
      ...REFUND_TOOL,
      description: 'Review the refund queue and approve or reject requests with a reason.',
      testId: 'home-refunds',
    },
    {
      ...FLAGS_TOOL,
      description: 'Inspect feature flags and change their per-environment state.',
      testId: 'home-flags',
    },
  ]
    .map(
      (t) => `  <li class="card">
    <h3><a href="${escapeHtml(t.href)}" data-testid="${t.testId}">${escapeHtml(t.name)}</a></h3>
    <p>${escapeHtml(t.description)}</p>
    <span class="open">Open ${escapeHtml(t.href)} →</span>
  </li>`,
    )
    .join('\n');

  return layout(
    'Home',
    user,
    `
<div class="page-head">
  <h2>Internal tools</h2>
  <p>Operational tools for refunds and feature flags.</p>
</div>
<ul class="cards" data-testid="home-tools">
${tools}
</ul>
${accessPanel(user)}`,
    HOME_TOOL,
  );
}

function sortHeader(label: string, sort: string, query: RefundQuery): string {
  const active = query.sort === sort;
  const current = effectiveSortDirection(query);
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.status) params.set('status', query.status);
  params.set('sort', sort);
  params.set('dir', active && current === 'asc' ? 'desc' : 'asc');
  const arrow = active ? (current === 'asc' ? ' ▲' : ' ▼') : '';
  return `<th><a href="/refunds?${escapeHtml(params.toString())}" data-testid="sort-${escapeHtml(sort)}">${escapeHtml(label)}${arrow}</a></th>`;
}

function statusOptions(selected: RefundStatusFilter): string {
  return ['all', ...REFUND_STATUSES]
    .map(
      (value) =>
        `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(value === 'all' ? 'All statuses' : value)}</option>`,
    )
    .join('');
}

type RefundStatusFilter = NonNullable<RefundQuery['status']>;

export function queuePage(
  user: User,
  requests: RefundRequest[],
  counts: StatusCounts,
  query: RefundQuery = {},
): string {
  const rows = requests
    .map(
      (r) => `<tr data-testid="row-${escapeHtml(r.id)}">
  <td><a href="/refunds/${escapeHtml(r.id)}" data-testid="link-${escapeHtml(r.id)}">${escapeHtml(r.id)}</a></td>
  <td>${escapeHtml(r.customerRef)}</td>
  <td>${money(r.amountCents)}</td>
  <td>${escapeHtml(r.reason)}</td>
  <td><span class="status ${escapeHtml(r.status)}" data-testid="status-${escapeHtml(r.id)}">${escapeHtml(r.status)}</span></td>
  <td>${escapeHtml(r.createdAt)}</td>
</tr>`,
    )
    .join('\n');
  const selectedStatus: RefundStatusFilter = query.status ?? 'all';
  return layout('Queue', user, `
<div class="page-head">
  <h2>Refund queue</h2>
  <p>Search, filter and sort refund requests; counts always reflect the full queue.</p>
</div>
<form class="toolbar" method="get" action="/refunds" data-testid="refund-filters">
  <div class="field">
    <label for="q">Search</label>
    <input type="text" id="q" name="q" value="${escapeHtml(query.q ?? '')}" placeholder="id, customer or reason" data-testid="refund-search" />
  </div>
  <div class="field">
    <label for="status">Status</label>
    <select id="status" name="status" data-testid="status-filter">${statusOptions(selectedStatus)}</select>
  </div>
  ${query.sort ? `<input type="hidden" name="sort" value="${escapeHtml(query.sort)}" /><input type="hidden" name="dir" value="${escapeHtml(effectiveSortDirection(query))}" />` : ''}
  <div class="actions">
    <button class="primary" type="submit" data-testid="refund-filter-apply">Apply</button>
    <a class="link-button" href="/refunds" data-testid="refund-filter-clear">Clear</a>
  </div>
</form>
<p class="counts" data-testid="status-counts">All ${counts.all} · PENDING ${counts.PENDING} · APPROVED ${counts.APPROVED} · REJECTED ${counts.REJECTED} · showing ${requests.length}</p>
<div class="table-wrap">
<table data-testid="queue">
  <thead><tr><th>ID</th><th>Customer</th>${sortHeader('Amount', 'amount', query)}<th>Reason</th>${sortHeader('Status', 'status', query)}${sortHeader('Created', 'created', query)}</tr></thead>
  <tbody>${rows}</tbody>
</table>
</div>`);
}

export function detailPage(
  user: User,
  request: RefundRequest,
  auditEvents: AuditEvent[],
  error?: string,
): string {
  const canAct = user.role === 'reviewer' && request.status === 'PENDING';
  const auditRows = auditEvents
    .map(
      (e) => `<tr data-testid="audit-${escapeHtml(e.id)}">
  <td>${escapeHtml(e.createdAt)}</td>
  <td>${escapeHtml(e.actorUserId)}</td>
  <td>${escapeHtml(e.action)}</td>
  <td>${escapeHtml(e.fromStatus)} → ${escapeHtml(e.toStatus)}</td>
  <td>${escapeHtml(e.reasonNote)}</td>
  <td>${escapeHtml(e.gatewayRef ?? '—')}</td>
</tr>`,
    )
    .join('\n');

  return layout(`Refund ${request.id}`, user, `
<a class="back" href="/refunds">← Back to queue</a>
<div class="page-head">
  <h2>Refund ${escapeHtml(request.id)}</h2>
  <p>Request detail, decision controls and the immutable audit trail.</p>
</div>
${error ? `<p class="error" data-testid="error">${escapeHtml(error)}</p>` : ''}
<div class="table-wrap" style="margin-bottom:1.25rem">
<table class="kv">
  <tbody>
    <tr><th>Customer</th><td data-testid="customer-ref">${escapeHtml(request.customerRef)}</td></tr>
    <tr><th>Amount</th><td>${money(request.amountCents)}</td></tr>
    <tr><th>Requested reason</th><td>${escapeHtml(request.reason)}</td></tr>
    <tr><th>Status</th><td><span class="status ${escapeHtml(request.status)}" data-testid="status">${escapeHtml(request.status)}</span></td></tr>
    <tr><th>Created</th><td>${escapeHtml(request.createdAt)}</td></tr>
  </tbody>
</table>
</div>

<section class="panel">
  <h3>Decision</h3>
${
  canAct
    ? `  <form class="decision" method="post" action="/refunds/${escapeHtml(request.id)}/decision" data-testid="decision-form">
    <div class="field">
      <label for="reasonNote">Reason</label>
      <input type="text" id="reasonNote" name="reasonNote" data-testid="reason" />
    </div>
    <button class="primary" type="submit" name="action" value="APPROVE" data-testid="approve">Approve</button>
    <button class="danger" type="submit" name="action" value="REJECT" data-testid="reject">Reject</button>
  </form>`
    : `  <p class="muted" data-testid="no-actions">${
        user.role === 'reviewer'
          ? 'This request is already decided; no further actions are possible.'
          : 'Read-only access: your role cannot approve or reject refunds.'
      }</p>`
}
</section>

<h3>Audit trail</h3>
<div class="table-wrap">
<table data-testid="audit-trail">
  <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Transition</th><th>Reason</th><th>Gateway ref</th></tr></thead>
  <tbody>${auditRows || '<tr data-testid="audit-empty"><td colspan="6">No audit events yet.</td></tr>'}</tbody>
</table>
</div>`);
}

function stateLabel(enabled: boolean): string {
  return enabled ? 'ENABLED' : 'DISABLED';
}

function selectOptions(values: readonly string[], selected: string, allLabel: string): string {
  return ['all', ...values]
    .map(
      (value) =>
        `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(value === 'all' ? allLabel : value)}</option>`,
    )
    .join('');
}

export function flagsListPage(
  user: User,
  flags: FeatureFlag[],
  states: FeatureFlagState[],
  query: FlagQuery = {},
): string {
  const stateFor = (flagId: string, environment: Environment): FeatureFlagState | undefined =>
    states.find((s) => s.flagId === flagId && s.environment === environment);

  const rows = flags
    .map((f) => {
      const cells = ENVIRONMENTS.map((env) => {
        const state = stateFor(f.id, env);
        const tone = state ? (state.enabled ? ' on' : ' off') : '';
        return `  <td><span class="status${tone}" title="${escapeHtml(env)}" data-testid="state-${escapeHtml(f.id)}-${escapeHtml(env)}">${
          state ? stateLabel(state.enabled) : '—'
        }</span></td>`;
      }).join('\n');
      return `<tr data-testid="row-${escapeHtml(f.id)}">
  <td><a href="/flags/${escapeHtml(f.id)}" data-testid="link-${escapeHtml(f.id)}">${escapeHtml(f.key)}</a></td>
  <td>${escapeHtml(f.description)}</td>
${cells}
</tr>`;
    })
    .join('\n');

  return layout(
    'Flags',
    user,
    `
<div class="page-head">
  <h2>Feature flags</h2>
  <p>Search flags and filter by environment and enabled state.</p>
</div>
<form class="toolbar" method="get" action="/flags" data-testid="flag-filters">
  <div class="field">
    <label for="q">Search</label>
    <input type="text" id="q" name="q" value="${escapeHtml(query.q ?? '')}" placeholder="key or description" data-testid="flag-search" />
  </div>
  <div class="field">
    <label for="environment">Environment</label>
    <select id="environment" name="environment" data-testid="flag-env-filter">${selectOptions(ENVIRONMENTS, query.environment ?? 'all', 'All environments')}</select>
  </div>
  <div class="field">
    <label for="state">State</label>
    <select id="state" name="state" data-testid="flag-state-filter">${selectOptions(['enabled', 'disabled'], query.state ?? 'all', 'Any state')}</select>
  </div>
  <div class="actions">
    <button class="primary" type="submit" data-testid="flag-filter-apply">Apply</button>
    <a class="link-button" href="/flags" data-testid="flag-filter-clear">Clear</a>
  </div>
</form>
<p class="counts" data-testid="flag-counts">Showing ${flags.length} flag${flags.length === 1 ? '' : 's'}</p>
<div class="table-wrap">
<table data-testid="flags">
  <thead><tr><th>Key</th><th>Description</th>${ENVIRONMENTS.map((env) => `<th>${escapeHtml(env)} state</th>`).join('')}</tr></thead>
  <tbody>${rows}</tbody>
</table>
</div>`,
    FLAGS_TOOL,
  );
}

export function flagDetailPage(
  user: User,
  flag: FeatureFlag,
  states: FeatureFlagState[],
  auditEvents: FlagAuditEvent[],
  error?: string,
): string {
  const environmentBlocks = ENVIRONMENTS.map((env) => {
    const state = states.find((s) => s.environment === env);
    if (!state) return '';
    const current = stateLabel(state.enabled);
    const form = canChangeFlag(user.role, env)
      ? `<form class="decision" method="post" action="/flags/${escapeHtml(flag.id)}/change" data-testid="change-form-${escapeHtml(env)}">
  <input type="hidden" name="environment" value="${escapeHtml(env)}" />
  <input type="hidden" name="enabled" value="${state.enabled ? 'false' : 'true'}" />
  <div class="field">
    <label for="reasonNote-${escapeHtml(env)}">Reason</label>
    <input type="text" id="reasonNote-${escapeHtml(env)}" name="reasonNote" data-testid="reason-${escapeHtml(env)}" />
  </div>
  <button class="${state.enabled ? 'danger' : 'primary'}" type="submit" data-testid="toggle-${escapeHtml(env)}">${state.enabled ? 'Disable' : 'Enable'} in ${escapeHtml(env)}</button>
</form>`
      : `<p class="muted" data-testid="no-actions-${escapeHtml(env)}">Read-only: your role cannot change this flag in ${escapeHtml(env)}.</p>`;

    return `<section class="panel" data-testid="environment-${escapeHtml(env)}">
  <h3>${escapeHtml(env)}</h3>
  <p class="muted">State: <span class="status ${state.enabled ? 'on' : 'off'}" data-testid="state-${escapeHtml(env)}">${current}</span> · updated ${escapeHtml(state.updatedAt)}</p>
  ${form}
</section>`;
  }).join('\n');

  const auditRows = auditEvents
    .map(
      (e) => `<tr data-testid="flag-audit-${escapeHtml(e.id)}">
  <td>${escapeHtml(e.createdAt)}</td>
  <td>${escapeHtml(e.actorUserId)}</td>
  <td>${escapeHtml(e.environment)}</td>
  <td>${stateLabel(e.fromEnabled)} → ${stateLabel(e.toEnabled)}</td>
  <td>${escapeHtml(e.reasonNote)}</td>
  <td>${escapeHtml(e.externalRef ?? '—')}</td>
</tr>`,
    )
    .join('\n');

  return layout(
    `Flag ${flag.key}`,
    user,
    `
<a class="back" href="/flags">← Back to flags</a>
<div class="page-head">
  <h2>${escapeHtml(flag.key)}</h2>
  <p>${escapeHtml(flag.description)}</p>
</div>
${error ? `<p class="error" data-testid="error">${escapeHtml(error)}</p>` : ''}
${environmentBlocks}

<h3>Audit trail</h3>
<div class="table-wrap">
<table data-testid="flag-audit-trail">
  <thead><tr><th>When</th><th>Actor</th><th>Environment</th><th>Transition</th><th>Reason</th><th>External ref</th></tr></thead>
  <tbody>${auditRows || '<tr data-testid="flag-audit-empty"><td colspan="6">No audit events yet.</td></tr>'}</tbody>
</table>
</div>`,
    FLAGS_TOOL,
  );
}
