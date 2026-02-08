/**
 * Generates a timestamped filename for exports
 * Sanitizes the prefix to prevent path traversal and special character injection
 * 
 * @param {string} prefix - Filename prefix (default: 'report')
 * @param {string} extension - File extension (default: 'xlsx')
 * @returns {string} Formatted filename: prefix-YYYY-MM-DD-HHmmss.extension
 */
export const generateTimestampedFilename = (prefix = 'report', extension = 'xlsx') => {
  // Sanitize prefix to prevent path traversal and injection attacks
  // Allow only alphanumeric characters, hyphens, and underscores
  const sanitizedPrefix = String(prefix)
    .replaceAll(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 50) // Limit length to prevent excessively long filenames
    || 'report'; // Use default if sanitization results in empty string
  
  // Sanitize extension similarly
  const sanitizedExtension = String(extension)
    .replaceAll(/[^a-zA-Z0-9]/g, '')
    .slice(0, 10)
    || 'xlsx';
  
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  
  return `${sanitizedPrefix}-${year}-${month}-${day}-${hours}${minutes}${seconds}.${sanitizedExtension}`;
};
