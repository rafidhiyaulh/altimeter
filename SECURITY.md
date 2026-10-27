# Security

Altimeter holds learners' essays, scores and, for under-18s, guardian consent. This page lists what is
protected, from whom, how, and where the limits are.

## What is protected

| Asset | Why it matters |
|---|---|
| Essay text and AI feedback | Personal writing, often by minors |
| Scores, forecasts and teacher marks | Decide who gets coaching and what parents are told |
| Guardian consent records | Legal basis for sending a minor's essay to an AI provider (UU PDP No. 27/2022, Art. 25) |
| Partner API keys and the worker secret | Write access to a school's data and to the job queue |
| Review ledger and audit log | The evidence that scores and marks were not changed afterwards |

## Threats and controls

| Threat | Control |
|---|---|
| A school sees another school's learners | Row-level security in Postgres on every table, filtered by the verified JWT (institution, cohort, learner). Pages never share cached renders. Integration tests check each role's view |
| A bug in the app bypasses those checks | The app's login role owns nothing. Each request switches to one narrow role (`alt_user`, `alt_worker` or `alt_api`), and users write only through database functions that re-check permissions. Attempt partitions cannot be read directly |
| Someone edits a teacher's mark or an audit row | Both tables are append-only and hash-chained: each row stores the hash of the previous one, and `alt.verify_chains()` finds any break. The tests confirm that even the database owner cannot update the review ledger |
| A stolen or leaked API key | Keys are stored only as SHA-256 hashes, shown once, scoped to one institution and revocable. Writes also need an HMAC signature over the body with a 5-minute window, so a captured request cannot be replayed later or altered |
| Duplicate writes from retries | `Idempotency-Key` on every write: a retry returns the stored response, and the same key with a different body is rejected |
| Brute force and abuse | Per-key and per-user rate limits kept in Postgres, so they hold across serverless instances. Login attempts are limited. LLM use has per-user and global token budgets |
| A minor's essay sent to an AI provider without consent | The database function `alt.ai_allowed` is checked before every LLM call. Without consent, feedback is built without AI. Names and IDs are never sent, and reports send aggregates only |
| The LLM invents quotes or numbers | Every quoted phrase must appear verbatim in the essay, and every number in a report must match a supplied fact. Items that fail are dropped and counted |
| Data kept longer than needed | Daily retention purge (shorter for under-18s), data export and erasure on request, every step written to the audit log |
| Script injection and clickjacking | Content-Security-Policy with explicit sources, `frame-ancestors 'none'`, HSTS with preload, `nosniff` and a locked-down Permissions-Policy |
| The worker endpoint is called by anyone | Bearer secret compared in constant time. The copy used by pg_cron is kept in Supabase Vault |
| Leaked secrets or vulnerable dependencies | CI runs gitleaks on the full history, `pnpm audit` on production dependencies, and CodeQL for TypeScript and Python. Dependabot opens monthly updates |

## Known limits

- The demo runs in its own schema and roles inside a shared Supabase project. A real deployment should use a dedicated project.
- One-click demo logins are on for the public demo. Set `ALT_DEMO_LOGIN=0` to turn them off.
- Staff accounts have no second factor yet.
- Feedback and reports use an external LLM (Gemini) when consent allows. An in-house OpenAI-compatible model can replace it through `LLM_BASE_URL`.
- There is no WAF in front of the app beyond the platform's defaults and the rate limits above.

## Reporting a problem

Please open a private security advisory on this repository rather than a public issue.
