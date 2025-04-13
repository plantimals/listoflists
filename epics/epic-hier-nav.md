# EPIC-HIER-NAV: Hierarchical Browse & Navigation

*This Epic focuses on the user experience of viewing and navigating the potentially complex, nested list structures.*

---

**HIER-STORY-001: Hierarchical Tree Display**

* **As a user, I want to** view my lists presented in an intuitive hierarchical tree structure **so that** I can easily understand the organization and relationships between lists [cite: FR-06].
* **AC 1:** Given I have loaded my lists, when the main view renders, then the lists are displayed using indentation to show nesting levels, displaying the `title` tag.
* **AC 2:** Linked lists (`a` tag items pointing to lists) are displayed as expandable/collapsible nodes within the parent list.
* **AC 3:** Visual cues (e.g., connector lines, icons) are used to clarify parent-child relationships in the tree.
* **AC 4:** The display remains clear and readable even with multiple levels of nesting (within performance/scalability limits) [cite: NFR-03].
* **AC 5:** Visual hierarchy between levels uses distinct indentation combined with subtle visual cues (e.g., background variations on hover/selection) rather than heavy borders [RefUI: Layout, Borders].
* **AC 6:** Vertical spacing between tree nodes and between items within a node follows the established consistent spacing system (e.g., 4px/8px increments) [RefUI: Spacing].
* **AC 7:** The tree view maximizes the 'data-ink ratio' by minimizing non-functional visual elements ('chartjunk'), focusing attention on the list structure and item content [Tufte: Data-Ink].

---

**HIER-STORY-002: Display User-Friendly Names (Profiles)**

* **As a user, I want** list items representing profiles (`p` tags) to display user-friendly names **so that** I can easily identify people without needing to decode `npub` identifiers [cite: FR-06].
* **AC 1:** Given a profile item (`p` tag) is displayed in a list, when the user's profile (`kind:0`) data is available locally, then the profile's `displayName` or `name` is shown.
* **AC 2:** If the profile name is not available, a shortened `npub` identifier is displayed as a fallback.
* **AC 3:** Raw `pubkey` strings are never displayed directly for profile items in the list view.
* **AC 4:** Displaying the name is performant and doesn't significantly slow down list rendering [cite: NFR-02].
* **AC 5:** Profile names (primary info) have greater visual weight (e.g., standard font weight) than fallback `npub` identifiers (secondary info, potentially slightly smaller or lighter weight) [RefUI: Hierarchy].
* **AC 6:** Fallback `npub` identifiers use a muted color (e.g., a mid-gray from the palette) to de-emphasize them compared to profile names [RefUI: Hierarchy, Color].

---

**HIER-STORY-003: Display Event/Resource Info Snippets**

