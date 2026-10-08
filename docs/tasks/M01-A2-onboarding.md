# M01-A2 — SHOP + DRIVER Onboarding design contract

Status: DESIGN READY FOR OWNER REVIEW  
Date: 2026-10-08  
Design base: `main @ 1f6c0deef490570702346dcd89d1bdb7858ab25a`  
Foundation gate: M01-A1 merged by PR #12 at merge commit `2dbdd8c51e750fba9ed042bbdd431f4edf19f9bb`; final PR-head CI `37664008990` success.

## 1. Authority and corrections

For M01-A2, precedence is:

1. this task;
2. merged M01-A1 contract and implementation;
3. ADR-003 transactional/idempotency core;
4. ADR-002 Auth security foundation;
5. `11Ship-buoc-4.2-auth-onboarding-M01-A-v1.0.md`;
6. legacy `11Ship-buoc-4.3-goi-Claude-M01-A1-AUTH-CORE-v1.0.md`.

Corrections to older onboarding text:

- Driver classification is `PLATFORM | EXTERNAL`. Legacy driver classification `SYSTEM` is invalid. Auth role `SYSTEM` remains a separate administration role and is not changed by this task.
- Self-onboarding always creates an `EXTERNAL` driver. A driver cannot submit `driver_type`.
- SHOP profile may be saved before GPS is available. GPS is required to complete onboarding and make the profile ACTIVE; saving an incomplete profile must not grant SHOP role.
- SHOP business hours are not required to complete profile onboarding. A newly completed shop starts with `accepting_orders=false`; absence of business hours means operational availability is OFFLINE until the later M02 hours slice exists.
- Driver onboarding does not activate a driver. It creates `PENDING`, `accepting_deliveries=false`. Bank verification, wallet funding, manual approval, suspension/closure and delivery acceptance belong to later M03/M04/M07 slices.
- M01 does not own M02/M03 business data. A2 is a vertical slice: M02 owns Shop tables/services, M03 owns Driver tables/services, and a composition/onboarding coordinator uses the existing M00 TransactionContext to commit business creation + M01 role grant atomically.
- A2 may add only the minimum M02/M03 owner schema required by onboarding. It must not implement full Shop management, Driver approval, bank, wallet, delivery or admin workflows.

## 2. Scope and implementation slices

A2 is one design group but MUST be implemented in two small Claude slices:

### M01-A2S — SHOP Onboarding

Implement:

- minimal M02 `service_areas`, `shops`, `shop_members` ownership;
- save/resume an incomplete SHOP profile;
- complete SHOP onboarding;
- grant M01 `SHOP` role only when completion succeeds;
- role/profile eligibility read port needed by Auth;
- onboarding status projection;
- migrations, tests, audit/outbox for this slice.

### M01-A2D — DRIVER Onboarding

Implement:

- minimal M03 `drivers`, `driver_service_areas` ownership;
- self-onboard DRIVER;
- always create `driver_type=EXTERNAL`, `status=PENDING`, `accepting_deliveries=false`;
- grant M01 `DRIVER` role atomically;
- driver profile/status read and active-status guard ports;
- onboarding status projection;
- migrations, tests, audit/outbox for this slice.

A2S and A2D may be separate implementation PRs. Do not hand Claude both in one prompt.

## 3. Explicitly out of scope

Do NOT implement:

- Shop business-hours CRUD or operational scheduling engine;
- Shop menu/order/delivery;
- Shop staff/member management beyond one OWNER membership created by onboarding;
- Driver bank account creation/verification;
- Driver wallet, topup, withdrawal, activation funding;
- Driver approval, PLATFORM promotion, suspend/resume, closure;
- Driver GPS tracking or online toggle;
- Delivery acceptance;
- ADMIN/SYSTEM provisioning or 2FA;
- production SMS;
- password/session changes already deferred from A1;
- geometry/polygon engine or routing provider.

No new ORM, JWT, validation framework, queue, Redis or external provider.

## 4. Ownership and module boundary

### M01 Auth owns

- `users`
- `user_roles`
- `sessions`
- current authentication/authorization primitives.

Only M01 may grant `user_roles.SHOP` or `user_roles.DRIVER`.

### M02 Shop owns

- `service_areas`
- `shops`
- `shop_members`

A2S does not create `shop_business_hours`; later M02 owns it.

### M03 Driver owns

- `drivers`
- `driver_service_areas`

A2D does not create `driver_bank_accounts` or closure tables.

### Coordinator rule

The onboarding coordinator may depend on owner services/ports, but it MUST NOT issue raw SQL against another module's business tables.

Owner participants accept the SAME existing M00 `TransactionContext`; they never begin/commit their own transaction.

