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
        
        // Log retry attempt for connection errors
        console.warn(`⚠️  Database connection error (attempt ${attempt}/${maxRetries}), retrying in ${delayMs * attempt}ms...`, {
          code: (error as any)?.code,
          message: (error as any)?.message?.substring(0, 100)
        });
        
        await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
      }
    }
    
    throw lastError || new Error('Max retries exceeded');
  };