import type { PrismaClient } from '@prisma/client';
import { resolveAuthContext, type AuthContext } from '@/auth/session';
import { createRequestLoaders, type RequestLoaders } from '@/graphql/loaders';
import { TenantScopedRepository } from '@/repositories/tenantRepository';

export interface GraphQLContext {
  auth: AuthContext;
  repo: TenantScopedRepository;
  loaders: RequestLoaders;
}

export async function createGraphQLContext(params: {
  request: Request;
  prisma: PrismaClient;
}): Promise<GraphQLContext> {
  const auth = await resolveAuthContext(params.request, params.prisma);
  const repo = new TenantScopedRepository(params.prisma, auth);
  const loaders = createRequestLoaders(repo);

  return {
    auth,
    repo,
    loaders,
  };
}
