import type { TConversation, TMessage } from '../schemas';

export interface TAdminRole {
  /** Immutable identifier: `"ADMIN"`/`"USER"` for system roles, the `_id` string for custom roles. Every role reference uses this. */
  roleKey: string;
  name: string;
  description?: string;
  permissions?: Record<string, Record<string, boolean>>;
  /** Parent role's `roleKey` in the hierarchy tree; `null` for a top-level branch, ADMIN, or USER. */
  parentRole?: string | null;
  /** Denormalized tree depth (0 for top-level branches, ADMIN, USER). Display only. */
  depth?: number;
}

/** The caller's own hierarchy access, from `GET /api/admin/hierarchy/me`. */
export interface TMyHierarchy {
  isAdmin: boolean;
  canViewSubordinates: boolean;
  viewableRoleKeys: string[];
  manageableRoleKeys: string[];
}

export interface TAdminRoleListResponse {
  roles: Array<TAdminRole & { _id?: string }>;
  total: number;
  limit: number;
  offset: number;
}

export interface TAdminMember {
  userId: string;
  name: string;
  email: string;
  avatarUrl?: string;
}

export interface TAdminMemberListResponse {
  members: TAdminMember[];
  total: number;
  limit: number;
  offset: number;
}

export interface TAdminUserListItem {
  id: string;
  name: string;
  username: string;
  email: string;
  avatar: string;
  role: string;
  provider: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface TAdminUserListResponse {
  users: TAdminUserListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface TAdminUserSearchResult {
  id: string;
  name: string;
  email: string;
  username?: string;
  avatarUrl?: string;
}

export interface TAdminUserSearchResponse {
  users: TAdminUserSearchResult[];
  total: number;
  capped: boolean;
}

export interface TAdminUserConversationsResponse {
  conversations: TConversation[];
  nextCursor: string | null;
}

export type TAdminUserMessagesResponse = TMessage[];
