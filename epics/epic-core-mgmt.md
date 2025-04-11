# EPIC-CORE-MGMT: Core List Management & Curation

*This Epic covers the fundamental ability for users to create, populate, and manage their curation lists.*

---

**CORE-STORY-001: Create New List**

* **As a curator, I want to** create a new list by providing a title **so that** I can start organizing Nostr content according to my interests [cite: FR-02].
* **AC 1:** Given I am authenticated, when I initiate the "Create List" action and provide a valid title (e.g., "My Awesome Bookmarks"), then the application generates a slugified identifier from the title (e.g., "my-awesome-bookmarks").
* **AC 2:** Before proceeding, the application MUST check the local database (`localDb`) to ensure no other list event exists with the same `kind`, `pubkey`, and the generated identifier (`d` tag).
* **AC 3:** If a list with the same `kind`, `pubkey`, and generated identifier already exists locally, the creation MUST fail, and an informative error message ("A list with the identifier '{slug}' already exists locally. Please choose a different title.") MUST be displayed.
* **AC 4:** If the generated identifier is locally unique, a new Nostr event (e.g., `kind:30001`) is created locally.
* **AC 5:** The created list event MUST include a `d` tag containing the generated, slugified identifier (which remains immutable).
* **AC 6:** The created list event MUST include a `title` tag containing the original, user-provided title.
* **AC 7:** The created list event is saved to local storage (Dexie) and is initially marked as unpublished.
* **AC 8:** The new list appears as a root item or at the designated location in my list hierarchy view after creation, displaying the `title`.

---

**CORE-STORY-002: Add Item to List (Standard Types)**

* **As a curator, I want to** add standard items (profiles, non-replaceable events, standard resources, list links) to one of my lists using a single input field **so that** I can easily populate my curated collections [cite: FR-04].
* **AC 1:** Given I have selected a list (excluding specialized lists like `kind:30005`), when I enter a valid `npub` or `nprofile` identifier into the "add item" input, then a new version of the list event containing a corresponding `p` tag is saved locally.
* **AC 2:** Given I have selected a list, when I enter a valid *non-replaceable* event identifier (`note1`, `nevent1`, or hex ID verified as non-replaceable kind via CORE-STORY-003 logic) into the "add item" input, then a new version of the list event containing a corresponding `e` tag is saved locally.
* **AC 3:** Given I have selected a list, when I enter a valid addressable resource or list identifier (`naddr1...` for kinds *other* than the NIP-05 specific list kind) into the "add item" input, then a new version of the list event containing a corresponding `a` tag is saved locally.
* **AC 4:** Given I have selected a list, when I enter text that does not match any recognized Nostr identifier format (for standard types) or a NIP-05 identifier (handled by CORE-STORY-010), then an error message is displayed, and no item is added.
* **AC 5:** Given I attempt to add an item whose type and value exactly match an item already present in the list, the item is not added again (no duplicate tags are created).

---

**CORE-STORY-003: Prevent Adding Replaceable Events as Static Links**

* **As a curator, I want** the application to prevent adding *replaceable* event IDs (`kind:0`, `kind:3`, `10000`-`19999`, `30000`-`39999`) as static 'e' tag items **so that** my list references remain stable and point to definitive content [cite: FR-04].
* **AC 1:** Given I enter an event identifier (hex, `note1`, `nevent1`) into the "add item" input, when the application determines the event's kind is replaceable (via local cache or network fetch), then the item is *not* added using an `e` tag.
* **AC 2:** When attempting to add a replaceable event ID via the 'e' tag mechanism, an informative error message is displayed explaining why it's disallowed (e.g., "Cannot add replaceable event kind X as a static link.").
* **AC 3:** The error message *may* suggest adding parameterized replaceable events using their `naddr` identifier instead.

---

**CORE-STORY-004: Nest List via Link**

* **As a curator, I want to** add a *link* to another Nostr list (using its `naddr`) as an item within my current list **so that** I can create nested hierarchies for better organization [cite: FR-03, FR-04].
* **AC 1:** Given I have selected a list, when I enter a valid `naddr` identifier for another list into the "add item" input, then a new version of the current list event containing an `a` tag with the `naddr` value is saved locally (handled by CORE-STORY-002).
* **AC 2:** In the hierarchy view, the item representing the linked list is visually identifiable as a nestable list (e.g., with an expand/collapse icon).
* **AC 3:** The `a` tag format used adheres to NIP-51 conventions for referencing addressable events (`kind:pubkey:dTag`).

---

**CORE-STORY-005: Rename List**

* **As a curator, I want to** rename my lists by changing their display name **so that** I can update their names to accurately reflect their contents or purpose while keeping their identifier stable [cite: FR-05].
* **AC 1:** Given I select one of my lists, when I initiate the "Rename" action and provide a new valid display name, then a new version of the list event is created locally.
* **AC 2:** The new list event version MUST have its `title` tag updated to the new display name.
* **AC 3:** The new list event version MUST retain the original, unchanged `d` tag.
* **AC 4:** The list appears with the new display name (the updated `title` tag) in the hierarchy view.
* **AC 5:** The new event version replaces the old one locally and is marked as unpublished, ready for synchronization.

---

**CORE-STORY-006: Delete Item from List**

* **As a curator, I want to** remove items (including `nip05` items) from my lists **so that** I can keep my collections up-to-date and remove irrelevant content [cite: FR-05].
* **AC 1:** Given I am viewing the items within one of my lists, when I initiate the "Delete" action for a specific item, then a confirmation prompt is shown (optional but recommended).
* **AC 2:** Upon confirmation, a new version of the list event is created locally that excludes the specific tag (`p`, `e`, `a`, or `nip05`) corresponding to the deleted item.
* **AC 3:** The deleted item no longer appears in the list's item view.
* **AC 4:** The new list event version replaces the old one locally and is marked as unpublished, ready for synchronization.

