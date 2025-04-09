# EPIC-LOCAL-SYNC: Local-First Data & Synchronization

*This Epic covers the core local-first architecture, ensuring data availability, offline use, and synchronization with the Nostr network.*

---

**SYNC-STORY-001: Local Data Persistence**

* **As a user, I want** all my created lists and viewed/cached content (external lists, profiles, events) stored locally in my browser **so that** the application loads quickly and I retain control over my data [cite: FR-12, NFR-01].
    * **AC 1:** Given I create or modify a list, when the action is completed, then the list event data is saved to the local database (IndexedDB via Dexie).
    * **AC 2:** Given I view a profile or event, when the data is fetched from the network or already present, then it is stored/updated in the local database.
    * **AC 3:** Given I view a linked external list, when its content is resolved, then the list event data and its items are cached in the local database.
    * **AC 4:** The application primarily reads list hierarchy, profile, and event data from the local database for display.

---

**SYNC-STORY-002: Offline Browsing Capability**

* **As a user, I want** to be able to launch the application and browse all previously viewed/synchronized lists and cached content when offline **so that** I have reliable access to my curated information anytime [cite: NFR-01].
    * **AC 1:** Given the browser is in offline mode, when I open the application, then the previously cached list hierarchy is displayed.
    * **AC 2:** Given the browser is in offline mode, when I click on a cached profile, event, or resolved list, then the locally stored content is displayed.
    * **AC 3:** Given the browser is in offline mode, when I attempt an action requiring network access (e.g., Manual Sync, Zap, fetching uncached data), then the action is disabled or an informative "Offline" message is shown.

---

**SYNC-STORY-003: Outgoing Synchronization**

* **As a curator, I want** my locally created or modified lists (marked as unpublished) to be automatically signed and published to Nostr relays when I am online **so that** my changes are saved to the network and potentially discoverable [cite: FR-13].
    * **AC 1:** Given I have local list events marked as unpublished, when a synchronization process runs (manual or automatic) and I am online, then the application attempts to publish these events to relays via the NDK service.
    * **AC 2:** Events are signed using the configured signer (NIP-07/NIP-46) before publishing.
    * **AC 3:** Upon successful publication confirmation from the NDK service (e.g., published to at least one relay), the corresponding event in the local database is marked as published (e.g., `published: true`).
    * **AC 4:** If publishing fails for an event, it remains marked as unpublished locally for a future retry.

---

**SYNC-STORY-004: Incoming Synchronization**

* **As a user, I want** the application to fetch updates to my lists and linked external lists from Nostr relays **so that** my local view stays current with changes made elsewhere [cite: FR-13].
    * **AC 1:** Given a synchronization process runs (manual or automatic) and I am online, the application queries relays for new events related to my lists (e.g., events authored by me since the last check).
    * **AC 2:** Fetched events are processed and saved/updated in the local database using the defined logic (e.g., respecting replaceable event rules based on `created_at`).
    * **AC 3:** The application uses the timestamp of the latest known local event to set the `since` filter for fetching, optimizing network requests.
    * **AC 4:** Fetching updates is performant and does not block the UI excessively [cite: NFR-02].

---

**SYNC-STORY-005: Automatic Background Synchronization**

* **As a user, I want** the application to automatically synchronize with Nostr relays periodically or when connectivity is restored **so that** my local data stays reasonably up-to-date without manual intervention [cite: FR-13 Refinement].
    * **AC 1:** Given the application detects an online status change from offline to online, when a configured cooldown period passes, then a sync process (incoming/outgoing) is automatically triggered.
    * **AC 2:** Given the application is online, it performs background sync checks at a defined interval (e.g., every 5-15 minutes).
    * **AC 3:** Background sync operations run without requiring explicit user interaction.
    * **AC 4:** Background sync has minimal impact on perceived UI performance [cite: NFR-02, NFR-08].

---

**SYNC-STORY-006: Synchronization Reliability (Constraint)**

* **As a user, I want** the synchronization process to handle network errors or relay issues robustly **so that** my local data remains consistent and usable [cite: NFR-05].
    * **AC 1:** Given a network error occurs during incoming sync, the process logs the error and completes without corrupting existing local data.
    * **AC 2:** Given a network error occurs during outgoing sync (publishing), the specific event remains marked as unpublished locally, and the error is logged.
    * **AC 3:** The application provides clear visual feedback if a manual sync fails due to widespread network/relay issues.
    * **AC 4:** (Future Refinement) Basic conflict resolution (e.g., newer network event vs local unpublished) is handled predictably according to a defined strategy.

---

**SYNC-STORY-007: Efficient Resource Usage (Constraint)**

* **As a developer/user, I want** the local storage and caching mechanisms to be efficient **so that** the application doesn't consume excessive disk space or browser resources [cite: NFR-08].
    * **AC 1:** Local database queries are optimized using appropriate indexes (as defined in `localDb.ts`).
    * **AC 2:** Data caching strategies avoid storing excessive redundant data.
    * **AC 3:** Memory usage remains reasonable even when browsing large or deeply nested lists.

---

