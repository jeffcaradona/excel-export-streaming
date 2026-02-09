// shared/src/signals.js
// Signal-based toggling removed: prefer the admin router (`createTimingToggleRouter`).
// Keep a compatible export so existing callers won't crash, but make it a no-op
// that logs a short deprecation/notice message.
import { console } from "node:console";

export function registerTimingSignalToggle({ logger = console } = {}) {
  logger?.warn?.(
    "[timing] signal toggle disabled: use createTimingToggleRouter admin endpoint instead",
  );
  return () => {};
}
