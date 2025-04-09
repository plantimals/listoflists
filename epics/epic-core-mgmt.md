# EPIC-CORE-MGMT: Core List Management & Curation

*This Epic covers the fundamental ability for users to create, populate, and manage their curation lists.*

---

**CORE-STORY-001: Create New List**

* **As a curator, I want to** create a new named list **so that** I can start organizing Nostr content according to my interests [cite: FR-02].
    * **AC 1:** Given I am authenticated, when I initiate the "Create List" action and provide a valid name, then a new Nostr event (e.g., `kind:30001`) is created locally.
    * **AC 2:** The created list event MUST include a `d` tag containing the provided name.
    * **AC 3:** The created list event MUST include a `title` tag containing the provided name.
    * **AC 4:** The created list event is saved to local storage (Dexie) and is initially marked as unpublished.
    * **AC 5:** The new list appears as a root item or at the designated location in my list hierarchy view after creation.

---

**CORE-STORY-002: Add Item to List (Auto-Detect)**

* **As a curator, I want to** add items (profiles, events, resources, list links) to one of my lists using a single input field **so that** I can easily populate my curated collections [cite: FR-04].
    * **AC 1:** Given I have selected a list, when I enter a valid `npub` or `nprofile` identifier into the "add item" input, then a new version of the list event containing a corresponding `p` tag is saved locally.
    * **AC 2:** Given I have selected a list, when I enter a valid *non-replaceable* event identifier (`note1`, `nevent1`, or hex ID verified as non-replaceable kind) into the "add item" input, then a new version of the list event containing a corresponding `e` tag is saved locally.
    * **AC 3:** Given I have selected a list, when I enter a valid addressable resource or list identifier (`naddr1...`) into the "add item" input, then a new version of the list event containing a corresponding `a` tag is saved locally.
    * **AC 4:** Given I have selected a list, when I enter text that does not match any recognized Nostr identifier format, then an error message is displayed, and no item is added.
    * **AC 5:** Given I attempt to add an item whose type and value exactly match an item already present in the list, the item is not added again (no duplicate tags are created).

---

**CORE-STORY-003: Prevent Adding Replaceable Events as Static Links**

* **As a curator, I want** the application to prevent adding *replaceable* event IDs (`kind:0`, `kind:3`, `10000`-`19999`, `30000`-`39999`) as static 'e' tag items **so that** my list references remain stable and point to definitive content [cite: FR-04].
    * **AC 1:** Given I enter an event identifier (hex, `note1`, `nevent1`) into the "add item" input, when the application determines the event's kind is replaceable, then the item is *not* added using an `e` tag.
    * **AC 2:** When attempting to add a replaceable event ID via the 'e' tag mechanism, an informative error message is displayed explaining why it's disallowed.
    * **AC 3:** The error message *may* suggest adding parameterized replaceable events using their `naddr` identifier instead.

---

**CORE-STORY-004: Nest List via Link**

* **As a curator, I want to** add a *link* to another Nostr list (using its `naddr`) as an item within my current list **so that** I can create nested hierarchies for better organization [cite: FR-03, FR-04].
    * **AC 1:** Given I have selected a list, when I enter a valid `naddr` identifier for another list into the "add item" input, then a new version of the current list event containing an `a` tag with the `naddr` value is saved locally.
    * **AC 2:** In the hierarchy view, the item representing the linked list is visually identifiable as a nestable list (e.g., with an expand/collapse icon).
    * **AC 3:** The `a` tag format used adheres to NIP-51 conventions for referencing addressable events (`kind:pubkey:dTag`).

---

**CORE-STORY-005: Rename List**

* **As a curator, I want to** rename my lists **so that** I can update their names to accurately reflect their contents or purpose [cite: FR-05].
    * **AC 1:** Given I select one of my lists, when I initiate the "Rename" action and provide a new valid name, then a new version of the list event is created locally.
    * **AC 2:** The new list event version MUST have its `d` tag updated to the new name.
    * **AC 3:** The new list event version MUST have its `title` tag updated to the new name.
    * **AC 4:** The list appears with the new name in the hierarchy view.
    * **AC 5:** The new event version replaces the old one locally and is marked as unpublished, ready for synchronization.

