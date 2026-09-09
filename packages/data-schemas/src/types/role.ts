import { PermissionTypes, Permissions } from 'librechat-data-provider';
import type { DeepPartial } from 'librechat-data-provider';
import type { Document } from 'mongoose';
import { CursorPaginationParams } from '~/common';

export interface IRole extends Document {
  name: string;
  description?: string;
  permissions: {
    [PermissionTypes.BOOKMARKS]?: {
      [Permissions.USE]?: boolean;
    };
    [PermissionTypes.PROMPTS]?: {
      [Permissions.USE]?: boolean;
      [Permissions.CREATE]?: boolean;
      [Permissions.SHARE]?: boolean;
      [Permissions.SHARE_PUBLIC]?: boolean;
    };
    [PermissionTypes.MEMORIES]?: {
      [Permissions.USE]?: boolean;
      [Permissions.CREATE]?: boolean;
      [Permissions.UPDATE]?: boolean;
      [Permissions.READ]?: boolean;
    };
    [PermissionTypes.AGENTS]?: {
      [Permissions.USE]?: boolean;
      [Permissions.CREATE]?: boolean;
      [Permissions.SHARE]?: boolean;
      [Permissions.SHARE_PUBLIC]?: boolean;
    };
    [PermissionTypes.MULTI_CONVO]?: {
      [Permissions.USE]?: boolean;
    };
    [PermissionTypes.TEMPORARY_CHAT]?: {
      [Permissions.USE]?: boolean;
    };
    [PermissionTypes.RUN_CODE]?: {
      [Permissions.USE]?: boolean;
    };
    [PermissionTypes.WEB_SEARCH]?: {
      [Permissions.USE]?: boolean;
    };
    [PermissionTypes.PEOPLE_PICKER]?: {
      [Permissions.VIEW_USERS]?: boolean;
      [Permissions.VIEW_GROUPS]?: boolean;
      [Permissions.VIEW_ROLES]?: boolean;
    };
    [PermissionTypes.MARKETPLACE]?: {
      [Permissions.USE]?: boolean;
    };
    [PermissionTypes.FILE_SEARCH]?: {
      [Permissions.USE]?: boolean;
    };
    [PermissionTypes.FILE_CITATIONS]?: {
      [Permissions.USE]?: boolean;
    };
    [PermissionTypes.MCP_SERVERS]?: {
      [Permissions.USE]?: boolean;
      [Permissions.CREATE]?: boolean;
      [Permissions.SHARE]?: boolean;
      [Permissions.SHARE_PUBLIC]?: boolean;
    };
    [PermissionTypes.REMOTE_AGENTS]?: {
      [Permissions.USE]?: boolean;
      [Permissions.CREATE]?: boolean;
      [Permissions.SHARE]?: boolean;
      [Permissions.SHARE_PUBLIC]?: boolean;
    };
    [PermissionTypes.SKILLS]?: {
      [Permissions.USE]?: boolean;
      [Permissions.CREATE]?: boolean;
      [Permissions.SHARE]?: boolean;
      [Permissions.SHARE_PUBLIC]?: boolean;
    };
    [PermissionTypes.SHARED_LINKS]?: {
      [Permissions.CREATE]?: boolean;
      [Permissions.SHARE]?: boolean;
      [Permissions.SHARE_PUBLIC]?: boolean;
    };
    [PermissionTypes.SCHEDULES]?: {
      [Permissions.USE]?: boolean;
      [Permissions.CREATE]?: boolean;
    };
  };
  tenantId?: string;
  /** Immutable role identifier. System roles: the uppercased name (`ADMIN`/`USER`). Custom roles: the doc `_id` as a string. Every role reference (`user.role`, `parentRole`, ROLE principals) holds this. Filled by a `pre('validate')` hook when omitted. */
  roleKey: string;
  /** `roleKey` of the parent role in the hierarchy tree. `null`/`undefined` = top-level branch. `ADMIN`/`USER` never set this. */
  parentRole?: string | null;
  /** Denormalized tree depth (0 for USER, ADMIN, and top-level branches). Display/pre-check only — never used for authorization. */
  depth?: number;
}

export type RolePermissions = IRole['permissions'];
export type RolePermissionsInput = DeepPartial<RolePermissions>;

export interface CreateRoleRequest {
  name: string;
  description?: string;
  permissions: RolePermissionsInput;
}

export interface UpdateRoleRequest {
  name?: string;
  description?: string;
  permissions?: RolePermissionsInput;
}

export interface RoleFilterOptions extends CursorPaginationParams {
  // Includes role name
  search?: string;
  hasPermission?: string;
}
