# EPIC-DISCO-AGG: Content Discovery & Aggregation

*This Epic focuses on features that help users find new lists and consume content from their curated collections efficiently.*

---

**DISCO-STORY-001: Discover Lists on Profile View**

* **As a user exploring Nostr, I want** to view a user's profile and see a list of their publicly shared curation lists **so that** I can discover new curated sources of information [cite: FR-10].
    * **AC 1:** Given I navigate to the profile view for a specific `npub`, when the view loads, then a query is initiated to fetch public NIP-51 list kinds (e.g., 30001) authored by that `npub` from relevant relays.
    * **AC 2:** Discovered public lists are displayed clearly within the profile view, showing at least the list name (derived from `d` or `title` tag).
    * **AC 3:** If no public lists are found for the user after querying, a message indicating this (e.g., "No public lists found") is displayed.
    * **AC 4:** A loading indicator is shown specifically for the list discovery section while the query is in progress.
    * **AC 5:** The display of discovered lists is clean and easy to scan [RefUI: Layout; Tufte: Clarity].

---

**DISCO-STORY-002: Add Discovered List Link**

* **As a user viewing discovered lists on someone's profile, I want** a simple action (e.g., a button) next to each list **so that** I can easily add a link to that list into my own curation structure [cite: FR-11].
    * **AC 1:** Given discovered public lists are displayed on the profile view, when I interact with a specific list entry, then an "Add Link to My List" (or similar) action/button is clearly visible and associated with that list.
    * **AC 2:** Activating the "Add Link" action prompts me to select one of my own existing lists (or potentially create a new one) as the destination for the link.
    * **AC 3:** Upon selecting a destination list, an `a` tag item, containing the `naddr` of the discovered list, is added to my chosen list locally (following CORE-STORY-004 logic) and marked for sync.
    * **AC 4:** A confirmation message (e.g., toast notification) is shown indicating the link was successfully added to the selected list.
    * **AC 5:** The "Add Link" action provides clear visual feedback during the process (e.g., button disabled state while processing).

---

**DISCO-STORY-003: Aggregated Feed View**

* **As a user, I want** an aggregated feed view for any selected list **so that** I can read through all the contained notes and articles from that list and its nested sub-lists in one place, like an RSS reader [cite: FR-14].
    * **AC 1:** Given I have selected a list in the hierarchy view, when I activate the "Aggregated View" mode/button, then the display changes to show a flat or vertically scrolling feed of content items.
    * **AC 2:** The feed includes content items derived from event (`e` tag) items and resource (`a` tag, e.g., `kind:30023`) items found within the selected list AND all recursively resolved sub-lists. Profile (`p` tag) items are excluded from this content feed.
    * **AC 3:** Items in the feed view are sorted chronologically by the original event `created_at` timestamp (e.g., newest first).
    * **AC 4:** Each feed item clearly displays its primary content (note text, article summary/link) and essential metadata (author display name, timestamp) with minimal visual clutter [Tufte: Data-Ink].
    * **AC 5:** The feed view uses clear typography and sufficient spacing between items for comfortable reading [RefUI: Typography, Spacing; Tufte: Clarity].
    * **AC 6:** A mechanism exists to easily switch back from the aggregated feed view to the hierarchical tree view for the selected list.

---

