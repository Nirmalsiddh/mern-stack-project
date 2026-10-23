# HavenHub

This is a full-stack web application built with Node.js, Express.js, MongoDB, and EJS. The project includes user authentication, listing management, image uploads, and a responsive interface following the MVC architecture.

## Live Demo

Application: https://mern-stack-project-90uh.onrender.com

---

## Features

- User registration and login
- Secure authentication using Passport.js
- Create, update, and delete listings
- Country search and legacy-compatible category filters
- Authenticated saved listings, owner dashboard and private account overview
- Server-side pagination and allowlisted record/price sorting
- Live average ratings and review counts without stored summary fields
- Create and delete reviews with author authorization
- Image upload with cloud storage
- Responsive interface built with Bootstrap
- MVC architecture for better code organization
- RESTful routing
- Server-side rendering using EJS

---

## Tech Stack

### Backend

- Node.js
- Express.js
- MongoDB
- Mongoose
- Passport.js

### Frontend

- EJS
- HTML
- CSS
- JavaScript
- Bootstrap

---

## Project Structure

```text
majorProject
│
├── controllers
├── init
├── models
├── public
├── routes
├── views
├── middleware.js
├── app.js
├── package.json
└── README.md
```

---

## Getting Started

### Clone the repository

```bash
git clone https://github.com/Nirmalsiddh/mern-stack-project.git
cd mern-stack-project
```

### Install dependencies

Use Node.js **22.23.4**, pinned in `.nvmrc` (`package.json` requires Node 22).
If you use nvm, run `nvm use` before installing.

```bash
npm ci
```

### Configure the application and database

Create `.env` from `.env.example` only if you do not already have one, then supply
your local settings as described below. Keep an existing `.env` intact.

A running MongoDB service is required. The example uses
`mongodb://127.0.0.1:27017/wanderlust`; alternatively, configure your own development
MongoDB URI. Startup waits for the database connection and required rate-limit
and session TTL indexes before listening. Database permissions must allow those
index operations. Do not run the seed script against existing data.

### Start the server

```bash
npm start
```

Open your browser and visit:

```text
http://localhost:8080
```

`PORT` overrides the default port of 8080.

---

## Environment Variables

Use [.env.example](.env.example) as the configuration reference; it contains no
credentials. At minimum, supply:

| Setting | Requirement |
|---|---|
| `ATLASDB_URL` | A reachable MongoDB connection URI for the intended environment. |
| `SECRET` | A securely generated random secret of at least 32 characters; never commit it. |
| `UPLOADS_ENABLED` | The example sets `false`, allowing local use without Cloudinary. Set `true` only with all three `CLOUD_*` settings securely supplied. |
| `NODE_ENV` | Use `development` locally. Production reads injected environment variables rather than loading `.env`. |
| `TRUST_PROXY` | Leave blank for direct local connections; production accepts explicit trusted proxy IPs/CIDRs only. |

The example includes a local secret-generation command. Missing required settings
cause startup to fail safely. Production requires HTTPS, a strong secret, and
either all Cloudinary settings or explicitly disabled uploads. Review the
[security and operations guide](docs/phase2-security.md) before deployment.

## Future Enhancements

- Profile editing and account recovery
- Interactive maps for listing locations
- Improved UI and animations

---

## Author

Nirmal Siddh
## Development and Testing