Composition wiring must preserve one-way ownership:

- A2 may make Auth export the existing `SessionAuthGuard` plus a narrow M01 role-grant participant; do not duplicate authentication logic in Onboarding.
- M02 exports read/write ports for ServiceArea/Shop that accept UUID actor IDs + TransactionContext; M02 does not import AuthModule.
- M03 exports Driver profile/status ports and may consume the M02 ServiceArea read/lock port; M03 does not import AuthModule.
- The Onboarding composition module imports Auth + M02 (+ M03 for A2D) and coordinates them.
- Auth role-context may consume read-only Shop/Driver eligibility ports once A2 is wired. This is a read dependency only; Auth must not issue raw M02/M03 SQL.
- If NestJS wiring would require a circular module import, STOP and move the composition provider to the app/onboarding layer rather than using `forwardRef` as an architectural shortcut.

Logical dependency:

```
HTTP + AuthGuard
      |
Onboarding coordinator
  |       |        |
 M01     M02      M03
 role    shop     driver
 grant   ports    ports
      \    |    /
       same TransactionContext
```

## 5. IDs, API format and validation convention

- Existing `/v1` prefix and JSON snake_case.
- UUID server IDs, same convention as A1.
- Bearer opaque session from A1.
- Every mutation requires canonical `Idempotency-Key`.
- Existing resource mutations use `expected_version`.
- Actor user_id comes only from authenticated server session, never request body.
- Strict schemas reject unknown fields.
- Fields such as `role`, `roles`, `driver_type`, `status`, `accepting_orders`, `accepting_deliveries`, `is_admin`, `permissions`, `user_id` are forbidden client input unless explicitly listed.
- String values are outer-trimmed where they are profile text; password semantics are irrelevant here and A1 remains unchanged.
- Phone contact uses the A1 Vietnamese phone normalizer but is not required to equal login phone and is not treated as a new authentication credential.

## 6. M02 schema — minimum Shop onboarding core

Create a new migration AFTER the Auth migration. Do not edit applied migrations. No `IF NOT EXISTS` drift masking and no business seed rows.

### 6.1 `service_areas`

Minimum:

- `service_area_id uuid PK`
- `code varchar(64) UNIQUE NOT NULL`
- `name varchar(120) NOT NULL`
- `status ACTIVE | INACTIVE NOT NULL`
- `version bigint NOT NULL DEFAULT 1 CHECK >= 1`
- `created_at`
- `updated_at`

A2 does not define polygons or routing geometry. Tests insert fixtures explicitly. Production onboarding is unavailable until an operator/configuration slice creates at least one ACTIVE service area.

### 6.2 `shops`

Minimum:

- `shop_id uuid PK`
- `name varchar(120) NOT NULL`
- `contact_phone_normalized varchar(16) NOT NULL`
- `zalo varchar(160) NULL`
- `facebook varchar(300) NULL`
- `address_text varchar(500) NOT NULL`
- `pickup_lat double precision NULL`
- `pickup_lng double precision NULL`
- `service_area_id uuid NULL FK -> service_areas`
- `status INCOMPLETE | ACTIVE | DISABLED NOT NULL`
- `accepting_orders boolean NOT NULL DEFAULT false`
- `version bigint NOT NULL DEFAULT 1 CHECK >= 1`
- `created_at`
- `updated_at`

DB checks:

- lat/lng are both NULL or both non-NULL;
- latitude in [-90, 90], longitude in [-180, 180];
- `status=ACTIVE` requires non-NULL lat/lng and service_area_id;
- `INCOMPLETE` must have `accepting_orders=false`.

Active service-area state is a cross-row rule and is rechecked under lock by service code at completion.

### 6.3 `shop_members`

Minimum:

- `shop_id uuid FK -> shops`
- `user_id uuid FK -> users`
- `member_role OWNER` for A2
- `created_at`
- PK/UNIQUE `(shop_id,user_id)`
- unique owner per shop;
- unique OWNER membership per user.

This enforces “one account owns one shop” at the DB layer. Do not use CASCADE deletes.

An INCOMPLETE profile already has its OWNER membership so only that authenticated user can resume it. It does NOT yet have M01 SHOP role.

## 7. M03 schema — minimum Driver onboarding core

Create a migration after the Shop/service-area migration because Driver references M02 service areas.

### 7.1 `drivers`

Minimum:

- `driver_id uuid PK`
- `user_id uuid UNIQUE NOT NULL FK -> users`
- `full_name varchar(120) NOT NULL`
- `plate_number varchar(32) NULL`
- `driver_type EXTERNAL | PLATFORM NOT NULL DEFAULT EXTERNAL`
- `status PENDING | ACTIVE | SUSPENDED | CLOSING | CLOSED NOT NULL`
- `accepting_deliveries boolean NOT NULL DEFAULT false`
- `version bigint NOT NULL DEFAULT 1 CHECK >= 1`
- `created_at`
- `updated_at`

