// Which other websites may connect to the game server (the front end can be hosted separately).

/** The Vite dev server, plus any origins in CORS_ORIGIN (comma-separated). */
export function allowedOriginsFrom(extra: string | undefined): string[] {
  return [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    ...(extra ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean)
  ];
}

/**
 * Exact matches from the allow-list, plus "https://*.example.com" entries matching any
 * subdomain (e.g. Cloudflare Pages preview builds at <hash>.hardman-boa-whist.pages.dev).
 */
export function originChecker(allowed: string[]): (origin: string) => boolean {
  return (origin) =>
    allowed.some((entry) => {
      if (entry === origin) return true;
      const wildcard = entry.match(/^(https?:\/\/)\*\.(.+)$/);
      if (!wildcard) return false;
      const [, scheme, domain] = wildcard;
      return origin.startsWith(scheme) && origin.slice(scheme.length).endsWith(`.${domain}`);
    });
}
