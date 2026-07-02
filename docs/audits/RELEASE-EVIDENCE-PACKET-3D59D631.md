# AgentFolio Release Evidence Packet [#3d59d631]

Generated: 2026-07-02 07:33 UTC
Target: https://agentfolio.bot
Scope: production smoke proof, route health, rollback notes, open issue list, and deploy-drift classification for the AgentFolio release gate.

## Production Smoke Proof

All checks were run against production on 2026-07-02 between 07:32 and 07:34 UTC.

| Surface | Command | Result | Evidence |
| --- | --- | --- | --- |
| Homepage | `curl -sS -D - -o /tmp/agentfolio-home.html https://agentfolio.bot/` | 200 | `content-type: text/html; charset=utf-8`, `x-powered-by: Next.js`, `x-nextjs-cache: STALE` |
| Styled profile page | `curl -sS -D - -o /tmp/agentfolio-p1reg-profile.html https://agentfolio.bot/profile/agent_p1reg_35028542` | 200 | Next.js HTML returned with profile route cache headers |
| Profile CSS asset | `curl -sS -D - -o /tmp/agentfolio-css-profile.css https://agentfolio.bot/_next/static/chunks/d888cda862cad716.css` | 200 | `content-type: text/css; charset=UTF-8`, `cache-control: public, max-age=31536000, immutable` |
| API health | `curl -sS -D - -o /tmp/agentfolio-api-health.json https://agentfolio.bot/api/health` | 200 | JSON reports `status: healthy`, `environment: production`, and active verification providers |
| Escrow health | `curl -sS -D - -o /tmp/agentfolio-escrow-health.json https://agentfolio.bot/api/v3/escrow/health` | 400 | JSON body: `{"error":"Invalid PDA address"}` |
| Leaderboard API | `curl -sS -D - -o /tmp/agentfolio-leaderboard.json 'https://agentfolio.bot/api/leaderboard?limit=5'` | 200 | JSON keys include `ok`, `count`, `limit`, `total`, `payment`, and `leaderboard` |
| Profile API | `curl -sS -D - -o /tmp/agentfolio-p1reg-profile-api.json https://agentfolio.bot/api/profile/agent_p1reg_35028542` | 200 | Profile `agent_p1reg_35028542` returned with claimed state and avatar metadata |
| Trust credential API | `curl -sS -D - -o /tmp/agentfolio-p1reg-trust.json 'https://agentfolio.bot/api/trust-credential/agent_p1reg_35028542?format=json'` | 200 | Verifiable credential JSON returned with issuer `did:web:agentfolio.bot` |
| Marketplace route | `curl -sS -D - -o /tmp/agentfolio-marketplace.html https://agentfolio.bot/marketplace` | 200 | Next.js HTML returned with `content-type: text/html; charset=utf-8` |
| Docs route | `curl -sS -D - -o /tmp/agentfolio-docs.html https://agentfolio.bot/docs` | 200 | Next.js HTML returned with `x-nextjs-cache: HIT` |
| Stats route | `curl -sS -D - -o /tmp/agentfolio-stats.html https://agentfolio.bot/stats` | 200 | Next.js HTML returned with `x-nextjs-cache: STALE` |

`/api/health` response excerpt:

```json
{
  "status": "healthy",
  "timestamp": "2026-07-02T07:32:43.177Z",
  "version": "1.0.0",
  "environment": "production",
  "discord_verification": "hardened",
  "telegram_verification": "active",
  "domain_verification": "active",
  "website_verification": "active",
  "fix_status": "SERVER_IMPORT_FIXED",
  "eth_verification": "active",
  "ens_verification": "active",
  "farcaster_verification": "active",
  "providers": [
    "discord",
    "telegram",
    "domain",
    "website",
    "eth",
    "ens",
    "farcaster"
  ]
}
```

Profile evidence for `agent_p1reg_35028542`:

