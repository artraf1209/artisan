import { expect, test } from '@playwright/test'

test('hybrid pages are reachable from the navbar', async ({ page }) => {
  await page.goto('/dashboard')

  await page.getByRole('link', { name: /queue/i }).click()
  await expect(page.getByRole('heading', { name: 'Approval Queue' })).toBeVisible()
  await expect(page.locator('main')).toContainText(
    /No pending approvals|Review pending hybrid-engine signals/i,
  )

  await page.getByRole('link', { name: /briefings/i }).click()
  await expect(page.getByRole('heading', { name: 'Daily Briefings' })).toBeVisible()
  await expect(page.locator('main')).toContainText(
    /No briefings yet|Morning summaries generated/i,
  )
})