---

**CORE-STORY-007: Delete List**

* **As a curator, I want to** delete entire lists that I no longer need **so that** I can keep my curation structure manageable [cite: FR-05].
* **AC 1:** Given I select one of my top-level lists, when I initiate the "Delete" action, then a confirmation prompt is shown.
* **AC 2:** Upon confirmation, the list is removed from the local hierarchy view.
* **AC 3:** The underlying list event data is marked as deleted or removed from local storage.
* **AC 4:** (Optional/V2) A NIP-09 deletion event referencing the list event ID *may* be created and queued for synchronization.
* **AC 5:** If a list *link* (`a` tag item) is deleted from within a parent list (using CORE-STORY-006), only the reference is removed; the underlying referenced list remains unaffected unless deleted separately.

---

**CORE-STORY-008: Reorder Items within List**

* **As a curator, I want to** reorder items (including `nip05` items) within a specific list **so that** I can arrange them according to my preferred sequence or importance [cite: FR-05].
* **AC 1:** Given I am viewing items in one of my lists, when I use the reordering mechanism (e.g., drag-and-drop, up/down buttons), then the visual order of items changes accordingly.
* **AC 2:** Upon saving/confirming the new order, a new version of the list event is created locally where the sequence of `p`, `e`, `a`, and `nip05` tags reflects the new order.
* **AC 3:** The items consistently appear in the new order in the list view.
* **AC 4:** The new list event version replaces the old one locally and is marked as unpublished, ready for synchronization.

---

**CORE-STORY-009: NIP-51 Compliance (Constraint)**

* **As a developer implementing list features, I want** the application to create and modify list events strictly adhering to NIP-51 tag conventions for standard types **so that** the lists are interoperable with other compatible clients [cite: NFR-07].
* **AC 1:** List events use recognized kinds (e.g., 30001, 30003). (A dedicated kind like 30005 for NIP-05 lists is considered custom).
* **AC 2:** List identifiers are stored in immutable `d` tags (generated slug). List display names are stored in mutable `title` tags.
* **AC 3:** Profile references use `p` tags with hex pubkeys.
* **AC 4:** Event references use `e` tags with hex event IDs (non-replaceable kinds only).
* **AC 5:** Addressable resource/list references use `a` tags with `kind:pubkey:dTag` or `kind:pubkey` format.
* **AC 6:** The custom `nip05` tag structure (`["nip05", identifier, cached_npub]`) is used exclusively for NIP-05 items within designated list kinds (e.g., `kind:30005`).

---

**CORE-STORY-010: Add NIP-05 Item**

* **As a curator, I want to** add a NIP-05 identifier (`user@domain.com`) to a designated list type (e.g., `kind:30005`) **so that** I can curate identities based on their NIP-05 address [cite: FR-17].
* **AC 1:** Given I have selected a list designated for NIP-05 identifiers (e.g., `kind:30005`), when I enter a valid NIP-05 identifier into the "add item" input, the application attempts to resolve it via the standard NIP-05 protocol.
* **AC 2:** If the initial NIP-05 resolution fails (e.g., network error, identifier not found, invalid response), an error message is displayed to the user, and the item is *not* added.
* **AC 3:** If the initial NIP-05 resolution succeeds, retrieving a valid `npub`, then a new version of the list event is created locally.
* **AC 4:** The new list event version includes a new tag: `["nip05", <nip05_identifier>, <resolved_npub>]`.
* **AC 5:** The new list event version replaces the old one locally and is marked as unpublished.
* **AC 6:** Duplicate NIP-05 identifiers are not added to the same list.

---

**CORE-STORY-011: Verify NIP-05 Item ("Sanity Check")**

* **As a curator, I want to** trigger an on-demand check for a NIP-05 item in my list **so that** I can verify if the identifier still resolves to the public key I originally associated with it [cite: FR-19].
* **AC 1:** Given a NIP-05 item is displayed in a list view, a "Check" or "Verify" button/icon is present next to it.
* **AC 2:** When I click the "Check" button, the application performs a fresh NIP-05 resolution for the identifier stored in the `nip05` tag's first element.
* **AC 3:** The application retrieves the cached `npub` stored in the `nip05` tag's second element.
* **AC 4:** The application compares the newly resolved `npub` (if successful) with the stored `npub`.
* **AC 5:** A clear status message is displayed to the user (e.g., toast, inline):
    * "Match: NIP-05 resolves to the stored public key." (if resolution successful and npubs match)
    * "Mismatch: NIP-05 resolves to [new_npub_short]. Stored was [stored_npub_short]." (if resolution successful but npubs differ)
    * "Resolution Failed: Could not resolve NIP-05 identifier." (if resolution fails)
* **AC 6:** If a mismatch occurs (AC 5b), an "Update stored npub?" action/button is presented alongside the message.

---

**CORE-STORY-012: Update NIP-05 Item (Post-Verification)**

* **As a curator, after verifying a NIP-05 item and finding a mismatch, I want to** update the stored public key associated with that item **so that** my list reflects the current NIP-05 resolution [cite: FR-19].
* **AC 1:** Given the verification process (CORE-STORY-011) resulted in a mismatch and presented an "Update stored npub?" action, when I activate this action, then a new version of the list event is created locally.
* **AC 2:** The new list event version contains the same `nip05` tag for the identifier, but the second element (the cached `npub`) is updated to the newly resolved public key obtained during the verification step.
* **AC 3:** All other tags in the list remain unchanged and in the same order relative to each other.
* **AC 4:** The new list event version replaces the old one locally and is marked as unpublished.
* **AC 5:** A confirmation message (e.g., "Stored npub updated for {nip05_identifier}") is displayed.
