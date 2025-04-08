import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';

// Assume online if not in a browser environment (SSR), check actual status otherwise
export const isOnline = writable(browser ? navigator.onLine : true);

if (browser) {
    console.log(`Initial network status (navigator.onLine): ${navigator.onLine}`);

    // --- Primary Mechanism: Event Listeners --- 
    window.addEventListener('online', () => {
        console.log('>>> BROWSER ONLINE event fired!');
        if (get(isOnline) === false) {
             console.log('Updating store to ONLINE via event');
             isOnline.set(true);
        }
    });

    window.addEventListener('offline', () => {
        console.log('>>> BROWSER OFFLINE event fired!');
        if (get(isOnline) === true) {
             console.log('Updating store to OFFLINE via event');
             isOnline.set(false);
        }
    });

    // --- Fallback Mechanism: Polling --- 
    const pollInterval = 5000; // Check every 5 seconds
    console.log(`Setting up network status polling every ${pollInterval}ms`);

    const intervalId = setInterval(() => {
        const currentBrowserStatus = navigator.onLine;
        const currentStoreStatus = get(isOnline);

        if (currentBrowserStatus !== currentStoreStatus) {
            console.log(`Polling detected status change: Browser=${currentBrowserStatus}, Store=${currentStoreStatus}. Updating store.`);
            isOnline.set(currentBrowserStatus);
        }
        // Optional: Log polling check even if no change
        // console.log(`Polling check: Browser=${currentBrowserStatus}, Store=${currentStoreStatus}`);
    }, pollInterval);

    // Note: For a global store like this, explicitly clearing the interval
    // on component unmount isn't standard. If this store were tied to a
    // specific component lifecycle, you'd return a cleanup function from onMount.
} 