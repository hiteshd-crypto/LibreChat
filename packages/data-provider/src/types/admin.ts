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
  /** Present when the caller holds `DEPARTMENT_HEAD` for their own branch. */
  departmentHead?: {
    departmentId: string;
    departmentName: string;
    rootRoleKey: string;
  };
  /** Whether the caller holds `READ_AUDIT_LOG`, independent of `isAdmin`. */
  canReadAuditLog: boolean;
}

/** A Department is a thin label over one top-level custom-role branch. */
export interface TDepartment {
  _id: string;
  name: string;
  /** `null` until a top-level role is created for this department — a
   * department starts completely empty. */
  rootRoleKey: string | null;
  createdAt?: string;
  /** Users holding the branch-root role or any role beneath it, as returned by the list endpoint. */
  memberCount?: number;
}

export interface TDepartmentListResponse {
  departments: TDepartment[];
}

export interface TCreateDepartmentBody {
  name: string;
  /** Omitted to create an empty department; set to wrap an existing top-level role. */
  rootRoleKey?: string;
}

export interface TRenameDepartmentBody {
  name: string;
}

/** `PATCH /api/admin/departments/:id/head` — wraps an existing top-level role
 * as an already-created, still-empty department's head. */
export interface TSetDepartmentHeadBody {
  roleKey: string;
}

/** A department's balance: pool balance + the sum of every member's personal `tokenCredits` —
 * the department's total wealth under this model. From `GET /api/admin/departments/:id/balance`. */
export interface TDepartmentBalanceResponse {
  poolBalance: number;
  totalBalance: number;
}

export interface TDepartmentGrantBody {
  amount: number;
}

export interface TDepartmentGrantResponse {
  poolBalance: number;
}

/** One member of the caller's own department (DEPARTMENT_HEAD included — no root exclusion). */
export interface TDepartmentMember {
  userId: string;
  name: string;
  email: string;
}

export interface TDepartmentMembersResponse {
  members: TDepartmentMember[];
}

export interface TDisbursePreviewRequest {
  recipientUserIds: string[];
  totalAmount: number;
}

export interface TDisbursePreviewRow {
  userId: string;
  name: string;
  currentBalance: number;
  newBalance: number;
}

export interface TDisbursePreviewResponse {
  poolBalance: number;
  perRecipientAmount: number;
  rows: TDisbursePreviewRow[];
}

export interface TDisburseConfirmRequest {
  recipientUserIds: string[];
  totalAmount: number;
  expectedPoolBalance: number;
  /** The current balances shown in the preview, keyed by userId — a staleness check only; the
   * server always recomputes the actual allocation and new balances itself. */
  expectedBalances: Record<string, number>;
}

export interface TDisburseConfirmRow {
  userId: string;
  name: string;
  previousBalance: number;
  newBalance: number;
}

export interface TDisburseConfirmResponse {
  poolBalance: number;
  rows: TDisburseConfirmRow[];
  committedAt: string;
}

export interface TTransferPreviewRequest {
  fromUserId: string;
  toUserId: string;
  amount: number;
}

export interface TTransferSide {
  userId: string;
  name: string;
  currentBalance: number;
  newBalance: number;
}

export interface TTransferPreviewResponse {
  from: TTransferSide;
  to: TTransferSide;
}

export interface TTransferConfirmRequest {
  fromUserId: string;
  toUserId: string;
  amount: number;
  expectedFromBalance: number;
  expectedToBalance: number;
}

export interface TTransferConfirmSide {
  userId: string;
  name: string;
  previousBalance: number;
  newBalance: number;
}

