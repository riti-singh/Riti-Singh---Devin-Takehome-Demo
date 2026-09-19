import type { AuditEvent, RefundRequest, User } from './domain/types.js';

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

function layout(title: string, user: User | undefined, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)} · Refund Operations</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 60rem; color: #14171a; }
  header { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1px solid #ddd; padding-bottom: .5rem; }
  table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
  th, td { text-align: left; padding: .5rem .6rem; border-bottom: 1px solid #eee; font-size: .95rem; }
  .status { font-weight: 600; font-size: .8rem; padding: .15rem .45rem; border-radius: .25rem; }
  .PENDING { background: #fff3cd; } .APPROVED { background: #d6f5d6; } .REJECTED { background: #f8d7da; }
  .error { background: #f8d7da; border: 1px solid #e0a3ab; padding: .75rem; border-radius: .3rem; }
  form.decision { margin-top: 1rem; display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; }
  input[type=text] { padding: .4rem; min-width: 22rem; }
  button { padding: .4rem .8rem; cursor: pointer; }
</style>
</head>
<body>
<header>
  <h1><a href="/refunds" style="text-decoration:none;color:inherit">Refund Operations</a></h1>
  <div>${
    user
      ? `Signed in as <strong data-testid="current-user">${escapeHtml(user.name)}</strong> (${escapeHtml(user.role)}) · <a href="/logout">Log out</a>`
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

export function queuePage(user: User, requests: RefundRequest[]): string {
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
  return layout('Queue', user, `
<h2>Refund queue</h2>
<table data-testid="queue">
  <thead><tr><th>ID</th><th>Customer</th><th>Amount</th><th>Reason</th><th>Status</th><th>Created</th></tr></thead>
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
