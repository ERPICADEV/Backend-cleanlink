"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.withRetry = void 0;
const dbErrorHandler_1 = require("./dbErrorHandler");
const withRetry = async (operation, maxRetries = 3, delayMs = 1000) => {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        }
        catch (error) {
            lastError = error;
            // Only retry on connection errors, not on other database errors
            const isConnectionError = (0, dbErrorHandler_1.isDatabaseConnectionError)(error);
            if (!isConnectionError || attempt === maxRetries) {
                throw error;
            }
            // Log retry attempt for connection errors with full details
            console.warn(`⚠️  Database connection error (attempt ${attempt}/${maxRetries}), retrying in ${delayMs * attempt}ms...`, {
                code: error?.code,
                message: error?.message?.substring(0, 200),
                errno: error?.errno,
                syscall: error?.syscall,
                address: error?.address,
                port: error?.port
            });
            // Exponential backoff with jitter
            const backoffDelay = delayMs * attempt + Math.random() * 500;
            await new Promise(resolve => setTimeout(resolve, backoffDelay));
        }
    }
    throw lastError || new Error('Max retries exceeded');
};
exports.withRetry = withRetry;
