import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, userId: string): Promise<void> {
  await page.goto('/login');
  await page.getByTestId('user-select').selectOption(userId);
  await page.getByTestId('login').click();
}

test('login lands on the internal-tools home page, not the refund queue', async ({ page }) => {
  await login(page, 'user-reviewer');

  await expect(page).toHaveURL('/');
  const tools = page.getByTestId('home-tools');
  await expect(tools).toBeVisible();
  await expect(tools.getByTestId('home-refunds')).toHaveText('Refund Operations');
  await expect(tools.getByTestId('home-flags')).toHaveText('Feature Flag Administration');
});

test('the access panel describes both tools per role', async ({ page }) => {
  await login(page, 'user-reviewer');
  await expect(page.getByTestId('access-summary')).toHaveText(
    'approve/reject refunds; read-only for flags',
  );

  await login(page, 'user-developer');
  await expect(page.getByTestId('access-summary')).toHaveText(
    'read-only for refunds; change flags in development',
  );

  await login(page, 'user-admin');
  await expect(page.getByTestId('access-summary')).toHaveText(
    'read-only for refunds; change flags in any environment',
  );

  await login(page, 'user-viewer');
  await expect(page.getByTestId('access-summary')).toHaveText('read-only across both tools');
});

test('the shared nav moves between the two tools and back home', async ({ page }) => {
  await login(page, 'user-viewer');

  await page.getByTestId('nav-refunds').click();
  await expect(page.getByTestId('queue')).toBeVisible();
  await expect(page.getByTestId('status-counts')).toContainText('PENDING');
  await expect(page.getByTestId('nav-refunds')).toHaveAttribute('aria-current', 'page');

  await page.getByTestId('nav-flags').click();
  await expect(page.getByTestId('flags')).toBeVisible();
  await expect(page.getByTestId('nav-flags')).toHaveAttribute('aria-current', 'page');

  await page.getByTestId('nav-home').click();
  await expect(page.getByTestId('home-tools')).toBeVisible();
});

test('anonymous users cannot reach the home page', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL('/login');
  await expect(page.getByTestId('user-select')).toBeVisible();
});
