import { useLayoutEffect, useRef } from "react";

/**
 * Scrolls the page to the top instantly when `verdictKey` transitions to a
 * new truthy value — i.e., when a verdict is first displayed through an
 * in-page state transition (no route change).
 *
 * Behavior:
 * - Scrolls to {top: 0, left: 0} with instant behavior (no animation).
 * - Does NOT scroll on rerenders of the same verdict (same key), so the user
 *   can scroll freely while reading without being yanked back to the top.
 * - Does NOT scroll when transitioning away from a verdict (key → null).
 * - Resets the tracked key when verdictKey is null so the next verdict scrolls.
 *
 * Uses useLayoutEffect so the final verdict layout exists in the DOM before
 * the scroll is applied (no flash of the old scroll position).
 *
 * @param {string|null|undefined} verdictKey — a stable identity for the
 *   current verdict (e.g. trial.public_slug), or null/undefined when no
 *   verdict is displayed.
 */
export function useVerdictScrollReset(verdictKey) {
  const lastKey = useRef(null);

  useLayoutEffect(() => {
    if (verdictKey && verdictKey !== lastKey.current) {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      lastKey.current = verdictKey;
    } else if (!verdictKey) {
      lastKey.current = null;
    }
  }, [verdictKey]);
}