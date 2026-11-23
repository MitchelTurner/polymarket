# Year in Search research

This is an early, read-only foundation for researching Google's Year in Search
People lists. It is not a trading application and does not provide financial
advice.

## What is available

- A PostgreSQL-backed API and a browser for the supplied Global People rankings
  for 2014, 2018, and 2021–2025.
- Standalone scoring primitives and a separately authenticated browser collector.

This is **not yet a working predictor**. The API does not connect the collector
or model to the web app. Live Trends and archive collection have not been
verified against Google. US lists, source clients, market prices, calibrated
predictions, backtests, scheduled jobs, and deployment are not implemented.
The interface deliberately does not display invented prices or probabilities.

## Local setup

Use Node.js 22, Corepack, pnpm, and a PostgreSQL database:

```sh
corepack pnpm install
export DATABASE_URL='<PostgreSQL connection URL>'
corepack pnpm --filter year-in-search-api build
corepack pnpm --filter year-in-search-api db:migrate
corepack pnpm --filter year-in-search-api db:seed
corepack pnpm --filter year-in-search-api start
```

In another terminal, run `corepack pnpm --filter web dev`. Vite proxies `/api`
to `http://127.0.0.1:3001`; override this with `VITE_API_PROXY_TARGET` if needed.
The seed replaces the supplied Global People results for those seven years.

The standalone collector requires a Chromium installation
(`corepack pnpm --filter collector-browser exec playwright install chromium`)
and a `COLLECTOR_TOKEN` of at least 32 characters. It binds to localhost and
requires the token as a bearer token. It is not connected to the API.

The API tests require `TEST_DATABASE_URL` pointing to a PostgreSQL test database
whose user can create and drop schemas. Component tests can be run with
`corepack pnpm --filter year-in-search-api test`,
`corepack pnpm --filter @polymarket/year-in-search-shared test`, and
`corepack pnpm --filter collector-browser test`.