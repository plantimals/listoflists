import { writable } from 'svelte/store';
import type { Writable } from 'svelte/store';
import type { TreeNodeData } from '$lib/types';

/**
 * Writable Svelte store to hold the computed hierarchical list structure.
 * Each item in the array is a root node of a tree.
 */
export const listHierarchy: Writable<TreeNodeData[]> = writable([]);

/**
 * Writable Svelte store to track whether the hierarchy is currently being built.
 */
export const isHierarchyLoading: Writable<boolean> = writable(false); 