"use strict";
// PostgreSQL database configuration
// This file exports the pool for use throughout the application
// Schema initialization should be done separately using schema.sql
Object.defineProperty(exports, "__esModule", { value: true });
const postgres_1 = require("./postgres");
exports.default = postgres_1.pool;
