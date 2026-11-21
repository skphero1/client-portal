# Sysfortech Client Portal (GraphQL, Project 2) — Run Report
**Run on Muse's side, 18 Nov 2026.** Project folder: `~/workspace/projects/sysfortech-client-portal`
Generator script kept at `~/workspace/projects/graphql-run/gen_graphql.py`.

## Verdict
**It runs. The GraphQL API works end-to-end against real Postgres, and tenant
isolation holds in every check I ran.** Two real defects in the pasted code
(plus two missing pieces) — details below. Nothing was faked: the 19/19
harness checks run the real resolvers/repo/DataLoaders, and the production
server checks run against real PostgreSQL 16.

## What ran
| Step | Result |
|---|---|
| `npm install` | Failed twice on `@prisma/engines` postinstall — Node's TLS download from `binaries.prisma.sh` kept getting `ECONNRESET`. `curl` downloads the same files fine (8 MB in ~2 s), so I downloaded the engines with curl and placed them by hand. `npm install --ignore-scripts` then passed (127 packages). |
| `npx prisma generate` | Failed at first for the same download reason, then passed after the engines were placed in **both** `node_modules/@prisma/engines/` and `node_modules/prisma/` (the CLI looks in its own folder; the library file must be named `libquery_engine-...so.node`, underscore, not `libquery-engine-...`). |
| `npx tsc --noEmit` | **2 errors, both real** — see fix below. After the fix: **pass, exit 0**. |
| Postgres | This VM has no Docker, so Postgres 16.15 was installed with apt instead of `docker compose`. `apt-get update` took 6+ min (mirror throttled to ~36 kB/s); the 44 MB of .debs were fetched with curl in ~15 s instead. Cluster `main` on :5432, user `sysfortech`, DBs `sysfortech_dev` + `sysfortech_test`. |
| `prisma migrate deploy` (dev + test) | Both pass. |
| `npm run db:seed` | Pass. Real DB counts: 2 tenants, 3 users, 4 memberships, 9 projects, 11 invoices, 7 tickets. |
| `npm run build` | **Pass** (surprising — see note). `/api/graphql` built as a dynamic route. |
| `npx vitest run` / `npm test` | **Fail: "No test files found, exiting with code 1"** — there is no `tests/` folder in the paste. |
| `npm run benchmark` | **Cannot run** — `scripts/benchmark-n-plus-1.ts` is missing from the paste. |
| Production server (`next start`, real Postgres) | Live on :3000, all checks below pass. Server stopped afterwards; Postgres left running. |

## The one code fix (mine, not Ultra's)
`src/graphql/resolvers.ts` — `parseOrBadInput` was typed `z.ZodType<T>`, so
TypeScript inferred the **input** type of schemas that use `.transform()`.
`validated.first` came out as `number | null | undefined` and
`input.priority` as `enum | null | undefined`, failing strict mode:
- `resolvers.ts(79,9)` — `first` not assignable to `number`
- `resolvers.ts(103,9)` — `priority` not assignable to `TicketPriority`

Fix (1 signature):
```ts
function parseOrBadInput<TOutput>(
  schema: z.ZodType<TOutput, z.ZodTypeDef, unknown>,
  value: unknown
): TOutput {
```
Runtime behaviour unchanged — it only corrects the inferred output type.
The original generator script was **not** modified, so the bug is preserved
there for Ultra to fix at source.

## Verified live (real Postgres, production build)
- Viewer as `client-northstar` (Amina Patel, CLIENT): only `northstar` permitted.
- Viewer as `manager-sysfortech` (Elena Rostova): both tenants.
- `projects(first:2)` as Northstar → `NSR-101, NSR-102`, `hasNextPage: true`;
  page 2 via the returned cursor → `NSR-103, NSR-104, NSR-105`,
  `hasNextPage: false`. The three projects sharing `2026-10-12T14:00:00Z`
  paginate correctly — no skip, no repeat (tie-break `createdAt DESC, id ASC`).
- `projects(tenantId: harborline)` as Northstar → empty. `project(HBL-201)`
  and `invoice(INV-HBL-2026-02)` as Northstar → `null`; visible as Harborline.
- `createTicket` on a Harborline project as Northstar → `NOT_FOUND`
  ("Project not found."), **identical** to an unknown project id (no oracle).
- `updateTicketStatus` as CLIENT → `FORBIDDEN`; as manager → `RESOLVED`.
- Manager `projects(first:50)` → all 9 projects across both tenants.
- Harness run (same code, in-memory Prisma stand-in, query counting):
  **19/19 checks pass**, including DataLoader batching — one `projects`
  query with invoices + tickets for 5 projects produced exactly
  1 `invoice.findMany` + 1 `ticket.findMany` (no N+1).
- Validation errors carry the right codes: bad cursor / `first:0` / `first:51`
  → `BAD_USER_INPUT`; unknown demo identity → `UNAUTHENTICATED`.

