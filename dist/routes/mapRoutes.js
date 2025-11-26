"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const mapController_sqlite_1 = require("../controllers/mapController-sqlite");
const router = (0, express_1.Router)();
// SQLite endpoints
router.get('/reports', mapController_sqlite_1.getMapReports);
router.get('/clusters', mapController_sqlite_1.getMapClusters);
router.get('/stats', mapController_sqlite_1.getMapStats);
exports.default = router;
