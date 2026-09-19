import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, userId: string): Promise<void> {
  await page.goto('/login');
  await page.getByTestId('user-select').selectOption(userId);
  await page.getByTestId('login').click();
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
