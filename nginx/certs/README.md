# Cloudflare Origin CA Certificates
Place your Cloudflare Origin Certificate and Private Key here for the VPS staging deployment:
- `origin.crt`: Cloudflare Origin Certificate (PEM format)
- `origin.key`: Cloudflare Origin Private Key (PEM format)

In Cloudflare Dashboard:
1. Navigate to SSL/TLS > Origin Server.
2. Click "Create Certificate".
3. Include hostnames: `*.staging.<root>` and `staging.<root>` (e.g. `*.staging.itqan.com`, `staging.itqan.com`).
4. Save the generated certificate to `origin.crt` and key to `origin.key`.
