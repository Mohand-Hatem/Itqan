# ADR-004: Bind devices with an HttpOnly cookie secret

**Status:** Accepted · 2026-11-08

**Context:** Browsers expose no hardware ID. Fingerprinting is unreliable and spoofable. Passkeys sync across devices.

**Decision:** On first login, create a device with a 32-byte random secret, store its hash, and set it in an HttpOnly cookie on the parent domain (`.<root-domain>`) so it works across tenant subdomains. Default `max_devices = 1`; changes need staff approval.

**Consequences:** Binds one browser on one machine, which is stricter than "one device". Clearing cookies, incognito or switching browsers locks the student out until approval, which means support load. Custom domains later cannot share the cookie. A native app is the only path to true hardware binding.