A2 may INSERT only:

- `driver_type=EXTERNAL`
- `status=PENDING`
- `accepting_deliveries=false`

PLATFORM is a later privileged management mutation. A2 exposes no command that changes driver_type/status.

DB check: `status <> ACTIVE` implies `accepting_deliveries=false` for states supported by A2; later lifecycle design may tighten transition rules without rewriting A2 history.

### 7.2 `driver_service_areas`

- `driver_id uuid FK -> drivers`
- `service_area_id uuid FK -> service_areas`
- `created_at`
- PK `(driver_id,service_area_id)`

A2 requires at least one unique ACTIVE service area for self-onboarding.

No CASCADE deletes.

## 8. SHOP onboarding API

### 8.1 Save/resume profile

`PUT /v1/onboarding/shop/profile`

Headers:

- `Authorization: Bearer ...`
- `Idempotency-Key: <uuid>`

Request:

```json
{
  "name": "Quán A",
  "contact_phone": "0987654321",
  "zalo": "optional",
  "facebook": "optional",
  "address_text": "Địa chỉ nhập tay",
  "pickup_lat": null,
  "pickup_lng": null,
  "service_area_id": null,
  "expected_version": null
}
```

Rules:

- name/contact/address are required;
- zalo/facebook optional;
- GPS + service_area may be omitted while saving profile;
- if one coordinate is supplied, both are required;
- supplied service_area must exist and be ACTIVE at the time of save;
- if the user has no profile, `expected_version` must be null/absent and the service creates one INCOMPLETE shop + OWNER membership atomically;
- if an INCOMPLETE profile exists, `expected_version` is required and must match;
- an ACTIVE/DISABLED shop cannot be mutated through onboarding profile endpoint;
- a user with an existing OWNER membership cannot create another shop.

Response 200/201:

```json
{
  "data": {
    "shop_id": "...",
    "status": "INCOMPLETE",
    "version": 1,
    "role_granted": false
  }
}
```

No SHOP role is granted by profile save.

### 8.2 Complete SHOP onboarding

`POST /v1/onboarding/shop/complete`

Headers: bearer + Idempotency-Key.

Request:

```json
{
  "expected_version": 1
}
```

Under one transaction:

1. lock authenticated user;
2. lock the user's OWNER membership + shop;
3. require INCOMPLETE and expected_version match;
4. require name/contact/address/GPS/service_area complete;
5. lock the referenced service-area row and require ACTIVE;
6. set shop ACTIVE, keep `accepting_orders=false`, increment version;
7. grant M01 SHOP role;
8. append SUCCESS audit;
9. append `shop.onboarded.v1` outbox event;
10. persist idempotency result and commit atomically.

No business-hour row is required.

Response 200:

```json
{
  "data": {
    "shop_id": "...",
    "status": "ACTIVE",
    "accepting_orders": false,
    "role_granted": true,
    "version": 2
  }
}
```

Completion does NOT auto-select active_role and does not mint a new access token. The client uses the existing session then calls role/select if it wants SHOP context.

## 9. DRIVER onboarding API

`POST /v1/onboarding/driver`

Headers: bearer + Idempotency-Key.

Request:

```json
{
  "full_name": "Nguyen Van A",
  "plate_number": "11B1-12345",
  "service_area_ids": ["uuid"]
}
```

Required:

- full_name;
- at least one unique service_area_id.

Optional:

- plate_number.

Forbidden:

- `driver_type`
- legacy `SYSTEM`
- `PLATFORM`
- `status`
- `accepting_deliveries`
- admin/permission fields
- bank verification flags
- wallet/funding fields.

Under one transaction:

1. lock authenticated user;
2. prove no Driver profile exists for the user;
3. sort service_area_ids by UUID and lock all referenced service-area rows in that order;
4. every area must exist and be ACTIVE;
5. create driver EXTERNAL/PENDING/accepting_deliveries=false;
6. insert driver_service_areas;
7. grant M01 DRIVER role;
8. append SUCCESS audit;
9. append `driver.onboarded.v1` outbox event;
10. persist idempotency result and commit atomically.

Response 201:

```json
{
  "data": {
    "driver_id": "...",
    "driver_type": "EXTERNAL",
    "status": "PENDING",
    "accepting_deliveries": false,
    "role_granted": true,
    "version": 1
  }
}
```

No bank, wallet or approval mutation runs here.

