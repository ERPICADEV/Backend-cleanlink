import { isDatabaseConnectionError } from './dbErrorHandler';

// Determine if we're on Render (production)
const isRender = process.env.RENDER || process.env.DATABASE_URL?.includes('render.com') || process.env.DATABASE_URL?.includes('onrender.com');

export const withRetry = async <T>(
    operation: () => Promise<T>,
    maxRetries = 3,
    delayMs = 1000
  ): Promise<T> => {
    let lastError: any;
    
    // Use longer delays and more retries for Render (database may be sleeping)
    const effectiveMaxRetries = isRender ? Math.max(maxRetries, 5) : maxRetries;
    const effectiveDelayMs = isRender ? Math.max(delayMs, 2000) : delayMs;
    
    for (let attempt = 1; attempt <= effectiveMaxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        
        // Only retry on connection errors, not on other database errors
        const isConnectionError = isDatabaseConnectionError(error);
        
        // Also retry on timeout errors (common when database is waking up)
        const isTimeoutError = (error as any)?.code === 'ETIMEDOUT' || 
                              (error as any)?.code === '57014' ||
                              String((error as any)?.message || '').toLowerCase().includes('timeout');
        
        const shouldRetry = isConnectionError || isTimeoutError;
        
        if (!shouldRetry || attempt === effectiveMaxRetries) {
          throw error;
        }
        
        // Log retry attempt for connection errors with full details
        console.warn(`⚠️  Database ${isConnectionError ? 'connection' : 'timeout'} error (attempt ${attempt}/${effectiveMaxRetries}), retrying in ${effectiveDelayMs * attempt}ms...`, {
          code: (error as any)?.code,
          message: (error as any)?.message?.substring(0, 200),
          errno: (error as any)?.errno,
          syscall: (error as any)?.syscall,
          address: (error as any)?.address,
          port: (error as any)?.port,
          isRender: isRender
        });
        
        // Exponential backoff with jitter (longer delays for Render)
        const backoffDelay = effectiveDelayMs * attempt + Math.random() * (isRender ? 1000 : 500);
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
      }
    }
    
    throw lastError || new Error('Max retries exceeded');
  };