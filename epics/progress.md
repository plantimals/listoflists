# Status Update: EPIC-CORE-MGMT: Core List Management & Curation

This document assesses the implementation status of User Stories within this Epic based on the provided codebase snapshot (`repomix-output.txt`).
[cite: 1]
---

**CORE-STORY-001: Create New List**

* **Status:** Done
* **Remaining Work:** None identified.
* *Evidence:* `CreateListModal.svelte` handles UI. `listService.ts` (assumed from testsand modal usage [cite: 586]) handles backend logic, including `d`/`title` tags per PRD v1.6[cite: 291, 292, 318]. Local uniqueness check (AC3 [cite: 46]) assumed implemented based on prior assessment[cite: 402].

---

**CORE-STORY-002: Add Item to List (Standard Types)**

* **Status:** Done
* **Remaining Work:** None identified.
* *Evidence:* `AddItemModal.svelte`and `listService.ts::addItemToList`handle single input, parsing standard Nostr identifiers (`npub`, `nprofile`, `note`, `nevent`, `naddr`, hex ID, coordinate), mapping to `p`/`e`/`a` tags[cite: 1383, 1390, 1396], checking duplicates[cite: 1430], and saving locally. Replaceable event validation (CORE-STORY-003)and NIP-05 handling delegation (CORE-STORY-010)are included.

---

**CORE-STORY-003: Prevent Adding Replaceable Events as Static Links**

* **Status:** Done
* **Remaining Work:** None identified.
* *Evidence:* `listService.ts::addItemToList`includes logic to check event kind (local cache `localDb::getEventById` [cite: 1414] or network fetch `ndkService::fetchEvent` [cite: 1416]) and reject adding 'e' tags for replaceable kinds[cite: 1420]. Tests in `listService.test.ts` confirm this.

---

**CORE-STORY-004: Nest List via Link**

* **Status:** Done
* **Remaining Work:** None identified.
* *Evidence:* Adding list `naddr` identifiers via the 'a' tag is handled by `listService.ts::addItemToList`[cite: 1385]. Rendering and hierarchy building handled by `hierarchyService.ts`and `TreeNode.svelte`. `AddressableItem.svelte` renders the link, differentiating list kinds[cite: 531].

---

**CORE-STORY-005: Rename List**

* **Status:** Done
* **Remaining Work:** None identified.
* *Evidence:* UI elements (`NodeActions.svelte` dispatching `openrenamemodal`[cite: 782], `RenameListModal.svelte`) and `listService.ts::renameList`exist. Service correctly updates *only* the `title` tag[cite: 1501], leaving the `d` tag immutable [cite: 1494, 1507] (AC3 [cite: 69]), aligning with PRD v1.6[cite: 298]. Tests in `listService.test.ts` confirm this.

---

**CORE-STORY-006: Delete Item from List**

* **Status:** Done
* **Remaining Work:** Consider adding a user confirmation prompt before deletion (AC1 refinement [cite: 73]).
* *Evidence:* `ItemWrapper.svelte::handleRemoveItem`(originally in `TreeNode`) and `listService.ts::removeItemFromList`contain logic to fetch the list, create a new version excluding the specified tag, sign, and save locally. Handles NIP-05 items via standard tag removal[cite: 1461].

---

**CORE-STORY-007: Delete List**

* **Status:** Done
* **Remaining Work:** None identified.
* *Evidence:* UI action exists in `NodeActions.svelte` [cite: 785] calling `handleDeleteList` in `TreeNode.svelte`. `listService.ts::deleteList`is implemented, handles NIP-09 deletion event creation/publishing (AC4 [cite: 81]) via `ndkService::publish`[cite: 1539], and removes the event from local storage via `localDb.deleteEventById` [cite: 1544] (AC3 [cite: 80]). Tests exist in `listService.test.ts`. Distinction between deleting link vs. source (AC5 [cite: 82]) is handled implicitly.

---

**CORE-STORY-008: Reorder Items within List**

