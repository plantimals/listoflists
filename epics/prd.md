# Product Requirements Document: Nostr Hierarchical Curation List Manager

* **Version:** 1.6 (was 1.5, updated for NIP-05 handling and dTag/title strategy)
* **Date:** April 11, 2025
* **Author:** Gemini (as Senior Product Manager), incorporating feedback from user.
* **Status:** Draft

## 1. Introduction & Overview

This document outlines the requirements for a Nostr client application focused on **content curation**. The application allows users to create, manage, and browse hierarchically structured lists of Nostr entities[cite: 245]. These entities include pointers to user profiles (`npub`), specific non-replaceable events (`note1...`/`nevent1...`), other addressable Nostr resources like long-form content or other lists (`naddr1...`), and **NIP-05 identifiers** (`user@domain.com`)[cite: 246]. The application functions by creating and navigating structured repositories of curated Nostr content pointers[cite: 247]. The core concept is analogous to OPML subscription lists for RSS feeds but instantiated within the Nostr protocol (primarily leveraging NIP-51 list constructs like `kind:30001` or `kind:30003`, and potentially a custom kind like `30005` for NIP-05 pointers)[cite: 248]. It enables users to organize their interests, follow specific creators or topics in a structured way, discover lists curated by others, and embed links to external lists within their own hierarchy[cite: 249]. Hierarchy is achieved *purely by nesting lists within lists*[cite: 250]. This tool aims to provide a powerful way to filter the signal from the noise and build personalized, durable information streams on Nostr, adhering to a **local-first** ethos[cite: 250, 257].

## 2. Goals & Objectives

