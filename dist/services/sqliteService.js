"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateId = exports.transaction = exports.query = void 0;
const postgres_1 = require("../config/postgres");
const crypto_1 = require("crypto");
exports.query = {
    // For SELECT queries
    get: async (sql, params = []) => {
        const result = await postgres_1.pool.query(sql, params);
        return result.rows[0];
    },
    // For SELECT queries returning multiple rows
    all: async (sql, params = []) => {
        const result = await postgres_1.pool.query(sql, params);
        return result.rows;
    },
    // For INSERT/UPDATE/DELETE
    run: async (sql, params = []) => {
        const result = await postgres_1.pool.query(sql, params);
        return { rowCount: result.rowCount || 0 };
    }
};
const transaction = async (callback) => {
    const client = await postgres_1.pool.connect();
    try {
        await client.query('BEGIN');
        await callback();
        await client.query('COMMIT');
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
};
exports.transaction = transaction;
const generateId = () => (0, crypto_1.randomUUID)();
exports.generateId = generateId;
