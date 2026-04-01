---
name: proposal-generator
description: Generate branded auction proposals for Auction Central properties using the bundled Auction Central proposal workflow
metadata: {"openclaw":{"requires":{"bins":["node"],"env":["AUCTION_CENTRAL_API_URL"]},"primaryEnv":"AUCTION_CENTRAL_API_TOKEN"}}
---

# Proposal Generator Skill

Generate branded Auction Central seller proposals by running the bundled wrapper at `{baseDir}/scripts/run-proposal-generator.mjs`.

## When To Use

Use this skill when the user asks you to:
- Generate a proposal for a property
- Create a seller pitch or branded proposal PDF
- Run the Auction Central proposal pipeline
- Test proposal generation against the Auction Central API

## Default Workflow

- `AUCTION_CENTRAL_API_URL` must be available in the environment.
- `AUCTION_CENTRAL_API_TOKEN` is optional. If it is missing, use the interactive CLI login flow on first use.
- Tokens are stored in `~/.auction-central/auth.json` inside the runtime.
- After a full reprovision or container replacement, the stored token may be gone and the user may need to approve the CLI again.
- The wrapper defaults proposal generation to:
  - `auctionType=on_site`
  - enrichment providers `lightstone,p24,municipal`
  - maps `osm/static/road`
- On success, the wrapper downloads the generated PDF into a local temporary path and returns that file path alongside the share URL and PDF URL.
- If the current chat runtime supports document upload, return the downloaded PDF file to the same chat.
- If document upload is unavailable or the PDF download fails, return the share URL and direct PDF URL clearly.

## Required Inputs

Collect or resolve these before generating:
- `address`: full street address including suburb
- `sellerName`: property owner name, strongly preferred

Optional fields:
- `auctionType`: `boardroom`, `on_site`, `online`, `hybrid`
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

Behavior rules:
- If the user gives only an address, try to infer the rest from current tenant context or the proposal workflow defaults before asking follow-up questions.
- `auctionType` defaults to `on_site`, so do not ask for it unless the owner wants a different auction type.
- If `sellerName` is missing, ask directly when it is genuinely blocking.
- Only use a placeholder seller such as `Seller to be confirmed` as a clearly labeled last resort when the owner still wants a draft proposal immediately.

## First-Run Authentication

If there is no working token yet, or proposal generation says authorization is required, authenticate first:

```bash
node {baseDir}/scripts/run-proposal-generator.mjs \
  --api "$AUCTION_CENTRAL_API_URL" \
  --login
```

Expected flow:
1. The command prints an authorization URL.
2. Show that URL to the user and tell them to approve the CLI in Auction Central.
3. Wait for the login command to finish successfully.
4. Rerun the proposal generation command.

If the user already supplied `AUCTION_CENTRAL_API_TOKEN` or a `--token`, you can skip the login step.

## Input File

Write the payload to a temporary JSON file before running the wrapper.

Minimal example:

```json
{
  "address": "21 West Road South, Morningside Ext 48",
  "sellerName": "Jane Smith"
}
```

Reference payloads are available at:
- `{baseDir}/examples/minimal-property.json`
- `{baseDir}/examples/full-property.json`

## Generate A Proposal

Basic command:

```bash
node {baseDir}/scripts/run-proposal-generator.mjs \
  --api "$AUCTION_CENTRAL_API_URL" \
  --input /tmp/proposal-input.json
```

If the owner insists on a draft before the seller is known:

```bash
node {baseDir}/scripts/run-proposal-generator.mjs \
  --api "$AUCTION_CENTRAL_API_URL" \
  --input /tmp/proposal-input.json \
  --placeholder-seller "Seller to be confirmed"
```

Override defaults only when needed:

```bash
node {baseDir}/scripts/run-proposal-generator.mjs \
  --api "$AUCTION_CENTRAL_API_URL" \
  --input /tmp/proposal-input.json \
  --auction-type boardroom \
  --map-provider google \
  --map-mode interactive \
  --map-view satellite
```

If you need to override auth explicitly:

```bash
node {baseDir}/scripts/run-proposal-generator.mjs \
  --api "$AUCTION_CENTRAL_API_URL" \
  --token "$AUCTION_CENTRAL_API_TOKEN" \
  --input /tmp/proposal-input.json
```

## Wrapper Flags

- `--api <url>`: API base URL. Defaults to `AUCTION_CENTRAL_API_URL`.
- `--input <path>`: input JSON file path. `--file` also works.
- `--token <token>`: override stored token or env token.
- `--login`: authenticate only, then exit.
- `--label <text>`: label for the minted CLI token.
- `--auction-type <value>`: override the default `on_site`.
- `--placeholder-seller <text>`: last-resort seller placeholder for draft output.
- `--map-provider <osm|google|stadia>`
- `--map-mode <static|interactive>`
- `--map-view <road|satellite|street>`
- `--output-dir <path>`: where downloaded PDFs should be saved.
- `--download-pdf false`: skip the PDF download step.

## Success Output

The wrapper prints JSON to stdout on success:

```json
{
  "propertyId": "prop_abc123def456",
  "proposalId": "ppl_789ghi012jkl",
  "shareUrl": "https://auctions.litescale.ai/proposals/share/a1b2c3d4e5f6g7h8",
  "pdfUrl": "https://auctions.litescale.ai/api/proposals/share/a1b2c3d4e5f6g7h8/pdf",
  "enrichmentProviders": ["lightstone", "p24", "municipal"],
  "downloadedPdfPath": "/tmp/auction-central-proposals/14-sandton-drive-sandhurst-sandton-ppl-789ghi012jkl.pdf",
  "downloadedPdfName": "14-sandton-drive-sandhurst-sandton-ppl-789ghi012jkl.pdf"
}
```

When the command succeeds:
- return the actual PDF file if the current chat runtime can upload documents
- otherwise report `shareUrl`, `pdfUrl`, `propertyId`, and `proposalId`
- if present, mention `downloadedPdfPath`
- if present, mention `pdfDownloadError` and fall back to the URLs

## Troubleshooting

- `API base URL is required`: set `AUCTION_CENTRAL_API_URL` or pass `--api`.
- `No input provided`: provide `--input`, `--file`, or pipe JSON to stdin.
- `address and sellerName are required`: the JSON payload is still incomplete.
- `Unable to start CLI authorization`: the Auction Central API is unreachable or the auth route is unavailable.
- `CLI authorization expired`: rerun the login command and approve again.
- `Proposal generation failed`: treat it as an API-side failure and inspect the returned error body or API logs if available.
- `pdfDownloadError`: the proposal exists, but the runtime could not download the PDF file. Use `shareUrl` and `pdfUrl`.
