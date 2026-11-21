import type { PrismaClient, Role } from '@prisma/client';
import { unauthenticatedError } from '@/graphql/errors';

export const DEMO_IDENTITY_HEADER = 'x-demo-user';
export const DEMO_IDENTITY_COOKIE = 'sysfortech_demo_user';

export const PREDEFINED_DEMO_IDENTITIES = [
  {
    demoKey: 'client-northstar',
    label: 'Amina Patel (Northstar Client)',
    organization: 'Northstar Craft Roasters',
    roleBadge: 'CLIENT',
  },
  {
    demoKey: 'client-harborline',
    label: 'Marcus Thorne (Harborline Client)',
    organization: 'Harborline Marine Logistics',
    roleBadge: 'CLIENT',
  },
  {
    demoKey: 'manager-sysfortech',
    label: 'Elena Rostova (Sysfortech Manager)',
    organization: 'Sysfortech Web Agency',
    roleBadge: 'AGENCY_MANAGER',
  },
] as const;

export type PredefinedDemoKey = (typeof PREDEFINED_DEMO_IDENTITIES)[number]['demoKey'];

export interface PermittedTenantSummary {
  id: string;
  slug: string;
  name: string;
  industry: string;
}

export interface AuthContext {
  userId: string;
  demoKey: string;
  email: string;
  name: string;
  title: string;
  role: Role;
  permittedTenantIds: readonly string[];
  permittedTenants: readonly PermittedTenantSummary[];
}

function readCookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const [rawKey, ...rest] = part.trim().split('=');
    if (rawKey === name && rest.length > 0) {
      return decodeURIComponent(rest.join('='));
    }
  }
  return null;
}

/**
 * Resolves the caller's identity, role, and permitted tenants strictly on the server.
 *
 * DEMO AUTH NOTE:
 * In this local portfolio demo, the browser selects one of three predefined demo keys
 * via `x-demo-user` header or `sysfortech_demo_user` cookie. Crucially, the client never
 * supplies roles or permitted tenant IDs; those are always loaded from PostgreSQL
 * (`User` + `TenantMembership`). Any unknown `x-demo-user` value is rejected with UNAUTHENTICATED.
 */
export async function resolveAuthContext(
  request: Request,
  prisma: PrismaClient
): Promise<AuthContext> {
  const headerDemoKey = request.headers.get(DEMO_IDENTITY_HEADER)?.trim() || null;
  const cookieDemoKey = readCookieValue(request.headers.get('cookie'), DEMO_IDENTITY_COOKIE);
  const fallbackDemoKey = process.env.DEFAULT_DEMO_USER?.trim() || 'client-northstar';

  const effectiveDemoKey = headerDemoKey ?? cookieDemoKey ?? fallbackDemoKey;

  const user = await prisma.user.findUnique({
    where: { demoKey: effectiveDemoKey },
    include: {
      memberships: {
        include: {
          tenant: true,
        },
        orderBy: {
          tenantId: 'asc',
        },
      },
    },
  });

  if (!user) {
    throw unauthenticatedError(
      `Unknown demo identity "${effectiveDemoKey}". Use one of: client-northstar, client-harborline, manager-sysfortech.`
    );
  }

  const permittedTenants: PermittedTenantSummary[] = user.memberships.map((m) => ({
    id: m.tenant.id,
    slug: m.tenant.slug,
    name: m.tenant.name,
    industry: m.tenant.industry,
  }));

  return {
    userId: user.id,
    demoKey: user.demoKey,
    email: user.email,
    name: user.name,
    title: user.title,
    role: user.role,
    permittedTenantIds: permittedTenants.map((t) => t.id),
    permittedTenants,
  };
}
