# Phase 7.4: Content tree API

* **Date:** 2026-11-13
* **Target step:** Phase 7, step 7.4 (`tasks/todo.md`), FR-C01 and FR-C02
* **Code:** `apps/api/src/content-items/`, `packages/shared/src/schemas/content.ts`

## Model

`content_items` is an adjacency list (`parent_id`) with a stored `depth` (1 = top of the course, at most 5) and `sort_order` (0..n among live siblings).

| Kind | Holds items | Needs an asset |
|---|---|---|
| `folder`, `chapter`, `lecture` | yes | no |
| `file` | no | ready, private, not MP4 (PDF, DOCX, PPTX, image) |
| `video` | no | ready, private, MP4 |

The `quiz` kind and `quiz_id` come in Phase 8, with the quizzes table.

## Rules

- **One editor at a time per course.** Every write runs in a transaction that locks the course row (`SELECT … FOR UPDATE`, `tenant_id` filtered by hand) and then loads all of the course's items, deleted ones included.
- **Move** (`PATCH {parentId?, position?}`): the new parent must be a live container of the same course (`400 INVALID_PARENT`). Moving under itself or a descendant is `409 TREE_CYCLE`. If the branch would go below level 5 it is `409 TREE_TOO_DEEP`. The depths of the whole branch, deleted items included, shift together, so a later restore never breaks the depth limit.
- **Order:** the server renumbers the live siblings 0..n after every create, move, delete and restore. `position` larger than the count means last.
- **Publish** sets or clears `published_at` on the item only. A student sees an item only if it and every item above it are published (checked on read, step 7.6).
- **Delete** stamps the item and its live descendants with one `deleted_at`. **Restore** clears exactly the items with that stamp, so items deleted earlier on their own stay deleted, and puts the item last among its siblings. Restoring under a deleted parent is `409 PARENT_DELETED`. Restoring twice is safe.
- **Audit:** `content.create`, `content.update` (title, asset), `content.publish`, `content.move`, `content.delete`, `content.restore`.

## Endpoints

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/content-items` | T, A | `{courseId, parentId?, kind, title, assetId?}`; appended last |
| PATCH | `/content-items/:id` | T, A | `{title?, parentId?, position?, published?, assetId?}` |
| DELETE | `/content-items/:id` | T, A | Soft delete of the branch |
| POST | `/content-items/:id/restore` | T, A | |
| GET | `/courses/:id/tree` | T, A | Nested live tree; `?deleted=true` lists the restorable items (each deleted group's top) |

Errors: `404 CONTENT_ITEM_NOT_FOUND`, `404 COURSE_NOT_FOUND` (also another tenant's course), `400 INVALID_PARENT`, `400 ASSET_NOT_USABLE`, `409 TREE_CYCLE`, `409 TREE_TOO_DEEP`, `409 PARENT_DELETED`.

## Later

- Student tree (published and enrolled only): step 7.6.
- Changing a file's download policy: with FR-C04 (7.6 or 7.8).
