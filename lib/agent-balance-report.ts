export type AgentBalanceRow = {
  role: string;
  address: string;
  exists: boolean;
  xlm: string | number | null;
  usdc: string | number | null;
  trustline: boolean;
};

export type ThresholdOptions = {
  minXlm?: number;
  minUsdc?: number;
};

export type ThresholdViolation = {
  role: string;
  address: string;
  metric: "xlm" | "usdc";
  actual: number | null;
  minimum: number;
};

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatBalancesJson(rows: AgentBalanceRow[]): string {
  return JSON.stringify(rows.map((row) => ({
    role: row.role,
    address: row.address,
    exists: row.exists,
    xlm: row.xlm,
    usdc: row.usdc,
    trustline: row.trustline,
  })), null, 2);
}

export function evaluateThresholds(
  rows: AgentBalanceRow[],
  options: ThresholdOptions,
): ThresholdViolation[] {
  const violations: ThresholdViolation[] = [];
  const minXlm = options.minXlm;
  const minUsdc = options.minUsdc;

  for (const row of rows) {
    if (typeof minXlm === "number") {
      const actual = toNumber(row.xlm);
      if (actual === null || actual < minXlm) {
        violations.push({
          role: row.role,
          address: row.address,
          metric: "xlm",
          actual,
          minimum: minXlm,
        });
      }
    }

    if (typeof minUsdc === "number") {
      const actual = toNumber(row.usdc);
      if (actual === null || actual < minUsdc) {
        violations.push({
          role: row.role,
          address: row.address,
          metric: "usdc",
          actual,
          minimum: minUsdc,
        });
      }
    }
  }

  return violations;
}

export function thresholdExitCode(violations: ThresholdViolation[]): number {
  return violations.length > 0 ? 1 : 0;
}

export function formatThresholdReport(violations: ThresholdViolation[]): string {
  if (violations.length === 0) return "";
  const lines = violations.map((v) => {
    const actual = v.actual === null ? "unknown" : v.actual.toString();
    return `${v.role} (${v.address}): ${v.metric.toUpperCase()} ${actual} < ${v.minimum}`;
  });
  return lines.join("\n");
}