---

**CORE-STORY-006: Delete Item from List**

* **As a curator, I want to** remove items from my lists **so that** I can keep my collections up-to-date and remove irrelevant content [cite: FR-05].
    * **AC 1:** Given I am viewing the items within one of my lists, when I initiate the "Delete" action for a specific item, then a confirmation prompt is shown (optional but recommended).
    * **AC 2:** Upon confirmation, a new version of the list event is created locally that excludes the tag (`p`, `e`, or `a`) corresponding to the deleted item.
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

* **As a curator, I want to** reorder items within a specific list **so that** I can arrange them according to my preferred sequence or importance [cite: FR-05].
    * **AC 1:** Given I am viewing items in one of my lists, when I use the reordering mechanism (e.g., drag-and-drop, up/down buttons), then the visual order of items changes accordingly.
    * **AC 2:** Upon saving/confirming the new order, a new version of the list event is created locally where the sequence of `p`, `e`, and `a` tags reflects the new order.
    * **AC 3:** The items consistently appear in the new order in the list view.
    * **AC 4:** The new list event version replaces the old one locally and is marked as unpublished, ready for synchronization.

---

**CORE-STORY-009: NIP-51 Compliance (Constraint)**

* **As a developer implementing list features, I want** the application to create and modify list events strictly adhering to NIP-51 tag conventions **so that** the lists are interoperable with other compatible clients [cite: NFR-07].
    * **AC 1:** List events use recognized kinds (e.g., 30001).
    * **AC 2:** List names/identifiers are stored in `d` tags (and potentially `title` tags).
    * **AC 3:** Profile references use `p` tags with hex pubkeys.
    * **AC 4:** Event references use `e` tags with hex event IDs.
    * **AC 5:** Addressable resource/list references use `a` tags with `kind:pubkey:dTag` or `kind:pubkey` format.

---
---

# EPIC-HIER-NAV: Hierarchical Browsing & Navigation

*This Epic focuses on the user experience of viewing and navigating the potentially complex, nested list structures.*

---

**HIER-STORY-001: Hierarchical Tree Display**

* **As a user, I want to** view my lists presented in an intuitive hierarchical tree structure **so that** I can easily understand the organization and relationships between lists [cite: FR-06].
    * **AC 1:** Given I have loaded my lists, when the main view renders, then the lists are displayed using indentation to show nesting levels.
    * **AC 2:** Linked lists (`a` tag items pointing to lists) are displayed as expandable/collapsible nodes within the parent list.
    * **AC 3:** Visual cues (e.g., connector lines, icons) are used to clarify parent-child relationships in the tree.
    * **AC 4:** The display remains clear and readable even with multiple levels of nesting (within performance/scalability limits) [cite: NFR-03].

---

**HIER-STORY-002: Display User-Friendly Names**

* **As a user, I want** list items representing profiles (`p` tags) to display user-friendly names **so that** I can easily identify people without needing to decode `npub` identifiers [cite: FR-06].
    * **AC 1:** Given a profile item (`p` tag) is displayed in a list, when the user's profile (`kind:0`) data is available locally, then the profile's `displayName` or `name` is shown.
    * **AC 2:** If the profile name is not available, a shortened `npub` identifier is displayed as a fallback.
    * **AC 3:** Raw `pubkey` strings are never displayed directly for profile items in the list view.
    * **AC 4:** Displaying the name is performant and doesn't significantly slow down list rendering [cite: NFR-02].

---

**HIER-STORY-003: Display Event/Resource Info Snippets**

