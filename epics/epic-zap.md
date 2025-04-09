# EPIC-ZAP: Value Exchange (Zapping)

*This Epic introduces the ability for users to send value (sats) to creators via the Nostr Zapping mechanism, integrating with the curated lists.*

---

**ZAP-STORY-001: Initiate Zap to Listed Creator**

* **As a user appreciating content or curation, I want** to be able to initiate a Zap to a creator identified within a list **so that** I can easily send them value (sats) [cite: FR-15].
    * **AC 1:** Given a list item represents a profile (`p` tag) or an event/resource (`e`/`a` tag) with an identifiable author, when the author's profile (`kind:0`) contains valid Zap details (e.g., `lud16` or `lud06`), then a Zap button/icon is displayed visibly associated with that list item.
    * **AC 2:** Clicking the Zap button fetches the necessary Zap endpoint information (e.g., LNURL) from the recipient's profile data (potentially requiring a fresh fetch if not cached).
    * **AC 3:** The application constructs a `kind:9735` zap request event, including relevant tags (e.g., `p` tag for the recipient, `e` or `a` tag referencing the zapped list item or list itself for context).
    * **AC 4:** The unsigned zap request event is passed to the user's active signer (NIP-07/NIP-46) for approval. (Note: The application itself does not handle Lightning payments; it only prepares the Nostr event for the user's wallet interaction).
    * **AC 5:** If Zap details cannot be found or retrieved for the creator associated with a list item, the Zap button is either not displayed or is shown in a disabled state.

---

**ZAP-STORY-002: Explore Proportional Zapping Configuration (V2)**

* **As a list creator or user (potentially V2), I want** to explore the possibility for lists to optionally specify zap splits **so that** value sent via the list might be shared between the curator and content creators [cite: FR-16].
    * **AC 1:** Research and document potential non-standard tag conventions (e.g., custom JSON within content, specific tag formats) suitable for embedding within a NIP-51 list event to define zap split percentages or recipient details (pubkeys/weights).
    * **AC 2:** Create UI mockups demonstrating how a list creator could potentially configure these suggested splits when creating or editing their list.
    * **AC 3:** Create UI mockups demonstrating how a user initiating a zap via the list would be clearly informed about any suggested split defined by the list creator.
    * **AC 4:** Investigate the technical feasibility of incorporating split information into `kind:9735` zap request events or related NIP-57 flows in a way that common Lightning wallets might interpret.
    * **AC 5:** Produce a summary document outlining the proposed tag structure, UI flows, technical challenges, and compatibility considerations for implementing proportional zapping (or concluding if it's currently impractical).

---

