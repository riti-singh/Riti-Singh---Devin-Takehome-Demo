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
  return `<section class="access" data-testid="access-panel">
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
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 60rem; color: #14171a; }
  header { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1px solid #ddd; padding-bottom: .5rem; }
  table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
  th, td { text-align: left; padding: .5rem .6rem; border-bottom: 1px solid #eee; font-size: .95rem; }
  .status { font-weight: 600; font-size: .8rem; padding: .15rem .45rem; border-radius: .25rem; }
  .PENDING { background: #fff3cd; } .APPROVED { background: #d6f5d6; } .REJECTED { background: #f8d7da; }
  .error { background: #f8d7da; border: 1px solid #e0a3ab; padding: .75rem; border-radius: .3rem; }
  form.decision { margin-top: 1rem; display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; }
  form.filters { margin-top: 1rem; display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; }
  form.filters input[type=text] { min-width: 14rem; }
  input[type=text] { padding: .4rem; min-width: 22rem; }
  button { padding: .4rem .8rem; cursor: pointer; }
  nav { display: flex; gap: 1rem; margin: .4rem 0; font-size: .95rem; }
  nav a.active { font-weight: 700; text-decoration: none; }
  .access { background: #f4f6f8; border: 1px solid #e1e5ea; border-radius: .3rem; padding: .25rem 1rem 1rem; margin-top: 1rem; }
  .counts { margin-top: 1rem; font-size: .9rem; color: #45505b; }
  .tools li { margin-bottom: .5rem; }
</style>
</head>
<body>
<header>
  <div>
    <h1><a href="${escapeHtml(tool.href)}" style="text-decoration:none;color:inherit">${escapeHtml(tool.name)}</a></h1>
    ${user ? nav(tool) : ''}
  </div>
  <div>${
    user
      ? `Signed in as <strong data-testid="current-user">${escapeHtml(user.name)}</strong> (${escapeHtml(user.role)}) · ${accessPanel(user, true)} · <a href="/logout">Log out</a>`
      : '<a href="/login">Log in</a>'
  }</div>
</header>
${body}
</body>
</html>`;
}

export function loginPage(users: User[], error?: string): string {
  const options = users
    .map((u) => `<option value="${escapeHtml(u.id)}">${escapeHtml(u.name)} (${escapeHtml(u.role)})</option>`)
    .join('');
  return layout('Log in', undefined, `
<h2>Log in</h2>
${error ? `<p class="error" data-testid="error">${escapeHtml(error)}</p>` : ''}
<form method="post" action="/login">
  <label for="userId">User</label>
  <select id="userId" name="userId" data-testid="user-select">${options}</select>
  <button type="submit" data-testid="login">Log in</button>
</form>`);
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
      (t) => `  <li><a href="${escapeHtml(t.href)}" data-testid="${t.testId}">${escapeHtml(t.name)}</a> — ${escapeHtml(t.description)}</li>`,
    )
    .join('\n');

  return layout(
    'Home',
    user,
    `
<h2>Internal tools</h2>
<ul class="tools" data-testid="home-tools">
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
<h2>Refund queue</h2>
<form class="filters" method="get" action="/refunds" data-testid="refund-filters">
  <label for="q">Search</label>
  <input type="text" id="q" name="q" value="${escapeHtml(query.q ?? '')}" placeholder="id, customer or reason" data-testid="refund-search" />
  <label for="status">Status</label>
  <select id="status" name="status" data-testid="status-filter">${statusOptions(selectedStatus)}</select>
  ${query.sort ? `<input type="hidden" name="sort" value="${escapeHtml(query.sort)}" /><input type="hidden" name="dir" value="${escapeHtml(effectiveSortDirection(query))}" />` : ''}
  <button type="submit" data-testid="refund-filter-apply">Apply</button>
  <a href="/refunds" data-testid="refund-filter-clear">Clear</a>
</form>
<p class="counts" data-testid="status-counts">All ${counts.all} · PENDING ${counts.PENDING} · APPROVED ${counts.APPROVED} · REJECTED ${counts.REJECTED} · showing ${requests.length}</p>
<table data-testid="queue">
  <thead><tr><th>ID</th><th>Customer</th>${sortHeader('Amount', 'amount', query)}<th>Reason</th>${sortHeader('Status', 'status', query)}${sortHeader('Created', 'created', query)}</tr></thead>
  <tbody>${rows}</tbody>
</table>`);
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
<p><a href="/refunds">← Back to queue</a></p>
<h2>Refund ${escapeHtml(request.id)}</h2>
${error ? `<p class="error" data-testid="error">${escapeHtml(error)}</p>` : ''}
<table>
  <tbody>
    <tr><th>Customer</th><td data-testid="customer-ref">${escapeHtml(request.customerRef)}</td></tr>
    <tr><th>Amount</th><td>${money(request.amountCents)}</td></tr>
    <tr><th>Requested reason</th><td>${escapeHtml(request.reason)}</td></tr>
    <tr><th>Status</th><td><span class="status ${escapeHtml(request.status)}" data-testid="status">${escapeHtml(request.status)}</span></td></tr>
    <tr><th>Created</th><td>${escapeHtml(request.createdAt)}</td></tr>
  </tbody>
