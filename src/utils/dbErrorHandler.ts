/**
 * Utility to handle database errors gracefully
 */

export function isDatabaseConnectionError(error: any): boolean {
  if (!error) return false;
  
  // Check for common connection error codes
  const connectionErrorCodes = [
    'ECONNREFUSED', 
    'ENOTFOUND', 
    'ETIMEDOUT', 
    'ECONNRESET',
    'ETIMEDOUT',
    'ENETUNREACH',
    'EHOSTUNREACH'
  ];
  
  // PostgreSQL-specific error codes for connection issues
  const postgresConnectionErrorCodes = [
    '57P01', // admin_shutdown
    '57P02', // crash_shutdown
    '57P03', // cannot_connect_now
    '08003', // connection_does_not_exist
    '08006', // connection_failure
    '08001', // sqlclient_unable_to_establish_sqlconnection
    '08004', // sqlserver_rejected_establishment_of_sqlconnection
    '08000', // connection_exception
    '53300', // too_many_connections
    '57P04', // database_shutdown
  ];
  
  const connectionErrorMessages = [
    'connection', 
    'connect', 
    'database', 
    'postgres',
    'timeout',
    'refused',
    'network',
    'unreachable',
    'pool',
    'client has been closed',
    'Connection terminated',
    'Connection terminated unexpectedly',
    'server closed the connection',
    'no connection to the server',
  ];
  
  // Check error code
  if (error.code) {
    if (connectionErrorCodes.includes(error.code) || postgresConnectionErrorCodes.includes(error.code)) {
      return true;
    }
  }
  
  // Check PostgreSQL error code (different property)
  if (error.code && postgresConnectionErrorCodes.includes(error.code)) {
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
    // Log detailed error information for debugging
    console.error('Database connection error details:', {
      code: error.code,
      message: error.message,
      name: error.name,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
    
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

