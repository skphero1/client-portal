import DataLoader from 'dataloader';
import type { Invoice, Project } from '@prisma/client';
import type { TenantScopedRepository, TicketWithAuthor } from '@/repositories/tenantRepository';

export interface RequestLoaders {
  projectById: DataLoader<string, Project | null>;
  invoicesByProjectId: DataLoader<string, Invoice[]>;
  ticketsByProjectId: DataLoader<string, TicketWithAuthor[]>;
}

/**
 * Instantiates fresh DataLoaders for a single GraphQL HTTP request.
 *
 * Two DataLoader invariants are enforced here:
 * 1. Request scoping: Loaders are NEVER shared across requests, guaranteeing Client A and
 *    Client B cannot read each other's memoized entries during concurrent requests.
 * 2. Key-order preservation: Every batch function returns an array of the exact same length
 *    and order as `keys`, defaulting to `[]` or `null` when a parent has zero child rows.
 */
export function createRequestLoaders(repo: TenantScopedRepository): RequestLoaders {
  return {
    projectById: new DataLoader<string, Project | null>(async (projectIds) => {
      const projects = await repo.findProjectsByIds(projectIds);
      const byId = new Map<string, Project>();
      for (const project of projects) {
        byId.set(project.id, project);
      }
      return projectIds.map((id) => byId.get(id) ?? null);
    }),

    invoicesByProjectId: new DataLoader<string, Invoice[]>(async (projectIds) => {
      const invoices = await repo.findInvoicesByProjectIds(projectIds);
      const grouped = new Map<string, Invoice[]>();
      for (const invoice of invoices) {
        const list = grouped.get(invoice.projectId);
        if (list) {
          list.push(invoice);
        } else {
          grouped.set(invoice.projectId, [invoice]);
        }
      }
      return projectIds.map((projectId) => grouped.get(projectId) ?? []);
    }),

    ticketsByProjectId: new DataLoader<string, TicketWithAuthor[]>(async (projectIds) => {
      const tickets = await repo.findTicketsByProjectIds(projectIds);
      const grouped = new Map<string, TicketWithAuthor[]>();
      for (const ticket of tickets) {
        const list = grouped.get(ticket.projectId);
        if (list) {
          list.push(ticket);
        } else {
          grouped.set(ticket.projectId, [ticket]);
        }
      }
      return projectIds.map((projectId) => grouped.get(projectId) ?? []);
    }),
  };
}
