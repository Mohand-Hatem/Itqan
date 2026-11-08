# ADR-002: Videos as MP4 in R2 for the MVP

**Status:** Accepted · 2026-11-08

**Context:** Budget is near zero. Managed video (Bunny Stream, Mux) adds encoding, adaptive bitrate and better protection, but costs money from day one.

**Decision:** Teachers upload compressed 720p MP4 to private R2. Students play it with a signed URL (4 h) in the native player with a moving identity watermark.

**Consequences:** No egress fees and no encoding service. No adaptive quality, and URLs can be copied while valid. `media_assets.provider` lets us move to Bunny Stream without changing the content model.
