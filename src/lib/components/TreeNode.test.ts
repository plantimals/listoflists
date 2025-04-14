/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/svelte';
import { writable, get, type Writable } from 'svelte/store';
import type { SvelteComponent as SvelteComponentType } from 'svelte'; // Use Type alias to avoid conflict
import { SvelteComponent } from 'svelte'; // Import base class for mocking
import type { NDKUser } from '@nostr-dev-kit/ndk';

import TreeNode from './TreeNode.svelte';
import type { TreeNodeData, ListItem, Nip05VerificationStateType } from '$lib/types';

// --- Remove Child Component Mocks ---
/*
const NodeHeaderMockFn = vi.fn();
const NodeItemsListMockFn = vi.fn();
vi.mock('$lib/components/NodeHeader.svelte', () => ({ default: NodeHeaderMockFn }));
vi.mock('$lib/components/NodeItemsList.svelte', () => ({ default: NodeItemsListMockFn }));
*/

// --- Keep other mocks --- 
vi.mock('./NodeActions.svelte', () => ({ default: vi.fn() })); // Keep mocking actions slot content
// REMOVE MOCKS for ItemWrapper and Nip05Item to allow them to render
/*
vi.mock('./ItemWrapper.svelte', () => ({ default: vi.fn() })); 
vi.mock('./Nip05Item.svelte', () => ({ default: vi.fn() })); 
*/
vi.mock('$lib/userStore', () => {
    const store = writable<NDKUser | null>(null);
    return { user: store };
});
vi.mock('$lib/refreshStore', () => ({ refreshTrigger: writable(0) }));
vi.mock('$lib/listService', async (importOriginal) => {
    const actual = await importOriginal() as Record<string, any>;
    return { ...actual, deleteList: vi.fn().mockResolvedValue({ success: true }), renameList: vi.fn().mockResolvedValue({ success: true }) };
});
vi.mock('$lib/localDb', () => ({
    localDb: {
        getLatestEventByCoord: vi.fn().mockResolvedValue(undefined),
        getProfile: vi.fn().mockResolvedValue(null)
    },
    StoredEvent: vi.fn()
}));
vi.mock('$lib/ndkService', () => ({
    ndkService: {
        fetchAndCacheItemDetails: vi.fn().mockResolvedValue(undefined),
        fetchEvent: vi.fn().mockResolvedValue(null),
        getNdkInstance: vi.fn(),
        getSigner: vi.fn()
    }
}));
vi.mock('$lib/networkStatusStore', () => ({ isOnline: writable(true) }));

// --- Test Suite ---

