import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, userId: string): Promise<void> {
  await page.goto('/login');
  await page.getByTestId('user-select').selectOption(userId);
  await page.getByTestId('login').click();
  await expect(page.getByTestId('home-tools')).toBeVisible();
  await page.getByTestId('nav-refunds').click();
  await expect(page.getByTestId('queue')).toBeVisible();
}

test('reviewer approves with a reason: status APPROVED and audit entry visible', async ({ page }) => {
  await login(page, 'user-reviewer');
  await page.getByTestId('link-rr-1001').click();

  await expect(page.getByTestId('status')).toHaveText('PENDING');
  await page.getByTestId('reason').fill('damage photos verified');
  await page.getByTestId('approve').click();

  await expect(page.getByTestId('status')).toHaveText('APPROVED');
  const auditRow = page.getByTestId('audit-trail').locator('tbody tr');
  await expect(auditRow).toHaveCount(1);
  await expect(auditRow.first()).toContainText('PENDING → APPROVED');
  await expect(auditRow.first()).toContainText('damage photos verified');
  await expect(auditRow.first()).toContainText('mock_gw_rr-1001');
});

test('reviewer rejects with a reason: status REJECTED and audit entry visible', async ({ page }) => {
  await login(page, 'user-reviewer');
  await page.getByTestId('link-rr-1002').click();

  await page.getByTestId('reason').fill('charge is legitimate');
  await page.getByTestId('reject').click();

  await expect(page.getByTestId('status')).toHaveText('REJECTED');
  const auditRow = page.getByTestId('audit-trail').locator('tbody tr');
  await expect(auditRow).toHaveCount(1);
  await expect(auditRow.first()).toContainText('PENDING → REJECTED');
  await expect(auditRow.first()).toContainText('charge is legitimate');
});

test('submitting without a reason is rejected and nothing changes', async ({ page }) => {
  await login(page, 'user-reviewer');
  await page.goto('/refunds/rr-1003');

  await page.getByTestId('approve').click();

  await expect(page.getByTestId('error')).toContainText('reason is required');
  await expect(page.getByTestId('status')).toHaveText('PENDING');
  await expect(page.getByTestId('audit-empty')).toBeVisible();
});

test('viewer cannot mutate: no decision form and direct POST is 403', async ({ page }) => {
  await login(page, 'user-viewer');
  await page.goto('/refunds/rr-1004');

  await expect(page.getByTestId('decision-form')).toHaveCount(0);
  await expect(page.getByTestId('no-actions')).toContainText('Read-only');

  // Bypass the UI entirely: server-side authorization must still refuse.
  const response = await page.request.post('/refunds/rr-1004/decision', {
    form: { action: 'APPROVE', reasonNote: 'bypassing the UI' },
  });
  expect(response.status()).toBe(403);

  await page.reload();
  await expect(page.getByTestId('status')).toHaveText('PENDING');
  await expect(page.getByTestId('audit-empty')).toBeVisible();
});

test('queue search and status filter narrow the rows while counts stay full-list', async ({
  page,
}) => {
  await login(page, 'user-viewer');

  const counts = (text: string | null): string => String(text).split(' · showing ')[0];
  const countsBefore = counts(await page.getByTestId('status-counts').textContent());

  await page.getByTestId('refund-search').fill('CUST-0002');
  await page.getByTestId('refund-filter-apply').click();
  await expect(page.getByTestId('row-rr-1002')).toBeVisible();
  await expect(page.getByTestId('row-rr-1001')).toHaveCount(0);
  await expect(page.getByTestId('status-counts')).toContainText('showing 1');
  expect(counts(await page.getByTestId('status-counts').textContent())).toBe(countsBefore);

  await page.getByTestId('refund-filter-clear').click();
  await page.getByTestId('status-filter').selectOption('REJECTED');
  await page.getByTestId('refund-filter-apply').click();
  await expect(page.getByTestId('row-rr-1007')).toBeVisible();
  await expect(page.getByTestId('row-rr-1001')).toHaveCount(0);

  await page.getByTestId('refund-filter-clear').click();
  await page.getByTestId('sort-amount').click();
  await expect(page).toHaveURL(/sort=amount&dir=asc/);
  await expect(page.getByTestId('queue').locator('tbody tr').first()).toContainText('rr-1004');
});

test('applying a filter on top of a sort keeps the sort direction', async ({ page }) => {
  await login(page, 'user-viewer');

  await page.getByTestId('sort-amount').click();
  await page.getByTestId('sort-amount').click();
  await expect(page).toHaveURL(/sort=amount&dir=desc/);
  const sortedIds = await page.getByTestId('queue').locator('tbody tr').allTextContents();

  await page.getByTestId('refund-search').fill('CUST');
  await page.getByTestId('refund-filter-apply').click();
  await expect(page).toHaveURL(/sort=amount&dir=desc/);
  const filteredIds = await page.getByTestId('queue').locator('tbody tr').allTextContents();
  expect(filteredIds).toEqual(sortedIds.filter((row) => filteredIds.includes(row)));
});

test('gateway failure leaves the request PENDING with no audit entry', async ({ page }) => {
  await login(page, 'user-reviewer');
  await page.goto('/refunds/rr-1005');

  await page.getByTestId('reason').fill('approving the rehearsal case');
  await page.getByTestId('approve').click();

  await expect(page.getByTestId('error')).toContainText('gateway');
  await expect(page.getByTestId('status')).toHaveText('PENDING');
  await expect(page.getByTestId('audit-empty')).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('status')).toHaveText('PENDING');
  await expect(page.getByTestId('audit-empty')).toBeVisible();
});