## Missing pieces in the paste (not bugs, gaps)
1. **No frontend.** No `src/app/layout.tsx` / `page.tsx` — only the API
   route. `next build` still passes (Next only needs a root layout when
   there are pages), but there is no UI to open at `/`. The portal is
   API-only as delivered.
2. **No tests.** `vitest.config.ts` looks for `tests/**/*.test.ts`, but no
   `tests/` folder exists. `npm test` can never pass as pasted.
3. **No benchmark script.** `package.json` has a `benchmark` script pointing
   at `scripts/benchmark-n-plus-1.ts`, which was never pasted.
4. **Demo auth is header/cookie demo keys** (`x-demo-user`), by design for a
   portfolio demo — roles and tenants are loaded server-side from Postgres,
   never trusted from the client. Do not present it as production auth.

## How to run it on your PC (as designed, with Docker)
```bash
cd sysfortech-client-portal
cp .env.example .env
npm install
npm run quickstart   # docker compose up, migrate dev+test, seed, next dev
# then open http://localhost:3000/api/graphql (GraphiQL)
# switch identity with header x-demo-user: client-northstar | client-harborline | manager-sysfortech
```
If `npm install` fails on your PC the same way (Prisma engines download),
the workaround used here is in this report's first table row. Re-seed any
time with `npm run db:seed` (it wipes and re-seeds; note the manager check
above left ticket `tkt_nsr_001` as RESOLVED in this copy's dev DB).

## Interview prep — explain this project, don't just build it
### Main points (30-second version)
Multi-tenant agency client portal: one GraphQL API serves two client
companies from one database, and a client can never see another tenant's
projects, invoices or tickets — enforced in a single repository class, not
hoped for in each resolver. Cursor pagination is stable across equal
timestamps, and DataLoader batches nested loads so one page costs a fixed
number of queries, not one per project.

### Q&A
- **Why GraphQL Yoga + Next.js route handler?** Yoga is a small, spec-
  compliant server; the App Router route handler keeps the API in the same
  deployable as the (future) frontend, no separate server to run.
- **Where does tenant isolation live?** `TenantScopedRepository`, built per
  request from the server-derived `AuthContext`. Every query filters
  `tenantId IN permittedTenantIds`; a requested `tenantId` is intersected
  with the permitted set, never trusted.
- **Why do cross-tenant and unknown IDs return the same error?** To avoid
  an ID oracle: if "exists but not yours" differed from "doesn't exist",
  an attacker could enumerate other tenants' IDs.
- **How does cursor pagination avoid skipping rows?** Cursor = base64url
  JSON `{createdAt, id}`; the next page is `createdAt < cursor OR
  (createdAt = cursor AND id > cursor.id)`, matching the
  `ORDER BY createdAt DESC, id ASC` exactly. Offset pagination would drift
  when rows are inserted.
- **Why DataLoader, and why per-request?** It batches `Project.invoices` /
  `Project.tickets` across all projects on a page into one query each, and
  fresh loaders per request mean Client A's cached rows can never leak into
  Client B's request.
- **Why is `first` capped at 50?** Zod validation on the argument — a client
  asking for 10,000 rows is a cheap DoS; the cap keeps every page bounded.
- **What does the demo auth prove and not prove?** It proves the
  *authorization* design (server-side membership lookup). It does not prove
  authentication — real auth would be sessions/JWT, and the demo key header
  must never ship.

### Security questions to expect (and the answers)
- *"Can a client read another tenant by guessing an ID?"* No — every
  lookup (direct, nested, mutation) goes through the tenant-scoped repo;
  verified live: cross-tenant project/invoice return `null`, cross-tenant
  ticket creation returns the same `NOT_FOUND` as an unknown ID.
- *"Can a client escalate to manager by sending a role in the request?"*
  No — the client sends only a demo key; role and tenant list come from
  `User` + `TenantMembership` in Postgres. `updateTicketStatus` checks the
  role in both the resolver and the repository.
- *"What about the demo identity header in production?"* It must be
  replaced by real session auth; as shipped it is a local-demo shortcut,
  documented in `src/auth/session.ts`.
- *"What stops one tenant's DataLoader cache leaking?"* Loaders are created
  fresh in `createGraphQLContext` per request and never shared.
- *"Is there any place the tenant filter is missing?"* Audit point:
  `Project.tenant` resolves from `auth.permittedTenants` and throws
  `INTERNAL_SERVER_ERROR` if the invariant breaks — defence in depth, and
  worth a test for.

## Sysfortech Shield v0.2 (pasted after the GraphQL code) — short verdict
Still UI-only. The manifest has **no background service worker, no content
scripts, no declarativeNetRequest ruleset and no blocklist** (the 35
"background" matches in the paste are all CSS). `popup.js` / `warning.js`
are the fixed versions from the earlier check (IDs match, Go Back / Proceed
wired), but `ALLOW_ONCE` is sent with `chrome.runtime.sendMessage` and
there is no listener to receive or remember it — the allowlist is never
stored. The landing page still claims drainer signatures, bloom filters
and "sub-millisecond heuristics" with no engine code behind them. Do not
present v0.2 as detecting anything yet.
