// src/lib/permissions.ts
// 🔐 Role-Based Access Control (RBAC) System

export enum AdminRole {
    SUPERADMIN = 'superadmin',
    ADMIN = 'admin',
    VIEWER = 'viewer'
  }
  
  export interface Permission {
    [key: string]: boolean;
  }
  
  /**
   * Role-Permission Matrix
   * Defines what each role can do in the system
   */
  export const ROLE_PERMISSIONS: Record<AdminRole, Permission> = {
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
  export const hasPermission = (role: AdminRole, permission: string): boolean => {
    return ROLE_PERMISSIONS[role]?.[permission] ?? false;
  };
  
  /**
   * Get human-readable label for a role
   */
  export const getRoleLabel = (role: AdminRole): string => {
    const labels: Record<AdminRole, string> = {
      [AdminRole.SUPERADMIN]: 'Super Administrator',
      [AdminRole.ADMIN]: 'Field Admin (MCD Team)',
      [AdminRole.VIEWER]: 'Viewer',
    };
    return labels[role] || 'Unknown';
  };
  
  /**
   * Get role description for UI
   */
  export const getRoleDescription = (role: AdminRole): string => {
    const descriptions: Record<AdminRole, string> = {
      [AdminRole.SUPERADMIN]: 'Full system access - Can assign, approve, and manage all reports',
      [AdminRole.ADMIN]: 'Field team member - Can work on assigned reports and submit for approval',
      [AdminRole.VIEWER]: 'Read-only access - Can view reports and analytics',
    };
    return descriptions[role] || '';
  };
  
  /**
   * Get all permissions for a role
   */
  export const getRolePermissions = (role: AdminRole): string[] => {
    const permissions = ROLE_PERMISSIONS[role];
    return Object.keys(permissions).filter(key => permissions[key]);
  };
  
  /**
   * Check if role can access a specific route
   */
  export const canAccessRoute = (role: AdminRole, route: string): boolean => {
    const routePermissions: Record<string, string> = {
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
    return requiredPermission ? hasPermission(role, requiredPermission) : false;
  };
  
  /**
   * Validate if a role value is valid
   */
  export const isValidRole = (role: string): role is AdminRole => {
    return Object.values(AdminRole).includes(role as AdminRole);
  };