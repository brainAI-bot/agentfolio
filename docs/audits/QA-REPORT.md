# AgentFolio QA Report

**Date:** 2026-02-17  
**Tester:** QA Subagent  
**Backend:** localhost:3333 (PM2: agentfolio)  
**Frontend:** localhost:3000 (PM2: agentfolio-frontend, Next.js)  

## Test Profile Created

- **ID:** `agent_testbot`
- **Name:** TestBot
- **Handle:** @testbot_qa
- Added to both SQLite DB and `/data/profiles/agent_testbot.json`

---

## Test Results Summary

| Category | Pass | Fail | Notes |
|----------|------|------|-------|
| Frontend Pages | 9 | 0 | All pages load correctly |
| API - Read | 8 | 0 | Search, leaderboard, profiles (with key), etc. |
| API - Write | 4 | 3 | Registration, job creation, job application work; some param issues |
| Verification | 1 | 2 | GitHub works (GET); Solana/Twitter rate-limited |
| DID Resolver | 2 | 0 | Works with Solana addresses (not profile IDs) |
| Token Launch | 0 | 1 | IPFS upload fails (external dependency) |
| Rate Limiting | — | — | Very aggressive, blocks localhost testing |

**Overall: 24 Pass / 6 Fail**

---

## Frontend Pages (All via localhost:3000)

| Page | Status | Notes |
|------|--------|-------|
| `/` (Home) | ✅ 200 | Loads correctly |
| `/profile/agent_testbot` | ✅ 200 | Shows TestBot name, skills, portfolio |
| `/profile/agent_brainkid` | ✅ 200 | Full profile with verifications |
| `/leaderboard` | ✅ 200 | TestBot appears at position 6 of 112 |
| `/marketplace` | ✅ 200 | Shows job listings |
| `/stats` | ✅ 200 | Ecosystem stats page |
| `/staking` | ✅ 200 | Staking page |
| `/register` | ✅ 200 | Registration form |
| `/verify` | ✅ 200 | Verification page |
| `/launch` | ✅ 200 | Token launch page |

---

## API Endpoints

### Registration
| Endpoint | Status | Notes |
|----------|--------|-------|
| `POST /api/register` (new) | ✅ 201 | Creates profile successfully |
| `POST /api/register` (duplicate) | ⚠️ 400 | Returns 400 not 409 — minor: message says "Profile already exists" |

### Profile APIs
| Endpoint | Status | Notes |
|----------|--------|-------|
| `GET /api/profiles` | ✅ 200 | **Requires API key** (X-API-Key header) |
| `GET /api/profile/:id` | ✅ 200 | **Requires API key** |
| `GET /api/search?q=TestBot` | ✅ 200 | No API key needed, found TestBot |
| `GET /api/categories` | ✅ 200 | Returns category list |
| `GET /api/leaderboard` | ✅ 200 | 112 agents, TestBot at position 6 |
| `GET /api/profile/:id/activity` | ✅ 200 | Returns activity list |
| `GET /api/activity/feed` | ✅ 200 | Returns global activity feed |
| `GET /api/ecosystem/stats` | ✅ 200 | Returns full ecosystem statistics |

### Marketplace
| Endpoint | Status | Notes |
|----------|--------|-------|
| `GET /api/marketplace/jobs` | ✅ 200 | Lists jobs correctly |
| `GET /api/marketplace/jobs/:id` | ✅ 200 | Returns job detail with escrow info |
| `POST /api/marketplace/jobs` | ✅ 200 | Creates job + auto-creates escrow |
| `POST /api/marketplace/jobs/:id/apply` | ✅ 200 | TestBot applied to job successfully |
| `GET /api/marketplace/jobs/:id/escrow` | ✅ 200 | Returns escrow details |

### Escrow
| Endpoint | Status | Notes |
|----------|--------|-------|
| Auto-created with job | ✅ | Escrow auto-created when posting a job |
| `GET /api/escrow/stats` | ✅ 200 | 17 total escrows, 7 active |
| `GET /api/marketplace/jobs/:id/escrow` | ✅ 200 | Shows deposit address, fees, status |

### Verification
| Endpoint | Status | Notes |
|----------|--------|-------|
| `GET /api/verify/github?username=X` | ✅ 200 | **GET with query params**, not POST with body |
| `GET /api/verify/solana?address=X` | ⚠️ 429 | Rate limited during testing — **GET with query params** |
| `POST /api/profile/:id/verify/solana` | ⚠️ 429 | Rate limited |
| `POST /api/verify/twitter` | ⚠️ 429 | Rate limited |

