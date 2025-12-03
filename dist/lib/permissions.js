"use strict";
// src/lib/permissions.ts
// 🔐 Role-Based Access Control (RBAC) System
Object.defineProperty(exports, "__esModule", { value: true });
exports.isValidRole = exports.canAccessRoute = exports.getRolePermissions = exports.getRoleDescription = exports.getRoleLabel = exports.hasPermission = exports.ROLE_PERMISSIONS = exports.AdminRole = void 0;
var AdminRole;
(function (AdminRole) {
    AdminRole["SUPERADMIN"] = "superadmin";
    AdminRole["ADMIN"] = "admin";
    AdminRole["VIEWER"] = "viewer";
})(AdminRole || (exports.AdminRole = AdminRole = {}));
/**
 * Role-Permission Matrix
 * Defines what each role can do in the system
 */
exports.ROLE_PERMISSIONS = {
    // 👑 SuperAdmin - Full access to everything
    [AdminRole.SUPERADMIN]: {
        VIEW_ALL_REPORTS: true,
        VIEW_ASSIGNED_REPORTS: true,
        ASSIGN_REPORTS: true,
        RESOLVE_REPORTS: true,
        APPROVE_WORK: true,
        REJECT_WORK: true,
        MANAGE_ADMINS: true,
        UPDATE_PROGRESS: true,
        SUBMIT_FOR_APPROVAL: true,
        ADD_NOTES: true,
        UPLOAD_PHOTOS: true,
        DELETE_REPORTS: true,
        FLAG_REPORTS: true,
        VIEW_ANALYTICS: true,
        VIEW_ADMIN_ONLY_ANALYTICS: true,
        VIEW_PENDING_APPROVALS: true,
        MANAGE_REWARDS: true,
    },
    // 🛠️ Admin (Field Team) - Work execution permissions only
    [AdminRole.ADMIN]: {
        VIEW_ASSIGNED_REPORTS: true,
        UPDATE_PROGRESS: true,
        SUBMIT_FOR_APPROVAL: true,
        ADD_NOTES: true,
        UPLOAD_PHOTOS: true,
        VIEW_ASSIGNED_ANALYTICS: true,
    },
    // 👀 Viewer - Read-only access
    [AdminRole.VIEWER]: {
        VIEW_ALL_REPORTS: true,
        VIEW_ANALYTICS: true,
    },
};
/**
 * Check if a role has a specific permission
 * @param role - Admin role to check
 * @param permission - Permission string to verify
 * @returns boolean indicating if permission is granted
 */
const hasPermission = (role, permission) => {
    return exports.ROLE_PERMISSIONS[role]?.[permission] ?? false;
};
exports.hasPermission = hasPermission;
/**
 * Get human-readable label for a role
 */
const getRoleLabel = (role) => {
    const labels = {
        [AdminRole.SUPERADMIN]: 'Super Administrator',
        [AdminRole.ADMIN]: 'Field Admin (MCD Team)',
        [AdminRole.VIEWER]: 'Viewer',
    };
    return labels[role] || 'Unknown';
};
exports.getRoleLabel = getRoleLabel;
/**
 * Get role description for UI
 */
const getRoleDescription = (role) => {
    const descriptions = {
        [AdminRole.SUPERADMIN]: 'Full system access - Can assign, approve, and manage all reports',
        [AdminRole.ADMIN]: 'Field team member - Can work on assigned reports and submit for approval',
        [AdminRole.VIEWER]: 'Read-only access - Can view reports and analytics',
    };
    return descriptions[role] || '';
};
exports.getRoleDescription = getRoleDescription;
/**
 * Get all permissions for a role
 */
const getRolePermissions = (role) => {
    const permissions = exports.ROLE_PERMISSIONS[role];
    return Object.keys(permissions).filter(key => permissions[key]);
};
exports.getRolePermissions = getRolePermissions;
/**
 * Check if role can access a specific route
 */
const canAccessRoute = (role, route) => {
    const routePermissions = {
        '/admin/reports': 'VIEW_ALL_REPORTS',
        '/admin/reports/assigned': 'VIEW_ASSIGNED_REPORTS',
        '/admin/pending-approvals': 'VIEW_PENDING_APPROVALS',
        '/admin/reports/:id/assign': 'ASSIGN_REPORTS',
        '/admin/reports/:id/approve': 'APPROVE_WORK',
        '/admin/reports/:id/reject': 'REJECT_WORK',
        '/admin/reports/:id/progress': 'UPDATE_PROGRESS',
        '/admin/reports/:id/submit-approval': 'SUBMIT_FOR_APPROVAL',
    };
    const requiredPermission = routePermissions[route];
    return requiredPermission ? (0, exports.hasPermission)(role, requiredPermission) : false;
};
exports.canAccessRoute = canAccessRoute;
/**
 * Validate if a role value is valid
 */
const isValidRole = (role) => {
    return Object.values(AdminRole).includes(role);
};
exports.isValidRole = isValidRole;