## 10. Auth integration after A2

A1 intentionally did not read Shop/Driver profiles because they did not exist. A2 adds profile-aware role eligibility through owner READ ports.

### 10.1 Role selection

For `POST /v1/auth/role/select`:

- SHOP: user must hold M01 SHOP role AND have an ACTIVE shop OWNER membership.
- DRIVER: user must hold M01 DRIVER role AND have a Driver profile not CLOSED. PENDING/SUSPENDED remain selectable so the user can enter the Driver app and see status/actions; active-only business operations use a stronger Driver guard.
- ADMIN/SYSTEM remain unavailable through this endpoint.
- PLATFORM/EXTERNAL are not roles.

Keep A1 SHOP single-active-session behavior unchanged after eligibility succeeds.

### 10.2 `GET /v1/auth/me`

Add an `onboarding` projection without changing bearer/session architecture:

```json
{
  "data": {
    "user_id": "...",
    "phone_normalized": "+84...",
    "available_roles": ["SHOP", "DRIVER"],
    "active_role": null,
    "onboarding_required": false,
    "role_selection_required": true,
    "onboarding": {
      "shop": "COMPLETED",
      "driver": "PENDING_APPROVAL"
    }
  }
}
```

A2 states:

SHOP:
- `NOT_STARTED`
- `INCOMPLETE`
- `COMPLETED`

DRIVER:
- `NOT_STARTED`
- `PENDING_APPROVAL`
- `ACTIVE`
- `SUSPENDED`
- `CLOSING`
- `CLOSED`

Do not fabricate wallet/bank/approval details.

The Auth module consumes read-only owner ports; it never writes M02/M03 tables.

### 10.3 Driver active guard port

M03 exports a server-side guard/service equivalent to:

`requireDriverActive(context,userId)`

It must reject PENDING with `DRIVER_PENDING_APPROVAL`. A2 tests this port against real PostgreSQL. M07 later reuses it together with accepting/routing/wallet checks; A2 does not claim delivery integration is complete.

## 11. Idempotency identity and replay

All A2 mutations reuse M00 IdempotencyExecutor.

### Shop profile save

- scope_type: `user`
- scope_id: authenticated user_id
- operation_id: `onboarding.shop.profile.save.v1`
- logical request: exact validated profile fields + expected_version.

### Shop completion

- scope_type: `user`
- scope_id: authenticated user_id
- operation_id: `onboarding.shop.complete.v1`
- logical request: expected_version.

### Driver create

- scope_type: `user`
- scope_id: authenticated user_id
- operation_id: `onboarding.driver.create.v1`
- logical request: full_name, plate_number, sorted unique service_area_ids.

Same key + same logical request replays the stored successful result with no duplicate business effect.

Same key + changed request -> `IDEMPOTENCY_KEY_REUSED`.

Dedupe/replay TTL and key rotation are inherited from M00. Do not create new idempotency storage.

A bearer session is still required before idempotency lookup reaches business execution; Idempotency-Key is never a credential.

## 12. Global lock order for A2

To avoid cross-flow deadlocks:

1. M00 idempotency advisory lock;
2. M01 user row `FOR UPDATE`;
3. existing owner aggregate row:
   - Shop OWNER membership then shop row; or
   - Driver row;
4. referenced service_area rows sorted by `service_area_id`;
5. M01 user_role write/check;
6. audit/outbox/idempotency persistence.

All fresh business checks happen under these locks with PostgreSQL time where time is relevant.

Concurrent Shop and Driver onboarding for the SAME user serialize at the user row but are both allowed to complete sequentially. Final user may own both SHOP and DRIVER roles.

## 13. Audit/outbox/privacy

Audit actions:

- `onboarding.shop.profile.save.v1`
- `onboarding.shop.complete.v1`
- `onboarding.driver.create.v1`

Outbox events on successful completion/create:

### `shop.onboarded.v1`

Payload exactly:

```json
{"shop_id":"...","user_id":"..."}
```

### `driver.onboarded.v1`

Payload exactly:

```json
{"driver_id":"...","user_id":"..."}
```

Do not place raw request bodies, contact phone, address, GPS, access token or Idempotency-Key into audit/outbox metadata.

Logs follow existing safe logging convention and must not log Authorization or raw request body.

## 14. Error contract delta

Add only the minimum A2 codes:

| HTTP | Code | Meaning |
|---|---|---|
| 409 | SHOP_ONBOARDING_EXISTS | user already owns a different/finished Shop profile incompatible with create |
| 409 | SHOP_PROFILE_INCOMPLETE | completion prerequisites missing or no draft exists |
| 409 | DRIVER_PROFILE_EXISTS | user already has a Driver profile |
| 400 | INVALID_SERVICE_AREA | missing/inactive/duplicate/invalid area reference |
| 409 | VERSION_CONFLICT | expected_version is stale |
| 403 | DRIVER_PENDING_APPROVAL | active-only Driver operation called while PENDING |

