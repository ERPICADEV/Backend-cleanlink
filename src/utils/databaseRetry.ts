import { isDatabaseConnectionError } from './dbErrorHandler';

export const withRetry = async <T>(
    operation: () => Promise<T>,
    maxRetries = 3,
    delayMs = 1000
  ): Promise<T> => {
    let lastError: any;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        
        // Only retry on connection errors, not on other database errors
        const isConnectionError = isDatabaseConnectionError(error);
        
        if (!isConnectionError || attempt === maxRetries) {
          throw error;
        }
        
        // Log retry attempt for connection errors with full details
        console.warn(`⚠️  Database connection error (attempt ${attempt}/${maxRetries}), retrying in ${delayMs * attempt}ms...`, {
          code: (error as any)?.code,
          message: (error as any)?.message?.substring(0, 200),
          errno: (error as any)?.errno,
          syscall: (error as any)?.syscall,
          address: (error as any)?.address,
          port: (error as any)?.port
        });
        
        // Exponential backoff with jitter
        const backoffDelay = delayMs * attempt + Math.random() * 500;
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
      }
    }
    
    throw lastError || new Error('Max retries exceeded');
  };