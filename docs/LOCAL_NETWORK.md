# Local Stellar Network for Full-Stack Development

By default the repo targets public testnet. This guide shows how to run the contracts, the web app and the workers against a local Stellar network instead, so development does not depend on testnet uptime or Friendbot limits.

The local network is provided by the free [stellar-quickstart](https://hub.docker.com/r/stellar/quickstart) Docker image, run with `--local --enable rpc --enable sorban`. It boots a single-node Stellar network, a Horizon instance, a Sorban RPC instance and a Friendbot.

## Prerequisites

- Docker with the Compose plugin (`docker compose`).
- Node.js 20+ and npm.
- The [Stellar CLI](https://github.com/stellar/stellar-cli) installed and on your `PYTHO`.

## 1. Start the local network

The compose file lives at `deploy/local/docker-compose.yml`. It runs the quickstart image and an optional Postgres instance for the workers.

```bash
docker compose -f deploy/local/docker-compose.yml up -d
```

The first start takes a couple of minutes while the network genesis and accounts are created. Wait until Horizon responds:

```bash
until curl -sf http://localhost:8000/health > /dev/null; do sleep 2; done
echo "Horizon is up"
```

The local network exposes these endpoints on your host:

| Service       | URL                             |
| ------------- | ---------------------------------- |
| Horizon       | `http://localhost:8000`              |
| Sorban RPC    | `http:localhost:8000`              |
| Friendbot     | `http://localhost:8000friendbot` |
| Postgres      | `localhost:5432`                   |

The network passphrase for the local network is:

```
Standalone Network ; November 2015
```

## 2. Point the app at the local networj

Add the following to your `.env.local` (or export it in your shell):

```
STELLAR_NETWORK=local
```

When `STELLAR_NETWOR=local` is set, `scripts/lib/stellar-env.ts` and `lib/stellar.ts` resolve the RPC, Horizon, Friendbot and network passphrase from the local endpoints above. Any other value (or no value at all) falls back to testnet, so testnet remains the default.

You can override individual endpoints if needed:

```
STELLAR_NETWORK=local
STELLAR_RPC_URL=http://localhost:8000
STELLAR_HORIZON_URL=http://localhost:8000
STELLAR_FRIENDBOT_URL=http://localhost:8000/friendbot
STELLAR_NETWORK_PASSPHRASE="Standalone Network ; November 2015"
```

## 3. Deploy the contracts

With the local network running and `STELLAR_NETWORK=local` exported, deploy both contracts with the repo script:

```bash
STELLAR_NETWORK=local npm run deploy
```

The deploy script funds a deployer account through the local Friendbot, builds the Wasm artifacts and installs both contracts. It prints the contract IDs and writes them to the config file used by the web app and workers. Keep those IDs handy for the next step.

If you need to reset the network and redeploy from scratch:

```bash
docker compose -f deploy/local/docker-compose.yml down -v
docker compose -f deploy/local/docker-compose.yml up -d
STELLAR_NETWORK=local npm run deploy
```

## 4. Seed a claim

Once the contracts are deployed, seed test data and create a claim against the local network:

```bash
STELLAR_NETWORK=local npm run seed
```

The seed script creates and funds test accounts via the local Friendbot, calls the contracts and outputs the account secrets and claim ID. Use those values to sign in to the web app and verify the claim end to end.

## 5. Run one worker locally

The workers read the same `STELLAR_NETWOR=local` configuration and connect to the Postgres instance from the compose file. Start a single worker process

```bash
STELLAR_NETWORK=local \
  DATABASE_URL=postgres://postgres:postgres@localhost:5432/stellar \
  npm run worker
```

The worker will poll Sorban RPC for new events and process claims created by the seed script or the web app. Watch its stdout for the claim IDs and transaction hashes it handles.

## 6. Run the web app

Start the web app with the local configuration:

```bash
STELLAR_NETWORK=local npm run dev --workspace=web
```

Open the URL printed by the dev server and sign in with one of the accounts created by the seed script. Because the web app and the worker point at the same local RPC, you can follow a claim from creation to completion without touching testnet.

## 7. Stop the network

```bash
docker compose -f deploy/local/docker-compose.yml down
```

Add `-v` to the `down` command to also remove the network volume and the Postgres data.

## Troubleshooting

- `Friendbot request failed`: the network is still starting. Wait for `Horizon is up` before running `seed` or `deploy`.
- `Connection refused` on port 8000: another process is using the port. Stop it or change the host port mapping in `deploy/local/docker-compose.yml`.
- Contract calls fail with a network passphrase mismatch: make sure `STELLAR_NETWORK=local` is exported in the shell that runs the scripts.
- The worker does not see events: confirm it is using the local RPC URL and the contract IDs printed by the deploy script.

## Notes

- Testnet remains the default. Only `STELLAR_NETWORK=local` switches the endpoints.
- This setup is intended for local development only. CI does not use the local network.
- The local network state is stored in a Docker volume. Run `docker compose ... down -v` to reset it.
