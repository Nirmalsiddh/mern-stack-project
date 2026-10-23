# Phase 5 engineering work log

## Verified baseline

Repository `Nirmalsiddh/mern-stack-project`, clean worktree at Phase 4 commit
`ab3a7294f6ea3f1efadf3705beae7d1474a72f02`. Remote main was fetched and verified at
`69a3a585cce3f48a5fef42adbcfbe2b30d217a1b`, the merge of PR #4 containing that commit.
Created `feat/phase5-portfolio-features` from this verified main with no upstream.
No commits, push, PR, production access or deployment are authorized in this task.

## Architecture review and Checkpoint A decisions

The existing User stores username/email and Passport hash/salt, without an account
creation date. Listing references its owner and review IDs; Review stores rating,
author and createdAt. Listing has no reliable createdAt. Existing protected CRUD,
CSRF, multipart decoding and legacy category normalization remain authoritative.

Favorites use a new collection rather than growing arrays on User. The unique
`{user, listing}` index prevents duplicates under concurrent idempotent upserts;
`{user, _id:-1}` supports saved order and `{listing}` supports delete cleanup.
Index initialization is awaited before the first save. These unique constraints
apply only to the newly introduced collection, not existing users or listings.
A nonunique `{owner, _id:-1}` listing index supports the owner's dashboard. Normal
Mongoose index creation is additive; no syncIndexes, reset, destructive migration
or production database/index operation was executed. Operators disabling automatic
indexes must create the declared indexes before enabling writes.

All account identities come from req.user. No browser owner/user identifier is
used for authorization. Favorites are joined to live listings, so dangling legacy
references are invisible and excluded from counts. Listing deletion removes all
its favorites; save rechecks existence after upsert to cover concurrent deletion.
There is no cross-collection transaction: temporary races converge to no visible
stale listing. Database failures are surfaced through the existing error handler;
a background orphan sweeper was not introduced.

Saved and owned collections are bounded to 12 cards per response, with six-digit
positive page validation and clamping beyond the final page. Collection counts,
saved-page aggregations and owner-page fetches have 2-second MongoDB execution
limits. These are server execution limits, not end-to-end request deadlines.
Favorite existence checks/writes and the profile User lookup do not all set
maxTimeMS. Profile selects only username/email and live counts;
no account creation date is inferred. Existing CRUD routes are reused for owner
management and CSRF-protected POST/DELETE forms for favorites. Cards, page controls
and account navigation reuse Phase 4 components and design tokens.

Checkpoint A automated verification: 72 passed / 0 failed / 2 explicitly skipped
DB suites without MongoDB; 118 passed / 0 failed / 0 skipped against the verified
empty random disposable databases. Audit: zero vulnerabilities. The new portfolio
integration suite checks guest redirects, CSRF, malformed/missing IDs, concurrent
duplicates, isolation, selected state, empty states, owner-only actions, private
profile fields and deleted/missing saved records. Browser gate passed: 21 actual Chromium page/viewport checks (three account pages × seven widths), save/remove, selected state, empty state, guest login transition, profile navigation and keyboard removal. Zero JavaScript errors or CSP violations. git diff --check passed. Checkpoint A completed before starting B.

## Checkpoint B decisions

Discovery uses a single allowlisted query parser for index and country search.
Country remains literal, bounded text; category aliases remain compatible.
`page` accepts positive decimal integers up to six digits, default 1. Out-of-range
pages clamp to the final page, and empty results display page 1 of 1. Discovery
`pageSize` is configurable from 1–24, default 12; account collections use 12.
Pagination and category links preserve country/category/sort/pageSize. Changing
sort or category resets the page. Sorting is a standard GET form, without JS.

Only newest, oldest, price-asc and price-desc are allowed. All orders include a
unique `_id` tie-breaker. There are no reliable historical listing timestamps,
so newest/oldest mean ObjectId record order, not a claimed original creation date.
No dates were invented or backfilled. Price ordering follows MongoDB BSON ordering:
missing/null prices precede numbers ascending and follow numbers descending;
missing values display Price unavailable, never a fabricated zero. Rating sorting
was deliberately omitted rather than introducing another expensive sort path.

