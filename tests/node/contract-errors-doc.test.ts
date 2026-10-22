import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

export interface ErrorVariant {
  name: string;
  code: number;
}

export interface DocErrorEntry {
  code: number;
  name: string;
  contract: string;
  entryPoints: string;
  cause: string;
  remediation: string;
}

const ROOT = process.cwd();
const MARKET_TYPES_PATH = join(ROOT, "contracts-soroban", "mimir-market", "src", "types.rs");
const SQUAD_TYPES_PATH = join(ROOT, "contracts-soroban", "mimir-squad", "src", "types.rs");
const DOC_PATH = join(ROOT, "docs", "CONTRACT_ERRORS.md");

/**
 * Parse a Rust source file containing `pub enum Error { ... }` and extract
 * all variant names and numeric discriminants.
 */
export function parseRustEnum(source: string, fileName = "types.rs"): ErrorVariant[] {
  const enumMatch = source.match(/pub enum Error\s*\{([\s\S]*?)\n\}/);
  if (!enumMatch) {
    throw new Error(`Could not find "pub enum Error { ... }" in ${fileName}`);
  }

  const body = enumMatch[1];
  const variants: ErrorVariant[] = [];
  const lines = body.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
      continue;
    }
    const match = trimmed.match(/^([A-Za-z0-9_]+)\s*=\s*(\d+),?/);
    if (match) {
      variants.push({
        name: match[1],
        code: Number(match[2]),
      });
    }
  }

  return variants;
}

/**
 * Parse the markdown error reference table from docs/CONTRACT_ERRORS.md.
 */
