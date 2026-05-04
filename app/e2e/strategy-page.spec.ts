import { expect, test } from '@playwright/test'

test('strategy page exposes the four-block multi-factor layout', async ({ page }) => {
  await page.goto('/strategy')

  await expect(page.getByRole('heading', { name: 'Strategy' })).toBeVisible()
  await expect(page.getByText('Strategy Summary')).toBeVisible()
  await expect(page.getByText('Stocks To Trade')).toBeVisible()
  await expect(page.getByText('When To Trade')).toBeVisible()
  await expect(page.getByText('Trade Pipeline')).toBeVisible()
  await expect(page.locator('select')).toBeVisible()
})