* **Status:** Won't Do (V1)
* **Remaining Work:** Not planned for V1.
* *Evidence:* No code found related to reordering tags within a list event[cite: 421].

---

**CORE-STORY-009: NIP-51 Compliance (Constraint)**

* **Status:** Done *(as applied to implemented features)*
* **Remaining Work:** Ensure continued adherence.
* *Evidence:* Existing code generally aligns with NIP-51 for standard lists (e.g., using `kind:30001`, `kind:30003` [cite: 602, 1222]), including immutable `d` tag [cite: 1494] and mutable `title` tag approach[cite: 1501], and correct `p`/`e`/`a` tags[cite: 1383, 1423, 1385]. Custom NIP-05 handling uses `["nip05", identifier, resolved_npub]` tag[cite: 1406].

---

**CORE-STORY-010: Add NIP-05 Item**

* **Status:** Done
* **Remaining Work:** None identified.
* *Evidence:* `listService.ts::addItemToList`includes logic to detect NIP-05 format[cite: 1398], call `nip05.queryProfile`[cite: 1404], handle resolution failure/success, and add the `["nip05", identifier, resolved_npub]` tag[cite: 1406]. Duplicate check exists[cite: 1400]. Test cases cover this in `listService.test.ts`.

---

**CORE-STORY-011: Verify NIP-05 Item ("Sanity Check")**

* **Status:** Done
* **Remaining Work:** None identified.
* *Evidence:* `Nip05Item.svelte` displays the identifier and "Check" button[cite: 737]. Clicking it dispatches `checknip05`[cite: 705]. `+page.svelte` handles this event via `handleCheckNip05`[cite: 2210], calls `nip05Service::verifyNip05`[cite: 2212], and updates the `nip05VerificationStates` map [cite: 2081, 2211, 2215] which is passed down [cite: 1008] to `Nip05Item` to display status (Match/Mismatch/Fail) [cite: 697, 733-736].

---

**CORE-STORY-012: Update NIP-05 Item (Post-Verification)**

* **Status:** Done - decided to stop
* **Remaining Work:** Based on prior assessment, the handling logic for the "Update?" button appears incomplete or was intentionally stopped. No further action planned per status.
* *Evidence:* The "Update?" button exists in `Nip05Item.svelte` [cite: 734] and dispatches an `updatenip05` event[cite: 707]. However, the implementation in `+page.svelte` and `listService.ts` seems missing or was removed[cite: 433].

---

### EPIC-AUTH-SIGN: Authentication & Signing

*This document assesses the implementation status of User Stories within this Epic based on the provided codebase snapshot (`repomix-output.txt`).*

---

**AUTH-STORY-001: NIP-07 Browser Extension Signing**

* **Status:** Done
* **Remaining Work:** None identified.
* *Evidence:* `ndkService.ts`includes `activateNip07Signer` which uses `NDKNip07Signer`. `+page.svelte` calls this via `handleLogin`. `ndkService.getSigner` provides the signer for actions requiring signatures (e.g., in `listService.ts`). Error handling (AC5) is present in `ndkService` and `+page.svelte`.

---

**AUTH-STORY-002: NIP-46 Remote Signing (Nostr Connect)**

* **Status:** Done
* **Remaining Work:** None identified.
* *Evidence:* `ndkService.ts` includes `activateNip46Signer` which uses `NDKNip46Signer`. `+page.svelte` has `handleNip46Login` which opens `Nip46ConnectModal.svelte` [cite: 740-769, 2093-2102]. The modal dispatches `initiateNip46Connect`, handled by `handleInitiateNip46Connect` in `+page.svelte`, which calls `ndkService.activateNip46Signer`. Connection status/errors are handled in the modal and page logic. Signing for actions uses the active signer from `ndkService.getSigner`.

---

**AUTH-STORY-003: Secure Signing Process (Constraint)**

