"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateLevelProgress = exports.getLevelInfo = exports.calculateLevel = exports.LEVEL_CONFIG = void 0;
exports.LEVEL_CONFIG = {
    1: { minPoints: 0, maxPoints: 50, name: "New Citizen", color: "#6B7280" },
    2: { minPoints: 51, maxPoints: 200, name: "Active Reporter", color: "#10B981" },
    3: { minPoints: 201, maxPoints: 500, name: "Community Leader", color: "#3B82F6" },
    4: { minPoints: 501, maxPoints: 1000, name: "Clean City Champion", color: "#8B5CF6" },
    5: { minPoints: 1001, maxPoints: 2000, name: "Eco Warrior", color: "#F59E0B" },
    6: { minPoints: 2001, maxPoints: 5000, name: "Cleanliness Guru", color: "#EF4444" },
    7: { minPoints: 5001, maxPoints: 9999, name: "City Savior", color: "#000000" }
};
const calculateLevel = (points) => {
    if (points >= 5001)
        return 7;
    if (points >= 2001)
        return 6;
    if (points >= 1001)
        return 5;
    if (points >= 501)
        return 4;
    if (points >= 201)
        return 3;
    if (points >= 51)
        return 2;
    return 1;
};
exports.calculateLevel = calculateLevel;
const getLevelInfo = (level) => {
    return exports.LEVEL_CONFIG[level] || exports.LEVEL_CONFIG[1];
};
exports.getLevelInfo = getLevelInfo;
const calculateLevelProgress = (points, currentLevel) => {
    const levelConfig = exports.LEVEL_CONFIG[currentLevel];
    if (!levelConfig || currentLevel === 5)
        return 100;
    const pointsInLevel = points - levelConfig.minPoints;
    const levelRange = levelConfig.maxPoints - levelConfig.minPoints;
    return Math.min(Math.round((pointsInLevel / levelRange) * 100), 100);
};
exports.calculateLevelProgress = calculateLevelProgress;
