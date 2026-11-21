import type {
  Invoice,
  PrismaClient,
  Project,
  Ticket,
  TicketPriority,
  TicketStatus,
  User,
} from '@prisma/client';
import type { AuthContext, PermittedTenantSummary } from '@/auth/session';
import { decodeProjectCursor, encodeProjectCursor } from '@/graphql/cursor';
import { forbiddenError, notFoundError } from '@/graphql/errors';

export type TicketWithAuthor = Ticket & {
  createdBy: Pick<User, 'id' | 'name' | 'email' | 'role'>;
};

export interface ProjectConnectionResult {
  edges: Array<{
    cursor: string;
    node: Project;
  }>;
  pageInfo: {
    hasNextPage: boolean;
    endCursor: string | null;
  };
}

/**
 * Centralized tenant-scoped data access layer.
 *
 * Every read and write in the GraphQL API flows through an instance of `TenantScopedRepository`
 * bound to the current caller's server-derived `AuthContext`. Neither direct lookups (`project(id)`,
 * `invoice(id)`), nested DataLoader batch queries (`Project.invoices`, `Project.tickets`), nor
 * mutations (`createTicket`, `updateTicketStatus`) can ever touch rows outside `auth.permittedTenantIds`.
 */
export class TenantScopedRepository {
  private readonly permittedSet: ReadonlySet<string>;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly auth: AuthContext
  ) {
    this.permittedSet = new Set(auth.permittedTenantIds);
  }

  /**
   * Intersects an optional UI filter (`tenantId`) with the caller's server-verified tenants.
   * Passing another tenant's ID never grants access; it narrows the intersection to `[]`.
   */
  private resolveScopedTenantIds(requestedTenantId?: string | null): string[] {
    if (!requestedTenantId) {
      return [...this.auth.permittedTenantIds];
    }
    return this.permittedSet.has(requestedTenantId) ? [requestedTenantId] : [];
  }

  async listProjectsPage(params: {
    first: number;
    after?: string | null;
    tenantId?: string | null;
  }): Promise<ProjectConnectionResult> {
    const scopedTenantIds = this.resolveScopedTenantIds(params.tenantId);
    if (scopedTenantIds.length === 0) {
      return {
        edges: [],
        pageInfo: { hasNextPage: false, endCursor: null },
      };
    }

    const decodedCursor = params.after ? decodeProjectCursor(params.after) : null;

    const rows = await this.prisma.project.findMany({
      where: {
        tenantId: { in: scopedTenantIds },
        ...(decodedCursor
          ? {
              OR: [
                { createdAt: { lt: decodedCursor.createdAt } },
                {
                  AND: [
                    { createdAt: decodedCursor.createdAt },
                    { id: { gt: decodedCursor.id } },
                  ],
                },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: params.first + 1,
    });

    const hasNextPage = rows.length > params.first;
    const pageRows = hasNextPage ? rows.slice(0, params.first) : rows;
    const edges = pageRows.map((project) => ({
      cursor: encodeProjectCursor({ createdAt: project.createdAt, id: project.id }),
      node: project,
    }));
    const lastEdge = edges[edges.length - 1];

    return {
      edges,
      pageInfo: {
        hasNextPage,
        endCursor: lastEdge ? lastEdge.cursor : null,
      },
    };
  }

  async findProjectById(projectId: string): Promise<Project | null> {
    if (this.auth.permittedTenantIds.length === 0) return null;
    return this.prisma.project.findFirst({
      where: {
        id: projectId,
        tenantId: { in: [...this.auth.permittedTenantIds] },
      },
    });
  }

  async findProjectsByIds(projectIds: readonly string[]): Promise<Project[]> {
    if (projectIds.length === 0 || this.auth.permittedTenantIds.length === 0) {
      return [];
    }
    return this.prisma.project.findMany({
      where: {
        id: { in: [...projectIds] },
        tenantId: { in: [...this.auth.permittedTenantIds] },
      },
    });
  }

  async findInvoiceById(invoiceId: string): Promise<Invoice | null> {
    if (this.auth.permittedTenantIds.length === 0) return null;
    return this.prisma.invoice.findFirst({
      where: {
        id: invoiceId,
        tenantId: { in: [...this.auth.permittedTenantIds] },
      },
    });
  }

  /**
   * Batched invoice lookup used by request-scoped DataLoader (`Project.invoices`).
   */
  async findInvoicesByProjectIds(projectIds: readonly string[]): Promise<Invoice[]> {
    if (projectIds.length === 0 || this.auth.permittedTenantIds.length === 0) {
      return [];
    }
    return this.prisma.invoice.findMany({
      where: {
        projectId: { in: [...projectIds] },
        tenantId: { in: [...this.auth.permittedTenantIds] },
      },
      orderBy: [{ issuedAt: 'desc' }, { id: 'asc' }],
    });
  }

  /**
   * Deliberately unbatched single-project lookup exposed ONLY for `scripts/benchmark-n-plus-1.ts`
   * so the teaching script still respects the same tenant boundary when demonstrating N+1 queries.
   */
  async findInvoicesForSingleProjectUnbatched(projectId: string): Promise<Invoice[]> {
    if (this.auth.permittedTenantIds.length === 0) return [];
    return this.prisma.invoice.findMany({
      where: {
        projectId,
        tenantId: { in: [...this.auth.permittedTenantIds] },
      },
      orderBy: [{ issuedAt: 'desc' }, { id: 'asc' }],
    });
  }

  /**
   * Batched ticket lookup used by request-scoped DataLoader (`Project.tickets`).
   */
  async findTicketsByProjectIds(projectIds: readonly string[]): Promise<TicketWithAuthor[]> {
    if (projectIds.length === 0 || this.auth.permittedTenantIds.length === 0) {
      return [];
    }
    return this.prisma.ticket.findMany({
      where: {
        projectId: { in: [...projectIds] },
        tenantId: { in: [...this.auth.permittedTenantIds] },
      },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
  }

  findPermittedTenantById(tenantId: string): PermittedTenantSummary | null {
    return this.auth.permittedTenants.find((t) => t.id === tenantId) ?? null;
  }

  async createTicket(params: {
    projectId: string;
    title: string;
    description: string;
    priority: TicketPriority;
  }): Promise<TicketWithAuthor> {
    const project = await this.findProjectById(params.projectId);
    if (!project) {
      // Foreign project IDs and unknown project IDs produce the exact same NOT_FOUND error.
      throw notFoundError('Project');
    }

    return this.prisma.ticket.create({
      data: {
        tenantId: project.tenantId,
        projectId: project.id,
        createdById: this.auth.userId,
        title: params.title,
        description: params.description,
        priority: params.priority,
        status: 'OPEN',
      },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    });
  }

  async updateTicketStatus(params: {
    ticketId: string;
    status: TicketStatus;
  }): Promise<TicketWithAuthor> {
    if (this.auth.role !== 'AGENCY_MANAGER') {
      throw forbiddenError('Only agency managers can update ticket status.');
    }

    const existingTicket = await this.prisma.ticket.findFirst({
      where: {
        id: params.ticketId,
        tenantId: { in: [...this.auth.permittedTenantIds] },
      },
    });

    if (!existingTicket) {
      throw notFoundError('Ticket');
    }

    return this.prisma.ticket.update({
      where: { id: existingTicket.id },
      data: { status: params.status },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    });
  }
}