Indexes: existing `_id` supports record ordering; new nonunique `{price:1,_id:1}`
supports both price directions, `{filters:1,_id:-1}` supports category discovery,
and `{owner:1,_id:-1}` supports owner pages. Combined category/price queries may
still require a blocking sort. Unanchored literal country search is not claimed
to be index-optimized. No unnecessary country/regex index was added.

Discovery retrieves only card fields and at most 24 records; saved/my-listings
retrieve at most 12. Saved lookups project only IDs for counts and card fields for
pages. Counts, discovery fetches and rating aggregations use 2-second MongoDB
execution limits. Offset pagination and exact counts are simple portfolio-scale
choices, not a production-scale performance guarantee; deep offsets and very
large saved/review sets need explain-plan/load testing and possibly keyset paging.

Cards on discovery and both account collections use one additional aggregation
for the current page's IDs, with a database-side review lookup and valid numeric
ratings in [1,5]. Missing references and duplicate review IDs do not inflate the
summary. Cards and details now use the same raw-storage aggregation (see the
focused correction below). Only scalar BSON numeric values within [1,5] qualify;
strings, booleans, arrays, objects, null and missing values do not. Valid BSON
numeric types are converted to doubles for the displayed mean and star values.
Details populate reviews lean, then use valid review IDs/values from that same
aggregation for individual stars; malformed values display Rating unavailable.
Averages are computed on read and displayed to one decimal,
with valid review count; zero valid reviews show No reviews yet. No summary fields
or background consistency jobs are stored. Creation/deletion therefore requires
no new summary writes. Invalid historical individual ratings display Rating
unavailable. The existing detail page still populates its review list; this phase
does not paginate detail reviews.

A missing-image edit fallback was corrected while checking optional legacy data;
the owner can open an image-less listing without calling replace() on undefined.
The existing upload/owner middleware order remains unchanged.

## Verification evidence

| Gate | Actual evidence |
|---|---|
| Checkpoint A | 118 DB-backed passes, 0 failures/skips; completed before B |
| Checkpoint A browser | 21 account page/viewport checks; save/remove, profile and navigation flows passed |
| Final no-DB suite | 74 passed, 0 failed, 2 explicit DB-suite skips |
| Final complete suite (after rating correction) | 132 passed, 0 failed, 0 skipped |
| Dependency audit | 0 vulnerabilities |
| Whitespace | git diff --check passed |

Commands: the unchanged CI workflow shell steps were executed locally through a
temporary helper with Node 22 and blank production/cloud settings:
`npm test`, `npm audit --audit-level=high`, plus the complete `npm test` after the
workflow's strict disposable loopback MongoDB preflight. Existing locked node_modules
were reused. CI configuration, manifests and lockfile are unchanged. These are
local results, not newly executed hosted Actions.

`test/portfolio.test.js` adds three portable units plus one real persistence/HTTP
suite with nineteen subtests (including six raw-rating cases). Coverage includes auth and CSRF; concurrent saves;
malformed/missing IDs; cross-user favorites/dashboard/profile isolation; repeat
remove; deleted/missing references; optional images; first/middle/last/out-of-range
pages; empty results; every allowlisted order and tie-breakers; combined search,
legacy category, sort and page state; invalid structured inputs; missing prices;
rating fractions, raw numeric strings/booleans/arrays/objects, BSON numeric types,
invalid and duplicate/missing reviews, card/detail equivalence, deletion, normal
review creation and association;
account paging and actual disposable database indexes. The earlier literal-search,
legacy-filter and query-deadline assertions are retained in stability.test.js;
only countDocuments stubs were added for the new count query. Security/upload and
all Phase 1–4 regression assertions remain.

Each database suite creates its own randomly suffixed test database, asserts it
has no collections before writes, and removes only IDs created within that
verified-empty target. Final recorded targets:
`havenhub_test_ci_18142ff9b88ccaef` and
`havenhub_test_ci_portfolio_a2c3872256f2b9f6` (rating-correction complete run).
MongoDB 7.0.45 runs in a fresh task-owned loopback container with tmpfs storage;
production databases, credentials, seed scripts and remote assets are not used.