* **Enable Structured Curation:** Allow users to create and manage deeply nested hierarchical lists containing references to Nostr profiles, specific events, addressable content/**other lists**, and NIP-05 identifiers[cite: 251].
* **Facilitate Content Discovery:** Provide mechanisms for users to browse their curated lists and discover relevant public lists curated by others, primarily via profile inspection[cite: 252].
* **Promote Interoperability:** Allow users to **link to and incorporate** lists created by others into their own curation structure via direct references[cite: 253]. (Note: Custom NIP-05 handling may limit interoperability for that specific list type).
* **Enhance Content Consumption:** Serve as a starting point for consuming Nostr content by providing easy access (viewing) to the profiles, events, or resources linked within the lists, including aggregated views[cite: 254].
* **Foster Personalized Information Streams:** Empower users to build and maintain their own tailored views of the Nostr ecosystem, moving beyond ephemeral timelines[cite: 255].
* **Support a "Republic of Letters":** Provide tooling that encourages thoughtful curation and sharing of valuable content and creators, akin to the role RSS/blogs played previously[cite: 256].
* **Embrace Local-First:** Ensure the application prioritizes local data storage and usability, functioning well even with intermittent connectivity[cite: 257].
* **Enable Value Exchange:** Integrate Nostr's value layer (Zaps) to allow users to support list and content creators[cite: 258].

## 3. Problem Statement / Motivation

* Nostr offers a decentralized communication substrate but lacks standardized, user-friendly tools for sophisticated content **curation and organization** beyond simple following or chronological timelines[cite: 259].
* Discovering and consistently following specific authors, topics, or noteworthy events across the vast Nostr network is challenging[cite: 260]. Information overload is common[cite: 261].
* There is no widely adopted equivalent to OPML for sharing and aggregating structured lists of Nostr resources, hindering the discovery of curated content streams[cite: 261]. Handling dynamic pointers like NIP-05 identifiers efficiently within static lists presents challenges.
* Users seeking alternatives to corporate media and hype-driven social platforms need tools to build durable, personalized connections with creators and ideas they value[cite: 262].
* Mobile users need effective ways to interact with Nostr applications requiring signing capabilities, which NIP-07 browser extensions often don't provide[cite: 263].
This application aims to provide the necessary tooling for structured curation on Nostr, addressing the need for better organization, discovery, aggregation, and value exchange, while supporting mobile users, prioritizing local data, and offering a pragmatic solution for handling NIP-05 identifiers[cite: 264].

## 4. Target Audience / Users

* Individuals seeking curated, high-signal information streams from the Nostr network[cite: 265].
* Users overwhelmed by noise on mainstream social media and default Nostr timelines[cite: 266].
* "Curators," researchers, and power users who want to organize and potentially share lists of interesting Nostr profiles, events, articles, NIP-05 identifiers, or other resources[cite: 267].
* People interested in building and following topic-specific or creator-focused collections, analogous to RSS feed collections[cite: 268].
* Proponents of a decentralized "republic of letters" seeking tools to foster intellectual exchange and discovery[cite: 269].
* **Mobile users** needing to interact with Nostr signing prompts via protocols like NIP-46[cite: 270].

## 5. Proposed Solution & Workflow

The application will function as a Nostr client specializing in list management and Browse, prioritizing local data:

1.  **Authentication & Signing:** User authenticates/signs actions via **NIP-07** (browser extension) or **NIP-46** (remote signing, e.g., via Amber on mobile) to save/load their lists[cite: 271]. Relays used are determined by the signing provider or defaults[cite: 272].
2.  **Local-First Data:** User's created lists, fetched external lists, profiles, and event content are **cached locally** (using Dexie/IndexedDB)[cite: 273]. Synchronization with Nostr relays occurs for publishing updates and fetching new data[cite: 274]. The app remains usable (for viewing cached data) offline[cite: 275].
3.  **List Creation & Management:**
    * Users can create new lists. They provide a **title** which becomes the initial `title` tag (display name)[cite: 275].
    * The application generates a slugified, **immutable `d` tag** (identifier) from the initial title and checks for *local uniqueness* before saving[cite: 275].
    * Users add items via a single input field that accepts `npub`, `note1...`/`nevent1...`, or `naddr1...` identifiers[cite: 276]. The app auto-detects the type and adds the corresponding item (`p`, `e`, or `a` tag) after validation (e.g., non-replaceable check for events)[cite: 277].
    * Users can add NIP-05 identifiers (`user@domain.com`) to specific list kinds (e.g., `kind:30005`). The app resolves the identifier once upon addition, stores it with the resolved `npub` in a custom `nip05` tag (`["nip05", identifier, resolved_npub]`), and rejects addition if initial resolution fails.
    * Hierarchy is achieved by adding an `a` tag item pointing to another list (`naddr1...`)[cite: 278].
    * Editing includes renaming lists (updates **only** the `title` tag), reordering items, deleting items/lists[cite: 279].
4.  **Display & Navigation:**
    * Displays lists in a hierarchical tree view. Users can expand/collapse nested lists[cite: 280].
    * Leaf nodes display identifying information: primarily display names (`title` tag, falling back to `d` tag; `kind:0` names, falling back to shortened `npub`); event snippets/IDs; resource identifiers[cite: 281].
    * NIP-05 items display the `user@domain.com` identifier directly.
5.  **Profile Viewing & List Discovery:**
    * Clicking a profile item (`npub`) opens a dedicated profile view (fetching `kind:0`)[cite: 282].
    * This view queries relays for the profile owner's **public lists** (`kind:30001` etc.)[cite: 283].
    * Discovered lists are displayed, allowing the current user to add a *link* (`a` tag item) to one of their own lists[cite: 284].
6.  **Recursive List Resolution:** Fetches and renders linked lists inline, detects cycles[cite: 285].
7.  **Content Interaction:** Clicking items triggers actions: View profile, view event, view resource, navigate linked list[cite: 286]. NIP-05 items have a "Check" button.
8.  **NIP-05 Verification:** Clicking "Check" on a NIP-05 item triggers re-resolution, compares the result to the cached `npub`, displays status (Match/Mismatch/Fail), and allows updating the cached `npub` on mismatch.
9.  **Aggregated View:** Offers a combined "feed" view of all content items (events, articles, etc.) within a selected list and its nested children[cite: 287].
10. **Zapping:** Allows users to initiate zaps to creators referenced in lists[cite: 288].

## 6. Functional Requirements (FR)

| ID    | Requirement                                                                                                                                                                           | Priority  | Notes                                                                                                                                                                                                                                                               |
| :---- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :-------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| FR-01 | **Multi-Signer Support:** Allow users to authenticate and sign events via **NIP-07** (browser extensions) AND **NIP-46** (remote signing)[cite: 294].                                             | Must Have | Crucial for desktop and mobile usability. App uses relays provided by signer[cite: 295].                                                                                                                                                                                  |
| FR-02 | **List Creation/Persistence:** Users provide a **title**. App generates an immutable, slugified **`d` tag** (identifier), checks for local uniqueness (kind+pubkey+dTag), saves as Nostr event (e.g., `kind:30001`) with both `d` (slug) and `title` (input) tags[cite: 296]. | Must Have | Core creation. Uses immutable `d` tag for identification, mutable `title` for display. Local uniqueness check prevents conflicting identifiers in the user's local store[cite: 297].                                                                                     |
| FR-03 | **Hierarchical Nesting via Links:** Hierarchy is achieved *exclusively* by adding `a` tag items within a list that reference the `naddr` of other lists[cite: 298].                                | Must Have | Defines nesting mechanism[cite: 299].                                                                                                                                                                                                                                   |
| FR-04 | **Add List Item (Standard Types):** Provide a single input field. App parses input (`npub`, `note1`/`nevent1`, `naddr1`), validates (non-replaceable event check), adds correct tag (`p`, `e`, `a`)[cite: 300, 301]. | Must Have | Streamlines user input. Handles profiles, events, and addressable resources/list links[cite: 302]. (NIP-05 handled by FR-17).                                                                                                                                          |
| FR-05 | **List Item/Name Management:** Allow users to **rename** lists (updates **only** the `title` tag), reorder items within a list, and delete items/lists[cite: 303].                             | Must Have | Standard editing capabilities[cite: 304]. `d` tag remains immutable after creation.                                                                                                                                                                                           |
| FR-06 | **Hierarchical Display:** Render lists and nested structure (including resolved external lists) in an intuitive tree view. Use display names (`title` tag, `kind:0` name, falling back to `d` tag/`npub`)[cite: 305]. | Must Have | Core UI[cite: 306]. (NIP-05 display handled by FR-18).                                                                                                                                                                                                          |
| FR-07 | **Recursive List Resolution:** When encountering a linked list item (`a` tag to list `naddr`), fetch and display its contents inline[cite: 307]. Cache fetched lists locally[cite: 308].                          | Must Have | Essential for viewing aggregated lists[cite: 307].                                                                                                                                                                                                                |
| FR-08 | **Cycle Detection:** Prevent infinite loops during recursive list resolution by detecting circular references. Report detected cycles clearly[cite: 309].                                             | Must Have | Critical for stability[cite: 310].                                                                                                                                                                                                                                |
| FR-09 | **Leaf Node Actions (Standard):** Clicking standard items triggers actions: view profile (`kind:0`), view event (`kind:1`, etc.), view resource (`kind:30023`), or navigate linked list (`kind:30001`)[cite: 311]. | Must Have | Makes list actionable[cite: 312]. (NIP-05 actions handled by FR-19).                                                                                                                                                                                            |
| FR-10 | **Profile Viewing & List Discovery:** Implement profile view triggered from `npub` items. View fetches `kind:0` AND user's public lists (`kind:30001` etc.)[cite: 313, 314].                              | Must Have | Core discovery mechanism[cite: 314].                                                                                                                                                                                                                              |
| FR-11 | **Add Discovered List:** Within profile view, allow easily adding a *link* (`a` tag item) referencing a discovered public list to the current user's chosen list[cite: 315].                          | Must Have | Closes the discovery -> curation loop[cite: 316].                                                                                                                                                                                                                   |
| FR-12 | **Local Data Persistence:** Store user's lists, cached external lists, profiles, events in local storage (Dexie/IndexedDB)[cite: 317].                                                               | Must Have | Core to local-first[cite: 318].                                                                                                                                                                                                                                 |
| FR-13 | **Background Sync:** Synchronize local list changes with Nostr relays when online. Fetch updates to linked external lists periodically or on demand[cite: 319].                                         | Should Have | Supports local-first model[cite: 319]. Conflict resolution strategy needed (see Open Questions)[cite: 320].                                                                                                                                                         |
| FR-14 | **Aggregated Feed View:** Provide a view that aggregates all content items (events, articles referenced by `naddr`) from a selected list and its resolved sub-lists into a single feed[cite: 321].     | Must Have | Key feature for consumption, similar to RSS readers[cite: 322].                                                                                                                                                                                                           |
| FR-15 | **Zap Integration:** Allow initiating zaps (`kind:9735`) to creators (identified via `p` or `a` tags with associated profiles) found within lists[cite: 323].                                        | Should Have | Basic zap functionality first[cite: 324].                                                                                                                                                                                                                           |
| FR-16 | **Proportional Zapping Config (V2):** Explore allowing list creators to specify zap percentages (via custom tags?) to split zaps between themselves and listed creators[cite: 325].                   | Could Have | Complex V2 feature. Requires defining non-standard tags[cite: 326].                                                                                                                                                                                                    |
| FR-17 | **Add NIP-05 Item:** Allow adding NIP-05 identifiers (`user@domain.com`) to compatible lists (e.g., `kind:30005`). Perform initial NIP-05 resolution. If successful, store custom `["nip05", identifier, resolved_npub]` tag. Reject add if initial resolution fails. | Should Have | Enables curation of NIP-05 identities with initial verification.                                                                                                                                                                                                  |
| FR-18 | **Display NIP-05 Item:** In list view, display the NIP-05 identifier string (`user@domain.com`) directly for `nip05` tag items. Include a "Check" button.                                        | Should Have | Provides fast display without on-read resolution cost.                                                                                                                                                                                                               |
| FR-19 | **Verify NIP-05 Item ("Sanity Check"):** Clicking "Check" button triggers NIP-05 re-resolution, compares result to cached `npub`, displays status (Match/Mismatch/Fail), and offers option to update cached `npub` on mismatch. | Should Have | Allows on-demand verification and correction of potentially outdated NIP-05 pointers.                                                                                                                                                                    |

## 7. Non-Functional Requirements (NFR)

| ID     | Requirement                    | Details                                                                                                                                                                                                                                                                                                                 |
| :----- | :----------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NFR-01 | **Local-First:** | **Prioritize local data storage.** App must be usable for Browse/managing cached lists offline[cite: 332]. Sync with network opportunistically[cite: 333].                                                                                                                                                                                |
| NFR-02 | **Performance:** | Fetching, parsing, rendering, local storage ops must be performant, especially with deep nesting/recursion[cite: 334]. NIP-05 resolution for verification should not block UI excessively. Lazy loading crucial[cite: 334].                                                                                                      |
| NFR-03 | **Usability:** | Interface for managing nested lists must be highly intuitive[cite: 335]. Profile view, discovery flow, aggregated feed must be clear[cite: 335]. NIP-05 verification results must be clear and actionable. Command palette (if implemented) should be intuitive[cite: 336].                                                            |
| NFR-04 | **Scalability:** | Handle lists with significant depth/breadth and many items without performance degradation[cite: 336].                                                                                                                                                                                                                           |
| NFR-05 | **Reliability:** | Accurately save/load/sync lists. Robust handling of errors (relay, signing, parsing, cycles, offline, sync conflicts, NIP-05 resolution failures)[cite: 337].                                                                                                                                                                   |
| NFR-06 | **Security:** | Secure handling of private keys via NIP-07/NIP-46[cite: 338]. Clear user consent for signing actions[cite: 338].                                                                                                                                                                                                                     |
| NFR-07 | **Interoperability:** | Adhere closely to NIP-51 standards for standard list events[cite: 339]. Acknowledge that custom NIP-05 kind/tags (`kind:30005`, `nip05` tag) limit interoperability for that specific feature.                                                                                                                                 |
| NFR-08 | **Resource Usage:** | Efficient use of local storage, memory, CPU[cite: 340].                                                                                                                                                                                                                                                                         |
| NFR-09 | **Design Quality & Consistency** | **The user interface must prioritize clarity, efficiency, and visual consistency.** Implementation should adhere to established design guidelines heavily influenced by the principles of "Refactoring UI" (e.g., spacing, hierarchy, color) and Edward Tufte (e.g., data-ink ratio, minimizing chartjunk) to ensure a professional and highly usable experience[cite: 341, 342]. Detailed guidelines should be maintained separately (e.g., in a Style Guide or Design System document)[cite: 343]. |

## 8. Technology Stack (Current)

Acknowledging that development is underway, the current technology stack includes:
* **Framework:** Svelte / SvelteKit
* **Nostr Libraries:** NDK (Nostr Development Kit) primary, `nostr-tools` utility dependency[cite: 344].
* **Styling:** Tailwind CSS, DaisyUI [cite: 345]
* **Local Storage:** Dexie.js (IndexedDB wrapper) [cite: 345]
* **Icons:** svelte-hero-icons

## 9. Success Metrics / KPIs

* **Curation Activity:** Lists created, items per list (including NIP-05 items), nesting depth via list links[cite: 346].
* **Discovery/Linking:** Frequency of adding links via profile discovery (FR-11)[cite: 346]. Resolution success rate.
* **Feature Usage:** NIP-46 vs NIP-07 usage[cite: 347]. Profile viewer usage[cite: 347]. Aggregated Feed view usage[cite: 347]. Zap initiation frequency[cite: 347]. NIP-05 "Check" button usage and update frequency.
* **User Retention & Feedback:** Value for curation, discovery, offline use, mobile experience, aggregation, zapping, NIP-05 handling[cite: 348].
* **Performance Benchmarks:** Load/render times, sync times, local storage usage, cycle detection performance[cite: 349]. NIP-05 verification time.
* **Offline Usage:** Frequency/duration of app usage while offline (if measurable)[cite: 350].

## 10. Open Questions & Future Considerations

* **Optimal UX for Nesting:** Needs discovery. Is tree view sufficient? Is drag-and-drop needed/viable? Consider graph view visualizations? [cite: 351]
* **NIP-05 List Kind:** Confirm if `kind:30005` is appropriate or if adding `nip05` tags to existing list kinds (e.g., 30001/30003) is preferable. Document final choice.
* **NIP-05 Resolution Library/Endpoint:** Choose and document the method used for NIP-05 resolution.
* **Advanced Discovery (V2+):** Beyond profile viewing - consider social graph analysis (e.g., follow lists), web-of-trust metrics, relay search by kind, indexer integration[cite: 352].
* **Sync Conflict Resolution:** Define strategy: CRDTs? Simple merge? User prompt on conflict (e.g., if external update clobbers local change)? [cite: 353]
* **Metadata for List Items (Standard Types):** NIP-51 lacks standard support. A non-standard approach (e.g., extra tag at end of item's tag array) could be used internally but lacks interoperability[cite: 354]. Document chosen approach if used[cite: 355].
* **Max Recursion Depth:** Implement a default limit (e.g., 10-20) for fetching linked lists[cite: 355]. Consider making it user-configurable[cite: 356].
* **Non-Public Lists:** Support is desired. Implementation requires thought (encryption? NIP-04 DMs containing list data?). Mark as future scope[cite: 356].
* **Multi-User Lists:** Currently limited by Nostr protocol capabilities for shared write access. Future scope[cite: 357].
* **Outbox Model (NIP-65):** (Stretch Goal / V2) Could potentially leverage NIP-65 relay lists for more targeted/efficient fetching[cite: 358].
* **Import/Export:** OPML or other formats (V2+)? [cite: 359] Support for the custom NIP-05 list format?

## 11. Out of Scope (for V1)

* Advanced list discovery (automated search, recommendations)[cite: 359].
* Complex sync conflict resolution UI (beyond basic detection/simple merge/prompt)[cite: 360].
* Real-time updates *within* viewed content[cite: 360].
* Complex sharing / multi-user collaboration on lists[cite: 361].
* Import/Export formats[cite: 361].
* Full-text search within curated list content[cite: 361].
* Proportional zapping configuration (FR-16)[cite: 362]. Basic zaps (FR-15) are Should Have.
