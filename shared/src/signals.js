// shared/src/signals.js
import { timing } from "./timingStore.js";
import { console } from "node:console";
import process from "node:process";

export function registerTimingSignalToggle({
  signal = "SIGUSR2",
  logger = console,
} = {}) {
  try {
    process.on(signal, () => {
      const v = timing.toggle();
      logger.log?.(`[timing] ${v ? "ENABLED" : "DISABLED"} via ${signal}`);
    });
  } catch (err) {
    // Some platforms may throw for unsupported signals
    logger.warn?.(
      `[timing] signal toggle not available (${signal}): ${err?.message ?? err}`,
    );
  }
}
