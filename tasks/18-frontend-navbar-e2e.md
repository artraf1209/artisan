# Task 18 — Frontend: Navbar + Smoke Test

**Status:** ⬜ pending  
**Depends on:** 15 16 17  
**Estimated effort:** 2–4 hours  

---

## Goal
Finish the Phase 0 frontend loop by linking the new hybrid pages from the navbar and adding one lightweight end-to-end smoke test for the happy path.

---

## Files to create

```text
playwright.config.ts
app/e2e/hybrid-nav.spec.ts
```

---

## Files to modify

```text
app/src/components/shared/Navbar.tsx
```

---

## Implementation notes

- Add navbar links for:
  - `/trades/queue`
  - `/briefings`
- Keep the legacy pages intact.
- Add one Playwright smoke test that verifies the new pages are reachable.
- Minimum flow to cover:
  1. open dashboard
  2. navigate to queue
  3. navigate to briefings
  4. confirm each page renders its heading or empty state
- If the app does not already have Playwright, add the smallest viable setup in this task.

---

## Acceptance criteria

- [ ] Navbar links expose the new hybrid pages
- [ ] Legacy navigation remains intact
- [ ] One end-to-end smoke test covers queue and briefings navigation
- [ ] Test is runnable in CI with a documented command