## Remaining limitations

- No cross-collection transaction for favorites/deletion. Reads exclude missing
  listings, normal deletion cleans references, and save rechecks existence; a DB
  failure can leave an invisible orphan requiring operational cleanup.
- Automatic index builds are additive but deployment duration/lock impact was not
  tested against production. Review index rollout before deployment.
- Newest/oldest use record identifier order, not historical accommodation dates.
- Exact counts/offset paging, country regex search and detail review population
  have not been load-tested at production scale.
- Real Cloudinary, production CDN/TLS, other browsers/physical devices and manual
  screen-reader/zoom checks remain unverified. Full WCAG compliance is not claimed.
- Booking, payment, messaging, profile editing/reset, avatars and stored rating
  summaries were not introduced.

## Final browser verification

The final loaded implementation passed 84 actual Chromium page/viewport checks:
saved listings, owner dashboard, profile, discovery, combined country/category/
sort/page discovery and listing details, each at 320, 375, 390, 768, 1024, 1280
and 1440px, in normal and no-CDN modes. No page overflow or off-screen form
controls occurred. Twenty-four axe scans (six pages at 390/1440px in each mode)
reported zero violations. Native rating arrows, GET sorting, pagination with
disjoint IDs, save/remove, live averages after review create/delete, account
navigation and logout access invalidation passed.

There were zero JavaScript exceptions, observed CSP violations or unexpected
failed application requests. The deliberate broken-image fixture and aborted
external photos were excluded from unexpected-failure counts. The normal mode
uses original SRI-verified Bootstrap responses as fixtures; the no-CDN mode blocks
them. Direct CDN browser certificate errors and blocked Unsplash from Phase 4
remain environment limitations, not production integration passes. CSP and TLS
checks were not weakened. The mobile saved/profile screenshots were visually
inspected and show synthetic data and local fallback illustrations. Evidence is
`/tmp/havenhub-phase5/checkpoint-a-browser.json` and
`/tmp/havenhub-phase5/checkpoint-b-browser.json`.

## Complete changed-file inventory

| File | Purpose |
|---|---|
| `README.md` | Feature routes, pagination/sort semantics, test suites and index rollout |
| `app.js` | Mount account routes after CSRF/session initialization |
| `controllers/listing.js` | Shared bounded discovery, detail rating/saved state, optional-image edit fallback |
| `models/listing.js` | Nonunique query indexes and favorite cleanup on deletion |
| `public/css/style.css` | Reused account/sort/pagination components and expanded responsive navigation |
| `test/stability.test.js` | Count-query stubs; retain earlier search/category/security assertions |
| `views/includes/navigation-links.ejs` | Session-aware saved/dashboard/profile links |
| `views/listing/index.ejs` | Shared cards, total count, GET sort and state-preserving page/category links |
| `views/listing/show.ejs` | Save/remove controls and real/valid rating presentation |
| `controllers/account.js` (new) | Session-scoped favorites, dashboard and profile handlers |
| `docs/phase5-portfolio.md` (new) | Architecture, checkpoint gates, tests, acceptance and limitations |
| `models/favorite.js` (new) | Separate indexed favorite relationship |
| `routes/account.js` (new) | Authentication and CSRF-protected account endpoints |
| `test/portfolio.test.js` (new) | Three units and nineteen real MongoDB/HTTP scenarios |
| `utils/discovery.js` (new) | Query validation, literal filters and sort allowlist |
| `utils/pagination.js` (new) | Bounded page parsing, clamping and preserved links |
| `utils/ratings.js` (new) | Shared raw-storage aggregation for cards/details and individual stars |
| `views/account/listings.ejs` (new) | Saved/owned collection and empty states |
| `views/account/profile.ejs` (new) | Private available account fields and counts |
| `views/includes/pagination.ejs` (new) | Accessible previous/current/next controls |
| `views/includes/rating-summary.ejs` (new) | Accessible real average/count/no-review text |
| `views/listing/cards.ejs` (new) | Shared responsive cards with collection-specific actions |

