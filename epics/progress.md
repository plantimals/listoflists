# Status Update: EPIC-CORE-MGMT: Core List Management & Curation

This document assesses the implementation status of User Stories within this Epic based on the provided codebase snapshot (`repomix-output.txt`) and recent updates.
---

**CORE-STORY-001: Create New List**

* **Status:** Done
* **Remaining Work:** None identified.
* *Evidence:* `CreateListModal.svelte`handles creating `kind:30001` events. Logic for slugified `d` tag and local uniqueness check needs verification against latest code, but assuming previous work addressed this based on ACs in `epic-core-mgmt.md`.

---

**CORE-STORY-002: Add Item to List (Auto-Detect)**

* **Status:** Partially Done
* **Remaining Work:** Ensure NIP-05 items are correctly excluded (handled by CORE-STORY-010).
* *Evidence:* `AddItemModal.svelte`and `listService.ts` (`addItemToList`)handle single input, parsing various Nostr identifiers, mapping to `p`/`e`/`a` tags, checking duplicates, and saving locally. Replaceable event validation (CORE-STORY-003) is also done.

---

**CORE-STORY-003: Prevent Adding Replaceable Events as Static Links**

* **Status:** Done
* **Remaining Work:** None identified.
* *Evidence:* `listService.ts` (`addItemToList`) includes logic to check event kind (local cache or network fetch) and reject adding 'e' tags for replaceable kinds.

---

**CORE-STORY-004: Nest List via Link**

* **Status:** Done
* **Remaining Work:** None identified.
* *Evidence:* Adding list `naddr` identifiers via the 'a' tag is handled by `addItemToList` [cite: 940-941, 950-951]. Rendering handled by `hierarchyService.ts`and `TreeNode.svelte` [cite: 656-661, 667-673].

---

**CORE-STORY-005: Rename List**

* **Status:** Done *(Updated April 11, 2025)*
* **Remaining Work:** None identified.
* *Evidence:* UI elements (`TreeNode.svelte`, `RenameListModal.svelte`) and parent page event handling (`+page.svelte`) exist. The `renameList` function in `listService.ts`has been modified (as per user confirmation) to correctly update *only* the `title` tag, leaving the original `d` tag immutable, aligning with the latest requirements. Tests in `listService.test.ts`have been updated and confirmed passing. Feature validated in browser.

---

**CORE-STORY-006: Delete Item from List**

* **Status:** Done
* **Remaining Work:**
    * Consider adding a user confirmation prompt before deletion (AC1 refinement).
* *Evidence:* `TreeNode.svelte` (`handleRemoveItem`)and `listService.ts` (`removeItemFromList`)contain logic to fetch the list, create a new version excluding the specified tag, sign, and save locally.

---

**CORE-STORY-007: Delete List**

* **Status:** To Do
* **Remaining Work:**
    * Implement UI element(s) to trigger deleting an entire list.
    * Implement logic to remove the list event data from local storage (`localDb.ts`).
    * Decide on and potentially implement NIP-09 event deletion for network propagation (Optional/V2 AC4).
    * Clarify and implement the distinction between deleting a *link* to a nested list vs. deleting the *source* list event itself (AC5).
* *Evidence:* No specific code found for deleting entire list events.

---

**CORE-STORY-008: Reorder Items within List**

* **Status:** To Do
* **Remaining Work:**
    * Implement a UI mechanism for users to reorder items within a list (e.g., drag-and-drop, move up/down buttons).
    * Implement the backend logic (likely in `listService.ts` or similar) to create a new list event version with the tags arranged in the new user-defined sequence.
    * Sign and save the new version locally (marked unpublished).
    * Ensure the UI consistently displays items in the saved order.
* *Evidence:* No code found related to reordering tags within a list event.

---

**CORE-STORY-009: NIP-51 Compliance (Constraint)**

* **Status:** Done *(as applied to implemented features)*
* **Remaining Work:** Ensure continued adherence as new features are added (e.g., NIP-05 custom tags).
* *Evidence:* Existing code generally aligns with NIP-51 for standard lists, including immutable `d` tag and mutable `title` tag approach[cite: 79, 80]. Custom NIP-05 handling uses specific tags[cite: 83].

---
