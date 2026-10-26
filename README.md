# Altimeter

**Readiness and score trust for English test-prep institutions.** A concept built for Acsent's B2B side.

**Live:** https://altimeter-readiness.vercel.app (one-click demo: Acsent team, institution admin, learner)

It answers three questions a school, university or scholarship programme asks before buying:

1. **Who will hit the target band by the deadline**, and who should get this week's coaching slots?
2. **How accurate are the AI scores**, measured against teachers and official results?
3. **Is children's data safe**: guardian consent, retention, erasure?

> Synthetic institutions, learners, teacher marks and official results. The 2,224 essay texts are real learner essays from a public corpus (Apache-2.0), scored by the real model through the real queue. No Acsent data is used.

## Results

| | |
|---|---|
| Writing model, prompts never seen in training | MAE 0.45 band, 82% within ±0.5, QWK 0.54 (mean baseline 0.59 / 60% / 0) |
| External check vs **human** raters (ELLIPSE, 3,911 essays) | Spearman 0.39 (essay length alone 0.24) |
| TypeScript serving vs Python training | max difference < 1e-9 on 300 essays |
| Readiness backtest, writing, with calibration | MAE 0.63 → 0.47, within ±0.5 62% → 81% |
| Chance of reaching the target, 4 weeks ahead | Brier 0.070 → 0.054 with calibration |
| System integration test against production | 54/54 |

Honesty notes: the public corpus had 4,234 duplicate essays and ~1,000 prompts leaking between its train and test splits (fixed by de-duplicating and re-splitting by prompt). Its labels look machine-made (no 7.5 band; 14% of essays at 8.0 on every criterion), which is exactly why the teacher audit and calibration exist.

## Six pillars

| Pillar | What |
|---|---|
| Relational DB | Postgres 17, schema `alt`: monthly partitions, bitemporal scores and forecasts (one current row by partial unique index), append-only hash-chained review ledger and audit log, writes only through functions |
| APIs + backend | Next.js 16 route handlers; partner API v1 with OpenAPI 3.1, API keys stored as SHA-256, HMAC request signatures, Idempotency-Key replay, RFC 9457 errors, Postgres rate limits |
| Distributed systems | pgmq queue with competing serverless workers, visibility timeout (at-least-once), idempotent effects (exactly-once), DLQ after 3 failures, coalesced readiness jobs, pg_cron + pg_net safety net with the secret in Vault; tested by killing a worker mid-batch |
| AI / ML | LightGBM per IELTS criterion with features written once in TypeScript (used by training and serving), split-conformal intervals, tree-path explanations; Kalman filter per skill + Monte Carlo with IELTS rounding; offset calibration to official results; LLM feedback and reports that must quote the essay / cite numbered facts |
| Cloud | Vercel sin1 + Supabase Singapore; standalone Dockerfile for a VPS behind Caddy |
| Security | RLS per institution / cohort / learner, an ownerless login role switching to one role per path, guardian consent before any LLM call on a minor's essay, retention purge by pg_cron, export and erasure, CSP/HSTS, UU PDP mapping |

## Layout

```
ml/               Python: corpus prep, writing model, ELLIPSE check, synthetic cohorts
db/migrations/    schema, RLS, runtime functions (versioned)
web/              Next.js app, API, worker, scripts (migrate, seed, cron, auth, SIT, screenshots)
```

## Run

```bash
cd ml && uv sync && uv run python -m altimeter_ml.prep && cd ../web
node scripts/dump-features.mjs ../ml/data/work/essays.jsonl ../ml/data/work/features.jsonl
cd ../ml && uv run python -m altimeter_ml.train_writing && uv run python -m altimeter_ml.validate_ellipse && uv run python -m altimeter_ml.synth
cd ../web && pnpm install
node scripts/backtest-readiness.mjs ../ml/data/work ../ml/artifacts/readiness_backtest.json
node --env-file=../.env.local scripts/migrate.mjs
node scripts/build-seed.mjs ../ml/data/work ../db/seed && node --env-file=../.env.local scripts/seed.mjs ../db/seed
node --env-file=../.env.local scripts/setup-auth.mjs
node --env-file=../.env.local scripts/setup-cron.mjs https://<your-url>
node --env-file=../.env.local scripts/seed-reviews.mjs ../db/seed/labels.json
pnpm test && pnpm lint && node --env-file=../.env.local scripts/sit.mjs https://<your-url>
```

Concept prototype by Muhammad Rafi Dhiyaulhaq. Not an official Acsent product.
