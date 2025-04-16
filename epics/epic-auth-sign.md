# EPIC-AUTH-SIGN: Authentication & Signing

*This Epic covers how users log in and authorize actions securely using standard Nostr protocols.*

---

**AUTH-STORY-001: NIP-07 Browser Extension Signing**

* **As a desktop user, I want to** authenticate and sign actions using my NIP-07 compatible browser extension **so that** I can securely manage my lists without entering private keys [cite: FR-01].
    * **AC 1:** Given a NIP-07 extension (e.g., Alby, Nos2x) is installed and available, when I initiate the "Login" action, then the application successfully requests authentication via the `window.nostr.getPublicKey()` API call.
    * **AC 2:** Upon successful authentication via NIP-07, my user identity (`NDKUser` object or pubkey) is stored in the application state, and the UI reflects the logged-in status.
    * **AC 3:** Given I am authenticated via NIP-07, when I perform an action requiring a signature (e.g., create/update list), then a signing request containing the unsigned event is sent via the `window.nostr.signEvent()` API call.
    * **AC 4:** Upon successful signing confirmation from the extension, the application receives the signed event and proceeds with the intended action (e.g., saving locally, queueing for sync).
    * **AC 5:** If the NIP-07 extension is not detected, or if authentication/signing requests are rejected or fail, appropriate error messages or feedback are displayed to the user.

---

**AUTH-STORY-002: NIP-46 Remote Signing (Nostr Connect)**

* **As a mobile user, I want to** authenticate and sign actions using a NIP-46 compatible remote signer (like Amber) **so that** I can use the application securely on my phone [cite: FR-01].
    * **AC 1:** Given I select the NIP-46 login option, the application provides a clear method to establish a connection (e.g., displaying a `nostrconnect://` QR code, allowing bunker URL input).
    * **AC 2:** Upon successful connection establishment with the NIP-46 signer, the application retrieves the user's pubkey and stores the identity in the application state, reflecting the logged-in status.
    * **AC 3:** Given I am authenticated via NIP-46, when I perform an action requiring a signature, then a properly formatted `connect` request containing the unsigned event is sent to the connected remote signer via the established NIP-46 relay connection.
    * **AC 4:** Upon receiving a successful `connect` response containing the signed event from the remote signer, the application validates the signature and proceeds with the intended action.
    * **AC 5:** The application clearly indicates the connection status with the NIP-46 signer, handles connection errors gracefully, and provides feedback for signing request timeouts or rejections from the remote signer.

---

**AUTH-STORY-003: Secure Signing Process (Constraint)**

* **As a user, I want** clear prompts and assurance that my private keys are handled securely via standard protocols (NIP-07/NIP-46) **so that** I feel confident managing my lists and my Nostr identity is protected [cite: NFR-06].
    * **AC 1:** The application source code *never* directly requests, handles, or stores the user's private key (`nsec`).
    * **AC 2:** All cryptographic signing operations are exclusively delegated through the NIP-07 browser extension API or the NIP-46 remote signing protocol.
    * **AC 3:** Prompts presented *by the chosen signer* (NIP-07 extension or NIP-46 app) clearly indicate the specific action being authorized, based on the event kind/content sent by this application.
    * **AC 4:** The application UI clearly displays whether the user is currently authenticated and potentially which method (NIP-07/NIP-46) is active.

---

EPIC-AUTH-SIGN: Authentication & Signing

AUTH-STORY-004: Persist NIP-46 Bunker Session Across Page Loads

    As a user who logged in via a NIP-46 bunker:// URI, I want the application to remember my connection details and attempt to reconnect automatically when I reload the page so that I don't have to manually re-enter my connection string every time [cite: FR-01].
    AC 1: Given I successfully log in using a NIP-46 connection string identified as safe for storage (specifically, starting with bunker://), the connection string used is saved to the browser's localStorage under a predefined key (e.g., nip46BunkerConnectionString). Connection strings starting with nostrconnect:// (which contain secrets) MUST NOT be saved.
    AC 2: When the application loads (onMount in +page.svelte), it checks localStorage for a saved NIP-46 bunker connection string before attempting any NIP-07 auto-login.
    AC 3: If a bunker:// connection string is found in localStorage:
        The application automatically attempts to re-establish the connection by calling ndkService.activateNip46Signer with the stored string.
        A visual indicator (e.g., "Attempting NIP-46 reconnect...") is shown during the attempt.
    AC 4: If the automatic reconnection attempt (AC 3) using the stored bunker:// string is successful:
        The user state ($user store) is set with the retrieved NDKUser.
        The application proceeds to load the user's data as if they had manually logged in.
        The connection string remains in localStorage for subsequent reloads.
    AC 5: If the automatic reconnection attempt (AC 3) fails (e.g., timeout, connection refused by signer, invalid stored string):
        An appropriate, non-blocking message is logged or briefly shown (e.g., "Failed to auto-reconnect NIP-46 signer. Please log in manually.").
        The invalid/failed connection string is cleared from localStorage.
        The application presents the standard manual login options (NIP-07 / NIP-46 buttons, public browse input).
    AC 6: When I explicitly click the "Logout" button:
        Any active NIP-46 signer is disconnected via ndkService.disconnectSigner().
        Any saved NIP-46 bunker connection string is cleared from localStorage.
