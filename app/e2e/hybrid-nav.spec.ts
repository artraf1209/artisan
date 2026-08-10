import { expect, test } from '@playwright/test'

test('hybrid pages are reachable from the navbar', async ({ page }) => {
  await page.goto('/dashboard')
  const primaryNav = page.getByRole('navigation', { name: 'Primary' })

  await primaryNav.getByRole('link', { name: 'Recommendations', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Recommendations' })).toBeVisible()
  await expect(page.locator('main')).toContainText(
    /No pending entry recommendations|Pending ENTER ideas awaiting a human decision/i,
  )

  await primaryNav.getByRole('link', { name: 'Briefing', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Briefing' })).toBeVisible()
  await expect(page.locator('main')).toContainText(
    /No briefings yet|Most recent daily digests returned/i,
  )
})
