/**
 * Environment variable validation for the BFF service using Zod schema.
 *
 * Validates only the variables the BFF needs — no database config here.
 * Mirrors the API's env.js pattern: schema → validate → lazy-cached getter.
 */
import { z } from 'zod';
import { ConfigurationError } from '../utils/errors.js';
import process from 'node:process';
/**
 * BFF environment schema — lean, no database fields
 */
const envSchema = z.object({
  APP_PORT: z.coerce.number().int().positive().default(3000),
  API_PORT: z.coerce.number().int().positive().default(3001),
  API_HOST: z.string().default('localhost'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
});

/**
 * Validate and return typed environment configuration.
 * Throws ConfigurationError if validation fails.
 *
 * @returns {Object} Validated environment configuration
 * @throws {ConfigurationError} If variables are missing or invalid
 */
export const validateEnv = () => {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const problems = result.error.errors
      .map((err) => `${err.path.join('.')}: ${err.message}`)
      .join(', ');

    throw new ConfigurationError(
      `Environment validation failed: ${problems}`,
    );
  }

  return result.data;
};

/**
 * Get validated environment config (lazy-loaded, cached after first call)
 */
let cachedEnv = null;

export const getEnv = () => {
  if (!cachedEnv) {
    cachedEnv = validateEnv();
  }
  return cachedEnv;
};