export function parseContractErrorsDoc(docContent: string): DocErrorEntry[] {
  const lines = docContent.split("\n");
  const entries: DocErrorEntry[] = [];
  let inTable = false;
  let headerFound = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) {
      inTable = false;
      continue;
    }

    const cells = trimmed
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());

    if (cells.length < 6) {
      continue;
    }

    // Check for header
    if (
      cells[0].toLowerCase() === "code" &&
      cells[1].toLowerCase() === "name" &&
      cells[2].toLowerCase() === "contract"
    ) {
      headerFound = true;
      inTable = true;
      continue;
    }

    // Skip divider row (e.g. | ---: | :--- |)
    if (cells[0].startsWith("-") || cells[0].startsWith(":-") || cells[0].startsWith("---")) {
      continue;
    }

    if (inTable && headerFound) {
      const rawCode = cells[0].replace(/[`\s]/g, "");
      const rawName = cells[1].replace(/[`\s]/g, "");
      const rawContract = cells[2].replace(/[`\s]/g, "");
      const entryPoints = cells[3];
      const cause = cells[4];
      const remediation = cells[5];

      const codeNum = Number(rawCode);
      if (!Number.isNaN(codeNum) && rawName && rawContract) {
        entries.push({
          code: codeNum,
          name: rawName,
          contract: rawContract,
          entryPoints,
          cause,
          remediation,
        });
      }
    }
  }

  return entries;
}

/**
 * Validate that all enum variants for both contracts are documented
 * with matching numeric codes, valid entry points, cause, and remediation.
 */
export function validateDocCoverage(
  docEntries: DocErrorEntry[],
  marketVariants: ErrorVariant[],
  squadVariants: ErrorVariant[],
): string[] {
  const errors: string[] = [];

  const marketDocMap = new Map<string, DocErrorEntry>();
  const squadDocMap = new Map<string, DocErrorEntry>();

  for (const entry of docEntries) {
    if (entry.contract === "mimir-market") {
      marketDocMap.set(entry.name, entry);
    } else if (entry.contract === "mimir-squad") {
      squadDocMap.set(entry.name, entry);
    } else {
      errors.push(`Unknown contract "${entry.contract}" in documentation for variant "${entry.name}"`);
    }

    if (!entry.entryPoints || entry.entryPoints.trim() === "") {
      errors.push(`Empty entry points for ${entry.contract}::${entry.name}`);
    }
    if (!entry.cause || entry.cause.trim() === "") {
      errors.push(`Empty cause for ${entry.contract}::${entry.name}`);
    }
    if (!entry.remediation || entry.remediation.trim() === "") {
      errors.push(`Empty remediation for ${entry.contract}::${entry.name}`);
    }
  }

  // Verify mimir-market variants
  const marketVariantNames = new Set<string>();
  for (const v of marketVariants) {
    marketVariantNames.add(v.name);
    const doc = marketDocMap.get(v.name);
    if (!doc) {
      errors.push(`Missing documentation for mimir-market variant "${v.name}" (code ${v.code})`);
    } else if (doc.code !== v.code) {
      errors.push(
        `Code mismatch for mimir-market::${v.name}: enum has ${v.code}, doc has ${doc.code}`,
      );
    }
  }

  // Check for extraneous mimir-market doc entries
  for (const name of marketDocMap.keys()) {
    if (!marketVariantNames.has(name)) {
      errors.push(`Documented mimir-market variant "${name}" does not exist in types.rs`);
    }
  }

  // Verify mimir-squad variants
  const squadVariantNames = new Set<string>();
  for (const v of squadVariants) {
    squadVariantNames.add(v.name);
    const doc = squadDocMap.get(v.name);
    if (!doc) {
      errors.push(`Missing documentation for mimir-squad variant "${v.name}" (code ${v.code})`);
    } else if (doc.code !== v.code) {
      errors.push(
        `Code mismatch for mimir-squad::${v.name}: enum has ${v.code}, doc has ${doc.code}`,
      );
    }
  }

  // Check for extraneous mimir-squad doc entries
  for (const name of squadDocMap.keys()) {
    if (!squadVariantNames.has(name)) {
      errors.push(`Documented mimir-squad variant "${name}" does not exist in types.rs`);
    }
  }

  return errors;
}

// ── Tests ────────────────────────────────────────────────────────────────────

test("parses mimir-market Error enum variants from types.rs", () => {
  const source = readFileSync(MARKET_TYPES_PATH, "utf8");
  const variants = parseRustEnum(source, "mimir-market/types.rs");
  assert.ok(variants.length >= 47, `Expected at least 47 variants, got ${variants.length}`);
  assert.ok(variants.some((v) => v.name === "AlreadyInitialized" && v.code === 1));
  assert.ok(variants.some((v) => v.name === "ClaimNotActive" && v.code === 21));
  assert.ok(variants.some((v) => v.name === "ConservationViolation" && v.code === 47));
});

test("parses mimir-squad Error enum variants from types.rs", () => {
  const source = readFileSync(SQUAD_TYPES_PATH, "utf8");
  const variants = parseRustEnum(source, "mimir-squad/types.rs");
  assert.ok(variants.length >= 32, `Expected at least 32 variants, got ${variants.length}`);
  assert.ok(variants.some((v) => v.name === "AlreadyInitialized" && v.code === 1));
  assert.ok(variants.some((v) => v.name === "SquadFull" && v.code === 28));
  assert.ok(variants.some((v) => v.name === "Timelocked" && v.code === 32));
});

test("docs/CONTRACT_ERRORS.md documents every variant in mimir-market and mimir-squad", () => {
  const marketSource = readFileSync(MARKET_TYPES_PATH, "utf8");
  const squadSource = readFileSync(SQUAD_TYPES_PATH, "utf8");
  const docContent = readFileSync(DOC_PATH, "utf8");

  const marketVariants = parseRustEnum(marketSource, "mimir-market/types.rs");
  const squadVariants = parseRustEnum(squadSource, "mimir-squad/types.rs");
  const docEntries = parseContractErrorsDoc(docContent);

  assert.ok(docEntries.length >= marketVariants.length + squadVariants.length, "Doc has insufficient entries");

  const problems = validateDocCoverage(docEntries, marketVariants, squadVariants);
  assert.deepEqual(problems, [], `Documentation coverage errors:\n${problems.join("\n")}`);
});

test("validation fails when an undocumented new variant is introduced in mimir-market", () => {
  const marketSource = readFileSync(MARKET_TYPES_PATH, "utf8");
  const squadSource = readFileSync(SQUAD_TYPES_PATH, "utf8");
  const docContent = readFileSync(DOC_PATH, "utf8");

  const marketVariants = [
    ...parseRustEnum(marketSource, "mimir-market/types.rs"),
    { name: "UndocumentedNewMarketError", code: 999 },
  ];
  const squadVariants = parseRustEnum(squadSource, "mimir-squad/types.rs");
  const docEntries = parseContractErrorsDoc(docContent);

  const problems = validateDocCoverage(docEntries, marketVariants, squadVariants);
  assert.ok(problems.length > 0, "Validator must fail when a variant is missing from the doc");
  assert.ok(
    problems.some((p) => p.includes('Missing documentation for mimir-market variant "UndocumentedNewMarketError"')),
    `Expected missing variant error, got: ${problems.join(", ")}`,
  );
});

test("validation fails when an undocumented new variant is introduced in mimir-squad", () => {
  const marketSource = readFileSync(MARKET_TYPES_PATH, "utf8");
  const squadSource = readFileSync(SQUAD_TYPES_PATH, "utf8");
  const docContent = readFileSync(DOC_PATH, "utf8");

  const marketVariants = parseRustEnum(marketSource, "mimir-market/types.rs");
  const squadVariants = [
    ...parseRustEnum(squadSource, "mimir-squad/types.rs"),
    { name: "UndocumentedNewSquadError", code: 888 },
  ];
  const docEntries = parseContractErrorsDoc(docContent);

  const problems = validateDocCoverage(docEntries, marketVariants, squadVariants);
  assert.ok(problems.length > 0, "Validator must fail when a squad variant is missing from the doc");
  assert.ok(
    problems.some((p) => p.includes('Missing documentation for mimir-squad variant "UndocumentedNewSquadError"')),
    `Expected missing variant error, got: ${problems.join(", ")}`,
  );
});

test("validation fails on code mismatch or empty description", () => {
  const badEntries: DocErrorEntry[] = [
    {
      code: 99, // Should be 1
      name: "AlreadyInitialized",
      contract: "mimir-market",
      entryPoints: "initialize",
      cause: "Already initialized",
      remediation: "Do not call again",
    },
    {
      code: 1,
      name: "AlreadyInitialized",
      contract: "mimir-squad",
      entryPoints: "", // Empty
      cause: "Already initialized",
      remediation: "", // Empty
    },
  ];

  const marketVariants = [{ name: "AlreadyInitialized", code: 1 }];
  const squadVariants = [{ name: "AlreadyInitialized", code: 1 }];

  const problems = validateDocCoverage(badEntries, marketVariants, squadVariants);
  assert.ok(problems.some((p) => p.includes("Code mismatch for mimir-market::AlreadyInitialized")));
  assert.ok(problems.some((p) => p.includes("Empty entry points for mimir-squad::AlreadyInitialized")));
  assert.ok(problems.some((p) => p.includes("Empty remediation for mimir-squad::AlreadyInitialized")));
});
