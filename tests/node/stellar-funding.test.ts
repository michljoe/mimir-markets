import { describe, it, expect, beforeEach, afterEach } from 'node:test';
import { assert } from 'node:assert';

// This test suite exercises the testnet funding helpers against a
// fake Horizon/Friendbot implementation injected through the module's
// minimal HTTP client seam. No network access is performed.

// -----------------------------------------------------------------------------
// Fake HTTP client
// -----------------------------------------------------------------------------

type Response = { status: number; body: unknown };

interface RecordedRequest {
  method: string;
  url: string;
  body?: unknown;
}

type Handler = (req: RecordedRequest) => Response | Promise<Response>;

class FakeClient {
  public requests: RecordedRequest[] = [];
  private handlers: Handler[] = [];

  on(handler: Handler): void {
    this.handlers.push(handler);
  }

  async request(method: string, url: string, body?: unknown): Promise<Response> {
    const recorded: RecordedRequest = { method, url, body };
    this.requests.push(recorded);
    for (const handler of this.handlers) {
      const result = await handler(recorded);
      if (result) {
        return result;
      }
    }
    throw new Error(`FakeClient: no handler for ${method} ${url}`);
  }
}

// -----------------------------------------------------------------------------
// Module under test
// -----------------------------------------------------------------------------

import {
  readAccount,
  ensureAccount,
  ensureTrustline,
  quoteXlmCost,
  buyUsdc,
  provisionAccount,
  setHorizonClient,
} from '../../scripts/lib/stellar-funding';

const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const FRIENDBOT_URL = 'https://friendbot-testnet.stellar.org';
const USDC_ISSUER = 'GBBDCGKNVCNVCNVCNVCNVCNVCNVCNVCNVCNVCNVCNVCNVCNVCNV';
const SOURCE_PUBLIC = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAF';
const DEST_PUBLIC = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

function jsonResponse(status: number, body: unknown): Response {
  return { status, body };
}

function accountResponse(overrides: Record<string, unknown> = {}): Response {
  return jsonResponse(200, {
    id: SOURCE_PUBLIC,
    account_id: SOURCE_PUBLIC,
    sequence: '1234567890',
    subentry_count: '0',
    balances: [
      { balance: '100.0000000', buy_ing_liabilities: '0', selling_liabilities: '0', asset_type: 'native' },
    ],
    thresholds: { loe_threshold: 1, med_threshold: 2, high_threshold: 3 },
    flags: { auth_required: false, auth_revocable: false, auth_immutable: false, clawback_enabled: false },
    data: {},
    num_sponsoring: 0,
    num_sponsored: 0,
    ...overrides,
  });
}

function notFound(): Response {
  return jsonResponse(404, {
    type: 'https://developer.stellar.org/horizon/errors/not-found',
    title: 'Resource Missing',
    status: 404,
    detail: 'Resource missing',
  });
}

let client: FakeClient;

beforeEach(() => {
  client = new FakeClient();
  setHorizonClient(client);
});

afterEach(() => {
  setHorizonClient(undefined);
});

