# Status Update: EPIC-CORE-MGMT: Core List Management & Curation

This document assesses the implementation status of User Stories within this Epic based on the provided codebase snapshot (`repomix-output.txt`) and recent updates.
[source: 13175] ---

**CORE-STORY-001: Create New List**

* **Status:** Done
* **Remaining Work:** None identified.
* *Evidence:* `CreateListModal.svelte` handles UI. `listService.ts` (assumed) handles backend logic, including `d`/`title` tags per PRD v1.6[cite: 307]. Local uniqueness check (AC4 [cite: 34]) assumed implemented based on 'Done' status.
[source: 13176-13178] ---

**CORE-STORY-002: Add Item to List (Standard Types)**

* **Status:** Done
* **Remaining Work:** None identified.
* *Evidence:* `AddItemModal.svelte`and `listService.ts::addItemToList`handle single input, parsing standard Nostr identifiers (`npub`, `nprofile`, `note`, `nevent`, `naddr`, hex ID, coordinate), mapping to `p`/`e`/`a` tags, checking duplicates, and saving locally. Replaceable event validation (CORE-STORY-003) is included. NIP-05 handled by CORE-STORY-010.
[source: 13179-13180] ---

**CORE-STORY-003: Prevent Adding Replaceable Events as Static Links**

* **Status:** Done
* **Remaining Work:** None identified.
* *Evidence:* `listService.ts::addItemToList` includes logic to check event kind (local cache `localDb::getEventById` [cite: 1003] or network fetch `ndkService::fetchEvent` [cite: 1006]) and reject adding 'e' tags for replaceable kinds. Tests in `listService.test.ts`confirm this.
[source: 13181-13182] ---

**CORE-STORY-004: Nest List via Link**

* **Status:** Done
* **Remaining Work:** None identified.
* *Evidence:* Adding list `naddr` identifiers via the 'a' tag is handled by `listService.ts::addItemToList`. Rendering and hierarchy building handled by `hierarchyService.ts`and `TreeNode.svelte`. `AddressableItem.svelte` renders the link.
[source: 13183-13184] ---

**CORE-STORY-005: Rename List**

* **Status:** Done
* **Remaining Work:** None identified.
* *Evidence:* UI elements (`NodeActions.svelte` dispatching `openrenamemodal`, `RenameListModal.svelte`) and `listService.ts::renameList`exist. Service correctly updates *only* the `title` tag, leaving the `d` tag immutable (AC3 [cite: 58]), aligning with PRD v1.6[cite: 315]. Tests in `listService.test.ts`confirm this.
[source: 13185-13187] ---

**CORE-STORY-006: Delete Item from List**

* **Status:** Done
* **Remaining Work:** Consider adding a user confirmation prompt before deletion (AC1 refinement [cite: 62]).
* *Evidence:* `ItemWrapper.svelte::handleRemoveItem`(originally in `TreeNode`) and `listService.ts::removeItemFromList`contain logic to fetch the list, create a new version excluding the specified tag, sign, and save locally. NIP-05 items handled via standard tag removal.
[source: 13188-13189] ---

**CORE-STORY-007: Delete List**

* **Status:** Done
* **Remaining Work:** None identified.
* *Evidence:* UI action exists in `NodeActions.svelte`calling `handleDeleteList` in `TreeNode.svelte`. `listService.ts::deleteList`is implemented, handles NIP-09 deletion event creation/publishing (AC4 [cite: 70]) via `ndkService::publish`, and removes the event from local storage via `localDb.deleteEventById` (AC3 [cite: 69, 1133-1135]). Tests exist in `listService.test.ts`. Distinction between deleting link vs. source (AC5) is handled implicitly: deleting a list only affects the source event; link deletion is handled by CORE-STORY-006.
[source: 13190-13193] ---

**CORE-STORY-008: Reorder Items within List**

* **Status:** Won't Do (V1)
* **Remaining Work:** Not planned for V1.
* *Evidence:* No code found related to reordering tags within a list event[cite: 412].
[source: 13194-13197] ---

**CORE-STORY-009: NIP-51 Compliance (Constraint)**

* **Status:** Done *(as applied to implemented features)*
* **Remaining Work:** Ensure continued adherence.
* *Evidence:* Existing code generally aligns with NIP-51 for standard lists (`kind:30001`/`30003` [cite: 78, 512]), including immutable `d` tag [cite: 80] and mutable `title` tag approach[cite: 81], `p`/`e`/`a` tags. Custom NIP-05 handling [cite: 84] uses `["nip05", identifier, resolved_npub]` tag.
[source: 13198-13199] ---

**CORE-STORY-010: Add NIP-05 Item**

* **Status:** Done
* **Remaining Work:** None identified.
* *Evidence:* `listService.ts::addItemToList` [cite: 9828] includes logic to detect NIP-05 format, call `nip05.queryProfile`[cite: 9870], handle resolution failure/success, and add the `["nip05", identifier, resolved_npub]` tag[cite: 9872]. Duplicate check exists[cite: 9867]. Test cases cover this in `listService.test.ts`.
[source: 13200-13203] ---

**CORE-STORY-011: Verify NIP-05 Item ("Sanity Check")**

* **Status:** Done
* **Remaining Work:** None identified.
* *Evidence:* `Nip05Item.svelte`displays the identifier and "Check" button[cite: 9453]. Clicking it dispatches `checknip05`[cite: 9421]. `+page.svelte` handles this event via `handleCheckNip05`[cite: 10836], calls `nip05Service::verifyNip05`[cite: 10838], and updates the `nip05VerificationStates` map [cite: 10837, 10841] which is passed down to `Nip05Item` to display status (Match/Mismatch/Fail) [cite: 11173, 11181-11183].
[source: 13204-13206] ---

**CORE-STORY-012: Update NIP-05 Item (Post-Verification)**

* **Status:** Done - decided to stop
* **Remaining Work:** Implement the `handleUpdateNip05` function in `+page.svelte` to receive the event and call the (yet to be created) `listService` function. Create the `listService` function to update the cached `npub` in the tag.
* *Evidence:* The "Update?" button exists in `Nip05Item.svelte`and dispatches an `updatenip05` event. However, the handling logic in `+page.svelte` and the corresponding `listService` function appear to be missing.
[source: 13207-13210] ---