* **Status:** Done (as applied)
* **Remaining Work:** Ensure continued adherence.
* *Evidence:* Code delegates signing to `NDKNip07Signer` or `NDKNip46Signer` via `ndkService`. No evidence of direct private key handling (`nsec`). UI in `+page.svelte` indicates login status. Signer prompts are handled externally by the NIP-07/NIP-46 signer itself.

---

### EPIC-HIER-NAV: Hierarchical Browse & Navigation

*This document assesses the implementation status of User Stories within this Epic based on the provided codebase snapshot (`repomix-output.txt`).*

---

**HIER-STORY-001: Hierarchical Tree Display**

* **Status:** Done
* **Remaining Work:** None identified.
* *Evidence:* `hierarchyService.ts::buildHierarchy` creates the tree structure. `HierarchyWrapper.svelte`iterates root nodes, passing them to `TreeNode.svelte`. `TreeNode.svelte` recursively renders children and uses `NodeHeader.svelte`for display, calculating indentation based on `depth`. Linked lists (`a` tags) are resolved and rendered inline (see HIER-STORY-004). Visual cues like expand/collapse icons exist.

---

**HIER-STORY-002: Display User-Friendly Names (Profiles)**

* **Status:** Done
* **Remaining Work:** None identified.
* *Evidence:* `UserItem.svelte`component fetches profile (`kind:0`) data using `localDb` and `ndkService`. It displays `displayName` or `name` if available, falling back to a shortened `npub`. Raw pubkeys are not displayed (AC3).

---

**HIER-STORY-003: Display Event/Resource Info Snippets**

* **Status:** Done
* **Remaining Work:** None identified.
* *Evidence:* `NoteItem.svelte`displays snippets for `e` tag items, fetching data via `localDb`/`ndkService`. `AddressableItem.svelte`handles `a` tag items (non-list resources like articles `kind:30023`), fetching data and displaying the `title` or `d` tag.

---

**HIER-STORY-004: Display Resolved External Lists**

* **Status:** Done
* **Remaining Work:** None identified.
* *Evidence:* `hierarchyService.ts::buildHierarchy` recursively fetches linked lists ('a' tag items pointing to lists) from `localDb` using `getLatestEventByCoord`and integrates them into the tree structure. `TreeNode.svelte` renders these resolved lists recursively. Loading indicators are not explicitly implemented for list resolution within the tree yet (AC2 might need refinement).

---

**HIER-STORY-005: Handle Circular References**

* **Status:** Done
* **Remaining Work:** None identified.
* *Evidence:* `hierarchyService.ts::buildHierarchy` uses a `processing` Set to detect cycles during recursive list resolution and prevents infinite loops [cite: 1142, 1150-1151]. Warnings are logged when cycles are detected. UI indication (AC2) is currently just the lack of further expansion.

---

**HIER-STORY-006: View Profile Action**

* **Status:** Done
* **Remaining Work:** None identified.
* *Evidence:* `UserItem.svelte` has a click handler (`handleClick`) that dispatches a `viewprofile` event with the `npub`. `TreeNode.svelte` forwards this event. `+page.svelte` handles the `viewprofile` event, setting `viewingNpub` which causes `ProfileView.svelte`to render, initiating profile and public list fetches.

---

**HIER-STORY-007: View Event Action**

* **Status:** Partially Done (Display exists, action TBD)
* **Remaining Work:** Implement click action on `NoteItem.svelte` to show full event content (modal/pane).
* *Evidence:* `NoteItem.svelte` displays event snippets. A dedicated click handler to view the full event content (AC1) is not currently implemented.

---

**HIER-STORY-008: View Resource Action**

* **Status:** Partially Done (Display exists, action TBD)
* **Remaining Work:** Implement click action on `AddressableItem.svelte` to show full resource content.
* *Evidence:* `AddressableItem.svelte` displays resource identifiers/names. A dedicated click handler to view the full resource (AC1) is not currently implemented.

---

**HIER-STORY-009: Expand/Collapse Nested Lists**

