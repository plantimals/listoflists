# Status Update: EPIC-CORE-MGMT: Core List Management & Curation

This document assesses the implementation status of User Stories within this Epic based on the provided codebase snapshot (`repomix-output.txt`).

---

**CORE-STORY-001: Create New List**

* **Status:** Done
* **Remaining Work:** None identified.
    * *Evidence:* `CreateListModal.svelte` handles creating `kind:30001` events with `d`/`title` tags, signing, saving locally (marked unpublished), and dispatching an event likely used to refresh the UI. ACs appear met.

---

**CORE-STORY-002: Add Item to List (Auto-Detect)**

* **Status:** Partially Done
* **Remaining Work:**
    * Implement validation to prevent adding *replaceable* event kinds via the 'e' tag mechanism (as detailed in CORE-STORY-003). This logic needs to be added within `listService.ts` (`addItemToList`).
    * *Evidence:* `AddItemModal.svelte` and `listService.ts` handle single input, parsing various Nostr identifiers (`npub`, `nprofile`, `note`, `nevent`, `naddr`, hex), mapping to `p`/`e`/`a` tags, checking duplicates, and saving new list versions locally. The core auto-detect mechanism exists, but lacks the specific replaceable event validation.

---

**CORE-STORY-003: Prevent Adding Replaceable Events as Static Links**

* **Status:** To Do
* **Remaining Work:**
    * Modify `listService.ts` (`addItemToList`) to fetch or determine the `kind` of an event ID being added via an 'e' tag.
    * Add logic to check if the fetched `kind` is replaceable (0, 3, 10k-20k, 30k-40k).
    * If replaceable, prevent adding the 'e' tag and return/display an informative error message (AC2).
    * Optionally, suggest adding via 'a' tag if appropriate (AC3).
    * *Evidence:* Current code in `listService.ts` adds any valid event ID as 'e' tag without kind checking.

---

**CORE-STORY-004: Nest List via Link**

* **Status:** Done
* **Remaining Work:** None identified.
    * *Evidence:* Adding list `naddr` identifiers via the 'a' tag is handled by the logic covered in CORE-STORY-002 (`listService.ts`). The rendering of these as nested, expandable structures is handled by `hierarchyService.ts` and `TreeNode.svelte`.

---

**CORE-STORY-005: Rename List**

* **Status:** To Do
* **Remaining Work:**
    * Implement UI element(s) to trigger the rename action for a selected list.
    * Create the backend logic (likely in `listService.ts` or similar) to:
        * Fetch the current list event.
        * Create a new event version with identical tags/content but updated `d` and `title` tags reflecting the new name.
        * Sign and save the new version locally (marked unpublished).
    * Ensure the UI (e.g., `TreeNode.svelte`) updates to display the new name after the operation.
    * *Evidence:* No specific code for renaming existing lists was found.

---

**CORE-STORY-006: Delete Item from List**

* **Status:** Done
* **Remaining Work:**
    * Consider adding a user confirmation prompt before deletion (AC1 refinement).
    * *Evidence:* `TreeNode.svelte` (`handleRemoveItem`) and `listService.ts` (`removeItemFromList`) contain logic to fetch the list, create a new version excluding the specified tag, sign, and save locally.

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
    * Implement the backend logic (likely in `listService.ts` or similar) to create a new list event version with the `p`, `e`, and `a` tags arranged in the new user-defined sequence.
    * Sign and save the new version locally (marked unpublished).
    * Ensure the UI consistently displays items in the saved order.
    * *Evidence:* No code found related to reordering tags within a list event.

---

**CORE-STORY-009: NIP-51 Compliance (Constraint)**

* **Status:** Done *(as applied to implemented features)*
* **Remaining Work:** Ensure continued adherence to NIP-51 standards as new list management features (rename, reorder, etc.) are implemented.
    * *Evidence:* Existing code for list creation (`kind:30001`, `d`/`title` tags) and item addition (`p`/`e`/`a` tags) appears consistent with NIP-51 conventions shown.

---

