import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_TOTAL_FEE_BPS,
  MIN_STAKE_ATOMIC,
  STELLAR_NETWORKS,
  USDC_ASSET,
  USDC_DECIMALS,
  USDC_ISSUER,
  formatAtomicUsdc,
  parseEnvFile,
  parseUsdcAtomic,
  resolveStellarNetwork,
  upsertEnvBody,
} from "../../scripts/lib/stellar-env";

test("parseEnvFile reads KEY=VALUE, export prefixes and quotes", () => {
  const parsed = parseEnvFile(
    [
      "# a comment",
      "",
      "STELLAR_DEPLOYER_PUBLIC=GABC",
      "export STELLAR_ORACLE_PUBLIC=GDEF",
      'NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"',
      "SINGLE='quoted'",
      "not a pair",
    ].join("\n"),
  );
  assert.equal(parsed.STELLAR_DEPLOYER_PUBLIC, "GABC");
  assert.equal(parsed.STELLAR_ORACLE_PUBLIC, "GDEF");
  assert.equal(parsed.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE, "Test SDF Network ; September 2015");
  assert.equal(parsed.SINGLE, "quoted");
  assert.equal(Object.keys(parsed).length, 4);
});

test("upsertEnvBody rewrites in place and never drops unrelated keys", () => {
  const before = ["# header", "KEEP_ME=yes", "STELLAR_DEPLOYER_PUBLIC=GOLD", ""].join("\n");
  const after = upsertEnvBody(before, { STELLAR_DEPLOYER_PUBLIC: "GNEW" });
  assert.match(after, /^# header$/m);
  assert.match(after, /^KEEP_ME=yes$/m);
  assert.match(after, /^STELLAR_DEPLOYER_PUBLIC=GNEW$/m);
  assert.doesNotMatch(after, /GOLD/);
});

test("upsertEnvBody appends new keys under an optional header", () => {
  const after = upsertEnvBody("KEEP_ME=yes\n", { NEW_KEY: "v" }, { header: "# ── Stellar ──" });
  assert.equal(after, "KEEP_ME=yes\n\n# ── Stellar ──\nNEW_KEY=v\n");
});

test("upsertEnvBody skips undefined values so callers can pass partials", () => {
  const after = upsertEnvBody("A=1\n", { A: undefined, B: "2" });
  assert.match(after, /^A=1$/m);
  assert.match(after, /^B=2$/m);
});

test("upsertEnvBody handles an empty starting body", () => {
  assert.equal(upsertEnvBody("", { A: "1" }, { header: "# h" }), "# h\nA=1\n");
});

test("USDC atomic conversion uses the SAC's 7 decimals", () => {
  assert.equal(USDC_DECIMALS, 7);
  assert.equal(parseUsdcAtomic("2"), 2_0000000n);
  assert.equal(parseUsdcAtomic("2.5"), 2_5000000n);
  assert.equal(parseUsdcAtomic("0.0000001"), 1n);
  assert.equal(formatAtomicUsdc(2_0000000n), "2");
  assert.equal(formatAtomicUsdc(2_5000000n), "2.5");
  assert.equal(formatAtomicUsdc(1n), "0.0000001");
  assert.throws(() => parseUsdcAtomic("1.00000001"));
});

test("contract-mirrored constants match contracts-soroban/mimir-market/src/types.rs", () => {
  // MIN_STAKE = 2_0000000, MAX_TOTAL_FEE_BPS = 1_000.
  assert.equal(MIN_STAKE_ATOMIC, 2_0000000n);
  assert.equal(MAX_TOTAL_FEE_BPS, 1_000);
});

test("USDC asset string is Circle's verified testnet issuer", () => {
  assert.equal(USDC_ISSUER, "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
  assert.equal(USDC_ASSET, `USDC:${USDC_ISSUER}`);
});

test("testnet remains the default network", () => {
  const net = resolveStellarNetwork({});
  assert.equal(net.name, "testnet");
  assert.equal(net.networkPassphrase, "Test SDF Network ; September 2015");
  assert.equal(net.horizonUrl, "https://horizon-testnet.stellar.org");
  assert.equal(net.rpcUrl, "https://soroban-testnet.stellar.org");
  assert.equal(net.friendbotUrl, "https://friendbot.stellar.org");
});

test("STELLAR_NETWORK=local resolves to the quickstart endpoints", () => {
  const net = resolveStellarNetwork({ STELLAR_NETWORK: "local" });
  assert.equal(net.name, "local");
  assert.equal(net.networkPassphrase, "Standalone Network ; February 2017");
  assert.equal(net.horizonUrl, "http://localhost:8000");
  assert.equal(net.rpcUrl, "http://localhost:8000/soroban/rpc");
  assert.equal(net.friendbotUrl, "http://localhost:8000/friendbot");
});

test("local network honours explicit URL overrides", () => {
  const net = resolveStellarNetwork({
    STELLAR_NETWORK: "local",
    STELLAR_RPC_URL: "http://127.0.0.1:9000/soroban/rpc",
    STELLAR_HORIZON_URL: "http://127.0.0.1:9000",
    STELLAR_FRIENDBOT_URL: "http://127.0.0.1:9000/friendbot",
  });
  assert.equal(net.rpcUrl, "http://127.0.0.1:9000/soroban/rpc");
  assert.equal(net.horizonUrl, "http://127.0.0.1:9000");
  assert.equal(net.friendbotUrl, "http://127.0.0.1:9000/friendbot");
});

test("STELLAR_NETWORKS exposes both testnet and local profiles", () => {
  assert.deepEqual(Object.keys(STELLAR_NETWORKS).sort(), ["local", "testnet"]);
});
