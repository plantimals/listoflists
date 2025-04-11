/**
 * Represents a single item within a list (e.g., a profile or event pointer).
 */
export type ListItem = { 
    type: 'p' | 'e'; // 'a' type for nested lists handled as children, not items here
    value: string; 
    relayHint?: string 
};

/**
 * Represents the data structure for a single node in the list hierarchy tree.
 */
export interface TreeNodeData {
    id: string;       // Unique identifier (event ID or coordinate)
    kind: number;     // Nostr event kind (e.g., 10000, 30000)
    name: string;     // Display name (from title, d tag, or kind)
    itemCount: number; // Number of direct items ('p', 'e', 'a' tags)
    children: TreeNodeData[]; // Array of child nodes
    items: Array<ListItem>; // Use the exported ListItem type
    dTag?: string;    // Optional 'd' tag identifier
    // Add other NDKEvent properties if needed for display or logic later
    eventId: string; // The actual Nostr event ID of the list version being displayed
    pubkey: string; // Author pubkey of the list event
} 