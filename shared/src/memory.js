/**
 * Creates a memory logger function that tracks peak memory usage
 * @param {NodeJS.Process} proc - The process to monitor memory usage
 * @param {Function} logger - The logging function (e.g., debug instance)
 * @returns {Function} A function that logs current memory usage with getPeakSummary() and logPeakSummary() methods
 */
const createMemoryLogger = (proc, logger) => {
  // Track peak values
  const peaks = {
    rss: 0,
    heapUsed: 0,
    heapTotal: 0,
    external: 0,
    arrayBuffers: 0
  };

  /**
   * Formats bytes to megabytes with 2 decimal places
   * @param {number} bytes - Value in bytes
   * @returns {string} Formatted string in MB
   */
  const formatMB = (bytes) => (bytes / 1024 / 1024).toFixed(2);

  /**
   * Updates peak values if current values are higher
   * @param {Object} mem - Current memory usage object
   */
  const updatePeaks = (mem) => {
    peaks.rss = Math.max(peaks.rss, mem.rss);
    peaks.heapUsed = Math.max(peaks.heapUsed, mem.heapUsed);
    peaks.heapTotal = Math.max(peaks.heapTotal, mem.heapTotal);
    peaks.external = Math.max(peaks.external, mem.external);
    if (mem.arrayBuffers !== undefined) {
      peaks.arrayBuffers = Math.max(peaks.arrayBuffers, mem.arrayBuffers);
    }
  };

  /**
   * Logs the current memory usage and updates peak tracking
   * @param {string} [label=''] - Optional label to prefix the log
   */
  const memoryLogger = (label = '') => {
    const mem = proc.memoryUsage();
    updatePeaks(mem);
    
    const prefix = label ? `[${label}] ` : '';
    
    logger(
      `${prefix}Memory Usage: ` +
      `RSS: ${formatMB(mem.rss)} MB | ` +
      `Heap Used: ${formatMB(mem.heapUsed)} MB / ${formatMB(mem.heapTotal)} MB | ` +
      `External: ${formatMB(mem.external)} MB` +
      (mem.arrayBuffers ? ` | Array Buffers: ${formatMB(mem.arrayBuffers)} MB` : '')
    );
  };

  /**
   * Returns the peak memory values seen so far
   * @returns {Object} Peak memory values in bytes and formatted MB
   */
  memoryLogger.getPeakSummary = () => ({
    rss: { bytes: peaks.rss, mb: formatMB(peaks.rss) },
    heapUsed: { bytes: peaks.heapUsed, mb: formatMB(peaks.heapUsed) },
    heapTotal: { bytes: peaks.heapTotal, mb: formatMB(peaks.heapTotal) },
    external: { bytes: peaks.external, mb: formatMB(peaks.external) },
    arrayBuffers: { bytes: peaks.arrayBuffers, mb: formatMB(peaks.arrayBuffers) }
  });

  /**
   * Logs the peak memory summary
   * @param {string} [label=''] - Optional label to prefix the log
   */
  memoryLogger.logPeakSummary = (label = '') => {
    const prefix = label ? `[${label}] ` : '';
    
    logger(
      `${prefix}Peak Memory Usage: ` +
      `RSS: ${formatMB(peaks.rss)} MB | ` +
      `Heap Used: ${formatMB(peaks.heapUsed)} MB / ${formatMB(peaks.heapTotal)} MB | ` +
      `External: ${formatMB(peaks.external)} MB` +
      (peaks.arrayBuffers > 0 ? ` | Array Buffers: ${formatMB(peaks.arrayBuffers)} MB` : '')
    );
  };

  return memoryLogger;
};

export { createMemoryLogger };
