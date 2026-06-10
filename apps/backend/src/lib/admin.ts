type AuditUser = {
  id: string;
  email: string | null;
  displayName: string | null;
};

const ADMIN_EMAILS = new Set(["joshlebed@gmail.com"]);

function normalizedEmail(email: string | null | undefined): string | null {
  const trimmed = email?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

function isAdminEmail(email: string | null | undefined): boolean {
  const normalized = normalizedEmail(email);
  return normalized !== null && ADMIN_EMAILS.has(normalized);
}

export function isAdminUser(user: Pick<AuditUser, "email">): boolean {
  return isAdminEmail(user.email);
}

export function userLabel(user: AuditUser): string {
  return user.displayName?.trim() || user.email || user.id;
}

export function auditUserLabel(user: AuditUser): string {
  const label = userLabel(user);
  const parts = [label];
  if (user.email && user.email !== label) parts.push(user.email);
  parts.push(user.id);
  return parts.join(", ");
}
