/**
 * Pluggable logger. The SDK logs nothing by default (no `console.log` noise in a
 * library); a host app can pass {@link consoleLogger} or its own implementation.
 */

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/** Default logger: discards everything. */
export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/** Logger that forwards to the global `console`. */
export const consoleLogger: Logger = {
  debug: (...a) => console.debug(...a),
  info: (...a) => console.info(...a),
  warn: (...a) => console.warn(...a),
  error: (...a) => console.error(...a),
};
