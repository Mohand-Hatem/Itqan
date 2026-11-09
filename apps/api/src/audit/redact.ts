const SECRET_KEY = /pass(word)?|token|secret|code|otp|cookie|authorization|api[-_]?key/i;

// Replaces values under secret-looking keys, at any depth. Errs on the side of hiding.
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [
        key,
        SECRET_KEY.test(key) ? "[redacted]" : redact(v),
      ]),
    );
  }
  return value;
}