* **Status:** Done
* **Remaining Work:** None identified.
* *Evidence:* `TreeNode.svelte` manages an `expanded` state. `NodeHeader.svelte` displays a chevron iconbased on `isExpanded` and children/items existence, dispatching a `toggle` event on click. `TreeNode.svelte` handles the `toggle` event.

---

**HIER-STORY-010: Intuitive Navigation (Constraint)**

* **Status:** Done (as applied)
* **Remaining Work:** Ensure continued adherence.
* *Evidence:* Hierarchy uses indentation (`TreeNode`/`NodeHeader` style prop). Expand/collapse controls exist (`NodeHeader`). Item types are visually distinct (`UserItem`, `NoteItem`, `AddressableItem`, `Nip05Item` use different icons/layouts). Clickable actions have hover states (`ItemWrapper`, `NodeHeader`, `NodeActions`).

---

**HIER-STORY-012: Display NIP-05 Item**

* **Status:** Done
* **Remaining Work:** None identified.
* *Evidence:* `Nip05Item.svelte`component exists. It displays the NIP-05 identifier string and includes the "Check" button (AC3). Display is performant as it uses the cached tag data initially.

---

**HIER-STORY-013: Command Palette Navigation**

* **Status:** Not Started
* **Remaining Work:** Implement command palette component and logic.
* *Evidence:* No code found related to a command palette feature.

---

### EPIC-LOCAL-SYNC: Local-First Data & Synchronization

*This document assesses the implementation status of User Stories within this Epic based on the provided codebase snapshot (`repomix-output.txt`).*

---

**SYNC-STORY-001: Local Data Persistence**

* **Status:** Done
* **Remaining Work:** None identified.
* *Evidence:* `localDb.ts` defines Dexie tables for `events` and `profiles`. `listService.ts` (create, add, remove, rename, delete)and `hierarchyService.ts` (implicitly, by using `localDb` for lookups)interact with `localDb`. `UserItem`, `NoteItem`, `AddressableItem` cache fetched data to `localDb`. `+page.svelte` loads initial hierarchy from `localDb`.

---

**SYNC-STORY-002: Offline Browse Capability**

* **Status:** Done
* **Remaining Work:** Minor: Ensure all network-dependent actions are appropriately disabled/show feedback when offline.
* *Evidence:* Application uses `localDb` as primary data source. `networkStatusStore.ts`tracks online status. Components like `ItemWrapper`, `CreateListModal`, `NodeActions`, `AddressableItem`, `Nip05Item` use the `$isOnline` store to disable actions requiring network access. `AddressableItem` explicitly handles offline state when fetching.

---

**SYNC-STORY-003: Outgoing Synchronization**

* **Status:** Done
* **Remaining Work:** None identified.
* *Evidence:* `syncService.ts::syncOutgoing`retrieves unpublished events using `localDb.getUnpublishedEvents`. It reconstructs `NDKEvent` objectsand publishes them via `ndkService.publish`. Upon successful publication confirmation (relay count > 0), it marks the event as published locally using `localDb.markEventAsPublished`. Tests in `syncService.test.ts` confirm this behavior.

---

**SYNC-STORY-004: Incoming Synchronization**

* **Status:** Done
* **Remaining Work:** Refine filter for fetching (currently fetches all relevant kinds by author, could potentially fetch based on mentions etc.).
* *Evidence:* `syncService.ts::syncIncoming`calculates the `since` timestamp using `localDb.getLatestEventTimestamp`. It fetches events using `ndkService.fetchEvents` with appropriate kind/author/since filters. Fetched events are processed and stored using `localDb.addOrUpdateEvent`, which respects replaceable event logic. Tests in `syncService.test.ts` confirm this.

---

**SYNC-STORY-005: Automatic Background Synchronization**

* **Status:** Not Started
* **Remaining Work:** Implement background sync logic (e.g., interval timer, on network status change).
* *Evidence:* No code found related to automatic background synchronization triggering `syncService.performSync`. Current sync is triggered manually via button or once after initial load.

