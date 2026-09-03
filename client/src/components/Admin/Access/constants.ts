import { SystemRoles } from 'librechat-data-provider';

/** Roles the backend refuses to rename or delete — the delete/rename UI hides for these. */
export const SYSTEM_ROLES = new Set<string>([SystemRoles.ADMIN, SystemRoles.USER]);