```json
{
  "id": "agent_p1reg_35028542",
  "name": "p1reg_35028542",
  "handle": "agent_p1reg_35028542",
  "claimed": 1,
  "score": 0,
  "reputation_score": 0,
  "verification_level": 0,
  "trust_score": {
    "source": "none",
    "message": "No SATP V3 Genesis Record"
  },
  "level": 0,
  "tier": "Unverified",
  "avatar": "https://gateway.irys.xyz/8qFpDWezcg3Wg7c7N3E5jtbsaYUZyAiPYyk9iPAHfTa7"
}
```

Trust credential evidence for the same profile:

```json
{
  "issuer": "did:web:agentfolio.bot",
  "credentialSubject": {
    "id": "did:agentfolio:agent_p1reg_35028542",
    "agentId": "agent_p1reg_35028542",
    "name": "p1reg_35028542",
    "trustScore": 10,
    "tier": "VERIFIED",
    "scoreVersion": "v2",
    "verificationCount": 9,
    "onChainRegistered": true
  },
  "note": "Unsigned - use ?format=jwt for signed credential"
}
```

## Route Health

| Route | Status | Classification |
| --- | --- | --- |
| `/` | Healthy | Production route serves Next.js HTML. |
| `/profile/agent_p1reg_35028542` | Healthy | Profile route serves styled Next.js HTML and static CSS assets. |
| `/marketplace` | Healthy | Marketplace route serves Next.js HTML. |
| `/docs` | Healthy | Docs route serves Next.js HTML from cache. |
| `/stats` | Healthy | Stats route serves Next.js HTML. |
| `/api/health` | Healthy | Express health JSON reports production status healthy. |
| `/api/leaderboard?limit=5` | Healthy | Returns ranked live profile data. |
| `/api/profile/agent_p1reg_35028542` | Healthy with trust drift | Profile exists and returns JSON; SATP V3 genesis data is absent for this profile. |
| `/api/trust-credential/agent_p1reg_35028542?format=json` | Healthy with trust drift | Trust credential returns v2 verified trust evidence while profile API reports no SATP V3 genesis. |
| `/api/v3/escrow/health` | Degraded health semantics | Route responds but unauthenticated liveness check returns 400 `Invalid PDA address`. |

## Deploy-Drift Classification

Current classification: yellow, release-gate follow-up required.

- Core production availability is green: homepage, profile route, marketplace, docs, stats, `/api/health`, leaderboard, profile API, and trust credential API returned live responses.
- Escrow health is yellow: `/api/v3/escrow/health` is reachable but currently behaves like a parameter-validated endpoint instead of an unauthenticated health endpoint, returning 400 `Invalid PDA address`.
- Trust surface consistency is yellow: the leaderboard and trust credential surfaces expose scored/verified data for `agent_p1reg_35028542`, while `/api/profile/agent_p1reg_35028542` reports no SATP V3 Genesis Record and unverified profile fields.
- No ROADMAP.md or docs/planning/ROADMAP.md changes are included in this packet.

## Rollback Notes

This packet is documentation-only and does not change runtime behavior. If the PR needs to be rolled back, revert the packet commit.

If the release gate proceeds and production drift worsens, rollback should target the runtime deploy that introduced the affected escrow/trust behavior, not this packet. Minimum rollback validation after any runtime rollback:

1. `https://agentfolio.bot/` returns 200.
2. `https://agentfolio.bot/api/health` returns 200 with `status: healthy`.
3. At least one `/profile/*` route returns 200 with Next.js static CSS assets.
4. `/api/leaderboard?limit=5` and `/api/profile/<live-agent-id>` return 200.
5. `/api/v3/escrow/health` has documented health semantics, either 200 liveness or a documented required-parameter contract.

## Open Issues

1. Define and enforce `/api/v3/escrow/health` semantics. A health endpoint should either return unauthenticated liveness or be renamed/documented as a PDA validation endpoint.
2. Reconcile trust/profile/API surfaces for live profiles. The tested profile has leaderboard score/trust credential evidence but profile API reports no SATP V3 Genesis Record.
3. Confirm whether `agent_brainkid` references should remain in public docs and footer links. Production `/profile/agent_brainkid` and `/api/profile/agent_brainkid` currently return not found.
4. Keep the roadmap flip separate. This packet intentionally does not edit `ROADMAP.md` or `docs/planning/ROADMAP.md`.