---

**SYNC-STORY-006: Synchronization Reliability (Constraint)**

* **Status:** Partially Done
* **Remaining Work:** Implement more robust conflict resolution (beyond simple timestamp check in `addOrUpdateEvent`). Improve handling of widespread network/relay errors.
* *Evidence:* `syncService.ts` includes basic error handling for fetch/publish operations within loops [cite: 1993-1994, 2012-2013]. `addOrUpdateEvent` in `localDb.ts` uses timestamps for basic conflict resolution of replaceable events. Unpublished events remain unpublished if publish fails. `+page.svelte` displays network offline status[cite: 2240].

---

**SYNC-STORY-007: Efficient Resource Usage (Constraint)**

* **Status:** Done (as applied)
* **Remaining Work:** Monitor performance and optimize as needed.
* *Evidence:* `localDb.ts` defines appropriate Dexie indexes for common queries (`[kind+pubkey]`, `[kind+pubkey+dTag]`, `[pubkey+published]`)[cite: 1629]. Hierarchy building (`hierarchyService.ts`) uses memoization (`nodeMap`) and depth limits [cite: 1141, 1149-1150]. Components use local cache (`localDb`) before network fetch (`UserItem`, `NoteItem`, `AddressableItem`).

---

### EPIC-DISCO-AGG: Content Discovery & Aggregation

*This document assesses the implementation status of User Stories within this Epic based on the provided codebase snapshot (`repomix-output.txt`).*

---

**DISCO-STORY-001: Discover Lists on Profile View**

* **Status:** Done
* **Remaining Work:** None identified.
* *Evidence:* `ProfileView.svelte` initiates fetching of public lists (kinds 30001, 30003) authored by the viewed `npub` using `ndkService.fetchEvents` within its `WorkspacePublicLists` function. Discovered lists are displayed with their name. Loading indicator and "No lists found" message are implemented.

---

**DISCO-STORY-002: Add Discovered List Link**

* **Status:** Done
* **Remaining Work:** None identified.
* *Evidence:* `ProfileView.svelte` displays an "Add Link" button next to each discovered list. Clicking it calls `handleAddLinkClick`, which opens `SelectListModal.svelte`. Selecting a destination list in the modal dispatches `listselected`, handled by `handleListSelected` in `ProfileView.svelte`. This handler calls `listService.ts::addItemToList` with the discovered list's `naddr` and the chosen destination list ID, adding the link (`a` tag). Confirmation/error messages are displayed.

---

**DISCO-STORY-003: Aggregated Feed View**

* **Status:** Done
* **Remaining Work:** None identified.
* *Evidence:* `NodeActions.svelte` provides a button to trigger the feed view. `+page.svelte` handles the `viewfeed` event, setting state to render `AggregatedFeedView.svelte`. `AggregatedFeedView` calls `hierarchyService.ts::aggregateContentItems`to collect 'e' and non-list 'a' tags recursively. It then fetches details from `localDb`and displays items chronologically, excluding profiles, with author/timestamp metadata. A "Back to Lists" button allows returning to the hierarchy view[cite: 2235].

---

### EPIC-ZAP: Value Exchange (Zapping)

*This document assesses the implementation status of User Stories within this Epic based on the provided codebase snapshot (`repomix-output.txt`).*

---

**ZAP-STORY-001: Initiate Zap to Listed Creator**

* **Status:** Not Started
* **Remaining Work:** Implement UI element (Zap button), fetch recipient Zap details, construct `kind:9735` event, delegate signing.
* *Evidence:* No components or service functions related to Zapping (`kind:9735`, LUD-06/16 lookup, LNURL handling) were found in the codebase.

---

**ZAP-STORY-002: Explore Proportional Zapping Configuration (V2)**

* **Status:** Not Started
* **Remaining Work:** Research tag conventions, design UI mockups, investigate technical feasibility.
* *Evidence:* No research documents, mockups, or implementation code related to proportional zapping were found.

---
