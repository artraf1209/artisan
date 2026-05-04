import { expect, test } from '@playwright/test'

test('hybrid pages are reachable from the navbar', async ({ page }) => {
  await page.goto('/dashboard')
  const primaryNav = page.getByRole('navigation', { name: 'Primary' })

  await primaryNav.getByRole('link', { name: 'Queue', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Queue' })).toBeVisible()
  await expect(page.locator('main')).toContainText(
    /No pending approvals|Review pending hybrid-engine signals/i,
  )

  await primaryNav.getByRole('link', { name: 'Briefings', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Briefings' })).toBeVisible()
  await expect(page.locator('main')).toContainText(
    /No briefings yet|Morning summaries generated/i,
  )
})