Total: **9 modified tracked files + 13 new files = 22**. No dependency, lockfile,
CI, credential, screenshot/ZIP or database artifact is included. Existing auth,
rate-limiting, session encryption, CSRF, ownership middleware, safe redirects and
multipart upload protections remain; the complete regression suite covers them.

## Acceptance checklist

PASS applies to the documented local scope, not production integration or full
accessibility certification.

| Criterion | Status | Evidence |
|---|---|---|
| Phase 4 merge verified | PASS | PR #4 merge `69a3a585...`, contains approved `ab3a729...` |
| Dedicated feature branch | PASS | `feat/phase5-portfolio-features` from verified main |
| Favorites implemented | PASS | Real HTTP save/remove and browser selected state |
| Favorites authentication/CSRF | PASS | Guest redirects and missing-token 403 integration checks |
| Duplicate prevention | PASS | Unique pair index and four concurrent save requests leave one record |
| Saved page | PASS | Real joined records, empty state, keyboard removal and browser matrix |
| My Listings dashboard | PASS | Session owner query, management controls and bounded page tests |
| Owner isolation | PASS | Other-user query input ignored, protected edit/delete return 403 |
| Profile overview | PASS | Own username/email and actual live counts, browser navigation |
| Sensitive fields private | PASS | HTTP assertions exclude hash, salt, other email and own internal user ID |
| Server pagination | PASS | First/middle/last/clamped/empty and account page tests |
| Allowlisted sorting | PASS | Four known-value orders, unique tie-breakers, invalid sort 400 |
| Search/category retained | PASS | Combined HTTP queries/links and browser next-page sorting flows |
| Correct average ratings | PASS (local DB/HTTP) | Shared aggregation; six raw-type cases assert identical card/detail output, valid-only dedup, deletion and creation |
| No-review state | PASS | Null average and No reviews yet after review deletion |
| Existing data compatibility | PASS | Legacy categories, absent images/prices/timestamps and missing references |
| Indexes reviewed | PASS | Schema review plus actual disposable favorites/owner/price index assertions |
| Responsive layouts | PASS | Final 84 normal/no-CDN checks at seven widths |
| Keyboard accessibility | PASS | Native rating arrows, favorite buttons, account links and pagination forms |
| New tests | PASS | Three portable units and nineteen integration subtests; obsolete pure-rating unit replaced by empty-batch check, its numeric/invalid/dedup assertions covered by stronger raw DB/HTTP cases; existing security assertions retained |
| Database integrations pass | PASS | 132 passing complete suite, zero failures/skips |
| Existing regressions pass | PASS | All Phase 1–4 assertions preserved in complete run |
| Security preserved | PASS | Unchanged auth/CSRF/ownership/upload middleware; new isolation/CSRF checks |
| CI compatible | PASS (local) | Unchanged CI shell steps pass with same Node/Mongo versions and no new deps; hosted run not performed |
| Production data untouched | PASS | Fresh loopback container, distinct random verified-empty targets, synthetic fixtures only |

**Final recommendation: APPROVE WITH CONDITIONS** for review. No known blocking
functional defect remains locally. Review index rollout and scale assumptions,
then verify real external services and manual browser/accessibility behavior
before production deployment. No commits, pushes, PRs, merge or deployment were
performed; user approval is required before publication.

## Final cleanup and Git review

The final preview exited successfully. Independent read-only counts confirmed
zero remaining documents across all twelve randomly named task databases from
checkpoint, final-suite and browser runs. Only the task-owned MongoDB container
was stopped; no pre-existing service was stopped and no production/remote asset
operation occurred. The source inventory was reviewed for credentials and
artifacts and git diff --check passed. HEAD remains the verified Phase 4 merge
`69a3a585cce3f48a5fef42adbcfbe2b30d217a1b`; all 22 Phase 5 files remain unstaged
on the dedicated feature branch. No commits, push, PR, merge or deployment.


### Final guest-login return guard

