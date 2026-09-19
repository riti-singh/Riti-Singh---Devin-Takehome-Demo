import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, userId: string): Promise<void> {
  await page.goto('/login');
  await page.getByTestId('user-select').selectOption(userId);
  await page.getByTestId('login').click();
  await expect(page.getByTestId('queue')).toBeVisible();
  await page.goto('/flags');
  await expect(page.getByTestId('flags')).toBeVisible();
}

test('admin enables a production flag: state ENABLED and audit entry visible', async ({ page }) => {
  await login(page, 'user-admin');
  await page.getByTestId('link-ff-checkout-v2').click();

  await expect(page.getByTestId('state-production')).toHaveText('DISABLED');
  await page.getByTestId('reason-production').fill('rollout approved');
  await page.getByTestId('toggle-production').click();

  await expect(page.getByTestId('state-production')).toHaveText('ENABLED');
  const auditRow = page.getByTestId('flag-audit-trail').locator('tbody tr');
  await expect(auditRow).toHaveCount(1);
  await expect(auditRow.first()).toContainText('DISABLED → ENABLED');
  await expect(auditRow.first()).toContainText('rollout approved');
  await expect(auditRow.first()).toContainText('mock_ff_checkout-v2_production');
});

test('developer enables a development flag', async ({ page }) => {
  await login(page, 'user-developer');
  await page.getByTestId('link-ff-bulk-refunds').click();

  await expect(page.getByTestId('state-development')).toHaveText('DISABLED');
  await page.getByTestId('reason-development').fill('testing the bulk path');
  await page.getByTestId('toggle-development').click();

  await expect(page.getByTestId('state-development')).toHaveText('ENABLED');
  await expect(page.getByTestId('state-production')).toHaveText('DISABLED');
  const auditRow = page.getByTestId('flag-audit-trail').locator('tbody tr');
  await expect(auditRow).toHaveCount(1);
  await expect(auditRow.first()).toContainText('development');
});

test('developer cannot change production: no form and direct POST is 403', async ({ page }) => {
  await login(page, 'user-developer');
  await page.goto('/flags/ff-dark-mode');

  await expect(page.getByTestId('change-form-development')).toBeVisible();
  await expect(page.getByTestId('change-form-production')).toHaveCount(0);
  await expect(page.getByTestId('no-actions-production')).toContainText('Read-only');

  // Bypass the UI entirely: server-side authorization must still refuse.
  const response = await page.request.post('/flags/ff-dark-mode/change', {
    form: { environment: 'production', enabled: 'false', reasonNote: 'bypassing the UI' },
  });
  expect(response.status()).toBe(403);

  await page.reload();
  await expect(page.getByTestId('state-production')).toHaveText('ENABLED');
  await expect(page.getByTestId('flag-audit-empty')).toBeVisible();
});

test('external system failure leaves the flag unchanged with no audit entry', async ({ page }) => {
  await login(page, 'user-admin');
  await page.goto('/flags/ff-apply-fail');

  await page.getByTestId('reason-production').fill('rehearsing the failure path');
  await page.getByTestId('toggle-production').click();

  await expect(page.getByTestId('error')).toContainText('feature flag system');
  await expect(page.getByTestId('state-production')).toHaveText('DISABLED');
  await expect(page.getByTestId('flag-audit-empty')).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('state-production')).toHaveText('DISABLED');
  await expect(page.getByTestId('flag-audit-empty')).toBeVisible();
});
