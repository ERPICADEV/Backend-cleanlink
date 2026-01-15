"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const mapController_1 = require("../controllers/mapController");
const router = (0, express_1.Router)();
router.get('/reports', mapController_1.getMapReports);
router.get('/clusters', mapController_1.getMapClusters);
router.get('/stats', mapController_1.getMapStats);
exports.default = router;
