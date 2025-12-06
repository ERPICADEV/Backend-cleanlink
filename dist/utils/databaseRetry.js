"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.withRetry = void 0;
const withRetry = async (operation, maxRetries = 3, delayMs = 1000) => {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        }
        catch (error) {
            if (attempt === maxRetries)
                throw error;
            await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
        }
    }
    throw new Error('Max retries exceeded');
};
exports.withRetry = withRetry;