Existing A1/M00 errors remain unchanged.

Do not expose SQL constraint names or another user's resource existence.

## 15. Concurrency and atomicity requirements

### SHOP

- Same user, same completion key/request concurrently: one execution; other replays or M00 returns BUSY according to existing contract.
- Different keys racing profile creation: exactly one shop + one OWNER membership; loser maps to `SHOP_ONBOARDING_EXISTS`.
- Different keys racing completion: one role grant, one ACTIVE transition, one audit/outbox effect; loser sees current business state, never duplicate.
- Service area becoming INACTIVE while completion waits: completion must lock/recheck and fail, no SHOP role.
- Fault at shop/member/role/audit/outbox/idempotency persistence rolls back the entire transaction.

### DRIVER

- Different keys racing create: exactly one driver and one set of area rows; loser `DRIVER_PROFILE_EXISTS`.
- Duplicate area IDs cannot create duplicate rows.
- Area becoming INACTIVE while create waits: lock/recheck -> fail with no driver/role.
- Role grant/audit/outbox/idempotency fault -> no orphan driver.
- Driver and Shop onboarding concurrently for same user may both succeed sequentially; neither role/profile overwrites the other.

Use deterministic PostgreSQL barriers, not sleep-only races.

## 16. Acceptance tests

Legacy A03 is superseded by the current product rule that Shop profile can be saved before GPS.

### A03 contract

- `A03-20` missing shop name/contact/address -> validation failure; no profile.
- `A03-21` valid shop profile without GPS can be saved -> INCOMPLETE, OWNER membership exists, SHOP role absent.
- `A03-22` complete shop with GPS + ACTIVE service area and no business hours -> ACTIVE, accepting_orders=false, SHOP role granted.
- `A03-23` same-key retry of profile save/completion -> same result, no second shop/member/role/event.
- `A03-24` two different keys racing first Shop profile create -> exactly one shop; loser SHOP_ONBOARDING_EXISTS.
- `A03-25` inactive/unknown service area at completion -> INVALID_SERVICE_AREA; profile remains INCOMPLETE; no SHOP role.
- `A03-26` Driver self-onboard -> EXTERNAL, PENDING, accepting_deliveries=false, DRIVER role granted.
- `A03-27` client sends driver_type PLATFORM, legacy SYSTEM, status, accepting_deliveries or admin fields -> strict reject; no privilege/profile.
- `A03-28` Driver without CCCD/vehicle_type succeeds; plate_number may be absent.
- `A03-29` Driver area unknown/inactive/duplicate -> reject atomically; no Driver role/profile.
- `A03-30` PENDING Driver active guard -> DRIVER_PENDING_APPROVAL.

### Additional mandatory tests

- `A03-C01` concurrent Driver create different keys -> one driver only.
- `A03-C02` area state race uses deterministic row-lock barrier.
- `A03-C03` Shop complete and Driver create concurrently for one user -> both can complete, user gets SHOP + DRIVER.
- `A03-C04` fault matrix proves no orphan profile/membership/area/role/audit/outbox/idempotency effects.
- `A03-C05` `/auth/me` reports NOT_STARTED/INCOMPLETE/COMPLETED and PENDING_APPROVAL correctly.
- `A03-C06` role/select SHOP requires ACTIVE owner profile; DRIVER pending profile remains selectable; missing profile with a stray role is not selectable.
- `A03-C07` SHOP device-switch invariant from A1 still passes after profile eligibility integration.
- `A03-C08` privacy markers do not appear in logs/audit/outbox/idempotency guard.

## 17. Migration gate

Tests must prove:

- clean install M00 + M01-A1 + M02 onboarding + M03 onboarding;
- upgrade from current merged main schema;
- second up no-op;
- drift fails loudly and atomically;
- no applied migration edited;
- down order respects M03 -> M02 dependencies and uses no CASCADE;
- DB uniqueness for one Shop owner/user and one Driver/user;
- service-area FK/invariants;
- `driver_type` accepts only EXTERNAL/PLATFORM and A2 service writes only EXTERNAL;
- status/accepting checks hold under direct SQL fixture attempts.

## 18. Implementation handoff policy

Do NOT hand A2 as one giant Claude task.

### First implementation: M01-A2S

Claude may touch:

- M02 owner module/repositories;
- service-area + shop migrations;
- onboarding Shop coordinator/controller;
- minimal Auth profile-eligibility/status integration;
- A2S tests/evidence.

