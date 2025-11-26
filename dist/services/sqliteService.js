"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateId = exports.transaction = exports.query = void 0;
const sqlite_1 = __importDefault(require("../config/sqlite"));
const crypto_1 = require("crypto");
exports.query = {
    // For SELECT queries
    get: (sql, params = []) => {
        const stmt = sqlite_1.default.prepare(sql);
        return stmt.get(...params);
    },
    // For SELECT queries returning multiple rows
    all: (sql, params = []) => {
        const stmt = sqlite_1.default.prepare(sql);
        return stmt.all(...params);
    },
    // For INSERT/UPDATE/DELETE
    run: (sql, params = []) => {
        const stmt = sqlite_1.default.prepare(sql);
        return stmt.run(...params);
    }
};
const transaction = (callback) => {
    sqlite_1.default.transaction(callback)();
};
exports.transaction = transaction;
const generateId = () => (0, crypto_1.randomUUID)();
exports.generateId = generateId;
