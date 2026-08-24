# Security Headers

Opaque's hosted frontend must ship the same browser security policy across staging, preview, and production. The static host should fail closed when a required header is missing.

## Required response headers

- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-Content-Type-Options: nosniff`
- `Content-Security-Policy` with `default-src 'self'`, `frame-ancestors 'none'`, and `object-src 'none'`
- `Permissions-Policy` denying unused powerful APIs
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Resource-Policy: same-origin`

The canonical static-host policy lives in `frontend/public/_headers`. Vercel deployments mirror the policy in `frontend/vercel.json`.

## CI verification

The frontend Vitest suite checks both checked-in hosting configurations. To verify a deployed staging URL, set one of these environment variables before running the test:

- `OPAQUE_STAGING_URL`
- `VITE_STAGING_URL`
- `DEPLOYED_FRONTEND_URL`

Example:

```sh
OPAQUE_STAGING_URL=https://staging.example.test npm --prefix frontend test -- securityHeaders
```

When a URL is configured, the test fetches the deployed page and fails if HSTS, `X-Frame-Options`, or `Referrer-Policy` are missing or weakened.
