#!/usr/bin/env node

import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEFAULT_AUCTION_TYPE = "on_site";
const DEFAULT_ENRICHMENT_PROVIDERS = ["lightstone", "p24", "municipal"];
const DEFAULT_MAPS = {
  provider: "osm",
  mode: "static",
  view: "road",
};
const DEFAULT_OUTPUT_DIR = path.join(os.tmpdir(), "auction-central-proposals");
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const GENERATOR_PATH = path.join(SCRIPT_DIR, "generate-proposal.mjs");

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

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => normalizeString(entry))
    .filter(Boolean);
}

function asPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...value }
    : {};
}

async function readPayload(args) {
  const filePath = normalizeString(args.input) || normalizeString(args.file);

  if (filePath) {
    return JSON.parse(await readFile(filePath, "utf-8"));
  }

  if (process.stdin.isTTY) {
    throw new Error("No input provided. Pass --input, --file, or pipe JSON to stdin.");
  }

  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  return JSON.parse(input);
}

function buildNormalizedPayload(basePayload, args) {
  const payload = asPlainObject(basePayload);
  const normalized = { ...payload };
  const placeholderSeller = normalizeString(args["placeholder-seller"]);

  if (!normalizeString(normalized.auctionType)) {
    normalized.auctionType = normalizeString(args["auction-type"]) || DEFAULT_AUCTION_TYPE;
  }

  if (!normalizeString(normalized.sellerName) && placeholderSeller) {
    normalized.sellerName = placeholderSeller;
  }

  if (!normalizeString(normalized.p24Url) && normalizeString(args["p24-url"])) {
    normalized.p24Url = normalizeString(args["p24-url"]);
  }

  const enrichmentProviders = normalizeStringArray(normalized.enrichmentProviders);
  normalized.enrichmentProviders = enrichmentProviders.length > 0
    ? enrichmentProviders
    : [...DEFAULT_ENRICHMENT_PROVIDERS];

  const maps = asPlainObject(normalized.maps);
  const mapProvider =
    normalizeString(args["map-provider"]) ||
    normalizeString(maps.provider) ||
    normalizeString(normalized.mapProvider) ||
    DEFAULT_MAPS.provider;
  const mapMode =
    normalizeString(args["map-mode"]) ||
    normalizeString(maps.mode) ||
    normalizeString(normalized.mapMode) ||
    DEFAULT_MAPS.mode;
  const mapView =
    normalizeString(args["map-view"]) ||
    normalizeString(maps.view) ||
    normalizeString(normalized.mapView) ||
    DEFAULT_MAPS.view;

  normalized.maps = {
    provider: mapProvider,
    mode: mapMode,
    view: mapView,
  };
  normalized.mapProvider = mapProvider;
  normalized.mapMode = mapMode;
  normalized.mapView = mapView;

  return normalized;
}

function buildGeneratorArgs(args, payloadPath) {
  const cliArgs = [];

  if (normalizeString(args.api)) {
    cliArgs.push("--api", normalizeString(args.api));
  }

  if (normalizeString(args.token)) {
    cliArgs.push("--token", normalizeString(args.token));
  }

  if (normalizeString(args.label)) {
    cliArgs.push("--label", normalizeString(args.label));
  }

  if (args.login === "true") {
    cliArgs.push("--login");
  }

  if (payloadPath) {
    cliArgs.push("--file", payloadPath);
  }

  return cliArgs;
}

function runGenerator(cliArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [GENERATOR_PATH, ...cliArgs], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(stderr.trim() || stdout.trim() || `Command exited with code ${code}`));
    });
  });
}

function parseJsonOutput(stdout, fallbackLabel) {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`Unable to parse ${fallbackLabel} output as JSON.`);
  }
}

function slugify(value) {
  const normalized = normalizeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "proposal";
}

async function maybeDownloadPdf(result, payload, args) {
  if (args["download-pdf"] === "false" || !normalizeString(result.pdfUrl)) {
    return {};
  }

  try {
    const response = await fetch(result.pdfUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const outputDir = normalizeString(args["output-dir"]) || DEFAULT_OUTPUT_DIR;
    await mkdir(outputDir, { recursive: true });

    const fileName = `${slugify(payload.address || result.propertyId)}-${slugify(result.proposalId)}.pdf`;
    const outputPath = path.join(outputDir, fileName);
    const fileBuffer = Buffer.from(await response.arrayBuffer());
    await writeFile(outputPath, fileBuffer);

    return {
      downloadedPdfPath: outputPath,
      downloadedPdfName: fileName,
    };
  } catch (error) {
    return {
      pdfDownloadError: error instanceof Error ? error.message : "Unable to download PDF",
    };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.login === "true") {
    const loginResult = await runGenerator(buildGeneratorArgs(args));
    process.stderr.write(loginResult.stderr);
    process.stdout.write(loginResult.stdout);
    return;
  }

  const payload = buildNormalizedPayload(await readPayload(args), args);
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "auction-central-proposal-"));
  const payloadPath = path.join(tempDir, "input.json");
  await writeFile(payloadPath, JSON.stringify(payload, null, 2));

  const generatorResult = await runGenerator(buildGeneratorArgs(args, payloadPath));
  if (generatorResult.stderr.trim()) {
    process.stderr.write(generatorResult.stderr);
  }

  const parsed = parseJsonOutput(generatorResult.stdout, "proposal generator");
  const downloaded = await maybeDownloadPdf(parsed, payload, args);

  console.log(
    JSON.stringify(
      {
        ...parsed,
        ...downloaded,
        auctionType: payload.auctionType,
        enrichmentProviders: payload.enrichmentProviders,
        maps: payload.maps,
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
