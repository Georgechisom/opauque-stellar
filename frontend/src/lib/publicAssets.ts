export function publicAssetPath(path: string): string {
  const base = import.meta.env.BASE_URL || "/";
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  const normalizedPath = path.replace(/^\/+/, "");
  return `${normalizedBase}${normalizedPath}`;
}

export function isWasmHtmlFallbackError(message: string): boolean {
  return (
    message.includes("WebAssembly.compile") ||
    message.includes("expected magic word") ||
    message.includes("found 3c 21 64 6f")
  );
}
