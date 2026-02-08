/**
 * Environment variable validation using Zod schema
 */
import { z } from 'zod';
import { ConfigurationError } from '../utils/errors.js';
import process from 'node:process';
/**
 * Define expected environment variables and their types
 */
const envSchema = z.object({
  // Database configuration (required)
  DB_USER: z.string().min(1, 'DB_USER is required'),
  DB_PASSWORD: z.string().min(1, 'DB_PASSWORD is required'),
  DB_HOST: z.string().min(1, 'DB_HOST is required'),
  DB_NAME: z.string().min(1, 'DB_NAME is required'),
  
  // Optional database config with defaults
  DB_PORT: z.coerce.number().int().positive().default(1433),
  
  // API configuration with defaults
  API_PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  
  // Optional settings
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  
  // JWT authentication
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
});

/**
 * Validate and return typed environment configuration
 * Throws ConfigurationError if validation fails
 * 
 * @returns {Object} Validated environment configuration
 * @throws {ConfigurationError} If required variables are missing or invalid
 */
export const validateEnv = () => {
  try {
    const result = envSchema.safeParse(process.env);
    
    if (!result.success) {
      const missingVars = result.error.errors
        .map(err => `${err.path.join('.')}: ${err.message}`)
        .join(', ');
      
      throw new ConfigurationError(
        `Environment validation failed: ${missingVars}`
      );
    }
    
    return result.data;
  } catch (error) {
    if (error instanceof ConfigurationError) {
      throw error;
    }
    throw new ConfigurationError(`Failed to validate environment: ${error.message}`);
  }
};

/**
 * Get validated environment config (lazy loaded, cached after first call)
 */
let cachedEnv = null;

export const getEnv = () => {
  if (!cachedEnv) {
    cachedEnv = validateEnv();
  }
  return cachedEnv;
};
