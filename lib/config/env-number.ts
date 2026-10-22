/** Reads a finite numeric environment value, applying a default and optional constraints. */
export type EnvNumberEnvironment = Readonly<Record<string, string | undefined>>;

/** Default and optional inclusive constraints for a numeric environment value. */
export type ReadEnvNumberOptions = {
  default: number;
  min?: number;
  max?: number;
  integer?: boolean;
};

/** Success contains the parsed value; failure contains a variable-specific message. */
export type EnvNumberResult =
  | { ok: true; value: number }
  | { ok: false; error: string };

/** Reads a numeric setting from an environment object without accessing process.env. */
export function readEnvNumber(
  env: EnvNumberEnvironment,
  name: string,
  options: ReadEnvNumberOptions,
): EnvNumberResult {
  const rawValue = env[name];
  if (rawValue === undefined || rawValue.trim() === "") {
    return { ok: true, value: options.default };
  }

  const value = Number(rawValue.trim());
  const range = `[${options.min ?? "-Infinity"}, ${options.max ?? "Infinity"}]`;
  const valueType = options.integer ? "integer" : "number";
  const error = `${name} must be a finite ${valueType} in the range ${range}.`;

  if (!Number.isFinite(value)) return { ok: false, error };
  if (options.integer && !Number.isInteger(value)) return { ok: false, error };
  if (options.min !== undefined && value < options.min) return { ok: false, error };
  if (options.max !== undefined && value > options.max) return { ok: false, error };

  return { ok: true, value };
}