[![CI](https://github.com/Nirmalsiddh/mern-stack-project/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Nirmalsiddh/mern-stack-project/actions/workflows/ci.yml)

The workflow is configured at [`.github/workflows/ci.yml`](.github/workflows/ci.yml).
GitHub-hosted execution has **not yet been verified** for this implementation.
The badge reflects GitHub's recorded status on `main`; it may show no status until
the workflow is published and runs there. Local test results are separate evidence.

Use the pinned Node.js 22.23.4 runtime (`.nvmrc`) and install dependencies with `npm ci`.
With nvm:

```bash
nvm use
npm ci
npm test
```

This runs the unit, template, browser-script, security, and mocked-upload tests without a
MongoDB connection. The two HTTP/database suites are explicitly skipped unless a safe
test target is supplied. To run the complete suite against a local MongoDB:

```bash
HAVENHUB_TEST_MONGODB_URL=mongodb://127.0.0.1:27017/havenhub_test_ci npm test
```

The suite only accepts an explicit loopback `havenhub_test` database name, adds a
random suffix for each run, and verifies that the resulting database is empty
before writing. It starts a separate application process on an ephemeral port
with a temporary session secret. It never uses your application's `ATLASDB_URL`,
changes `.env`, or runs the seed script. Cleanup deletes only document IDs from
that isolated run; it does not drop databases or reset collections. Interrupted
runs may leave isolated test records behind.

Cloudinary upload handling is mocked for authorization checks. No real uploads
or Cloudinary asset deletions are performed. Real Cloudinary integration still
requires separate verification with securely supplied credentials.

### What the tests exercise

Node's built-in test runner discovers `test/*.test.js`. Stability, security,
upload-authorization and Phase 2 correction tests use in-memory adapters or mocks;
they need no MongoDB service. Some start local HTTP servers or child processes.
Image decoding uses real Sharp, while Cloudinary upload/deletion is mocked.
`test/integration.test.js` uses real MongoDB, Mongoose persistence and a child
application for authentication, sessions, listing/review CRUD and reliability.

Test files run in separate Node processes. Database subtests run sequentially
because they share a fixture lifecycle; do not enable concurrency within that
fixture. Independent complete-suite invocations receive different random database
names. No application secret, `.env` file or Cloudinary credentials are required:
test helpers generate synthetic secrets and explicitly clear the child app's
cloud settings. The only database-test input is `HAVENHUB_TEST_MONGODB_URL`.
Never substitute `ATLASDB_URL`, `DATABASE_URL` or another application database.

### Continuous integration

CI runs for pull requests targeting `main`, pushes to `main`, and manual dispatch.
Feature-branch pushes alone do not duplicate PR runs. Obsolete runs for the same
PR/ref are canceled. The two independent jobs have ten-minute timeouts:

- **Unit tests and dependency audit:** Node from `.nvmrc`, locked installation,
  `npm test` without a database, then `npm audit --audit-level=high`. The explicit
  integration-suite skip in this job is not database coverage.
- **MongoDB integration tests:** the same runtime/install and complete `npm test`
  against a dedicated official MongoDB 7.0.45 service, pinned by digest. Docker
  health checks and a bounded client-side ping gate execution. The URI must equal
  the workflow's designated loopback `havenhub_test_ci` target; the suite then
  validates the URI, adds a random suffix and verifies an empty database before
  any writes. Runner/service isolation provides disposal without broad deletion.

Both jobs use `npm ci --no-audit --no-fund`; auditing is an explicit separate step
in the unit job. npm's download cache is keyed by `package-lock.json`; installed
`node_modules` are not cached. Actions are pinned to verified commit SHAs, the
token has `contents: read`, and checkout does not persist credentials. No secrets,
privileged containers, production environments or deployment steps are configured.
Tests and audit errors fail their job; no failure-suppression flags are used.

The audit policy blocks **high and critical** advisories; lower severities remain
visible and should be reviewed. A registry/network error fails the audit instead
of being treated as a clean result. Do not use automatic forced dependency fixes.
A zero-advisory snapshot is not proof of complete application security.

### Common failures and troubleshooting

- **Wrong Node version or lock mismatch:** run `nvm use` and `npm ci`; inspect the
  manifest/lock discrepancy instead of silently updating dependencies.
- **Unwritable npm cache in a restricted local workspace:** select a writable
  cache, for example `npm_config_cache=/tmp/havenhub-npm-cache npm ci`. Keep
  package integrity and TLS checks enabled. GitHub-hosted runners use the action's
  normal npm cache path.
- **Skipped database suite:** a default `npm test` run intentionally skips it.
  For integration coverage, set the explicit disposable test URI shown above.
- **Connection refused/readiness failure:** start a dedicated local MongoDB
  instance on the configured loopback port. In Actions, inspect service health
  and its logs. Do not switch to a production URI to make tests pass.
- **Rejected database URL:** retain the `havenhub_test` prefix, loopback host and
  no credentials/query options. `havenhub_ci_test` is intentionally incompatible
  with the current safety rule. Never weaken the rule for CI.
- **Port already in use:** stop only a test service you own or use another local
  loopback port for local tests; Actions uses an isolated runner's fixed mapping.
- **Audit failure:** inspect advisories or registry connectivity. Make reviewed
  dependency corrections separately; do not suppress the audit exit status.
- **Native image dependency installation:** confirm the pinned Node version and
  supported OS/architecture, then reinstall from the lockfile.

### Recommended branch protection

After a real CI run establishes the check names, require PRs and both checks:
`Unit tests and dependency audit` and `MongoDB integration tests`. Consider
requiring branches to be up to date before merging. Block force pushes and
deletion of `main`. For a solo portfolio, avoid mandatory reviewer counts that
prevent the owner from merging. Repository plan/visibility can affect available
protections; verify them in GitHub before enabling rules. Existing protection and
ruleset settings could not be inspected because the GitHub API returned
`Forbidden`; no repository settings were changed.

## Security and operations

Phase 2 setup, proxy requirements, security controls, audit evidence, and known
limits are documented in [docs/phase2-security.md](docs/phase2-security.md).
Start with `.env.example`, supply a strong random `SECRET`, and keep actual
credentials outside Git. Production requires HTTPS and explicit trusted proxy
addresses if TLS terminates upstream. Logout now uses its POST form with CSRF
protection. Existing Phase 1 sessions require reauthentication after this update.

## Portfolio features (Phase 5)

Sign in to use **Saved** (`/saved`), **My listings** (`/my-listings`) and **Profile**
(`/profile`). Save or remove a stay from its detail page; saved state is shown in
text and an accessible pressed state. Owner management reuses protected edit and
delete forms. The profile shows only your stored username/email and live counts;
no account creation date is inferred.

Discovery supports `page` (positive decimal, up to six digits), `pageSize` (1–24,
default 12), and `sort` (`newest`, `oldest`, `price-asc`, `price-desc`). Pagination
retains country/category/sort state and clamps beyond the final page. Newest and
oldest use deterministic ObjectId record order because historical creation dates
are unavailable. Missing prices sort before numbers ascending and after numbers
descending and remain labeled unavailable. Saved/owned pages show 12 stays each.

Ratings use valid linked reviews only, with one-decimal averages and a no-review
state. No rating summaries are persisted. Favorites introduce a new collection
with unique user/listing pairs and lookup/cleanup indexes; listing indexes support
owner, category and price queries. Review additive index rollout before production
use, especially when disabling Mongoose automatic indexes. No destructive migration
or production data operation is required or was executed.

See [Phase 5 decisions, verification and limitations](docs/phase5-portfolio.md).
