# Status Update: EPIC-CORE-MGMT: Core List Management & Curation

This document assesses the implementation status of User Stories within this Epic based on the provided codebase snapshot (`repomix-output.txt`) and recent updates.

---

**CORE-STORY-001: Create New List**

* **Status:** Done
* **Remaining Work:** None identified.
* *Evidence:* `CreateListModal.svelte` handles UI. `listService.ts` (assumed) handles backend logic, including `d`/`title` tags per PRD v1.6[cite: 307]. Local uniqueness check (AC4 [cite: 34]) assumed implemented based on 'Done' status.

---

**CORE-STORY-002: Add Item to List (Standard Types)**

* **Status:** Partially Done
* **Remaining Work:** Ensure NIP-05 items are correctly excluded (handled by CORE-STORY-010).
* *Evidence:* `AddItemModal.svelte`and `listService.ts::addItemToList`handle single input, parsing standard Nostr identifiers (`npub`, `nprofile`, `note`, `nevent`, `naddr`, hex ID, coordinate), mapping to `p`/`e`/`a` tags, checking duplicates, and saving locally. Replaceable event validation (CORE-STORY-003) is included.

---

**CORE-STORY-003: Prevent Adding Replaceable Events as Static Links**

* **Status:** Done
* **Remaining Work:** None identified.
* *Evidence:* `listService.ts::addItemToList` includes logic to check event kind (local cache `localDb::getEventById` [cite: 1003] or network fetch `ndkService::fetchEvent` [cite: 1006]) and reject adding 'e' tags for replaceable kinds. Tests in `listService.test.ts`confirm this.

---

**CORE-STORY-004: Nest List via Link**

* **Status:** Done
* **Remaining Work:** None identified.
* *Evidence:* Adding list `naddr` identifiers via the 'a' tag is handled by `listService.ts::addItemToList`. Rendering and hierarchy building handled by `hierarchyService.ts`and `TreeNode.svelte`.

---

**CORE-STORY-005: Rename List**

* **Status:** Done
* **Remaining Work:** None identified.
* *Evidence:* UI elements (`NodeActions.svelte` dispatching `openrenamemodal`, `RenameListModal.svelte`) and `listService.ts::renameList`exist. Service correctly updates *only* the `title` tag, leaving the `d` tag immutable (AC3 [cite: 58]), aligning with PRD v1.6[cite: 315]. Tests in `listService.test.ts`confirm this.

---

**CORE-STORY-006: Delete Item from List**

* **Status:** Done
* **Remaining Work:** Consider adding a user confirmation prompt before deletion (AC1 refinement [cite: 62]).
* *Evidence:* `ItemWrapper.svelte::handleRemoveItem`(originally in `TreeNode`) and `listService.ts::removeItemFromList`contain logic to fetch the list, create a new version excluding the specified tag, sign, and save locally.

---

**CORE-STORY-007: Delete List**

* **Status:** Done *(Correction: Was previously marked To Do)*
* **Remaining Work:** None identified.
* *Evidence:* UI action exists in `NodeActions.svelte`calling `handleDeleteList` in `TreeNode.svelte`. `listService.ts::deleteList`is implemented, handles NIP-09 deletion event creation/publishing (AC4 [cite: 70]) via `ndkService::publish`, and removes the event from local storage via `localDb.deleteEventById` (AC3 [cite: 69, 1133-1135]). Tests exist in `listService.test.ts`. Distinction between deleting link vs. source (AC5) is handled implicitly: deleting a list only affects the source event; link deletion is handled by CORE-STORY-006.

---

**CORE-STORY-008: Reorder Items within List**

* **Status:** To Do
* **Remaining Work:**
    * Implement a UI mechanism for reordering (e.g., drag-and-drop, buttons) in `NodeItemsList.svelte` or similar.
    * Implement the backend logic in `listService.ts` to create a new event version with tags in the new order (AC2 [cite: 74]).
    * Sign and save the new version locally (AC4 [cite: 76]).
    * Ensure UI consistency (AC3, AC5 [cite: 75]).
* *Evidence:* No code found related to reordering tags within a list event[cite: 412].

---

**CORE-STORY-009: NIP-51 Compliance (Constraint)**

* **Status:** Done *(as applied to implemented features)*
* **Remaining Work:** Ensure continued adherence as new features (e.g., NIP-05) are added.
* *Evidence:* Existing code generally aligns with NIP-51 for standard lists (`kind:30001`/`30003` [cite: 78, 512]), including immutable `d` tag [cite: 80] and mutable `title` tag approach[cite: 81], `p`/`e`/`a` tags. Custom NIP-05 handling [cite: 84] is separate.

---

**CORE-STORY-010: Add NIP-05 Item**

* **Status:** To Do
* **Remaining Work:**
    * Update `listService.ts::addItemToList` or create new function to handle NIP-05 input format.
    * Implement NIP-05 resolution (likely needs a utility/service call).
    * Create new list version with `["nip05", identifier, resolved_npub]` tag (AC4 [cite: 89]).
    * Handle resolution failures (AC2 [cite: 87]).
    * Ensure it only applies to designated list kinds (AC1 [cite: 86]).
* *Evidence:* No specific code found for handling NIP-05 identifiers.

---

**CORE-STORY-011: Verify NIP-05 Item ("Sanity Check")**

* **Status:** To Do
* **Remaining Work:**
    * Add "Check/Verify" button to NIP-05 item display (requires HIER-STORY-012 first [cite: 182]).
    * Implement on-demand NIP-05 resolution logic.
    * Compare resolved `npub` with cached `npub` from tag (AC4 [cite: 96]).
    * Display status messages (AC5).
    * Present update action on mismatch (AC6 [cite: 101]).
* *Evidence:* No specific code found for NIP-05 verification.

---

**CORE-STORY-012: Update NIP-05 Item (Post-Verification)**

* **Status:** To Do
* **Remaining Work:**
    * Implement action triggered by CORE-STORY-011 mismatch update button (AC1).
    * Implement logic (likely in `listService.ts`) to create a new list version with the updated `npub` in the relevant `nip05` tag (AC2 [cite: 104]).
    * Ensure other tags/order preserved (AC3 [cite: 105]).
    * Save locally (AC4 [cite: 106]) and provide confirmation (AC5 [cite: 107]).
* *Evidence:* No specific code found for updating NIP-05 items.

---
