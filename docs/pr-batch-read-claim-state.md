# feat(contracts): add a paginated withdrawable-balances view for operators

## Summary

Adds get_withdrawable_batch to mimim-market so operators can read up to MAX_BATCH_SIZE withdrawable balances in one simulated transaction, instead of querying one address at a time via get_withdrawable(who) and replaying WithdrawalPending events to find stranded payouts. The function is a pure read -- no USDC moves, no auth, no state mutations.

---

## What changed

### Rust (contracts-soroban/mimir-market/src/)

| File | Change |
|------|--------|
| types.rs | Added MAX_BATCH_SIZE = 50 constant; added Error::BatchTooLarge variant |
| storage.rs | Added get_withdrawable_opt(env, who) -> i128 -- miss returns 0, hit bumps TTL |
| contract.rs | Added get_withdrawable_batch(env, addrs: Vec<Address>) -> Result<Vec<i128>, Error> |
| lib.rs | Registered test_batch_read module |
| test_batch_read.rs | Focused tests for order, zero, and cap |

### TypeScript (lib/contract.ts)

Added two exports:
- BATCH_GET_WITHDRAWABLE_MAX = 50 -- mirrors the contract constant so callers can chunk without a magic number.
- batchGetWithdrawable(addrs: string[]) -> Promise<bigint[]> -- throws when addrs.length > BATCH_GET_WITHDRAWABLE_MAX; otherwise reads concurrently via the existing readWithdrawableRaw + mapWithConcurrency path. Returns 0 per unknown address, with length always equal to the input.

---

## Acceptance criteria

- [x] Output order mirrors input.
- [x] Unknown addresses return 0.
- [x] Over-sized input is rejected before any storage read.

---

## Accounting

get_withdrawable_batch is unconditionally read-only. Every Soroban guarantee that applies to get_withdrawable applies here too:

- No USDC contract transfer, no escrow change, no fee accrual.
- The returned balances are byte-for-byte identical to what get_withdrawable would return individually.
- TTL extension logic is identical: a present entry is bumped by the same BUMP_THRESHOLD / BUMP_EXTEND pair that get_withdrawable uses; a missing address does not touch storage at all.

The conservation invariant payouts + fees + dust = escrow inflow that is tested in test_settlement.rs and lib/fees.ts is unaffected -- this function never participates in settlement.

---

## Trust model

### What this function can and cannot do

| Capability | get_withdrawable | get_withdrawable_batch |
|------------|----------------|-------------------------|
| Read withdrawable balance | ✓ | ✓ |
| Move USDC | ✗ | ✗ |
| Require auth | ✗ | ✗ |
| Modify state | ✗ | ✗ |
| Return partial results on error | ✗ | ✗ (0 per unknown address) |

Because there is no auth entry and no USDC transfer, an unsigned simulation is enough to call this function. It is safe to surface through any read-only API endpoint, including unauthenticated public routes.

### Caller-supplied addresses

The function treats addrs as an untrusted list:

- An address that has never been credited returns 0 -- no contract error, no panic.
- Duplicate addresses return the same balance twice -- idempotent, no side effect from reading twice.
- Over-large batches return BatchTooLarge before any storage is touched.

None of these inputs can trigger a state change.

### read-index / cache interaction

The Neon Postgres read-index is an optional cache (design principle 1: "contract state is source of truth"). batchGetWithdrawable reads the contract directly, not the cache. Nothing in this PR inverts that relationship or writes cache rows from batch data.

---

## Migration

No migration is needed. The change is purely additive:

- get_withdrawable_batch is a new function that did not exist on the previous deployed contract. Existing callers of get_withdrawable are unaffected -- no call site has changed.
- The BatchTooLarge error is a new discriminant in the Error enum. The existing error codes are unchanged.
- The MAX_BATCH_SIZE constant is a new public constant; no existing constant was renamed or removed.
- The TypeScript batchGetWithdrawable helper is new; no existing exported name was shadowed or removed.

### Deployment steps

1. Build with cargo build --release --target wasm32v1none and verify the WASM digest with npm run verify:artifacts.
2. Deploy the new contract WASM (npm run deploy:contract). Because the function is additive and the ABI is extended (not changed), no state migration or re-initialization is needed.
3. Regenerate TypeScript bindings with npm run stellar*bindings to expose the native get_withdrawable_batch binding. The batchGetWithdrawable helper in lib/contract.ts already works without this step (it uses readWithdrawableRaw internally) and can be upgraded to the native binding post-regeneration.
4. Run npm run smoke:onchain to confirm the live contract is reachable.

### Rollback

Because the function is additive, rolling back to the previous contract WASM is safe -- the TypeScript batchGetWithdrawable helper falls back to readWithdrawableRaw calls and continues to work against the older contract. There is no stored state to revert.

---

## Operational impact

### RPC cost

The current implementation issues one simulated invocation per address (same as readWithdrawableRaw). After bindings regeneration and upgrade to the native get_withdrawable_batch contract call, a 50-address batch becomes one simulation with 50 ledger-entry reads -- a ~20x reduction in simulated calls for full-range operator scans.

### Footprint limit

MAX_BATCH_SIZE = 50, keypt each simulated transaction's persistent-entry footprint within the Soroban limit. The function reads only the Withdrawable entry per address, so the footprint scales linearly with the batch size and stays bounded.

### Rate limits

The helper respects STELLAR_READ_CONCURRENCY through mapWithConcurrency, so the public Soroban RPC is not overwhelmed even under a full 50-address batch. The limit is the same constant already governing readClaimsRange.

### Feature flags

No feature flags added. The function is always available once the contract is deployed. The TypeScript helper is always exported.

### Pause / kill switch

This is a read path. The existing checkWriteAllowed guards on create_claim and challenge_claim are unrelated to reads and are unaffected. There is no "pause reads" capability (reads cannot be paused without breaking all callers), and none is needed here.

---

## Test evidence

```
test result: ok. 136 passed; 0 failed; 0 ignored   (mimir-market)
test result: ok. 65 passed; 0 failed; 0 ignored    (mimir-squad)
wasm32v1-none build: Finished release profile, no warnings
npm run typecheck: 0 new errors in lib/contract.ts
npm run check:terms: ✓ no forbidden terms in 527 tracked files
```

New tests in test_batch_read.rs:

- Order: batch output mirrors input order for a mixed list of known and unknown addresses.
- Zero: unknown addresses return 0, and an empty input returns an empty vec.
- Cap: exactly MAX_BATCH_SIZE addresses are accepted; MAX_BATCH_SIZE + 1 is rejected with BatchTooLarge before any storage read.
- Conservation: batch values match individual get_withdrawable calls field-by-field; batch does not mutate escrow.
- Regression: existing get_withdrawable unaffected after batch read; duplicate addresses return consistent values; output length always equals input length.

Closes #<this issue>