* **As a user, I want** list items representing standard events (`e` tags) or resources (`a` tags, non-list) to show relevant identifying information **so that** I can get a preview or understand what the item represents [cite: FR-06, Section 5.4].
* **AC 1:** Given an event item (`e` tag) is displayed, when its content is available locally, then a snippet of the event content is shown.
* **AC 2:** If event content is not cached, the event ID (shortened `note1...` or hex) is displayed.
* **AC 3:** Given a resource item (`a` tag, non-list) is displayed, identifying information (e.g., `d` tag from the resource's event, or the `naddr` itself) is shown.
* **AC 4:** Event/Resource snippets prioritize displaying key content information efficiently, avoiding excessive labels or containers [Tufte: Clarity, Data-Ink].

---

**HIER-STORY-004: Display Resolved External Lists**

* **As a user Browse lists, I want** linked external lists fetched (via sync) and cached locally to be displayed inline within the hierarchy **so that** I can view aggregated content seamlessly [cite: FR-07].
* **AC 1:** Given a list contains an `a` tag link to another list, when the linked list's event data is available locally, its items and nested structure are rendered beneath the link item upon expansion.
* **AC 2:** If the linked list's data is not yet cached locally, a loading indicator or placeholder is shown upon attempting expansion.
* **AC 3:** The application correctly handles multiple levels of recursive list resolution (up to the defined limit) [cite: NFR-04].
* **AC 4:** Resolution and rendering of nested lists are performant [cite: NFR-02].

---

**HIER-STORY-005: Handle Circular References**

* **As a user Browse lists, I want** the application to detect and clearly indicate circular list references **so that** the application doesn't hang or crash, and I understand the structure [cite: FR-08].
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
* **AC 5:** The clickable area for expanding/collapsing is sufficiently large for easy interaction on both desktop and mobile [RefUI: Forms/Target Size].

---

**HIER-STORY-010: Intuitive Navigation (Constraint)**

* **As a user, I want** the overall hierarchical Browse interface to be intuitive and easy to understand **so that** I can navigate my curated content efficiently without confusion [cite: NFR-03].
* **AC 1:** Visual hierarchy is clear through indentation and/or connector lines.
* **AC 2:** Expand/collapse controls are easily discoverable and operate predictably.
* **AC 3:** Clickable actions on list items are clearly indicated.
* **AC 4:** Users can easily distinguish between different item types (profile, event, resource, list link, NIP-05 identifier).
* **AC 5:** Clickable list items use subtle hover/active states (e.g., background color change) consistent with the application's interactive elements [RefUI: Depth/Interaction].
* **AC 6:** Borders used for separating items (if any) are subtle and use a light gray from the defined palette [RefUI: Borders].
* **AC 7:** UI elements prioritize conveying information clearly and efficiently, minimizing purely decorative aspects [Tufte: Data-Ink, Clarity].

---

**HIER-STORY-012: Display NIP-05 Item** (New Story)

* **As a user Browse lists, I want** items representing NIP-05 identifiers to display the identifier string directly and include a verification button **so that** I can easily see the curated identifier and check its current status on demand [cite: FR-18].
* **AC 1:** Given a list item corresponds to a `nip05` tag (`["nip05", identifier, cached_npub]`), the UI displays the identifier string (e.g., `user@domain.com`).
* **AC 2:** The displayed identifier string is clearly distinguishable from other item types (e.g., via an icon or label).
* **AC 3:** A distinct "Check" or "Verify" button/icon is displayed adjacent to the NIP-05 identifier item.
* **AC 4:** Displaying the identifier is performant and does not require NIP-05 resolution [cite: NFR-02].

---

**HIER-STORY-013: Command Palette Navigation** (Renumbered from HIER-STORY-011)

* **As a user, I want to** open a command palette (e.g., via keyboard shortcut) and type to quickly search for and navigate to lists, profiles, or content **so that** I can efficiently jump between different parts of my curated information without relying solely on the visual tree [cite: NFR-03].
* **AC 1:** A specific keyboard shortcut (e.g., Ctrl+K / Cmd+K) activates the command palette overlay.
* **AC 2:** The palette presents an input field for typing search queries.
* **AC 3:** As I type, a list of matching results appears below the input field, dynamically filtering based on the query.
* **AC 4:** Matching logic searches across:
    * List display names (`title` tags) or identifiers (`d` tags).
    * Profile display names (`kind:0`) or `npub` identifiers.
    * (Optional V2) Addressable resource titles (e.g., `d` tag of `kind:30023` long-form posts).
    * (Optional V2) NIP-05 identifiers stored in lists.
* **AC 5:** Each result clearly indicates the item type (list, profile, resource, NIP-05) and its name/identifier.
* **AC 6:** Selecting a result using keyboard (Enter) or mouse click dismisses the palette and navigates the main view to the selected item (e.g., highlighting the list in the tree, opening the profile view, displaying the resource).
* **AC 7:** Pressing the Escape key dismisses the command palette without taking action.
* **AC 8:** The search and display are performant, providing results quickly even with a large local dataset [cite: NFR-02].

### HIER-STORY-014: Render Markdown Content

* **As a user,** I want the application to render Markdown-formatted content using `markdown-it` in event and resource views **so that** I can read articles and notes with proper formatting.

**Acceptance Criteria:**

* Given an event's `content` is Markdown, when the event is displayed in `ResourceViewModal` or `EventViewModal`, then the Markdown is rendered as HTML using the `markdown-it` library.
* The rendered HTML is styled using the `@tailwindcss/typography` plugin to ensure readability and consistent design.
* The solution handles common Markdown elements (headings, paragraphs, lists, links, blockquotes, code blocks).
* The original text content is still visible if Markdown rendering fails or is not applicable.

**Notes:**

* Implement using the `markdown-it` library for parsing.
* Ensure the `@tailwindcss/typography` plugin is configured and applied to the container rendering the HTML.

---