It must not create Driver tables.

After ChatGPT audit + Owner merge, hand:

### Second implementation: M01-A2D

Claude may touch:

- M03 owner module/repositories;
- driver migration;
- Driver onboarding coordinator/controller;
- Driver role/status integration;
- A2D tests/evidence.

It must not add Wallet/approval/bank/delivery.

Both implementation PRs start DRAFT and remain unmerged until independent ChatGPT review.

## 19. CODE_READY gate

A2 design may be merged before implementation. A slice becomes CODE_READY only when:

- this design is Owner-locked;
- previous required slice is merged where applicable;
- current main CI is green;
- migration names/base SHA are pinned at handoff;
- no conflicting newer M02/M03 design has been accepted;
- error registry and API schemas are reconciled with current main;
- Claude prompt lists exact base/head and tests.

If a later accepted Driver/Wallet ADR changes status/type ownership, the A2D handoff must reconcile it explicitly before code; Claude must not guess.

## 20. Definition of Done

M01-A2 as a group is DONE only when both A2S and A2D are merged and verified.

A2S PASS requires:

- resumable Shop profile;
- GPS required only for completion;
- one account -> one Shop owner invariant;
- completion atomically grants SHOP role;
- no hours required; accepting_orders starts false;
- active area rechecked under lock;
- deterministic race + rollback tests;
- Auth role/profile integration does not regress A1 SHOP session behavior.

A2D PASS requires:

- one Driver/user invariant;
- self-onboarding always EXTERNAL/PENDING/offline;
- PLATFORM/SYSTEM/admin injection impossible;
- active areas validated under lock;
- role grant atomic with profile/areas;
- pending active guard exists;
- deterministic race + rollback tests;
- user can hold SHOP + DRIVER together;
- no bank/wallet/approval/delivery implementation leaked into scope.

No A2 implementation is allowed to claim Driver ACTIVE or production onboarding rollout readiness.

## 21. A2S review addendum — resumable profile and coherent Auth projection

