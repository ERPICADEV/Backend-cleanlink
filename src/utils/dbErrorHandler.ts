/**
 * Utility to handle database errors gracefully
 */

export function isDatabaseConnectionError(error: any): boolean {
  if (!error) return false;
  
  // Check for common connection error codes
  const connectionErrorCodes = ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET'];
  const connectionErrorMessages = ['connection', 'connect', 'database', 'postgres'];
  
  // Check error code
  if (error.code && connectionErrorCodes.includes(error.code)) {
    return true;
  }
  
  // Check error message
  const errorMessage = String(error.message || '').toLowerCase();
  if (connectionErrorMessages.some(msg => errorMessage.includes(msg))) {
    return true;
  }
  
  // Check for AggregateError with connection errors
  if (error.errors && Array.isArray(error.errors)) {
    return error.errors.some((e: any) => isDatabaseConnectionError(e));
  }
  
  return false;
}

export function isTableMissingError(error: any): boolean {
  if (!error) return false;
  
  // PostgreSQL error code for "relation does not exist"
  if (error.code === '42P01') {
    return true;
  }
  
  // Check error message
  const errorMessage = String(error.message || '').toLowerCase();
  if (errorMessage.includes('relation') && errorMessage.includes('does not exist')) {
    return true;
  }
  
  return false;
}

export function handleDatabaseError(error: any, defaultMessage: string = 'Database operation failed') {
  if (isDatabaseConnectionError(error)) {
    return {
      status: 503, // Service Unavailable
      error: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'Database connection failed. Please check your DATABASE_URL and ensure PostgreSQL is running.',
        details: process.env.NODE_ENV === 'development' 
          ? `Connection error: ${error.code || error.message}` 
          : undefined
      }
    };
  }
  
  if (isTableMissingError(error)) {
    return {
      status: 503, // Service Unavailable
      error: {
        code: 'SCHEMA_NOT_INITIALIZED',
        message: 'Database tables do not exist. Please run the database schema migration.',
        details: process.env.NODE_ENV === 'development' 
          ? `Run: psql $DATABASE_URL -f schema.sql or use the migration script` 
          : undefined
      }
    };
  }
  
  // Other database errors
  return {
    status: 500,
    error: {
      code: 'DATABASE_ERROR',
      message: defaultMessage,
      details: process.env.NODE_ENV === 'development' 
        ? error.message 
        : undefined
    }
  };
}

