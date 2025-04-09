# Product Requirements Document: Nostr Hierarchical Curation List Manager

* **Version:** 1.5 (was 1.4, updated based on user feedback)
* **Date:** April 9, 2025
* **Author:** Gemini (as Senior Product Manager), incorporating feedback from user.
* **Status:** Draft

## 1. Introduction & Overview

This document outlines the requirements for a Nostr client application focused on **content curation**. The application allows users to create, manage, and browse hierarchically structured lists of Nostr entities. These entities include pointers to user profiles (`npub`), specific non-replaceable events (`note1...`/`nevent1...`), and other addressable Nostr resources like long-form content or **other lists** (`naddr1...`). The application functions by creating and navigating structured repositories of curated Nostr content pointers.

The core concept is analogous to OPML subscription lists for RSS feeds but instantiated within the Nostr protocol (likely leveraging NIP-51 list constructs like `kind:30001`). It enables users to organize their interests, follow specific creators or topics in a structured way, discover lists curated by others, and embed links to external lists within their own hierarchy. Hierarchy is achieved *purely by nesting lists within lists*. This tool aims to provide a powerful way to filter the signal from the noise and build personalized, durable information streams on Nostr, adhering to a **local-first** ethos.

## 2. Goals & Objectives

* **Enable Structured Curation:** Allow users to create and manage deeply nested hierarchical lists containing references to Nostr profiles, specific events, and addressable content/**other lists**.
* **Facilitate Content Discovery:** Provide mechanisms for users to browse their curated lists and discover relevant public lists curated by others, primarily via profile inspection.
* **Promote Interoperability:** Allow users to **link to and incorporate** lists created by others into their own curation structure via direct references.
* **Enhance Content Consumption:** Serve as a starting point for consuming Nostr content by providing easy access (viewing) to the profiles, events, or resources linked within the lists, including aggregated views.
* **Foster Personalized Information Streams:** Empower users to build and maintain their own tailored views of the Nostr ecosystem, moving beyond ephemeral timelines.
* **Support a "Republic of Letters":** Provide tooling that encourages thoughtful curation and sharing of valuable content and creators, akin to the role RSS/blogs played previously.
* **Embrace Local-First:** Ensure the application prioritizes local data storage and usability, functioning well even with intermittent connectivity.
* **Enable Value Exchange:** Integrate Nostr's value layer (Zaps) to allow users to support list and content creators.

## 3. Problem Statement / Motivation

* Nostr offers a decentralized communication substrate but lacks standardized, user-friendly tools for sophisticated content **curation and organization** beyond simple following or chronological timelines.
* Discovering and consistently following specific authors, topics, or noteworthy events across the vast Nostr network is challenging. Information overload is common.
* There is no widely adopted equivalent to OPML for sharing and aggregating structured lists of Nostr resources, hindering the discovery of curated content streams.
* Users seeking alternatives to corporate media and hype-driven social platforms need tools to build durable, personalized connections with creators and ideas they value.
* Mobile users need effective ways to interact with Nostr applications requiring signing capabilities, which NIP-07 browser extensions often don't provide.

This application aims to provide the necessary tooling for structured curation on Nostr, addressing the need for better organization, discovery, aggregation, and value exchange, while supporting mobile users and prioritizing local data.

## 4. Target Audience / Users

* Individuals seeking curated, high-signal information streams from the Nostr network.
* Users overwhelmed by noise on mainstream social media and default Nostr timelines.
* "Curators," researchers, and power users who want to organize and potentially share lists of interesting Nostr profiles, events, articles, or other resources.
* People interested in building and following topic-specific or creator-focused collections, analogous to RSS feed collections.
* Proponents of a decentralized "republic of letters" seeking tools to foster intellectual exchange and discovery.
* **Mobile users** needing to interact with Nostr signing prompts via protocols like NIP-46.

## 5. Proposed Solution & Workflow

The application will function as a Nostr client specializing in list management and browsing, prioritizing local data:

1.  **Authentication & Signing:** User authenticates/signs actions via **NIP-07** (browser extension) or **NIP-46** (remote signing, e.g., via Amber on mobile) to save/load their lists. Relays used are determined by the signing provider or defaults.
2.  **Local-First Data:** User's created lists, fetched external lists, profiles, and event content are **cached locally** (using Dexie/IndexedDB). Synchronization with Nostr relays occurs for publishing updates and fetching new data. The app remains usable (for viewing cached data) offline.
3.  **List Creation & Management:**
    * Users can create new lists (root nodes or nested items).
    * Users add items via a single input field that accepts `npub`, `note1...`/`nevent1...`, or `naddr1...` identifiers. The app auto-detects the type and adds the corresponding item (`p`, `e`, or `a` tag) after validation (e.g., non-replaceable check for events).
    * Hierarchy is achieved by adding an `a` tag item pointing to another list (`naddr1...`).
    * Editing includes renaming lists (`d` tag/name parameter), reordering items, deleting items/lists.
4.  **Display & Navigation:**
    * Displays lists in a hierarchical tree view. Users can expand/collapse nested lists.
    * Leaf nodes display identifying information (primarily **display names** from `kind:0`, falling back to shortened `npub` if needed; event snippets/IDs; resource identifiers).
5.  **Profile Viewing & List Discovery:**
    * Clicking a profile item (`npub`) opens a dedicated profile view (fetching `kind:0`).
    * This view queries relays for the profile owner's **public lists** (`kind:30001` etc.).
    * Discovered lists are displayed, allowing the current user to add a *link* (`a` tag item) to one of their own lists.
6.  **Recursive List Resolution:** Fetches and renders linked lists inline, detects cycles.
7.  **Content Interaction:** Clicking items triggers actions: View profile, view event, view resource, navigate linked list.
8.  **Aggregated View:** Offers a combined "feed" view of all content items (events, articles, etc.) within a selected list and its nested children.
9.  **Zapping:** Allows users to initiate zaps to creators referenced in lists.

## 6. Functional Requirements (FR)

| ID    | Requirement                                                                                                                                                                              | Priority  | Notes                                                                                                                                          |
| :---- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------- | :--------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-01 | **Multi-Signer Support:** Allow users to authenticate and sign events via **NIP-07** (browser extensions) AND **NIP-46** (remote signing).                                                  | Must Have | Crucial for desktop and mobile usability. App uses relays provided by signer.                                                                  |
| FR-02 | **List Creation/Persistence:** Users can create named lists, saved as Nostr events (e.g., `kind:30001` using NIP-51 structure) associated with their pubkey.                              | Must Have | Core creation. Use `d` tag for list identifier/name.                                                                                           |
| FR-03 | **Hierarchical Nesting via Links:** Hierarchy is achieved *exclusively* by adding `a` tag items within a list that reference the `naddr` of other lists.                                    | Must Have | Defines nesting mechanism.                                                                                                                     |
| FR-04 | **Add List Item (Auto-Detect Type):** Provide a single input field for adding items. App parses input (`npub`, `note1`/`nevent1`, `naddr1`), validates (non-replaceable event check), adds correct tag (`p`, `e`, `a`). | Must Have | Streamlines user input. Handles profiles, events, and addressable resources/list links.                                             |
| FR-05 | **List Item Management:** Allow users to edit list names (`d` tag/name parameter), reorder items within a list, and delete items/lists.                                                    | Must Have | Standard editing capabilities.                                                                                                                 |
| FR-06 | **Hierarchical Display:** Render lists and nested structure (including resolved external lists) in an intuitive tree view. Use display names/npubs, not raw pubkeys.                    | Must Have | Core UI.                                                                                                                                       |
| FR-07 | **Recursive List Resolution:** When encountering a linked list item (`a` tag to list `naddr`), fetch and display its contents inline. Cache fetched lists locally.                         | Must Have | Essential for viewing aggregated lists.                                                                                                        |
| FR-08 | **Cycle Detection:** Prevent infinite loops during recursive list resolution by detecting circular references. Report detected cycles clearly.                                            | Must Have | Critical for stability.                                                                                                                        |
| FR-09 | **Leaf Node Actions:** Clicking items triggers actions: view profile (`kind:0`), view event (`kind:1`, etc.), view resource (`kind:30023`), or navigate linked list (`kind:30001`).          | Must Have | Makes list actionable.                                                                                                                         |
| FR-10 | **Profile Viewing & List Discovery:** Implement profile view triggered from `npub` items. View fetches `kind:0` AND user's public lists (`kind:30001` etc.).                              | Must Have | Core discovery mechanism.                                                                                                                      |
| FR-11 | **Add Discovered List:** Within profile view, allow easily adding a *link* (`a` tag item) referencing a discovered public list to the current user's chosen list.                        | Must Have | Closes the discovery -> curation loop.                                                                                                        |
| FR-12 | **Local Data Persistence:** Store user's lists, cached external lists, profiles, events in local storage (Dexie/IndexedDB).                                                               | Must Have | Core to local-first.                                                                                                                           |
| FR-13 | **Background Sync:** Synchronize local list changes with Nostr relays when online. Fetch updates to linked external lists periodically or on demand.                                        | Should Have | Supports local-first model. Conflict resolution strategy needed (see Open Questions).                                                               |
| FR-14 | **Aggregated Feed View:** Provide a view that aggregates all content items (events, articles referenced by `naddr`) from a selected list and its resolved sub-lists into a single feed.  | Must Have | Key feature for consumption, similar to RSS readers.                                                                                         |
| FR-15 | **Zap Integration:** Allow initiating zaps (`kind:9735`) to creators (identified via `p` or `a` tags with associated profiles) found within lists.                                       | Should Have | Basic zap functionality first.                                                                                                                 |
| FR-16 | **Proportional Zapping Config (V2):** Explore allowing list creators to specify zap percentages (via custom tags?) to split zaps between themselves and listed creators.                | Could Have | Complex V2 feature. Requires defining non-standard tags.                                                                                         |

## 7. Non-Functional Requirements (NFR)

| ID     | Requirement      | Details                                                                                                                                                                                                                                                                                                                       |
| :----- | :--------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| NFR-01 | **Local-First:** | **Prioritize local data storage.** App must be usable for browsing/managing cached lists offline. Sync with network opportunistically.                                                                                                                                                                                          |
| NFR-02 | **Performance:** | Fetching, parsing, rendering, local storage ops must be performant, especially with deep nesting/recursion. Lazy loading crucial.                                                                                                                                                                                                |
| NFR-03 | **Usability:** | Interface for managing nested lists must be highly intuitive. Profile view, discovery flow, aggregated feed must be clear.                                                                                                                                                                                                       |
| NFR-04 | **Scalability:** | Handle lists with significant depth/breadth and many items without performance degradation.                                                                                                                                                                                                                                       |
| NFR-05 | **Reliability:** | Accurately save/load/sync lists. Robust handling of errors (relay, signing, parsing, cycles, offline, sync conflicts).                                                                                                                                                                                                            |
| NFR-06 | **Security:** | Secure handling of private keys via NIP-07/NIP-46. Clear user consent for signing actions.                                                                                                                                                                                                                                        |
| NFR-07 | **Interoperability:** | Adhere closely to NIP-51 standards for list events.                                                                                                                                                                                                                                                                           |
| NFR-08 | **Resource Usage:** | Efficient use of local storage, memory, CPU.                                                                                                                                                                                                                                                                                  |
| **NFR-09** | **Design Quality & Consistency** | **The user interface must prioritize clarity, efficiency, and visual consistency. Implementation should adhere to established design guidelines heavily influenced by the principles of "Refactoring UI" (e.g., spacing, hierarchy, color) and Edward Tufte (e.g., data-ink ratio, minimizing chartjunk) to ensure a professional and highly usable experience. Detailed guidelines should be maintained separately (e.g., in a Style Guide or Design System document).** |

## 8. Technology Stack (Current)

Acknowledging that development is underway, the current technology stack includes:
* **Framework:** Svelte / SvelteKit
* **Nostr Libraries:** NDK (Nostr Development Kit) primary, `nostr-tools` utility dependency.
* **Styling:** Tailwind CSS, DaisyUI
* **Local Storage:** Dexie.js (IndexedDB wrapper)
* **Icons:** svelte-hero-icons

## 9. Success Metrics / KPIs

* **Curation Activity:** Lists created, items per list, nesting depth via list links.
* **Discovery/Linking:** Frequency of adding links via profile discovery (FR-11). Resolution success rate.
* **Feature Usage:** NIP-46 vs NIP-07 usage. Profile viewer usage. Aggregated Feed view usage. Zap initiation frequency.
* **User Retention & Feedback:** Value for curation, discovery, offline use, mobile experience, aggregation, zapping.
* **Performance Benchmarks:** Load/render times, sync times, local storage usage, cycle detection performance.
* **Offline Usage:** Frequency/duration of app usage while offline (if measurable).

## 10. Open Questions & Future Considerations

* **Optimal UX for Nesting:** Needs discovery. Is tree view sufficient? Is drag-and-drop needed/viable? Consider graph view visualizations?
* **Advanced Discovery (V2+):** Beyond profile viewing - consider social graph analysis (e.g., follow lists), web-of-trust metrics, relay search by kind, indexer integration.
* **Sync Conflict Resolution:** Define strategy: CRDTs? Simple merge? User prompt on conflict (e.g., if external update clobbers local change)?
* **Metadata for List Items:** NIP-51 lacks standard support. A non-standard approach (e.g., extra tag at end of item's tag array) could be used internally but lacks interoperability. Document chosen approach if used.
* **Max Recursion Depth:** Implement a default limit (e.g., 10-20) for fetching linked lists. Consider making it user-configurable.
* **Non-Public Lists:** Support is desired. Implementation requires thought (encryption? NIP-04 DMs containing list data?). Mark as future scope.
* **Multi-User Lists:** Currently limited by Nostr protocol capabilities for shared write access. Future scope.
* **Outbox Model (NIP-65):** (Stretch Goal / V2) Could potentially leverage NIP-65 relay lists for more targeted/efficient fetching.
* **Import/Export:** OPML or other formats (V2+)?

## 11. Out of Scope (for V1)

* Advanced list discovery (automated search, recommendations).
* Complex sync conflict resolution UI (beyond basic detection/simple merge/prompt).
* Real-time updates *within* viewed content.
* Complex sharing / multi-user collaboration on lists.
* Import/Export formats.
* Full-text search within curated list content.
* Proportional zapping configuration (FR-16). Basic zaps (FR-15) are Should Have.


