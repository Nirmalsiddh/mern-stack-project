# Phase 2: security and operations

## Verified baseline and scope

Repository: `Nirmalsiddh/mern-stack-project`. Remote `main` was fetched and verified
at `6ddff081b8f27ad4d49feed0647ad1b1b364f35f` (merge of PR #1). Phase 1 commit
`260016cb7e5b7072619a3b9697f925fe6848a962` is its ancestor. Implementation branch:
`security/phase2-hardening`. No existing uncommitted changes were present.

This phase preserves Express 4, EJS, Passport, Mongoose 8, and MongoDB sessions.
No product features, deployment, production data changes, or bulk asset cleanup
are included. Phase 1 documentation records its historical verification;
current security behavior and limits are described here.

## Focused audit and corrections

Severity describes application risk; dependency audit severities are recorded separately.

| Finding / location | Severity and root cause | Correction and regression evidence |
|---|---|---|
| State-changing forms and `routes/*` lacked CSRF checks; logout used GET | High: cookie-authenticated cross-site actions were not explicitly verified | Maintained `csrf-sync`, hidden session-bound tokens, 403 for missing/invalid tokens, POST logout; unit/multipart/HTTP tests |
| Login/signup had no throttling | High: repeated password hashing and account creation were unbounded | `express-rate-limit` backed by atomic MongoDB counters, TTL index; real HTTP and two-instance tests |
| Session options in `app.js` lacked Secure/SameSite policy and startup secret checks | Medium: production could use weak configuration | Validated secrets, HttpOnly, production Secure, explicit SameSite=Lax, seven-day configurable lifetime, explicit store; cookie and config tests |
| Logout left session lifecycle implicit | Medium: invalidation and fixation handling needed evidence | Passport 0.7 regeneration retained; logout destroys the resulting session and clears the named cookie; ID rotation and stored-session deletion tested |
| Multer/Cloudinary adapter accepted unbounded, unverified bytes | High: resource exhaustion and unsupported content | Bounded memory parser, 5 MB limit, PNG/JPEG decoding and re-encoding with Sharp, 25 MP limit; spoof/truncation/size/type tests |
| Upload succeeded before a failed database save | Medium: unreferenced uploads could accumulate | New-asset cleanup after a confirmed validation/missing-document failure, only after a reference check. Active/old images and uncertain outcomes are retained; mocked deletion tests |
| Startup accepted requests before DB/session-store readiness | High operational risk: server appeared live without required persistence, including asynchronous session TTL initialization | Await connection, rate-counter index, and connect-mongo's public `collectionP` before listen; delayed/rejected initialization and cleanup tests |
| No bounded shutdown or health endpoints | Medium operational risk | Drain HTTP, close store/database, enforce deadline; live/ready endpoints, unit checks and actual SIGTERM test |
| Request fields had weak bounds; account errors could reveal details | Medium: large payloads and avoidable account enumeration | Body/parameter/depth bounds, Joi length/type constraints, generic account errors and local-only redirects; validation and HTTP tests |
| No explicit security headers; legitimate inline navbar CSS | Medium defense gap | Helmet with CSP and restricted scripts/forms/framing; navbar CSS moved to stylesheet, only fixed style attributes allowed inline; header tests |
| Existing session cipher adapter failed default round-trip after compatible dependency updates | High operational regression discovered by integration tests | Retain supported serialization hooks and the existing AES-256-GCM envelope; strictly require a 12-byte IV, 16-byte tag and canonical encoded fields; real encrypted-store persistence/expiry and malformed-envelope tests |
| Review creation also saved legacy parent category values | Medium reliability risk: a review could fail against a legacy alias or leave an inserted review before parent validation | Normalize known aliases and validate the parent before inserting the review; real database-backed CSRF review test |
| Dependency audit reported 21 affected dependency entries | Critical through low, with differing reachability | Compatible patched dependency graph, replacement of obsolete upload adapter, Node 22 pin, audit and complete regression suite |

Existing protections retained: Passport password hashing and session regeneration,
server-side listing/review ownership, review/listing membership, strict ObjectId
checks, literal bounded country search, escaped EJS user content, and validation
before the single-write listing update.

### Final review corrections

The review reproduced three defects before correction: listening while session
initialization was pending, an unhandled initialization rejection, and acceptance
of shortened GCM tags. `test/phase2-corrections.test.js` first produced one pass
and three failures for the startup/encryption regressions; these checks now pass.

- **Session initialization:** connect-mongo 5.1.0 exposes `collectionP` publicly
  in its type declarations. It resolves only after collection acquisition and
  native TTL-index creation. Startup now awaits it immediately after constructing
  the store and attaching the runtime error listener. Rejection reaches the safe
  startup handler, with store close and Mongoose disconnect attempted separately;
  a cleanup failure does not prevent the other cleanup or replace the original
  error. Tests exercise the actual store constructor with isolated I/O adapters,
  successful/delayed/rejected initialization, no premature listen, and zero
  unhandled rejections. Real HTTP login/session persistence is also tested.
- **Encryption:** encoded envelopes must contain the four version-1 fields,
  canonical nonempty base64, an exact 12-byte IV and 16-byte tag, and an encrypted
  JSON object. Both cipher and decipher specify `authTagLength: 16`. Invalid data
  produces a generic error without logging payloads or secrets. Tests cover
  altered/truncated tags and ciphertext, invalid IVs, malformed envelopes and
  invalid decrypted JSON/payloads. A fixture written with the prior algorithm
  still decrypts: the key derivation, envelope version and valid wire format
  have not changed.
- **Readiness:** one shared ping at a time uses `Db.command` with a 1000 ms
  driver `timeoutMS`, an AbortSignal and server `maxTimeMS`. The installed
  driver's `Admin.command` forwards the deadline but drops the signal, so the
  supported database command API is used instead. A response deadline returns
  503 and requests cancellation. If an adapter ignores cancellation, its single
  pending operation stays tracked; subsequent probes return unavailable without
  starting more work. Late success/rejection is consumed, then probing can
  resume. Tests cover HTTP 503, concurrent probes, both late outcomes, and a real
  driver command behind a deliberately unresponsive local TCP proxy. The latter
  verifies the underlying command settles, not merely that the HTTP timer fires.
- **CSRF timing:** csrf-sync has no comparator hook. Keep its token generation,
  request-token extraction and standard error, but verify bounded 256-character
  hex tokens with equal-length `timingSafeEqual`. Missing/malformed/duplicate,
  header, multipart and cross-session behavior remains covered.
- **Login timing:** prepare an unsaved dummy user once before startup listens,
  using the existing Passport plugin's password API and parameters. Unknown
  accounts perform one dummy verification; existing accounts perform one normal
  verification. The original rate limiter and input bounds remain ahead of
  authentication. Real PBKDF2 call-count tests cover both paths, valid login and
  lookup errors. This removes the avoidable skipped-hash distinction; it does
  not promise identical end-to-end latency or hide public usernames.

Built-in encryption was evaluated rather than assumed unusable: the installed
connect-mongo/kruptein default combination has a serialization mismatch, while
adjusted supported serialization hooks can round-trip with a compatible secret.
Kruptein also rejects random hex secrets under its character-class policy.
Changing to that cipher would change the stored envelope and secret contract,
requiring dual-format reading or reauthentication for existing Phase 2 sessions.
The scoped correction retains valid existing data instead. A future replacement
requires a separate compatibility review; custom encryption is not claimed to
be the only possible supported solution. Session-ID/AAD binding is unchanged.

## Request order and upload tradeoffs

For multipart create/update: authenticate; check ownership for updates; parse one
bounded file into memory; verify CSRF; validate listing fields; decode/re-encode
the image; upload; validate/save the complete document. Parsing must precede the
CSRF check because ordinary browser multipart forms carry their token in a field.
No remote upload occurs before CSRF, field validation, and image decoding.
Unauthorized requests are rejected before parsing. Enforce a matching request-size
and concurrency policy at the production reverse proxy as well; buffers and image
decoding consume bounded per-request resources, not unlimited global capacity.

Only PNG and JPEG are supported. Filename and declared MIME type are not trusted.
Missing files preserve the current image (or the creation fallback). Cloudinary
uses fixed image/folder settings and an upload timeout; failures expose no SDK
configuration. No automated test contacts real Cloudinary.

Cloudinary public IDs remain in `image.filename`. Successful replacement preserves
the old asset: deletion of existing assets is intentionally not implemented here.
On a confirmed pre-write validation failure, cleanup considers only the new ID
under `wanderlust_DEV/` and verifies that no listing references it. A failed
reference check or an ambiguous network/database write outcome never triggers
deletion. Cleanup failures log no ID or credentials. A durable reconciliation
queue and safe eventual cleanup of superseded assets remain deferred; cleanup is
best effort and not a cross-service transaction.

## Session and proxy contract

Use a random SECRET of at least 32 characters; do not use example text. Generate one
locally with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
and supply it securely. No secret value is committed. The signing secret is not
changed by this implementation. MongoDB session payloads are encrypted using a
domain-separated key derived from that secret, native AES-256-GCM, a fresh 12-byte
IV, and an authenticated tag.
The reader enforces the full tag/IV lengths and canonical version-1 structure;
valid existing Phase 2 envelopes remain readable without a migration.

The new `havenhub.sid` cookie and encrypted envelope intentionally require existing
Phase 1 browser sessions to log in again. Old session records are left untouched
and expire via their existing TTL; no migration or session reset is executed.
Sessions use HttpOnly, SameSite=Lax, production Secure, and a configurable maximum
age (default seven days, maximum seven days). `saveUninitialized` is false; pages
that need a CSRF token deliberately initialize a session. No MemoryStore is used
by application startup; explicit in-memory stores appear only in tests.

Proxy trust defaults to false. In production, set TRUST_PROXY only to the actual
proxy IPs/CIDRs, never a numeric hop count, blanket trust, or `/0`. The edge must
strip/replace forwarded headers and prevent direct client access to the app port.
With TLS termination upstream, the trusted proxy must send `X-Forwarded-Proto:
https`; otherwise Secure cookies will not be issued. Header spoofing is ignored
from untrusted addresses. Test production HTTPS behavior in the actual deployment
before public release; these tests simulate a trusted local proxy.

Authentication counters live in MongoDB, keyed by purpose, a hash of the normalized
client IP, and a fixed time window. They are shared across processes, expire using
a TTL index, and have no unbounded in-process map. Defaults: ten login attempts and
five signup attempts per 15 minutes. AUTH_WINDOW_MS, LOGIN_LIMIT and SIGNUP_LIMIT
are bounded configuration values. Store errors fail closed. A fixed-window policy
can allow bursts at window boundaries; it is not a distributed sliding-window
algorithm. Do not use X-Forwarded-For as an identity without the proxy contract.

## Startup, health and shutdown

1. Use Node 22.23.4 (`.nvmrc`) and run `npm ci`.
2. Use `.env.example` as a template without overwriting an existing `.env`.
3. Supply ATLASDB_URL and SECRET. Production requires all three CLOUD_* values
   unless UPLOADS_ENABLED=false is explicitly configured. Missing cloud settings
   disable uploads in development; the rest of the app remains usable. Set
   UPLOADS_ENABLED=true after securely providing all three cloud settings to enable uploads.
4. Run `npm start`. MongoDB connection and rate-limit TTL index creation must
   succeed, and the session-store TTL initialization must finish, before the
   server listens. Application DB credentials must permit
   those normal collection/index operations. Startup errors never print URIs.
5. `/health/live` returns 200 for the running HTTP process; it is not a readiness
   signal. `/health/ready` returns 200 only while connected, able to ping MongoDB,
   and not shutting down; otherwise 503. A one-second client-side deadline and
   cancellation bound the readiness command, with one operation in flight.
   These endpoints bypass sessions, set
   no-store, and expose no hostnames, credentials or collection details.
6. SIGTERM/SIGINT stops readiness, drains HTTP, closes the session store/database,
   and exits. SHUTDOWN_TIMEOUT_MS bounds draining (default ten seconds), after
   which connections are terminated and the process exits unsuccessfully.

Production requires HTTPS. Production settings enable HSTS and Secure cookies;
development does not force HTTPS upgrades. CSP permits only the existing local,
Bootstrap, Font Awesome, Google Fonts, Unsplash and Cloudinary resources. Inline
scripts/event handlers, objects, cross-origin form actions and framing are blocked.
Only existing fixed inline style attributes retain an inline allowance. External
CDN availability and visual browser behavior still need deployment verification.

## Dependencies and compatibility

Baseline audit: 21 affected dependency entries (3 critical, 10 high, 6 moderate, 2 low; severities include inherited dependency chains). Some involved
features not used here (for example Joi recursive-link schemas and lodash template
imports), but the vulnerable versions were still refreshed. Express request parsing,
proxy address processing, Mongoose casting, and the Cloudinary SDK are used by the
application; no exploit was executed against real services.

Same-major updates include Express 4.22.3, Mongoose 8.24.6, Cloudinary 2.11.0,
express-session 1.19.0, Joi 17.13.8, dotenv 16.6.1, and their resolved transitives.
The lockfile remains frozen-install compatible. Multer 1 was replaced with 2.5.0:
its single-file/memory parsing API is compatible with these routes, and the obsolete
multer-storage-cloudinary adapter was removed. The new pipeline is covered by
actual multipart requests. New focused dependencies: csrf-sync 4.2.1,
express-rate-limit 8.7.1, Helmet 8.3.0 and Sharp 0.35.5. Sharp provides trusted image
decoding/re-encoding instead of custom file-signature guessing. Express and
Mongoose retain their existing major versions. Node 20 is end-of-life at this
task's date; Node 22.23.4 is pinned and tested. No forced audit fix or TLS/integrity
bypass was used. A zero-advisory audit is a registry snapshot, not proof that all
possible vulnerabilities have been eliminated.

### Dependency findings and exposure

The original audit's package-level entries are listed below; one entry may include
multiple advisories or inherit severity from a transitive dependency. Exposure
assessments are code-path reviews, not demonstrations of exploitability. Compatible
patches/removals resolve all entries in the final audit snapshot.

| Package | Original severity | Application relevance / exploitability assessment | Resolved version or removal |
|---|---|---|---|
| `asn1.js` | moderate | Legacy session-cipher decoding; DB payloads, not browser-supplied ASN.1. Optional adapter is no longer used. | removed from resolved graph |
| `bn.js` | moderate | Legacy cipher math dependency; no direct application API. | removed from resolved graph |
| `body-parser` | moderate | Used for URL-encoded forms; explicit size/depth/parameter bounds added. | 1.20.9 |
| `brace-expansion` | high | Transitive build/file globbing; no user-controlled glob API in the app. | 2.1.7 |
| `cloudinary` | high | Used for remote uploads; options are now fixed and bytes decoded. Real provider integration remains unverified. | 2.11.0 |
| `connect-mongo` | moderate | Used for sessions; inherited cipher dependencies refreshed and encryption round-trip tested. | 5.1.0 |
| `ejs` | high | Used with repository-owned templates; no user-supplied template compilation. | 3.1.10 |
| `ejs-mate` | high | Layout engine; inherited build/glob chain, fixed view paths. | 4.0.0 |
| `express` | critical | Routes and parsing used; inherited parser/proxy advisories addressed. | 4.22.3 |
| `express-session` | low | Used for authentication; inherited header dependency updated, cookie tests pass. | 1.19.0 |
| `filelist` | high | EJS build/globbing chain; no exposed arbitrary file-pattern API. | 1.0.6 |
| `jake` | high | EJS build tooling; not invoked by application request handlers. | 10.9.4 |
| `joi` | high | Input validation used; reported recursive links/custom message templates/rename/isoDate APIs are not used here. | 17.13.8 |
| `kruptein` | moderate | Optional store cipher is no longer used; native authenticated session serialization replaces it. | 3.4.0 |
| `lodash` | high | Transitive library; application does not expose template-import or arbitrary unset/omit APIs. | 4.18.1 |
| `minimatch` | high | Transitive file glob matching; no user-controlled glob endpoint. | 5.1.9 |
| `mongoose` | critical | Used for model queries/updates; Joi rejects object/operator payloads; casting dependencies patched. | 8.24.6 |
| `on-headers` | low | Session header handling; upgraded transitive dependency, tested cookies. | 1.1.0 |
| `path-to-regexp` | high | Express routes are fixed; application has no ambiguous adjacent dynamic route segments. | 0.1.13 |
| `proxy-addr` | critical | Previously default proxy trust was false; patched before enabling explicit trusted CIDRs. | 2.0.8 |
| `qs` | moderate | Query/form parsing used; bounds added and patched parser resolved. | 6.16.1 |

## Verification and acceptance

Run `npm test` for local unit/template/multipart/security checks. Without a test
URI, the database suite is explicitly skipped. Run the complete suite with:

```bash
HAVENHUB_TEST_MONGODB_URL=mongodb://127.0.0.1:27017/havenhub_test npm test
```

Each run creates a random, verified-empty loopback test database, uses synthetic
credentials, and cleans up test-run document IDs only. The child app receives no
real Cloudinary bindings. Real Mongoose saves remain in the legacy-category tests;
only remote upload/deletion is mocked. Empty test DB metadata may remain locally.
Test-support routes and header-based identities exist only in test harnesses and
are never mounted in application startup.

| Acceptance item | Status | Evidence / scope |
|---|---|---|
| Phase 1 baseline verified | PASS | Remote fetch plus ancestry check against merge commit above |
| Confirmed findings addressed/documented | PASS | Audit table, controls and explicit limitations above |
| CSRF on browser forms | PASS | Valid, missing, invalid and cross-session token checks; actual state-changing routes and multipart requests |
| Authentication rate limiting | PASS | Real login/signup 429 tests; MongoDB counters shared across two app instances; spoofed XFF does not bypass limits |
| Hardened sessions | PASS | Cookie-policy/proxy tests, encrypted-store round-trip/expiry, strict envelope rejection, fixation rotation and logout deletion |
| Upload validation/size limits | PASS | Real PNG/JPEG decode, spoofed/executable/truncated bytes, oversized multipart request and storage failure tests |
| Authorization remains effective | PASS | Existing guest/owner/review-author tests and zero unauthorized upload calls |
| Image failure handling | PASS | Confirmed unreferenced new upload cleanup; active/ambiguous assets retained; legacy DB failure leaves document unchanged |
| Required config validated | PASS | Missing/invalid settings and safe startup failure tests |
| Reliable DB/session startup | PASS | Actual unavailable DB child exits without listening; real store initialization with delayed/rejected I/O adapters never listens early and cleans up without unhandled rejection |
| Graceful shutdown | PASS | Actual isolated child exits 0 after SIGTERM; bounded deadline implemented. In-flight deadline exhaustion is NOT VERIFIED |
| Health checks | PASS | Connected/disconnected/shutting-down readiness, bounded stalled HTTP probes, late outcomes, single-operation bound and real driver cancellation through a local TCP fault proxy |
| HTTP security headers | PASS | Helmet/CSP assertions and production HTTPS cookie simulation; visual CDN rendering NOT VERIFIED |
| Dependency findings documented | PASS | Before/after audit and compatible updates above |
| Focused security tests | PASS | `test/security.test.js`, `test/phase2-corrections.test.js`, expanded HTTP and multipart suites |
| Existing tests pass | PASS | Existing regression assertions retained with token-aware clients and POST logout |
| No production data/credentials modified | PASS | Only verified-empty local test databases; no actual Cloudinary operations, seeds, migrations or secret edits |
| No unrelated functionality removed | PASS | Existing MVC features retained; deliberate security changes (POST logout, stricter new-account input, supported image types) documented |

## Executed verification results

All commands below used Node 22.23.4. The original Phase 2 run passed 87 tests;
the final-correction run supersedes that count. Current commands/results:

| Command | Result |
|---|---|
| `node --test test/phase2-corrections.test.js` | 8 passed, 0 failed, 0 skipped |
| `npm test` without a DB URI | 59 passed, 0 failed, 1 explicitly skipped database suite |
| `HAVENHUB_TEST_MONGODB_URL=mongodb://127.0.0.1:27017/havenhub_test npm test` | 97 passed, 0 failed, 0 skipped; runner counts include parent tests |
| `git diff --check` | Passed |

The complete correction-suite target was
`127.0.0.1:27017/havenhub_test_31280ad83f823cff`, verified empty before writes and
cleaned up by test-run document IDs afterward. The TCP proxy forwards only to the
explicit loopback test service and issues handshake/ping commands; Cloudinary
remains mocked. The correction tests add eight focused cases plus two real DB/
driver cases. Existing registration/login/logout, CSRF, throttling, listing/
review CRUD, upload authorization/validation, category compatibility, session
rotation/invalidation and normal SIGTERM assertions remain in the complete run.

Frozen `npm ci` and a zero-vulnerability `npm audit --json` snapshot were recorded
during the original Phase 2 work; neither was rerun for these corrections, which
change no dependencies. Intermediate failing reproductions are not counted as
passing verification.

`npm ci` still reports deprecated `generaterr` and `scmp` dependencies of
passport-local-mongoose 8.0.0. They have no advisory in this audit snapshot; a
future authentication-plugin upgrade needs its own compatibility review rather
than an unreviewed major-version migration.

## File change inventory

38 files: 24 modified tracked files and 14 new files. The original 36-file set is
preserved; the two additional files are the correction suite and authentication
helper. No generated output,
credentials, database artifacts, or dependency directories are included.

| File | Status | Reason |
|---|---|---|
| `README.md` | Modified | Node 22, current test commands and operations link. |
| `app.js` | Modified | Testable app construction, hardened middleware, DB-first startup, health and bounded shutdown. |
| `cloudConfig.js` | Modified | Secure SDK configuration; obsolete storage adapter removed. |
| `controllers/listing.js` | Modified | Failure cleanup for a confirmed unreferenced new upload. |
| `controllers/reviews.js` | Modified | Normalize legacy parent category and validate before inserting review. |
| `controllers/users.js` | Modified | Generic signup errors, safe redirects, session-destroying logout. |
| `middleware.js` | Modified | Persist validated/sanitized review input. |
| `package.json` | Modified | Focused security dependencies, patched lower bounds and Node 22 engine. |
| `package-lock.json` | Modified | Reproducible patched dependency resolution. |
| `public/css/style.css` | Modified | Move fixed navbar CSS out of inline style block for CSP. |
| `routes/listing.js` | Modified | Authentication/ownership, bounded parsing, CSRF, validation and verified upload order. |
| `routes/review.js` | Modified | CSRF on review mutations with ownership checks retained. |
| `routes/user.js` | Modified | CSRF, shared auth throttling, account validation and POST-only logout. |
| `schema.js` | Modified | Bounded fields/types, new-account rules and legacy-compatible login. |
| `test/integration.test.js` | Modified | Token-aware existing tests, real shared rate counters, lifecycle and encrypted-session checks. |
| `test/stability.test.js` | Modified | Render CSRF locals and retain callback behavior tests without source-shape coupling. |
| `test/upload-authorization.test.js` | Modified | Real bounded multipart parser/decoder with mocked remote storage. |
| `utils/errorHandler.js` | Modified | Safe 403 CSRF and 400/413 multipart responses. |
| `views/includes/navbar.ejs` | Modified | POST logout with token and external CSS. |
| `views/listing/edit.ejs` | Modified | CSRF plus field bounds and PNG/JPEG selection. |
| `views/listing/new.ejs` | Modified | CSRF plus field bounds and PNG/JPEG selection. |
| `views/listing/show.ejs` | Modified | CSRF on delete/review forms and bounded review text. |
| `views/users/login.ejs` | Modified | CSRF, credential bounds/autocomplete, remove unused email field. |
| `views/users/signup.ejs` | Modified | CSRF and explicit new-account bounds/password guidance. |
| `.env.example` | New | Non-secret configuration template with secure settings. |
| `.nvmrc` | New | Exact tested Node 22.23.4 pin. |
| `config/environment.js` | New | Validated config and explicit session cookie/store policy. |
| `docs/phase2-security.md` | New | Audit, dependency exposure, operations, acceptance evidence and limitations. |
| `test-support/security.js` | New | Test-only token/session setup, generated image fixtures and remote mocks. |
| `test/security.test.js` | New | Focused configuration, CSRF, upload, crypto, session, headers and startup tests. |
| `test/phase2-corrections.test.js` | New | Final-review startup, envelope, bounded readiness, CSRF and real password-verification regressions. |
| `utils/authenticate.js` | New | Existing plugin verification plus an unsaved dummy for unknown accounts. |
| `utils/authRateLimit.js` | New | Atomic MongoDB rate counters and maintained limiter integration. |
| `utils/csrf.js` | New | Maintained session-bound CSRF generation and verification. |
| `utils/imageUpload.js` | New | Bounded parser, decoded/re-encoded uploads and conservative cleanup. |
| `utils/safeRedirect.js` | New | Local-only post-login redirect policy. |
| `utils/securityHeaders.js` | New | Helmet/CSP policy matching existing assets. |
| `utils/sessionTransforms.js` | New | Authenticated encrypted session serialization hooks. |

## Remaining limitations and deferred work

- Real Cloudinary integration: NOT VERIFIED; no existing remote images were deleted.
- Production reverse-proxy/TLS deployment and visual/accessibility behavior: NOT VERIFIED.
- A live session-store outage and forced shutdown deadline with in-flight requests
  were not induced; direct store failure rendering and normal shutdown are tested.
- Cross-process/concurrent rate-limit races and actual TTL deletion/window rollover
  remain unverified. The existing shared-counter test uses two servers in one
  process; atomic database updates and index configuration are inspected/tested.
- Readiness timing depends on event-loop scheduling. A noncompliant adapter that
  never settles after abort retains one pending command and stays unavailable;
  it cannot accumulate commands. A real connected driver's stalled command was
  cancelled in the local TCP-proxy test, not in a production network outage.
- The review flow still uses separate child/parent writes; an intervening DB
  failure can orphan a review. Transactions are outside these scoped corrections.
- Durable asset reconciliation, eventual superseded-image cleanup, safe seed tooling,
  broader observability, pagination/indexing, email verification/password reset,
  and unrelated UI/product improvements remain deferred.
- Nothing is committed, pushed, merged or deployed by this phase. No Phase 3 work.
