/**
 * Generates a timestamped filename for exports
 * @param {string} prefix - Filename prefix (default: 'report')
 * @param {string} extension - File extension (default: 'xlsx')
 * @returns {string} Formatted filename: prefix-YYYY-MM-DD-HHmmss.extension
 */
export const generateTimestampedFilename = (prefix = 'report', extension = 'xlsx') => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  
  return `${prefix}-${year}-${month}-${day}-${hours}${minutes}${seconds}.${extension}`;
};