export interface TTransferConfirmResponse {
  from: TTransferConfirmSide;
  to: TTransferConfirmSide;
  committedAt: string;
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

/** A standard-category pricing rate: USD per 1M tokens, keyed by model. */
export interface TAdminPricingRate {
  modelKey: string;
  prompt: number;
  completion: number;
  updatedAt?: string;
}

export interface TAdminPricingListResponse {
  rates: TAdminPricingRate[];
}

export interface TAdminPricingCreateBody {
  modelKey: string;
  prompt: number;
  completion: number;
}

export type TAdminPricingUpdateBody = Partial<
  Pick<TAdminPricingCreateBody, 'prompt' | 'completion'>
>;

export interface TAdminPricingMutationResponse {
  rate: TAdminPricingRate;
  /** `false` when the row was saved but the in-memory pricing cache failed to reload. */
  cacheReloaded: boolean;
}

export interface TAdminPricingDeleteResponse {
  success: boolean;
  cacheReloaded: boolean;
}

/** A user's token balance. `tokenCredits` is 0 and `hasRecord` false when no balance document exists. */
export interface TAdminUserBalance {
  userId: string;
  /** 1000 tokenCredits = $0.001 USD. */
  tokenCredits: number;
  hasRecord: boolean;
}

export interface TAdminUserBalanceUpdateBody {
  tokenCredits: number;
  /**
   * The balance the caller last saw: a number, or `null` when it saw no balance record.
   * When present, the save is rejected with 409 if the stored value has since changed.
   */
  expectedTokenCredits?: number | null;
}

/** The 409 body returned when a guarded balance save finds the value changed. */
export interface TAdminUserBalanceConflict {
  error: string;
  balance: TAdminUserBalance;
}

/** One of a root user's current descendants in the role hierarchy — an eligible grant recipient. */
export interface TTokenGrantDescendant {
  userId: string;
  name: string;
  email: string;
}

export interface TTokenGrantDescendantsResponse {
  descendants: TTokenGrantDescendant[];
}

export interface TTokenGrantPreviewRequest {
  rootUserId: string;
  recipientUserIds: string[];
  totalAmount: number;
}

export interface TTokenGrantPreviewRow {
  userId: string;
  name: string;
  currentBalance: number;
  newBalance: number;
}

export interface TTokenGrantPreviewResponse {
  /** The identical amount every participant (root + recipients) receives — no remainder. */
  perParticipantAmount: number;
  rows: TTokenGrantPreviewRow[];
}

export interface TTokenGrantConfirmRequest {
  rootUserId: string;
  recipientUserIds: string[];
  totalAmount: number;
  /** The current balances shown in the preview, keyed by userId — used only as a staleness
   * check; the server always recomputes the actual allocation and new balances itself. */
  expectedBalances: Record<string, number>;
}

export interface TTokenGrantConfirmRow {
  userId: string;
  name: string;
  previousBalance: number;
  newBalance: number;
}

export interface TTokenGrantConfirmResponse {
  rows: TTokenGrantConfirmRow[];
  committedAt: string;
}

/** The 409 body returned when a participant's live balance no longer matches the preview. */
export interface TTokenGrantStaleError {
  error: string;
  stale: Array<{ userId: string; expected: number; current: number }>;
}

/** Denormalized actor identity captured at write time on an audit entry. */
export interface TAdminAuditActor {
  type: string;
  id?: string;
  name: string;
}

/** Generic target of an audited action — a user, department, role, etc. */
export interface TAdminAuditTarget {
  type: string;
  id?: string;
  name?: string;
}

/** Audit log entry as returned by `GET /api/admin/audit-log`. */
export interface TAdminAuditLogEntry {
  id: string;
  category: string;
  action: string;
  outcome: string;
  severity: string;
  actor: TAdminAuditActor;
  target: TAdminAuditTarget;
  metadata?: Record<string, string | number | boolean | null>;
  context?: { requestId?: string; ip?: string; userAgent?: string; sessionId?: string };
  tenantId?: string;
  integrity: { seq: number; hash: string; prevHash: string };
  /** ISO 8601 string. */
  timestamp: string;
}

export interface TAdminAuditLogListParams {
  limit?: number;
  offset?: number;
  action?: string;
  outcome?: string;
  from?: string;
  to?: string;
  targetType?: string;
  targetQuery?: string;
}

export interface TAdminAuditLogListResponse {
  entries: TAdminAuditLogEntry[];
  total: number;
  /** Pass as `cursor` to fetch the next page; `null` when the page is the last. */
  nextCursor: number | null;
}

export interface TAdminAuditLogVerifyResponse {
  ok: boolean;
  chainKey: string;
  checked: number;
  brokenAt?: number;
  reason?: string;
  range?: { firstSeq: number; lastSeq: number };
}
