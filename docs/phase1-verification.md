# Phase 1 verification

Scope: application stability tasks 5.1–5.8. Existing Express/EJS/Mongoose MVC architecture retained. No dependency additions or lockfile changes.

## Commands and test safety

Use Node.js 20.18.0:

```bash
npm test
HAVENHUB_TEST_MONGODB_URL=mongodb://127.0.0.1:27017/havenhub_test npm test
```

The first command deliberately skips the database suite. The second includes HTTP/database integration checks. That suite validates an explicit loopback test target, creates a random suffixed database, verifies it is empty before writing, and starts a separate app on an ephemeral port. Its session secret is generated only in memory. Cleanup targets document IDs from the isolated run. Existing development/production data, credentials, environment files, seed scripts, and Cloudinary assets are untouched.

## Required checklist

| Requirement | Result | Evidence |
|---|---|---|
| Search form submits the correct parameter | PASS | Rendered navbar asserts `name="country"`; HTTP search returns fixture listing. |
| Search queries handle special characters safely | PASS | Literal regex metacharacters, empty/long/structured queries tested; 2-second MongoDB execution limit asserted. |
| Category filters produce correct results | PASS | HTTP tests for canonical and hyphenated category links and legacy stored values. |
| Listing creation supports valid categories | PASS | Joi checks every valid category; HTTP creation persists canonical category. |
| Listing editing supports valid categories | PASS | Edit forms select canonical values for legacy records without writes. Real Mongoose/database tests cover both legacy aliases with/without image replacement, omitted categories, explicit category changes, valid-category preservation, missing categories, and invalid input. |
| Shared JavaScript works on applicable pages | PASS | In-memory DOM tests cover missing/present optional switch, one handler, tax labels, and validation. Public pages/static assets return 200. |
| Missing listings do not produce unexpected exceptions | PASS | HTTP GET/edit/update/delete/review creation return 404. |
| Missing reviews are handled safely | PASS | HTTP deletion returns 404 without mutation. |
| Invalid identifiers are handled correctly | PASS | HTTP malformed listing/review IDs return 400. |
| Redirecting handlers stop execution | PASS | Empty search avoids queries; guests cannot create/update/delete; deleted listing returns one 404 response. Missing listing's redirect/render sequence was replaced by one error response. |
| Async errors propagate to error handling | PASS | Injected lookup rejection reaches `next`; centralized handler tested; expected HTTP errors rendered. |
| Session-store errors are handled correctly | PASS | Registered handler accepts error, does not throw, and logs no payload or credentials. Real MongoDB sessions exercised by HTTP authentication. |
| New review timestamps are accurate | PASS | Per-document construction times and persisted HTTP review timestamp checked. |
| Upload authorization happens before upload processing | PASS | Multipart tests record zero upload calls for guest, stranger, invalid ID, and missing listing. |
| Unauthorized requests cannot modify other users' listings | PASS | HTTP checks edit/update/delete denial and unchanged stored title. |
| Review deletion controls appear only for authorized users | PASS | Rendered templates and HTTP pages checked as author, other user, and guest. |
| Backend review ownership protections remain effective | PASS | Guest/stranger denied; author succeeds; wrong parent-listing ID rejected. |
| Relevant automated tests pass | PASS | Final correction: complete suite 60 passed, 0 failed, 0 skipped. Default command 28 passed, 0 failed, 1 database suite skipped. Counts include parent tests. |
| Tested existing workflows remain operational | PASS | HTTP tests cover registration, login/logout, listing CRUD, search, category filtering, reviews, public pages/static assets. Legacy image replacement uses real Mongoose validation/persistence with mocked Cloudinary storage; real remote uploads remain NOT VERIFIED. |
| No production or valuable database records were modified | PASS | All database-mutating checks use verified-empty random test databases, never `ATLASDB_URL` or the seed script. |
| No secrets introduced into source control | PASS | Diff reviewed; no environment/credential files added; temporary session/test credentials generated at runtime. |

## Final correction: legacy categories and safe updates

The regression suite was added before changing the update controller. It reproduced five failing leaf checks: normalization for both aliases without an image, replacement-image saves for both aliases, and unchanged stored fields after a real Mongoose validation failure. Parent-test failures were additional runner counts, not additional defects.

The controller now prepares all field, category, and optional image changes in memory on the ownership-checked document, then calls `save()` once. Full Mongoose validation occurs before the database write. Explicit selections take priority; omitted known legacy values normalize to canonical values; omitted valid categories/images are preserved. Unknown historical categories are rejected rather than silently reassigned. A concurrent deletion detected by Mongoose returns 404.

| Final-correction check | Result | Evidence |
|---|---|---|
| Legacy edit form | PASS | Renders canonical selection without changing stored legacy value. |
| Legacy update without replacement image | PASS | Both `iconic-cities` and `amazing-pools` normalize and persist; original image retained. |
| Legacy image replacement | PASS | Both aliases persist canonical categories and replacement image using real document validation and save. Only storage upload is mocked. |
| Explicit category selection | PASS | Selecting `rooms` overrides stored `iconic-cities`. |
| Existing valid/missing category | PASS | Omitted valid category is preserved; missing category becomes `all` on save. |
| Invalid category input | PASS | Returns 400 and leaves all stored listing fields/image unchanged. |
| Mongoose validation failure | PASS | An unknown historical category triggers real enum validation; full before/after database documents remain equal. |
| Unauthorized multipart updates | PASS | Guest/non-owner requests never invoke upload processing and leave the stored listing unchanged. |

Full-suite disposable target for the passing final-correction run: `127.0.0.1:27017/havenhub_test_0bb40bf51f90fa40`. The suite verified it was empty before writes and cleaned up its documents by ID afterward. Empty test collection/database metadata may remain on MongoDB; it is not a repository artifact.

## Limits and deferred work

- Real Cloudinary integration: **NOT VERIFIED**. Authorization is verified with a mocked storage handler; no remote upload or asset deletion occurs. A database save and a remote upload are not one transaction: an authorized upload followed by invalid data or a failed save may leave an unused new asset. Existing Cloudinary images are never deleted by this correction.
- Real-browser visual/accessibility behavior: **NOT VERIFIED**. Frontend coverage uses EJS rendering and in-memory DOM checks.
- A live MongoDB session-store outage was not induced. The error callback is directly tested, and normal session persistence is exercised through HTTP.
- No destructive migrations or edits to existing review timestamps. Legacy category values are normalized only when an authorized update is saved; reads retain existing records unchanged. Filtering still accepts legacy aliases.
- Search remains a country substring search. Pagination and indexing at larger scale are deferred.
- CSRF protection, rate limiting, production cookie configuration, upload limits, image cleanup, startup hardening, and the destructive seed script remain separate follow-up work.
- No push, merge, pull request, deployment, or Phase 2 work is authorized or performed.