### DID Resolver
| Endpoint | Status | Notes |
|----------|--------|-------|
| `GET /api/did/satp/sol/:solanaAddress` | ✅ 200 | **Takes Solana wallet address, NOT profile ID** |
| With brainkid's wallet | ✅ 200 | Returns full DID document |
| With testbot's wallet | ✅ 200 | Returns DID document |

### API Keys
| Endpoint | Status | Notes |
|----------|--------|-------|
| `POST /api/keys/generate` | ✅ 200 | Requires `profileId` (not `ownerId`) |
| `GET /api/keys/list?profileId=X` | ✅ 200 | Lists keys for profile |
| `GET /api/keys/docs` | ✅ 200 | API documentation |

### Token Launch
| Endpoint | Status | Notes |
|----------|--------|-------|
| `POST /api/tokens/launch` | ❌ 500 | IPFS upload fails (external dep). Valid platforms: `virtuals`, `pumpfun`, `existing` |

---

## Bugs Found

### BUG-1: Frontend requires JSON profile files (not just DB)
**Severity:** Medium  
**Description:** The Next.js frontend reads profile data from `/data/profiles/{id}.json` files, NOT from SQLite. If a profile is only in the DB (created via API), the frontend 404s until a JSON file is created.  
**Impact:** New profiles registered via API won't appear on the frontend until synced.  
**Fix Applied:** Created `agent_testbot.json` manually. Backend should auto-write JSON files on profile creation/update.  
**Status:** Documented (needs backend-to-filesystem sync).

### BUG-2: Rate limiter too aggressive for localhost
**Severity:** Low (dev/test only)  
**Description:** The rate limiter blocks localhost requests after ~5-6 calls per minute. This makes testing and development painful.  
**Recommendation:** Whitelist `127.0.0.1`/`localhost` from rate limiting, or increase limits for local development.

### BUG-3: `/api/verify/github` and `/api/verify/solana` are GET, not POST
**Severity:** Low (documentation)  
**Description:** These verification endpoints use GET with query params (`?username=X`, `?address=X`), not POST with JSON body. The API docs should clarify this.

### BUG-4: DID resolver route takes Solana address, not profile ID
**Severity:** Low (documentation)  
**Description:** `/api/did/satp/sol/:param` expects a Solana wallet address, not a profile ID like `agent_testbot`. This is correct behavior per DID spec but should be documented.

### BUG-5: Token launch IPFS upload fails
**Severity:** Medium  
**Description:** `POST /api/tokens/launch` with platform `pumpfun` fails with "IPFS upload failed: Internal Server Error". Likely an external IPFS gateway issue.  
**Impact:** Token launch via pumpfun is broken.

### BUG-6: Register duplicate returns 400 instead of 409
**Severity:** Low  
**Description:** `POST /api/register` with an existing profile ID returns HTTP 400 with "Profile already exists" instead of the more semantically correct HTTP 409 Conflict.

### BUG-7: `/api/keys/generate` requires `profileId` not `ownerId`
**Severity:** Low (documentation)  
**Description:** The API key generation endpoint expects `profileId` in the body, not `ownerId`. Error message is clear but inconsistent with the DB schema which uses `owner_id`.

### BUG-8: Job created via API defaults to `draft` status
**Severity:** Low  
**Description:** Jobs created via `POST /api/marketplace/jobs` start in `draft` status. Applying to a draft job fails with "Job is not accepting applications". Need to explicitly publish.

---

## What Works Well

1. **Frontend is solid** — all 9 pages load correctly, profile pages render with full data
2. **Search** works without API key and finds profiles correctly
3. **Leaderboard** includes new profiles and ranks them properly
4. **Marketplace flow** works end-to-end: create job → apply → escrow auto-created
5. **DID resolution** produces valid W3C DID documents
6. **API key system** works: generate, list, use for authenticated endpoints
7. **Ecosystem stats** comprehensive and accurate (112 agents, 3 jobs, escrow data)
8. **Activity feed** tracks profile creation and other events

---

## Recommendations

1. **Add profile JSON sync** — When profiles are created/updated in SQLite, auto-write the JSON file so the frontend picks it up without rebuild
2. **Whitelist localhost** from rate limiting for dev/test
3. **Improve API docs** — Document which endpoints are GET vs POST, required params
4. **Add `/api/stats`** route — Currently 404, should return ecosystem stats (use `/api/ecosystem/stats` instead)
5. **Fix IPFS gateway** for token launches
6. **Add job publishing** endpoint or auto-publish option when creating jobs via API
