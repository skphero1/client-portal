import type { Invoice, Project } from '@prisma/client';
import { z } from 'zod';
import type { GraphQLContext } from '@/graphql/context';
import { badUserInputError, createDomainError, forbiddenError } from '@/graphql/errors';
import type { TicketWithAuthor } from '@/repositories/tenantRepository';

const projectsQueryArgsSchema = z.object({
  first: z
    .number()
    .int('Argument "first" must be an integer.')
    .min(1, 'Argument "first" must be between 1 and 50.')
    .max(50, 'Argument "first" must be between 1 and 50.')
    .nullish()
    .transform((val) => val ?? 10),
  after: z.string().min(1).nullish(),
  tenantId: z.string().min(1).nullish(),
});

const byIdArgsSchema = z.object({
  id: z.string().trim().min(1, 'ID must not be empty.'),
});

const createTicketArgsSchema = z.object({
  projectId: z.string().trim().min(1, 'Project ID must not be empty.'),
  input: z.object({
    title: z
      .string()
      .trim()
      .min(5, 'Ticket title must be between 5 and 120 characters.')
      .max(120, 'Ticket title must be between 5 and 120 characters.'),
    description: z
      .string()
      .trim()
      .min(10, 'Ticket description must be between 10 and 2,000 characters.')
      .max(2000, 'Ticket description must be between 10 and 2,000 characters.'),
    priority: z
      .enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
      .nullish()
      .transform((val) => val ?? 'MEDIUM'),
  }),
});

const updateTicketStatusArgsSchema = z.object({
  ticketId: z.string().trim().min(1, 'Ticket ID must not be empty.'),
  status: z.enum(['OPEN', 'IN_PROGRESS', 'WAITING_ON_CLIENT', 'RESOLVED']),
});

const invoiceLineItemSchema = z.object({
  label: z.string(),
  hours: z.number(),
  rateCents: z.number().int(),
  subtotalCents: z.number().int(),
});

function parseOrBadInput<TOutput>(
  schema: z.ZodType<TOutput, z.ZodTypeDef, unknown>,
  value: unknown
): TOutput {
  const result = schema.safeParse(value);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    throw badUserInputError(firstIssue?.message ?? 'Invalid input.');
  }
  return result.data;
}

export const resolvers = {
  Query: {
    viewer: (_parent: unknown, _args: unknown, ctx: GraphQLContext) => ({
      id: ctx.auth.userId,
      demoKey: ctx.auth.demoKey,
      name: ctx.auth.name,
      email: ctx.auth.email,
      title: ctx.auth.title,
      role: ctx.auth.role,
      permittedTenants: ctx.auth.permittedTenants,
    }),

    projects: async (_parent: unknown, rawArgs: unknown, ctx: GraphQLContext) => {
      const validated = parseOrBadInput(projectsQueryArgsSchema, rawArgs ?? {});
      return ctx.repo.listProjectsPage({
        first: validated.first,
        after: validated.after,
        tenantId: validated.tenantId,
      });
    },

    project: async (_parent: unknown, rawArgs: unknown, ctx: GraphQLContext) => {
      const { id } = parseOrBadInput(byIdArgsSchema, rawArgs);
      return ctx.repo.findProjectById(id);
    },

    invoice: async (_parent: unknown, rawArgs: unknown, ctx: GraphQLContext) => {
      const { id } = parseOrBadInput(byIdArgsSchema, rawArgs);
      return ctx.repo.findInvoiceById(id);
    },
  },

  Mutation: {
    createTicket: async (_parent: unknown, rawArgs: unknown, ctx: GraphQLContext) => {
      const { projectId, input } = parseOrBadInput(createTicketArgsSchema, rawArgs);
      return ctx.repo.createTicket({
        projectId,
        title: input.title,
        description: input.description,
        priority: input.priority,
      });
    },

    updateTicketStatus: async (_parent: unknown, rawArgs: unknown, ctx: GraphQLContext) => {
      if (ctx.auth.role !== 'AGENCY_MANAGER') {
        throw forbiddenError('Only agency managers can update ticket status.');
      }
      const { ticketId, status } = parseOrBadInput(updateTicketStatusArgsSchema, rawArgs);
      return ctx.repo.updateTicketStatus({ ticketId, status });
    },
  },

  Project: {
    targetLaunchDate: (project: Project) =>
      project.targetLaunchDate ? project.targetLaunchDate.toISOString() : null,
    createdAt: (project: Project) => project.createdAt.toISOString(),
    updatedAt: (project: Project) => project.updatedAt.toISOString(),
    tenant: (project: Project, _args: unknown, ctx: GraphQLContext) => {
      const tenant = ctx.repo.findPermittedTenantById(project.tenantId);
      if (!tenant) {
        throw createDomainError('Tenant scope invariant violated.', 'INTERNAL_SERVER_ERROR');
      }
      return tenant;
    },
    invoices: (project: Project, _args: unknown, ctx: GraphQLContext) =>
      ctx.loaders.invoicesByProjectId.load(project.id),
    tickets: (project: Project, _args: unknown, ctx: GraphQLContext) =>
      ctx.loaders.ticketsByProjectId.load(project.id),
  },

  Invoice: {
    issuedAt: (invoice: Invoice) => invoice.issuedAt.toISOString(),
    dueAt: (invoice: Invoice) => invoice.dueAt.toISOString(),
    paidAt: (invoice: Invoice) => (invoice.paidAt ? invoice.paidAt.toISOString() : null),
    lineItems: (invoice: Invoice) => {
      const parsed = z.array(invoiceLineItemSchema).safeParse(invoice.lineItemsJson);
      return parsed.success ? parsed.data : [];
    },
    project: async (invoice: Invoice, _args: unknown, ctx: GraphQLContext) => {
      const project = await ctx.loaders.projectById.load(invoice.projectId);
      if (!project) {
        throw createDomainError('Parent project missing in tenant scope.', 'INTERNAL_SERVER_ERROR');
      }
      return project;
    },
  },

  Ticket: {
    createdAt: (ticket: TicketWithAuthor) => ticket.createdAt.toISOString(),
    updatedAt: (ticket: TicketWithAuthor) => ticket.updatedAt.toISOString(),
    project: async (ticket: TicketWithAuthor, _args: unknown, ctx: GraphQLContext) => {
      const project = await ctx.loaders.projectById.load(ticket.projectId);
      if (!project) {
        throw createDomainError('Parent project missing in tenant scope.', 'INTERNAL_SERVER_ERROR');
      }
      return project;
    },
  },
};
