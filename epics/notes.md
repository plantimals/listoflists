Okay, Product Owner, these are excellent points for refinement and improvement. Let's break them down in the context of our project structure and current implementation:

    NIP-46 Login Persistence:
        Analysis: You're right, the current NIP-46 login flow (ndkService::activateNip46Signer, +page.svelte::handleInitiateNip46Connect) establishes a connection for the current session but doesn't persist the connection details (like the bunker:// URL or the full nostrconnect:// URI which includes a secret) across page reloads. The NDKNip46Signer likely requires re-initialization with these parameters.
        Proposal: This is a significant usability improvement. We should treat this as a new User Story under EPIC-AUTH-SIGN, potentially AUTH-STORY-004: Persist NIP-46 Session.
            ACs would involve:
                Securely storing necessary NIP-46 connection parameters (e.g., connection string) in localStorage upon successful connection.
                On page load (onMount in +page.svelte), checking localStorage for saved NIP-46 parameters.
                If parameters exist, automatically attempting to re-activate the NIP-46 signer using the stored details (ndkService.activateNip46Signer).
                Handling potential errors during re-activation (e.g., signer app no longer available, invalid parameters).
                Ensuring the "Logout" actionclears these stored parameters from localStorage.
            Note: Storing connection strings, especially those containing secrets (like some nostrconnect:// URIs), requires careful security consideration. We might need to research best practices for this.

    Consolidate List Actions ("Three Dots" Menu):
        Analysis: This is a good UI refinement suggestion to reduce clutter. The actions (Rename, Add Item, Copy naddr, Aggregate View, Delete) are currently separate icons/buttons within NodeActions.svelte.
        Proposal: This fits well as a UI Refinement Task under HIER-STORY-010 (Intuitive Navigation).
            Task: Modify NodeActions.svelteto use a DaisyUI dropdown component (triggered by a vertical three-dots icon button). The dropdown menu would then contain the existing action buttons/icons. This keeps the functionality the same but improves the layout.

    Logged-Out UI Cleanup & Redesign:
        Analysis: The screenshot [cite: uploaded:Screenshot From 2025-04-15 20-16-22.png] clearly shows the duplication you mentioned. The login buttons and public browse input appear both in the header and the main content area when logged out. This stems from the conditional logic in +page.svelte. The broader desire for a UI makeover (colors, logo, etc.) is a larger topic.   

    Proposal:
        Bug Fix/Immediate Task: Refine the #if !$user} / {:else if BrowsePublicHexkey} / {:else} logic in src/routes/+page.svelteto ensure only one instance of the login buttons and one instance of the public browse input field (+ error display) is rendered when the user is logged out and not actively Browse a public key. Remove the redundant elements and the "OR BROWSE PUBLIC LISTS" divider within the main content area's logged-out state. This directly addresses the duplication issue.
        UI Redesign: This is a larger strategic initiative. I recommend we create a New Epic: EPIC-DESIGN-REFRESH to capture this. It would involve defining a new visual identity (color palette, typography, potential logo), reviewing overall layout strategy, and potentially creating several smaller stories to implement the changes across components. This needs discussion and likely design mockups before becoming actionable development tasks.

Browse Discovered Lists on Profile View:

    Analysis: Currently, ProfileView.sveltelists the names of discovered public listsand allows linking them but doesn't allow interactive Browse (expanding/collapsing to see items) directly within the profile view. The logic for loading/displaying list items resides in TreeNode.svelteand related components (NodeItemsList, ItemWrapper, etc.).   

Proposal: This is a valuable feature enhancement. Let's define a New User Story: DISCO-STORY-005: Interactive Browse of Discovered Lists under EPIC-DISCO-AGG.

    ACs would involve:
        Modifying ProfileView.svelte to render each discovered list entry using a component similar to TreeNode.svelte (perhaps a simplified version or reusing TreeNode itself).
        Passing necessary props, including currentUserPubkey=null to ensure read-only state for these embedded list views.
        Implementing logic (similar to TreeNode::loadExternalItems ) within this new/reused component in ProfileView to fetch and display the items of a discovered list when it's expanded within the profile view.   

                Ensuring correct visual distinction and that interactions within this embedded browser don't conflict with the main hierarchy state.

Summary & Next Steps:

We have identified:

    New Story: AUTH-STORY-004 (NIP-46 Persistence)
    UI Task: Refine NodeActions.svelte (Dropdown Menu)
    Bug Fix: Correct +page.svelte logged-out view duplication.
    New Epic: EPIC-DESIGN-REFRESH (Requires further planning)
    New Story: DISCO-STORY-005 (Interactive Browse in Profile View)

Which of these would you like to prioritize and break down into actionable prompts first? The NIP-46 persistence (AUTH-STORY-004), the NodeActions UI refinement, or fixing the logged-out UI duplication seem like potentially good candidates for near-term work.
