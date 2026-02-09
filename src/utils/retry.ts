import { MAX_RETRIES, BASE_RETRY_DELAY_MS } from '../constants.js';
import { logger } from './logger.js';

export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries: number = MAX_RETRIES,
): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
        logger.warn(`${label} failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}
