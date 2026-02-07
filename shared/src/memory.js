/**
 * Creates a memory logger function
 * @param {NodeJS.Process} proc - The process to monitor memory usage
 * @param {Function} logger - The logging function (e.g., debug instance)
 * @returns {Function} A function that logs current memory usage
 */
const createMemoryLogger = (proc, logger) => {
  /**
   * Formats bytes to megabytes with 2 decimal places
   * @param {number} bytes - Value in bytes
   * @returns {string} Formatted string in MB
   */
  const formatMB = (bytes) => (bytes / 1024 / 1024).toFixed(2);

  /**
   * Logs the current memory usage
   * @param {string} [label=''] - Optional label to prefix the log
   */
  return (label = '') => {
    const mem = proc.memoryUsage();
    const prefix = label ? `[${label}] ` : '';
    
    logger(
      `${prefix}Memory Usage: ` +
      `RSS: ${formatMB(mem.rss)} MB | ` +
      `Heap Used: ${formatMB(mem.heapUsed)} MB / ${formatMB(mem.heapTotal)} MB | ` +
      `External: ${formatMB(mem.external)} MB` +
      (mem.arrayBuffers ? ` | Array Buffers: ${formatMB(mem.arrayBuffers)} MB` : '')
    );
  };
};

export { createMemoryLogger };
