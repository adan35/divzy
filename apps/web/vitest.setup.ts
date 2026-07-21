import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// `test.globals` is off (explicit vitest imports everywhere), so
// @testing-library/react's own auto-cleanup registration (which relies on
// globals) never fires — without this, DOM from one test's render() leaks
// into the next test in the same file.
afterEach(() => {
  cleanup();
});

// jsdom doesn't implement scrollIntoView — needed by any keyboard-navigable
// popover/listbox (currency-select / search-select's highlight-scroll
// effect); stub it globally rather than per-test-file.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// jsdom doesn't implement ResizeObserver — needed by Recharts'
// ResponsiveContainer (used by any bar/line chart component); stub it
// globally rather than per-test-file, same reasoning as scrollIntoView above.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
