---
name: proposal-generator
description: Generate branded auction proposals for Auction Central properties using the Auction Central proposal CLI
metadata: {"openclaw":{"requires":{"bins":["node"],"env":["AUCTION_CENTRAL_API_URL"]},"primaryEnv":"AUCTION_CENTRAL_API_TOKEN"}}
---

# Proposal Generator Skill

Generate branded Auction Central proposals by running the bundled CLI at `{baseDir}/scripts/generate-proposal.mjs`.

## When To Use

Use this skill when the user asks you to:
- Generate a proposal for a property
- Create a seller pitch or branded proposal PDF
- Run the Auction Central proposal pipeline
- Test proposal generation against the Auction Central API

## Runtime Contract

- `AUCTION_CENTRAL_API_URL` must be available in the environment.
- `AUCTION_CENTRAL_API_TOKEN` is optional. If it is missing, use the interactive CLI login flow on first use.
- Tokens are stored in `~/.auction-central/auth.json` inside the runtime.
- After a full reprovision or container replacement, the stored token may be gone and the user may need to approve the CLI again.
- The primary command path is:

```bash
node {baseDir}/scripts/generate-proposal.mjs ...
```

## Required Property Inputs

Collect these before generating:
- `address`: full street address including suburb
- `sellerName`: property owner name
- `auctionType`: one of `boardroom`, `on_site`, `online`, `hybrid`

Useful optional fields:
- `maritalStatus`: `single`, `married_cop`, `married_anc`, `divorced`, `widowed`
- `p24Url`: full Property24 listing URL
- `brokerName`
- `propertyType`: `residential`, `commercial`, `industrial`, `vacant_land`
- `bedrooms`
- `bathrooms`
- `garages`
- `erfSize`
- `floorSize`
- `proposedDate`
- `notes`

Do not invent missing required fields. Ask for them first.

## First-Run Authentication

If there is no working token yet, or proposal generation says authorization is required, authenticate first:

```bash
node {baseDir}/scripts/generate-proposal.mjs \
  --api "$AUCTION_CENTRAL_API_URL" \
  --login
```

Expected flow:
1. The command prints an authorization URL.
2. Show that URL to the user and tell them to approve the CLI in Auction Central.
3. Wait for the CLI login command to finish successfully.
4. Rerun the proposal generation command.

If the user already supplied `AUCTION_CENTRAL_API_TOKEN` or a `--token`, you can skip the login step.

## Input File

Write the payload to a temporary JSON file before running the CLI.

Minimal example:

```json
{
  "address": "21 West Road South, Morningside Ext 48",
  "sellerName": "Jane Smith",
  "auctionType": "boardroom",
  "brokerName": "Marco Gaspar"
}
```

Reference payloads are available at:
- `{baseDir}/examples/minimal-property.json`
- `{baseDir}/examples/full-property.json`

## Generate A Proposal

Basic command:

```bash
node {baseDir}/scripts/generate-proposal.mjs \
  --api "$AUCTION_CENTRAL_API_URL" \
  --file /tmp/proposal-input.json
```

With enrichment providers:

```bash
node {baseDir}/scripts/generate-proposal.mjs \
  --api "$AUCTION_CENTRAL_API_URL" \
  --file /tmp/proposal-input.json \
  --enrich lightstone,p24,municipal
```

With map options:

```bash
node {baseDir}/scripts/generate-proposal.mjs \
  --api "$AUCTION_CENTRAL_API_URL" \
  --file /tmp/proposal-input.json \
  --map-provider osm \
  --map-mode static \
  --map-view road
```

If you need to override auth explicitly:

```bash
node {baseDir}/scripts/generate-proposal.mjs \
  --api "$AUCTION_CENTRAL_API_URL" \
  --token "$AUCTION_CENTRAL_API_TOKEN" \
  --file /tmp/proposal-input.json
```

## CLI Flags

- `--api <url>`: API base URL. Defaults to `AUCTION_CENTRAL_API_URL`.
- `--file <path>`: path to the input JSON file.
- `--token <token>`: override stored token or env token.
- `--login`: authenticate only, then exit.
- `--label <text>`: label for the minted CLI token.
- `--enrich <csv>`: any of `lightstone`, `p24`, `municipal`.
- `--p24-url <url>`: overrides or supplies `p24Url`.
- `--map-provider <osm|google|stadia>`
- `--map-mode <static|interactive>`
- `--map-view <road|satellite|street>`

## Success Output

The CLI prints JSON to stdout on success:

```json
{
  "propertyId": "prop_abc123",
  "proposalId": "ppl_def456",
  "shareUrl": "https://app.auctions.litescale.ai/proposals/share/abc123def456",
  "pdfUrl": "https://api.auctions.litescale.ai/api/proposals/share/abc123def456/pdf",
  "enrichmentProviders": ["lightstone", "p24"]
}
```

When the command succeeds, report:
- `shareUrl`
- `pdfUrl`
- `propertyId`
- `proposalId`

## Troubleshooting

- `API base URL is required`: set `AUCTION_CENTRAL_API_URL` or pass `--api`.
- `No input provided`: provide `--file` or pipe JSON to stdin.
- `address and sellerName are required`: the JSON payload is incomplete.
- `Unable to start CLI authorization`: the Auction Central API is unreachable or the auth route is unavailable.
- `CLI authorization expired`: rerun the login command and approve again.
- `Proposal generation failed`: treat it as an API-side failure and inspect the returned error body or API logs if available.
