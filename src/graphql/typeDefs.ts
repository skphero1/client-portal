export const typeDefs = /* GraphQL */ `
  enum Role {
    CLIENT
    AGENCY_MANAGER
  }

  enum ProjectStatus {
    DISCOVERY
    ACTIVE
    QA_REVIEW
    COMPLETED
  }

  enum TicketStatus {
    OPEN
    IN_PROGRESS
    WAITING_ON_CLIENT
    RESOLVED
  }

  enum TicketPriority {
    LOW
    MEDIUM
    HIGH
    URGENT
  }

  enum InvoiceStatus {
    DRAFT
    ISSUED
    PAID
    OVERDUE
  }

  type Tenant {
    id: ID!
    slug: String!
    name: String!
    industry: String!
  }

  type Viewer {
    id: ID!
    demoKey: String!
    name: String!
    email: String!
    title: String!
    role: Role!
    permittedTenants: [Tenant!]!
  }

  type TicketAuthor {
    id: ID!
    name: String!
    email: String!
    role: Role!
  }

  type InvoiceLineItem {
    label: String!
    hours: Float!
    rateCents: Int!
    subtotalCents: Int!
  }

  type Invoice {
    id: ID!
    invoiceNumber: String!
    description: String!
    amountCents: Int!
    status: InvoiceStatus!
    issuedAt: String!
    dueAt: String!
    paidAt: String
    lineItems: [InvoiceLineItem!]!
    projectId: ID!
    project: Project!
  }

  type Ticket {
    id: ID!
    title: String!
    description: String!
    status: TicketStatus!
    priority: TicketPriority!
    createdAt: String!
    updatedAt: String!
    projectId: ID!
    project: Project!
    createdBy: TicketAuthor!
  }

  type Project {
    id: ID!
    code: String!
    name: String!
    summary: String!
    status: ProjectStatus!
    budgetCents: Int!
    targetLaunchDate: String
    createdAt: String!
    updatedAt: String!
    tenant: Tenant!
    invoices: [Invoice!]!
    tickets: [Ticket!]!
  }

  type ProjectEdge {
    cursor: String!
    node: Project!
  }

  type PageInfo {
    hasNextPage: Boolean!
    endCursor: String
  }

  type ProjectConnection {
    edges: [ProjectEdge!]!
    pageInfo: PageInfo!
  }

  input CreateTicketInput {
    title: String!
    description: String!
    priority: TicketPriority = MEDIUM
  }

  type Query {
    viewer: Viewer!
    projects(first: Int = 10, after: String, tenantId: ID): ProjectConnection!
    project(id: ID!): Project
    invoice(id: ID!): Invoice
  }

  type Mutation {
    createTicket(projectId: ID!, input: CreateTicketInput!): Ticket!
    updateTicketStatus(ticketId: ID!, status: TicketStatus!): Ticket!
  }
`;
