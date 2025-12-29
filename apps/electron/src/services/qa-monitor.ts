
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Monitoring Service for QA Session
 * Captures user interactions, navigation events, and performance metrics.
 */

// --- Navigation Logger ---
export function NavigationLogger() {
  const location = useLocation();

  useEffect(() => {
    console.log(`[QA-MONITOR] Navigation: -> ${location.pathname}${location.search}`);
    // Performance marker for page load (approximate)
    const pageName = location.pathname.replace('/', '') || 'home';
    const markName = `page-load-${pageName}`;
    performance.mark(`${markName}-start`);

    return () => {
      // End marker on unmount/navigation away (if needed, or just log duration)
      // For simplicity, we just log the entry.
    };
  }, [location]);

  return null;
}

// --- Interaction Logger ---
export function initInteractionLogger() {
  if (window.hasInitializedInteractionLogger) return;
  window.hasInitializedInteractionLogger = true;

  const getElementLabel = (el: HTMLElement): string => {
    const id = el.id ? `#${el.id}` : '';
    const classList = el.classList.value ? `.${el.classList.value.split(' ').join('.')}` : '';
    const text = el.innerText ? ` ("${el.innerText.slice(0, 20)}")` : '';
    const role = el.getAttribute('role') ? `[role="${el.getAttribute('role')}"]` : '';
    const ariaLabel = el.getAttribute('aria-label') ? `[aria-label="${el.getAttribute('aria-label')}"]` : '';
    
    return `${el.tagName.toLowerCase()}${id}${role}${ariaLabel}${text}`;
  };

  window.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    // Walk up to find a button or interactive element if the target is an icon/span
    const interactive = target.closest('button, a, input, select, [role="button"]') || target;
    
    console.log(`[QA-MONITOR] Interaction: Clicked ${getElementLabel(interactive as HTMLElement)}`);
  }, true); // Capture phase to ensure we log even if event propagation stops

  console.log('[QA-MONITOR] Interaction logger initialized');
}

// --- Global Error Handler (Renderer) ---
export function initErrorLogger() {
    window.addEventListener('error', (event) => {
        console.error(`[QA-MONITOR] Uncaught Error: ${event.message}`, event.error);
    });
    window.addEventListener('unhandledrejection', (event) => {
        console.error(`[QA-MONITOR] Unhandled Promise Rejection:`, event.reason);
    });
}

// --- State Logger ---
export function logStateChange(storeName: string, partialState: any) {
  const keys = Object.keys(partialState);
  // Filter out noisy or large data fields (optional)
  const filteredKeys = keys.filter(k => !['meetings', 'recordings', 'unifiedRecordings', 'activityLog'].includes(k));
  
  if (filteredKeys.length > 0) {
      const updates = filteredKeys.reduce((acc, k) => ({ ...acc, [k]: partialState[k] }), {});
      console.log(`[QA-MONITOR] State [${storeName}]:`, updates);
  }
}

declare global {
  interface Window {
    hasInitializedInteractionLogger: boolean;
  }
}