describe('stellar-funding', () => {
  describe('readAccount', () => {
    it('returns the account when it exists', async () => {
      client.on(() => accountResponse());

      const account = await readAccount(SOURCE_PUBLIC);

      assert.ok(account);
      expect(account?.account_id).toEqual(SOURCE_PUBLIC);
      expect(client.requests).toHaveLength(1);
      expect(client.requests[0].method).toEqual('GET');
      expect(client.requests[0].url).toContain(`/accounts/${SOURCE_PUBLIC}`);
    });

    it('returns null when the account does not exist', async () => {
      client.on(() => notFound());

      const account = await readAccount(SOURCE_PUBLIC);

      expect(account).toBeNull();
    });
  });

  describe('ensureAccount', () => {
    it('returns the existing account without hitting Friendbot', async () => {
      client.on(req => {
        if (req.url.includes('/accounts/')) {
          return accountResponse();
        }
        return jsonResponse(500, { detail: 'unexpected request' });
      });

      const result = await ensureAccount(SOURCE_PUBLIC, { friendbotUrl: FRIENDBOT_URL });

      expect(result.created).toEqual(false);
      expect(result.account.account_id).toEqual(SOURCE_PUBLIC);
      expect(client.requests.some(r => r.url.startsWith(FRIENDBOT_URL))).toEqual(false);
    });

    it('creates the account via Friendbot when it is missing', async () => {
      let created = false;
      client.on(req => {
        if (req.url.startsWith(FRIENDBOT_URL)) {
          expect(req.method).toEqual('GET');
          expect(req.url).toContain(`address=${SOURCE_PUBLIC}`);
          created = true;
          return jsonResponse(200, { hash: 'friendbot-hash' });
        }
        if (req.url.includes(`/accounts/${SOURCE_PUBLIC}`)) {
          return created ? accountResponse() : notFound();
        }
        return jsonResponse(500, { detail: 'unexpected request' });
      });

      const result = await ensureAccount(SOURCE_PUBLIC, { friendbotUrl: FRIENDBOT_URL, pollIntervalMs: 1, timeoutMs: 1000 });

      expect(result.created).toEqual(true);
      expect(result.account.account_id).toEqual(SOURCE_PUBLIC);
      expect(created).toEqual(true);
    });

    it('propagates Friendbot failures', async () => {
      client.on(req => {
        if (req.url.startsWith(FRIENDBOT_URL)) {
          return jsonResponse(500, { detail: 'friendbot down' });
        }
        return notFound();
      });

      await expect(
        ensureAccount(SOURCE_PUBLIC, { friendbotUrl: FRIENDBOT_URL, pollIntervalMs: 1, timeoutMs: 1000 }),
      ).rejects(/friendbot/i);
    });
  });

  describe('ensureTrustline', () => {
    it('returns existing=true when the trustline is already present', async () => {
      client.on(() =>
        accountResponse({
          balances: [
            { balance: '100.0000000', asset_type: 'native' },
            {
              balance: '0.0000000',
              asset_type: 'credit-aliphan4_num1',
              asset_code: 'USDC',
              asset_issuer: USDC_ISSUER,
              limit: '1000.0000000',
            },
          ],
        }),
      );

      const result = await ensureTrustline(SOURCE_PUBLIC, { assetCode: 'USDC', issuer: USDB_ISSUER });

      expect(result.existing).toEqual(true);
      expect(client.requests.some(r => r.method === 'POST')).toEqual(false);
    });

    it('submits a change-trust transaction when the trustline is missing', async () => {
      const submitted: unknown[] = [];
      client.on(req => {
        if (req.method === 'GET' && req.url.includes('/accounts/')) {
          return accountResponse();
        }
        if (req.method === 'GET' && req.url.includes('/fee')) {
          return jsonResponse(200, { last_ledger: 1, min_fee: '100', max_fee: '1000', modes: {} });
        }
        if (req.method === 'GET' && req.url.includes('/ledgers/')) {
          return jsonResponse(200, { sequence: 1, hash: 'ledger-hash', close_time: new Date().toISOString() });
        }
        if (req.method === 'POST' && req.url.includes('/transactions')) {
          submitted.push(req.body);
          return jsonResponse(200, { hash: 'tx-hash', ledger: 1, successful: true });
        }
        return jsonResponse(500, { detail: 'unexpected request' });
      });

      const result = await ensureTrustline(SOURCE_PUBLIC, {
        assetCode: 'USDC',
        issuer: USDB_ISSUER,
        signer: async () => 'dummy-signature',
      });

      expect(result.existing).toEqual(false);
      expect(submitted).toHaveLength(1);
    });
  });

  describe('quoteXlmCost', () => {
    it('parses the destination amount from a path-payment quote', async () => {
      client.on(req => {
        if (req.url.includes('/paths/')) {
          expect(req.url).toContain(`destination_account=${SOURCE_PUBLIC}`);
          expect(req.url).toContain(`source_asset=type%3Dnative%3Aissuer%3D`);
          expect(req.url).toContain(`destination_asset=credit_aliphan4num1%3AUSDC%3A${USDC_ISSUER}`);
          expect(req.url).toContain(`destination_amount=10.0000000`);
          return jsonResponse(200, {
            _embedded: {
              records: [
                {
                  path: [],
                  source_amount: '12.5000000',
                  destination_amount: '10.0000000',
                  destination_asset_type: 'credit_aliphan4_num1',
                  destination_asset_code: 'USDC',
                  destination_asset_issuer: USDC_ISSUER,
                },
              ],
            },
          });
        }
        return jsonResponse(500, { detail: 'unexpected request' });
      });

      const quote = await quoteXlmCost({
        sourceAccount: SOURCE_PUBLIC,
        destinationAsset: { code: 'USDC', issuer: USDC_ISSUER },
        destinationAmount: '10.0000000',
      });

      expect(quote.sourceAmount).toEqual('12.5000000');
      expect(quote.destinationAmount).toEqual('10.0000000');
      expect(quote.path).toEqual([]);
    });

    it('throws when no path is found', async () => {
      client.on(req => {
        if (req.url.includes('/paths/')) {
          return jsonResponse(200, { _embedded: { records: [] } });
        }
        return jsonResponse(500, { detail: 'unexpected request' });
      });

      await expect(
        quoteXlmCost({
          sourceAccount: SOURCE_PUBLIC,
          destinationAsset: { code: 'USDC', issuer: USDB_ISSUER },
          destinationAmount: '10.0000000',
        }),
      ).rejects(/no path/i);
    });
  });

  describe('buyUsdc', () => {
    it('submits a path payment transaction', async () => {
      const submitted: unknown[] = [];
      client.on(req => {
        if (req.method === 'GET' && req.url.includes('/accounts/')) {
          return accountResponse();
        }
        if (req.method === 'GET' && req.url.includes('/paths/')) {
          return jsonResponse(200, {
            _embedded: {
              records: [
                {
                  path: [],
                  source_amount: '12.5000000',
                  destination_amount: '10.0000000',
                },
              ],
            },
          });
        }
        if (req.method === 'GET' && req.url.includes('/fee')) {
          return jsonResponse(200, { last_ledger: 1, min_fee: '100', max_fee: '1000', modes: {} });
        }
        if (req.method === 'GET' && req.url.includes('/ledgers/')) {
          return jsonResponse(200, { sequence: 1, hash: 'ledger-hash', close_time: new Date().toISOString() });
        }
        if (req.method === 'POST' && req.url.includes('/transactions')) {
          submitted.push(req.body);
          return jsonResponse(200, { hash: 'tx-hash', ledger: 1, successful: true });
        }
        return jsonResponse(500, { detail: 'unexpected request' });
      });

      const result = await buyUsdc({
        sourceAccount: SOURCE_PUBLIC,
        destinationAccount: DEST_PUBLIC,
        amount: '10.0000000',
        issuer: USDB_ISSUER,
        signer: async () => 'dummy-signature',
      });

      expect(result.submitted).toEqual(true);
      expect(submitted).toHaveLength(1);
    });
  });

  describe('provisionAccount', () => {
    it('runs the full flow for a new account', async () => {
      let created = false;
      client.on(req => {
        if (req.url.startsWith(FRIENDBOT_URL)) {
          created = true;
          return jsonResponse(200, { hash: 'friendbot-hash' });
        }
        if (req.method === 'GET' && req.url.includes('/accounts/')) {
          return created ? accountResponse() : notFound();
        }
        if (req.method === 'GET' && req.url.includes('/fee')) {
          return jsonResponse(200, { last_ledger: 1, min_fee: '100', max_fee: '1000', modes: {} });
        }
        if (req.method === 'GET' && req.url.includes('/ledgers/')) {
          return jsonResponse(200, { sequence: 1, hash: 'ledger-hash', close_time: new Date().toISOString() });
        }
        if (req.method === 'POST' && req.url.includes('/transactions')) {
          return jsonResponse(200, { hash: 'tx-hash', ledger: 1, successful: true });
        }
        return jsonResponse(500, { detail: 'unexpected request' });
      });

      const result = await provisionAccount({
        publicKey: SOURCE_PUBLIC,
        friendbotUrl: FRIENDBOT_URL,
        trustlines: [{ code: 'USDC', issuer: USDB_ISSUER }],
        signer: async () => 'dummy-signature',
        pollIntervalMs: 1,
        timeoutMs: 1000,
      });

      expect(result.accountCreated).toEqual(true);
      expect(result.trustlines).toHaveLength(1);
      expect(result.trustlines[0].existing).toEqual(false);
    });

    it('reports partial failure when a trustline submission fails', async () => {
      client.on(req => {
        if (req.method === 'GET' && req.url.includes('/accounts/')) {
          return accountResponse();
        }
        if (req.method === 'GET' && req.url.includes('/fee')) {
          return jsonResponse(200, { last_ledger: 1, min_fee: '100', max_fee: '1000', modes: {} });
        }
        if (req.method === 'GET' && req.url.includes('/ledgers/')) {
          return jsonResponse(200, { sequence: 1, hash: 'ledger-hash', close_time: new Date().toISOString() });
        }
        if (req.method === 'POST' && req.url.includes('/transactions')) {
          return jsonResponse(200, {
            hash: 'tw-hash',
            ledger: 1,
            successful: false,
            extra_result_xdr_result: '',
            result_xdr_result: '',
            result_codes: ['tx_insufficient_balance'],
          });
        }
        return jsonResponse(500, { detail: 'unexpected request' });
      });

      const result = await provisionAccount({
        publicKey: SOURCE_PUBLIC,
        friendbotUrl: FRIENDBOT_URL,
        trustlines: [{ code: 'USDC', issuer: USDB_ISSUER }],
        signer: async () => 'dummy-signature',
        pollIntervalMs: 1,
        timeoutMs: 1000,
      });

      expect(result.accountCreated).toEqual(false);
      expect(result.trustlines).toHaveLength(1);
      expect(result.trustlines[0].error).toBeTruthy();
    });
  });
});
