import type { TConversation, TMessage } from '../schemas';

export interface TAdminRole {
  name: string;
  description?: string;
  permissions?: Record<string, Record<string, boolean>>;
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
