// vitest.setup.ts
import 'fake-indexeddb/auto'; // Recommended auto-import way
import '@testing-library/jest-dom/vitest'; // Import the matchers

// Optional: Log to confirm setup runs during test execution
console.log('Applied fake-indexeddb polyfill for Vitest.');
console.log('Applied @testing-library/jest-dom matchers.'); 