A guest POST to a favorite action must not be replayed as GET after login.
The new account-route guard preserves normal isLoggedIn behavior for reads and
signed-in users, while storing the safe GET `/saved` return target for guest
mutations. Authentication still precedes CSRF, and signed-in mutations still
require CSRF. The earlier 126-test suite included a real HTTP regression for this
return path. A supplementary Chromium check also passed guest favorite POST →
login → saved GET with an empty saved state and no JavaScript errors. Evidence:
`/tmp/havenhub-phase5/login-return-browser.json`. No form layout changed.

The supplementary login-return verification also cleaned its fresh browser target.
Independent counts confirmed zero documents in both final integration targets
and that browser target (three additional databases in the replacement task-owned
container). That container was stopped as well. Those pre-correction suite totals were 126
passed, 0 failed, 0 skipped; the correction evidence below supersedes them.


## Focused rating consistency correction

Independent review found that populated Mongoose reviews cast stored numeric
strings and booleans into Numbers. Cards aggregated raw BSON and excluded them,
while details counted the cast values. The previous equivalence claim was therefore
too broad. For example, raw 4 and "5" produced a 4.0/one-review card but a
4.5/two-review detail. No production data was examined to determine prevalence.

Both surfaces now call attachRatings. Its lookup uses scalar $isNumber plus the
existing inclusive [1,5] range, before $toDouble; this also prevents rating arrays
from reaching numeric conversion. Details request the same lookup's valid IDs and
numeric values for individual review labels. Lean population preserves the raw
review representation until those values are applied in memory. No model,
server-side review validation, CSRF/authorization, persisted rating or migration
was changed. Missing/duplicate references retain the existing summary behavior.
The unused hydrated-review summary implementation was removed.

Six new real MongoDB/HTTP subtests cover ordinary numeric ratings, numeric strings,
booleans, mixed valid/invalid values (including arrays/objects), no valid ratings,
and BSON Decimal128/Long/Double values. Each checks identical rendered card/detail
averages and counts and invalid individual labels. The mixed case also deletes
reviews through the protected route, checks updated and empty summaries, then
creates a normal review and verifies both surfaces again. Existing fraction,
range, duplicate/missing reference and deletion coverage remains. The old pure
summary helper unit was replaced by an empty-batch/no-database check; its validity
assertions now run against raw MongoDB storage rather than uncast plain objects.

Before the correction, five new subtests failed (six failures including the parent
suite); the string/boolean mismatches and array conversion failure were reproduced.
After the correction:

- Focused portfolio file: **23 passed, 0 failed, 0 skipped**.
- npm test without MongoDB: **74 passed, 0 failed, 2 explicitly skipped DB suites**.
- Complete npm test with MongoDB: **132 passed, 0 failed, 0 skipped**.
- npm audit --audit-level=high: **0 vulnerabilities**.
- git diff --check: passed.

Verification used Node 22.23.4 and a fresh task-owned MongoDB 7.0.45 container,
bound only to 127.0.0.1 with tmpfs storage. Tests verify randomly suffixed targets
are empty before writes and remove their synthetic records afterward. Production
and Cloudinary settings were blank; no destructive seed, migration, production
access, credential change or external image operation occurred. Existing locked
dependencies and unchanged CI shell commands were reused. Local logs are
/tmp/havenhub-phase5-correction-{focused,unit,integration}.log, not hosted CI runs.

No Chromium matrix was rerun for this correction: current evidence is real HTTP
rendering of the unchanged templates, plus the earlier browser checks documented
above. Their earlier rating fixtures did not cover malformed raw BSON types.
Full WCAG compliance, real Cloudinary/CDN behavior and production performance
remain unverified. Detail reviews and the valid-review ID/value list are not
paginated; very large review histories need separate scale work. Concurrent review
writes between separate reads/requests can still change the displayed snapshot;
identical results are asserted for the same unchanged stored data, without
introducing transactions. Favorites race redesign, transactions, saved-query sort,
deep pagination and production index rollout remain deferred.

Only controllers/listing.js, utils/ratings.js, test/portfolio.test.js and this
work log were changed for the focused correction. All prior Phase 5 changes are
preserved and uncommitted. No push, PR, merge, deploy or Phase 6 work occurred.