Three corrections from the independent design review of the A2S implementation (PR #16). They add to sections 8, 10 and 12; nothing else in this document changes, and where an earlier sentence disagrees with this section, this section wins.

### 21.1 `GET /v1/onboarding/shop/profile` — the draft is resumable

Section 8.1 promises "save/resume" but defined only the write. A new session or another device had no way to get the draft and its current version back. This endpoint is that read.

- `Authorization: Bearer ...` is required (existing session errors apply). **No `Idempotency-Key`**: it is not required and is ignored when sent.
- Read-only: no audit row on success, no outbox event, no idempotency record.
- M02 owns the SQL: one statement joining the user's OWNER membership to its shop, so membership and shop come from a single snapshot. It takes no lock.
- The user comes only from the session. The response never contains `user_id`, membership fields, or audit/idempotency metadata.

No Shop profile yet:

```json
{ "data": null }
```

Otherwise (200):

```json
{
  "data": {
    "shop_id": "...",
    "name": "Tên quán",
    "contact_phone": "+84987654321",
    "zalo": null,
    "facebook": null,
    "address_text": "Địa chỉ",
    "pickup_lat": null,
    "pickup_lng": null,
    "service_area_id": null,
    "status": "INCOMPLETE",
    "accepting_orders": false,
    "version": 1
  }
}
```

`contact_phone` is the stored normalized value. The response is enough to rebuild the form and `PUT` it back with `expected_version = version`. An owned ACTIVE or DISABLED shop is returned too; the mutation rules of 8.1 and 8.2 are unchanged.

### 21.2 `GET /v1/auth/me` reads one coherent state

`/auth/me` read the user's roles and then the Shop eligibility as two READ COMMITTED statements without a lock. A completion committing between them could produce a projection that never existed (for example `onboarding.shop = COMPLETED` without SHOP in `available_roles`).

- Before reading roles and Shop eligibility, `/auth/me` takes a **shared** row lock on the user (`FOR SHARE`) and re-checks that the user exists and is ACTIVE.
- Completion keeps its user `FOR UPDATE` (section 12, step 2), so the two serialize at the user row: `/auth/me` runs entirely before a completion or waits for its commit.
- `FOR SHARE` does not conflict with `FOR SHARE`: concurrent `/auth/me` calls of one user do not wait for each other.
- No SERIALIZABLE transaction, no Auth SQL against M02 tables, no `forwardRef`. The lock order of every mutation in section 12 is unchanged; `/auth/me` takes only this one lock and writes nothing. A1 session behavior is unchanged.

### 21.3 `onboarding_required` when the Shop is COMPLETED but not selectable

A DISABLED shop finished onboarding. It cannot be selected, and it must not be told to onboard again, because both onboarding commands refuse it. One rule, shared by login and `/auth/me`:

- `onboarding_required = true` only when the user has no selectable role **and** Shop onboarding is `NOT_STARTED` or `INCOMPLETE`. A stray SHOP role without a profile still needs onboarding.
- `role_selection_required = true` only when at least one role is selectable and the session has no active role.

| Shop state | SHOP in `available_roles` | `onboarding.shop` | `onboarding_required` (no other usable role) |
| --- | --- | --- | --- |
| no profile | no | `NOT_STARTED` | `true` |
| INCOMPLETE | no | `INCOMPLETE` | `true` |
| ACTIVE | yes (with the SHOP role) | `COMPLETED` | `false` |
| DISABLED | no; select gives `ROLE_NOT_AVAILABLE` | `COMPLETED` | `false` |

A Shop-only user whose completed shop is DISABLED therefore gets, at login and at `/auth/me`: `available_roles = []`, `onboarding_required = false`, `role_selection_required = false`.

DRIVER is unchanged: holding the role makes it selectable, and any selectable role makes `onboarding_required = false`.


## 22. Owner-locked A2D revision — remove Driver service-area registration

Decision date: 2026-10-08. Owner explicitly approved removing Driver operating-area registration from A2D. This section supersedes ALL earlier Driver-specific area requirements in sections 2, 4, 7, 9, 11, 12, 15–20 and the previous Claude handoff. Shop/service-area rules remain unchanged. This is the accepted implementation target; PR #17 at `48ea24887009fc432b5077bdff4786eedab35524` still implements the superseded design and is NOT ready to merge.

### Schema and API

- M03 A2D owns only `drivers`. Do not create `driver_service_areas` or its index.
- Remove `service_area_ids` from Driver request schema, logical request, coordinator, repository and fixtures. Under strict unknown-field validation, a request containing it returns the existing generic 400 BAD_REQUEST and creates no effects.
- Remove `DRIVER_SERVICE_AREAS_MAX`; no 50-area cap or substitute cap.
- Request: required `full_name`; optional/null `plate_number`. Existing text normalization and length limits remain.
- No GPS field, GPS check, province check, default-area assignment or location provider is introduced in A2D.
- Future verification and delivery-acceptance slices will define their own conditions. A2D does not define new distance/position conditions or change existing delivery policies.
- M02 `service_areas`, Shop's area FK, Shop validation and Shop area-lock tests remain.

### Transaction and ownership

Use the existing M00 executor, same user scope and operation `onboarding.driver.create.v1`. Logical request is exactly normalized full_name and plate_number.

Lock order: M00 idempotency advisory/existing-record lock → M01 user FOR UPDATE → existing Driver row if present → Driver insert → M01 DRIVER role grant → audit → outbox → idempotency-result persistence.

One Driver per user remains enforced by UNIQUE(user_id). Self-onboarding still creates EXTERNAL/PENDING/accepting_deliveries=false/version 1, and grants DRIVER atomically. Replay, strict privilege-field rejection, outbox payload, Auth eligibility, coherent /auth/me and no automatic role selection/token minting remain unchanged. Concurrent Shop completion and Driver creation still serialize on the user root and may both succeed.

### Migration policy

The Driver migration on this unmerged draft PR has been exercised only on disposable local/CI test databases per the author handoff. Amend `1791676800000_create-driver-onboarding.sql` to create/drop only drivers and its own constraints/indexes. Do not edit any previously merged M00/Auth/Shop migration. Recreate disposable test databases after the amendment; do not prescribe a reset of persistent data. If an actual persistent deployment of the draft migration is discovered, STOP the migration edit and report it for an additive migration plan.

### Accepted Auth/guard semantics

- A Driver profile of any known status means Driver onboarding has already finished. A CLOSED profile is not selectable and must not route the user back to Driver creation.
- ACTIVE-only guard: ACTIVE returns driver_id; PENDING throws DRIVER_PENDING_APPROVAL; SUSPENDED/CLOSING/CLOSED/missing profile throws existing ROLE_NOT_AVAILABLE.
- Unexpected runtime status MUST reject (safe TechnicalError/internal is acceptable), never resolve undefined. The database CHECK and TypeScript union do not replace this defensive behavior.
- Guard remains a read participant using the caller's TransactionContext. No new locking protocol or delivery endpoint is introduced here.

### Revised acceptance mapping

| ID | Required proof |
| --- | --- |
| A03-26 | Create EXTERNAL/PENDING/offline/version 1 with atomic DRIVER role, audit, event and idempotency result |
| A03-27 | Reject driver_type (PLATFORM/SYSTEM), status, accepting_deliveries, identity/admin/bank/wallet injection; no effects |
| A03-28 | No CCCD/vehicle_type required; plate_number may be absent/null; no area/GPS input required |
| A03-29 | **Superseded:** Driver area validation is removed. New proof: legacy service_area_ids is rejected as an unknown field; full_name with optional plate succeeds without any service-area fixture |
| A03-30 | Real PostgreSQL-backed active guard: PENDING rejects with DRIVER_PENDING_APPROVAL |
| A03-C01 | Concurrent different-key create: exactly one Driver and one set of effects |
| A03-C02 | Driver area race removed; existing Shop area-race coverage remains unchanged |
| A03-C03 | Same-user Shop complete + Driver create both succeed sequentially; both profiles/roles preserved |
| A03-C04 | Driver/role/audit/outbox/idempotency persistence fault matrix: full rollback and successful retry; Driver-area fault removed |
| A03-C05 | Coherent /auth/me Driver projection, including concurrent creation |
| A03-C06 | Profile-aware SHOP/DRIVER eligibility; pending Driver selectable; stray role and CLOSED refused |
| A03-C07 | Existing SHOP device-switch invariant unchanged |
| A03-C08 | No profile text/secrets in logs/audit/outbox/idempotency guard |

Migration proofs: clean install, upgrade from merged base, second runner up no-op, drift atomic failure, down dependency order, one Driver/user, FK to users, types/status/offline constraints. Remove Driver-area FK/uniqueness/index proofs. Assert the final schema has NO driver_service_areas table/index. Direct SQL creation of a Driver without area rows is valid.

## 23. Claude repair handoff — PR #17, revision 22 plus F1–F3

Start from reviewed head `48ea24887009fc432b5077bdff4786eedab35524` plus the design-only commit that adds sections 22–23. Fetch branch `feat/m01-a2d-driver-onboarding`, verify the intervening diff, and record the actual new base. Keep the same PR #17 DRAFT. Do not merge, mark Ready or start another module.

1. Implement section 22 across migration, M03, Driver coordinator/parser/constants, Auth test fixtures, Driver tests and evidence. Remove all Driver area rows/SQL/locks/fixtures/faults/tests. Preserve Shop areas and all relevant Shop tests. Do not add GPS or verification workflows.
2. **F1:** fix the active guard's unexpected-status fallthrough. Unit test must assert the guard promise itself rejects; it must not read driverId after resolution and mistake that TypeError for guard denial. Show the new regression fails on old guard and passes on fixed guard.
3. **F2:** add PostgreSQL-backed tests that invoke the real DriverActiveGuard through an actual M00 TransactionContext. Prove ACTIVE returns the correct id; PENDING → DRIVER_PENDING_APPROVAL; SUSPENDED/CLOSING/CLOSED and missing profile → ROLE_NOT_AVAILABLE. Do not fake SQL results or add an HTTP endpoint to expose the guard.
4. **F3:** rewrite evidence mapping against section 22 and actual test names. Correct the historical final-head run 37721442229 at 48ea248: unit 1051/1051; local integration 615 passed + 1 pending out of 616; CI integration 616/616, no pending. Report fresh counts separately, do not carry old totals forward.
5. Run required lint/typecheck/build/migration smoke/unit/integration local and CI modes; verify Shop/Auth regression. Local toolchain/network limitations must be reported honestly; GitHub CI evidence is acceptable.
6. Update PR title/body around the final no-area implementation and evidence. Handoff: base, code head, final head, exact-SHA final CI URL/status/counts, changed old tests/reasons, acceptance mapping and migration amendment scope. No PASS or DONE claim before independent audit.

## 24. Post-merge repair addendum (2026-10-08)

Bổ sung cho §8, §10 và §12; không viết lại evidence lịch sử ([A2S](../evidence/M01-A2S.md), [A2D](../evidence/M01-A2D.md)). Chi tiết: [M00-M01-post-merge-repairs §1](M00-M01-post-merge-repairs.md).

- Mọi lệnh onboarding (shop save, shop complete, driver create) và replay nhạy cảm xác thực lại user VÀ session HIỆN TẠI bên trong transaction nghiệp vụ: user FOR UPDATE, session FOR UPDATE, rồi đồng hồ PostgreSQL mới; replay chạy cùng participant trước khi decrypt. SessionAuthGuard chỉ còn là precheck.
- `sessionId` không thuộc scope, replay guard hay logical request; session thay thế hợp lệ của cùng user vẫn replay được, session đã revoke hoặc hết hạn thì không.
- `RoleGrantParticipant.grant()` không còn tự khóa user; user lock nằm ở participant trên.