* **As a user, I want** list items representing events (`e` tags) or resources (`a` tags) to show relevant identifying information **so that** I can get a preview or understand what the item represents [cite: FR-06, Section 5.4].
    * **AC 1:** Given an event item (`e` tag) is displayed, when its content is available locally, then a snippet of the event content is shown.
    * **AC 2:** If event content is not cached, the event ID (shortened `note1...` or hex) is displayed.
    * **AC 3:** Given a resource item (`a` tag, non-list) is displayed, identifying information (e.g., `d` tag from the resource's event, or the `naddr` itself) is shown.

---

**HIER-STORY-004: Display Resolved External Lists**

* **As a user browsing lists, I want** linked external lists fetched (via sync) and cached locally to be displayed inline within the hierarchy **so that** I can view aggregated content seamlessly [cite: FR-07].
    * **AC 1:** Given a list contains an `a` tag link to another list, when the linked list's event data is available locally, its items and nested structure are rendered beneath the link item upon expansion.
    * **AC 2:** If the linked list's data is not yet cached locally, a loading indicator or placeholder is shown upon attempting expansion.
    * **AC 3:** The application correctly handles multiple levels of recursive list resolution (up to the defined limit) [cite: NFR-04].
    * **AC 4:** Resolution and rendering of nested lists are performant [cite: NFR-02].

---

**HIER-STORY-005: Handle Circular References**

* **As a user browsing lists, I want** the application to detect and clearly indicate circular list references **so that** the application doesn't hang or crash, and I understand the structure [cite: FR-08].
    * **AC 1:** Given a list structure contains a cycle, when the application resolves the hierarchy, the recursion stops upon detecting the cycle.
    * **AC 2:** The UI clearly indicates where the cycle was detected (e.g., showing the linked list item but not expanding it further, adding an icon/message).
    * **AC 3:** The application remains responsive and does not enter an infinite loop during cycle detection or rendering.

---

**HIER-STORY-006: View Profile Action**

* **As a user, I want to** click on a profile item (`p` tag) within a list **so that** I can navigate to view that user's detailed profile information (including their public lists) [cite: FR-09, FR-10].
    * **AC 1:** Given a profile item is displayed in the list, when I click on it, the application navigates to or displays the dedicated profile view for that user's `npub`.
    * **AC 2:** The profile view is populated with the user's `kind:0` data.
    * **AC 3:** The profile view initiates the discovery of the user's public lists (as per FR-10).

---

**HIER-STORY-007: View Event Action**

* **As a user, I want to** click on an event item (`e` tag) within a list **so that** I can view the full content of that specific Nostr event [cite: FR-09].
    * **AC 1:** Given an event item is displayed in the list, when I click on it, the application displays the full content of the event (e.g., in a modal or preview pane).
    * **AC 2:** If the event content is not locally cached, an attempt is made to fetch it from relays (if online).
    * **AC 3:** The display correctly renders basic formatting or media previews if applicable.

---

**HIER-STORY-008: View Resource Action**

* **As a user, I want to** click on an addressable resource item (`a` tag, non-list) within a list **so that** I can view the associated content (e.g., long-form post) [cite: FR-09].
    * **AC 1:** Given a resource item (`a` tag for e.g., `kind:30023`) is displayed, when I click on it, the application displays the content associated with that `naddr`.
    * **AC 2:** If the resource content is not locally cached, an attempt is made to fetch it from relays (if online).

---

**HIER-STORY-009: Expand/Collapse Nested Lists**

* **As a user navigating the hierarchy, I want to** easily expand and collapse nested lists **so that** I can manage the display complexity and focus on specific sections [cite: Section 5.4].
    * **AC 1:** List items representing nested lists have a clear visual indicator (e.g., triangle icon) showing their current state (expanded/collapsed).
    * **AC 2:** Clicking the indicator toggles the display of the nested list's immediate children/items.
    * **AC 3:** The expand/collapse state is maintained during scrolling or minor UI updates.
    * **AC 4:** The action is responsive and intuitive [cite: NFR-03].

---

**HIER-STORY-010: Intuitive Navigation (Constraint)**

* **As a user, I want** the overall hierarchical browsing interface to be intuitive and easy to understand **so that** I can navigate my curated content efficiently without confusion [cite: NFR-03].
    * **AC 1:** Visual hierarchy is clear through indentation and/or connector lines.
    * **AC 2:** Expand/collapse controls are easily discoverable and operate predictably.
    * **AC 3:** Clickable actions on list items are clearly indicated.
    * **AC 4:** Users can easily distinguish between different item types (profile, event, resource, list link).

---