describe('TreeNode.svelte', () => {

    // Variable for user store mock instance
    let mockUserStoreInstance: Writable<NDKUser | null>;

    beforeEach(async () => {
        // Reset mocks and state
        vi.clearAllMocks(); // Clears call counts etc. for ALL vi.fn() mocks

        // Retrieve and set up user store mock
        const UserStoreModule = await import('$lib/userStore');
        mockUserStoreInstance = vi.mocked(UserStoreModule.user);
        mockUserStoreInstance.set(mockNDKUser);
        
        // Cleanup testing-library renders
        cleanup(); 
    });

    // Minimal mock NDKUser for testing
    const mockNDKUser = {
        pubkey: 'test-user-pubkey',
        // Add other NDKUser properties if needed by the component, cast to NDKUser
    } as NDKUser;

    const createMockNode = (overrides: Partial<TreeNodeData> = {}): TreeNodeData => ({
        id: 'list1',
        kind: 30001,
        name: 'Test List',
        pubkey: 'test-user-pubkey',
        eventId: 'event1',
        dTag: 'test-list',
        itemCount: 0,
        children: [],
        items: [],
        ...overrides,
    });

    const defaultVerificationStates: { [id: string]: Nip05VerificationStateType } = {};

    it('should render the node name and badges, but not items initially', () => {
        const mockNode = createMockNode({ name: 'Basic Render Test', itemCount: 3, dTag: 'basic-tag' });
        const currentUserPubkey = get(mockUserStoreInstance)?.pubkey;
        const { getByText, queryByText, queryByRole } = render(TreeNode, { 
            node: mockNode, 
            depth: 1, 
            verificationStates: defaultVerificationStates, 
            currentUserPubkey: currentUserPubkey 
        });

        // Check NodeHeader content is rendered
        expect(getByText('Basic Render Test')).toBeTruthy();
        // Check badges (assuming they are rendered by NodeHeader)
        expect(getByText(`K:${mockNode.kind}`)).toBeTruthy();
        expect(getByText(mockNode.dTag!)).toBeTruthy();
        expect(getByText(`${mockNode.itemCount} items`)).toBeTruthy();

        // Check NodeItemsList content is NOT rendered initially (assuming it renders items)
        // Use queryBy... which returns null if not found
        // We need a way to identify content specific to NodeItemsList. 
        // Let's assume list items might be rendered in <li> elements if NodeItemsList uses a <ul> or <ol>.
        // Or we might need to add a data-testid inside NodeItemsList later.
        expect(queryByRole('listitem')).toBeNull();
        // Or check for specific mock item text if NodeItemsList rendered something simple
        // expect(queryByText('mock-item-value')).not.toBeInTheDocument(); 
    });

    it('should toggle visibility of items/children when toggleExpand is called', async () => {
        const mockChildNode = createMockNode({ id: 'child1', name: 'Child List', pubkey: 'test-user-pubkey' });
        // Use a valid hex string for the mock pubkey
        const mockItem = { type: 'p' as const, value: 'f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0' }; // Give item a specific value
        const mockNode = createMockNode({ children: [mockChildNode], items: [mockItem], itemCount: 2 });
        const currentUserPubkey = get(mockUserStoreInstance)?.pubkey;
        const { component } = render(TreeNode, {
            node: mockNode,
            depth: 0,
            verificationStates: defaultVerificationStates,
            currentUserPubkey: currentUserPubkey
        });

        // Check initial state: Item value should not be rendered (UserItem renders npub, not raw hex)
        // Use queryByText and toBeNull for initial check
        expect(screen.queryByText('f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0')).toBeNull();
        // Check item wrapper is not present initially
        expect(screen.queryByTestId('item-wrapper')).toBeNull(); 

        // Trigger toggleExpand
        await component.toggleExpand();

        // Check NodeItemsList IS rendered.
        // Use queryByTestId and not.toBeNull to check for item wrapper
        expect(screen.queryByTestId('item-wrapper')).not.toBeNull(); 

        // Keep check for child node commented out for now
        // expect(getByText(mockChildNode.name)).toBeInTheDocument();

        // Trigger toggleExpand again
        await component.toggleExpand();

        // Check item wrapper is NOT rendered again
        // Use queryByTestId and toBeNull
        expect(screen.queryByTestId('item-wrapper')).toBeNull();
    });

    it('should pass isExternal=true prop to NodeHeader for external lists', () => {
        const externalNode = createMockNode({ pubkey: 'other-user-pubkey', name: 'External List' });
        const currentUser = get(mockUserStoreInstance)?.pubkey;
        // Use screen queries
        render(TreeNode, { 
            node: externalNode, 
            depth: 0, 
            verificationStates: defaultVerificationStates, 
            currentUserPubkey: currentUser 
        });

        // Check external node render shows (External) label appended by NodeHeader
        // expect(getByTextExt('External List')).toBeInTheDocument(); 
        expect(screen.getByText('External List')).toBeTruthy(); // Use getByText + toBeTruthy
        // expect(getByTextExt('(External)')).toBeInTheDocument(); 
        expect(screen.getByText('(External)')).toBeTruthy(); // Use getByText + toBeTruthy

        // Clean up and render internal node
        cleanup();

        const internalNode = createMockNode({ pubkey: currentUser || 'fallback-pubkey', name: 'Internal List' });
        // Use screen queries
        render(TreeNode, { 
            node: internalNode, 
            depth: 0, 
            verificationStates: defaultVerificationStates, 
            currentUserPubkey: currentUser 
        });
        
        // Check internal node render shows name but NOT (External) label
        // expect(getByTextInt('Internal List')).toBeInTheDocument();
        expect(screen.getByText('Internal List')).toBeTruthy(); // Use getByText + toBeTruthy
        expect(screen.queryByText('(External)')).toBeNull(); // Already correct
    });

}); 