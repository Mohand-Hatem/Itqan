# Phase 7.6: Content access API

* **Date:** 2026-11-13
* **Target step:** Phase 7, step 7.6 (`tasks/todo.md`), FR-C04, FR-C05, FR-C06
* **Code:** `apps/api/src/content-items/content-access.service.ts`, `StorageService.presignGet`

## Who sees what

A **student** reaches content only after these checks, in order:

1. The course exists in this tenant and is not deleted (`404 COURSE_NOT_FOUND`).
2. The student has an active membership (`403 NO_ACCESS`).
3. The student has an enrollment, and it is active (`403 ENROLLMENT_REQUIRED`, `403 ENROLLMENT_TERMINATED`). These are the same checks as `GET /courses/:id/access` (6.7).
4. The course is `published` or `archived`. Archived courses stay open to students already enrolled. A draft course gives `403 COURSE_NOT_PUBLISHED`.
5. The item and every item above it are published and not deleted. Otherwise `404 CONTENT_ITEM_NOT_FOUND`, so hidden items don't reveal that they exist.

**Staff** (teacher, assistant) can preview any live item of their tenant, published or not.

## Links

`GET /content-items/:id/access` returns `{itemId, kind, mimeType, fileName, fileSize, viewUrl, downloadUrl, expiresAt, watermark}`.

| File | viewUrl | downloadUrl | Lifetime | Watermark |
|---|---|---|---|---|
| PDF, JPEG/PNG/WebP | yes (`inline`) | only when `downloadable` | 5 min | no |
| DOCX, PPTX | no (browsers can't show them) | always | 5 min | no |
| MP4 | yes (`inline`, range requests) | never | 4 h | viewer's `{name, email}` |

- Every link forces the stored `Content-Type` and a `Content-Disposition` (`inline` or `attachment`). Non-ASCII names such as Arabic go in `filename*` (RFC 6266). A file is never served as another type (docs/09 #9).
- **Refresh:** when a link expires (R2 answers 403), the client asks the same endpoint again. All checks run again, so an ended enrollment stops new links at once. A link already handed out lives until it expires.
- Links are credentials: they are never logged.

## Student tree

`GET /courses/:id/tree` as a student returns `[{id, kind, title, mimeType, children}]`: the same checks 1–4, then only published items, built from the top down, so anything under an unpublished or deleted item is left out. Staff keep the 7.4 view.

## Download policy

`PATCH /uploads/:id {downloadPolicy}` (T, A) switches a file between `view_only` and `downloadable`, with a `media.update` audit entry. The policy belongs to the file, so it applies to every item that uses it.

## Not here

- The viewer pages, the PDF viewer and the video player with the moving watermark: 7.7–7.9, which wait for the design.
- Progress: 7.10.