</table>

${
  canAct
    ? `<form class="decision" method="post" action="/refunds/${escapeHtml(request.id)}/decision" data-testid="decision-form">
  <label for="reasonNote">Reason</label>
  <input type="text" id="reasonNote" name="reasonNote" data-testid="reason" />
  <button type="submit" name="action" value="APPROVE" data-testid="approve">Approve</button>
  <button type="submit" name="action" value="REJECT" data-testid="reject">Reject</button>
</form>`
    : `<p data-testid="no-actions">${
        user.role === 'reviewer'
          ? 'This request is already decided; no further actions are possible.'
          : 'Read-only access: your role cannot approve or reject refunds.'
      }</p>`
}

<h3>Audit trail</h3>
<table data-testid="audit-trail">
  <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Transition</th><th>Reason</th><th>Gateway ref</th></tr></thead>
  <tbody>${auditRows || '<tr data-testid="audit-empty"><td colspan="6">No audit events yet.</td></tr>'}</tbody>
</table>`);
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
        return `  <td><span class="status" title="${escapeHtml(env)}" data-testid="state-${escapeHtml(f.id)}-${escapeHtml(env)}">${
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
<h2>Feature flags</h2>
<form class="filters" method="get" action="/flags" data-testid="flag-filters">
  <label for="q">Search</label>
  <input type="text" id="q" name="q" value="${escapeHtml(query.q ?? '')}" placeholder="key or description" data-testid="flag-search" />
  <label for="environment">Environment</label>
  <select id="environment" name="environment" data-testid="flag-env-filter">${selectOptions(ENVIRONMENTS, query.environment ?? 'all', 'All environments')}</select>
  <label for="state">State</label>
  <select id="state" name="state" data-testid="flag-state-filter">${selectOptions(['enabled', 'disabled'], query.state ?? 'all', 'Any state')}</select>
  <button type="submit" data-testid="flag-filter-apply">Apply</button>
  <a href="/flags" data-testid="flag-filter-clear">Clear</a>
</form>
<p class="counts" data-testid="flag-counts">Showing ${flags.length} flag${flags.length === 1 ? '' : 's'}</p>
<table data-testid="flags">
  <thead><tr><th>Key</th><th>Description</th>${ENVIRONMENTS.map((env) => `<th>${escapeHtml(env)} state</th>`).join('')}</tr></thead>
  <tbody>${rows}</tbody>
</table>`,
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
  <label for="reasonNote-${escapeHtml(env)}">Reason</label>
  <input type="text" id="reasonNote-${escapeHtml(env)}" name="reasonNote" data-testid="reason-${escapeHtml(env)}" />
  <button type="submit" data-testid="toggle-${escapeHtml(env)}">${state.enabled ? 'Disable' : 'Enable'} in ${escapeHtml(env)}</button>
</form>`
      : `<p data-testid="no-actions-${escapeHtml(env)}">Read-only: your role cannot change this flag in ${escapeHtml(env)}.</p>`;

    return `<section data-testid="environment-${escapeHtml(env)}">
  <h3>${escapeHtml(env)}</h3>
  <p>State: <span class="status" data-testid="state-${escapeHtml(env)}">${current}</span> · updated ${escapeHtml(state.updatedAt)}</p>
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
<p><a href="/flags">← Back to flags</a></p>
<h2>${escapeHtml(flag.key)}</h2>
${error ? `<p class="error" data-testid="error">${escapeHtml(error)}</p>` : ''}
<p>${escapeHtml(flag.description)}</p>
${environmentBlocks}

<h3>Audit trail</h3>
<table data-testid="flag-audit-trail">
  <thead><tr><th>When</th><th>Actor</th><th>Environment</th><th>Transition</th><th>Reason</th><th>External ref</th></tr></thead>
  <tbody>${auditRows || '<tr data-testid="flag-audit-empty"><td colspan="6">No audit events yet.</td></tr>'}</tbody>
</table>`,
    FLAGS_TOOL,
  );
}
