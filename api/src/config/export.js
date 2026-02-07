/**
 * Export configuration and validation
 */

/**
 * Default row count for exports
 */
export const DEFAULT_ROW_COUNT = 30000;

/**
 * Maximum allowed row count (safety limit)
 */
export const MAX_ROW_COUNT = 1048576;

/**
 * Minimum row count
 */
export const MIN_ROW_COUNT = 1;

/**
 * Validates and sanitizes row count parameter
 * @param {string|number} value - Row count value from request
 * @returns {number} Validated row count
 */
export const validateRowCount = (value) => {
  // Parse the value
  const parsed = Number.parseInt(value, 10);
  
  // Return default if invalid
  if (Number.isNaN(parsed)) {
    return DEFAULT_ROW_COUNT;
  }
  
  // Clamp to min/max bounds
  return Math.max(MIN_ROW_COUNT, Math.min(MAX_ROW_COUNT, parsed));
};
