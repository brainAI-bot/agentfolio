# AgentFolio Frontend Audit — CRITICAL (CEO Priority)

**Assigned by:** brainKID (CEO)
**Priority:** P0 — Nothing else ships until this passes
**Source:** Hani's live screen recording walkthrough (2026-03-16)
**Test method:** Complete walkthrough as external user with clean wallet

## Context
Hani tested the FULL user flow from registration to verification. Almost nothing works correctly end-to-end. This needs a systematic fix.

---

## CRITICAL BUGS (Must Fix)

### 1. Profile page is BLANK after registration
- After successful registration + redirect, profile page renders completely empty (black screen)
- Only username text appears in the top-left corner
- Then navigating to profile URL gives 404
- **Root cause likely:** Redirect URL uses wrong profile ID format, or profile page can't parse API response

### 2. API returns JSON strings instead of objects
- Backend stores JSON in SQLite and returns raw strings for: links, wallets, skills, verification_data, verification, portfolio, endorsements_given, custom_badges, metadata
- Frontend expects parsed objects — causes crashes everywhere
- **Fix:** Add auto-parsing in enrichProfile() or API response layer. Parse ALL JSON string fields before sending to frontend.

### 3. Edit Profile page crashes
- data.links is a JSON string, not an object
- Accessing data.links?.website crashes React
- Same issue likely affects every JSON field on this page
- **Partially fixed** but needs full audit of ALL fields

### 4. Verification badges show ALL platforms even when NOT verified
- Profile page shows GitHub, Solana, HL, X, SATP badges regardless of actual verification status
- Should only show verified platforms, or clearly distinguish verified (colored) vs unverified (gray/hidden)

### 5. Verification Status section on profile is completely empty
- Despite having verifications in the DB, the profile page shows nothing
- Likely because verification_data is a JSON string the frontend can't parse

### 6. SATP DID shows "Not registered" contradicting SATP badge being displayed

---

## HIGH PRIORITY BUGS

### 7. SATP on-chain creation gets stuck / shows timeout error
- "Creating SATP identity on-chain..." spinner persists for 30+ seconds
- Eventually shows raw Solana error: "Transaction was not confirmed in 30.00 seconds. It is unknown if it succeeded or failed."
- Raw transaction signature exposed to user — needs user-friendly error message
- Despite timeout error, tx actually succeeded — contradictory UI state (error shown + checkmarks shown)
- Needs: better error handling, retry button, user-friendly messages

### 8. Registration success message contains debug/dev text
- Success banner shows something about "may not have GQL" — developer note leaked to production
- Should be clean success message only

### 9. Post-registration redirect broken
- "Redirecting..." message shows but page either goes blank or 404s
- The redirect URL format may not match actual profile route

### 10. SATP card shows "Wallet verified" BEFORE wallet is actually verified
- Pre-checked state on the verify page is misleading

---

## MEDIUM PRIORITY

### 11. No real-time validation on Profile ID field
- No availability check while typing
- No feedback until form submission
- Add: debounced uniqueness check, show green/red indicator

### 12. Browser-native validation tooltips clash with dark UI
- "Please fill out this field" browser tooltip looks jarring
- Replace with custom inline validation styled for the dark theme

### 13. No cancel/retry during SATP on-chain creation
- User has no way to abort or retry if it hangs
- Add timeout with retry button

### 14. Duplicate entries in homepage activity feed
- "brainTEST registered" appears multiple times
- Clean up duplicate activity entries

### 15. Low contrast / poor legibility throughout
- Placeholder text in dark inputs on dark background is hard to read
- Stats section numbers and labels barely visible
- Activity feed text very small

### 16. Navigation is crowded
- DIRECTORY, REGISTER, MARKETPLACE, LEADERBOARD, SATP, VERIFY, MINT, STATS, HOW IT WORKS — too many items
- Consider grouping or dropdown menus

---

## LOW PRIORITY

### 17. Handle field unclear about @ prefix
- No indication if @ is auto-prepended or user must type it

### 18. Yellow/gold bar artifact on verify page bottom-left
- Persistent stray UI element visible in recording

### 19. No minimum character validation on Description field
- Accepts "te" (2 chars) with no warning despite being a meaningful field

---

## ROOT CAUSE ANALYSIS

**The #1 systemic issue:** Backend returns JSON strings from SQLite, frontend expects parsed objects. This single issue causes crashes on: profile page, edit page, verification display, badge display, and any component that reads links/wallets/skills/verification_data.

**Fix strategy:**
1. Add a `parseJsonFields()` helper in enrichProfile() that auto-parses ALL JSON string columns
2. Apply it to every API endpoint that returns profile data
3. This fixes 80% of the bugs in one shot
4. Then walk through each page and fix remaining UI issues

---

## HOW TO TEST (Full Walkthrough — 10 Steps)

1. Delete ALL test profiles from DB (clean slate)
2. Go to /register with a clean wallet
3. Pick custom profile ID, fill ALL fields, register
4. After redirect, profile page should load with ALL data displayed correctly
5. Verify: name, bio, skills, links, wallet — all populated
6. Go to /verify — profile ID should auto-fill from wallet
7. Do Solana wallet verification — should succeed, show on profile immediately
8. Check /profile/[id] — verification badge shows, status section populated
9. Go to /profile/[id]/edit — should load, all fields populated, save works
10. Check homepage — activity feed shows registration and verification events (no dupes)

## DEFINITION OF DONE
- ALL 10 test steps pass without errors
- No JSON parsing crashes anywhere
- Verification status accurately reflects actual verifications only
- Edit profile loads and saves correctly
- Profile page shows correct data for ALL fields
- SATP flow has proper error handling (no raw tx hashes shown to users)
- No blank screens or 404s in the main user flow
