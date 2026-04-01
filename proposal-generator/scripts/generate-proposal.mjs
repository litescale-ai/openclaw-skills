#!/usr/bin/env node

import os from "node:os";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const CONFIG_DIR = path.join(os.homedir(), ".auction-central");
const CONFIG_PATH = path.join(CONFIG_DIR, "auth.json");
const DEFAULT_AUTH_TIMEOUT_MS = 10 * 60 * 1000;

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith("--")) continue;

    const key = current.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      args[key] = "true";
      continue;
    }

    args[key] = value;
    index += 1;
  }

  return args;
}

function normalizeApiBaseUrl(value) {
  return value.replace(/\/+$/, "");
}

function printUsage() {
  console.log(`
Usage:
  pnpm --filter @auction-central/api cli:proposal -- --api http://127.0.0.1:8788 --file ./property.json
  pnpm --filter @auction-central/api cli:proposal -- --api https://auctions.litescale.ai --login

Environment fallback:
  AUCTION_CENTRAL_API_URL
  AUCTION_CENTRAL_API_TOKEN

Optional flags:
  --token <token>                 Override stored token
  --login                         Authenticate only, then exit
  --label "Office MacBook"        Label the minted CLI token
  --enrich lightstone,p24,municipal
  --map-provider osm|google|stadia
  --map-mode static|interactive
  --map-view road|satellite|street
  --p24-url https://www.property24.com/...

Input JSON example:
  {
    "address": "21 West Road South, Morningside Ext 48",
    "sellerName": "Laura Example",
    "auctionType": "boardroom",
    "maritalStatus": "married_cop",
    "p24Url": "https://www.property24.com/...",
    "brokerName": "Marco Gaspar"
  }
`);
}

async function readPayload(filePath) {
  if (filePath) {
    const content = await readFile(filePath, "utf-8");
    return JSON.parse(content);
  }

  if (process.stdin.isTTY) {
    throw new Error("No input provided. Pass --file or pipe JSON to stdin.");
  }

  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  return JSON.parse(input);
}

async function readStoredConfig() {
  try {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { tokens: {} };
  }
}

async function saveStoredToken(apiBaseUrl, token) {
  const current = await readStoredConfig();
  current.tokens ||= {};
  current.tokens[normalizeApiBaseUrl(apiBaseUrl)] = {
    token,
    updatedAt: new Date().toISOString(),
  };

  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(current, null, 2));
}

async function getStoredToken(apiBaseUrl) {
  const current = await readStoredConfig();
  return current.tokens?.[normalizeApiBaseUrl(apiBaseUrl)]?.token || null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startCliLogin(apiBaseUrl, label) {
  const response = await fetch(`${normalizeApiBaseUrl(apiBaseUrl)}/api/auth/cli/initiate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ label }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Unable to start CLI authorization");
  }

  console.error("");
  console.error("Authorize Auction Central CLI in your browser:");
  console.error(payload.authorizeUrl);
  console.error("");
  console.error("Waiting for approval...");

  const deadline = Date.now() + DEFAULT_AUTH_TIMEOUT_MS;
  const statusUrl = `${normalizeApiBaseUrl(apiBaseUrl)}/api/auth/cli/claim/${payload.code}`;

  while (Date.now() < deadline) {
    const statusResponse = await fetch(statusUrl, { method: "POST" });
    const statusPayload = await statusResponse.json();

    if (!statusResponse.ok) {
      throw new Error(statusPayload.error || "CLI authorization status failed");
    }

    if (statusPayload.token) {
      await saveStoredToken(apiBaseUrl, statusPayload.token);
      console.error(`Stored CLI token for ${normalizeApiBaseUrl(apiBaseUrl)} in ${CONFIG_PATH}`);
      return statusPayload.token;
    }

    if (statusPayload.status === "expired" || statusPayload.status === "denied") {
      throw new Error("CLI authorization expired. Re-run the command to generate a new link.");
    }

    await sleep(2000);
  }

  throw new Error("Timed out waiting for CLI authorization.");
}

function buildPayload(basePayload, args) {
  const payload = { ...basePayload };

  if (args["p24-url"] && !payload.p24Url) {
    payload.p24Url = args["p24-url"];
  }

  if (args.enrich) {
    payload.enrichmentProviders = args.enrich
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  }

  const mapProvider = args["map-provider"];
  const mapMode = args["map-mode"];
  const mapView = args["map-view"];
  if (mapProvider || mapMode || mapView) {
    payload.maps = {
      ...(typeof payload.maps === "object" && payload.maps ? payload.maps : {}),
      ...(mapProvider ? { provider: mapProvider } : {}),
      ...(mapMode ? { mode: mapMode } : {}),
      ...(mapView ? { view: mapView } : {}),
    };
  }

  if (mapProvider) payload.mapProvider = mapProvider;
  if (mapMode) payload.mapMode = mapMode;
  if (mapView) payload.mapView = mapView;

  return payload;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help === "true") {
    printUsage();
    return;
  }

  const apiBaseUrl = args.api || process.env.AUCTION_CENTRAL_API_URL;
  if (!apiBaseUrl) {
    printUsage();
    throw new Error("API base URL is required.");
  }

  let token =
    args.token ||
    process.env.AUCTION_CENTRAL_API_TOKEN ||
    await getStoredToken(apiBaseUrl);

  if (!token) {
    token = await startCliLogin(
      apiBaseUrl,
      args.label || `${os.hostname()} CLI`,
    );
  }

  if (args.login === "true") {
    console.log(
      JSON.stringify(
        {
          apiBaseUrl: normalizeApiBaseUrl(apiBaseUrl),
          tokenStoredAt: CONFIG_PATH,
        },
        null,
        2,
      ),
    );
    return;
  }

  const payload = buildPayload(await readPayload(args.file), args);
  const response = await fetch(
    `${normalizeApiBaseUrl(apiBaseUrl)}/api/proposals/generate`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    },
  );

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || "Proposal generation failed");
  }

  console.log(
    JSON.stringify(
      {
        propertyId: result.data.propertyId,
        proposalId: result.data.proposalId,
        shareUrl: result.data.shareUrl,
        pdfUrl: result.data.pdfUrl,
        enrichmentProviders: result.data.enrichmentProviders,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
