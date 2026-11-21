import type { PrismaClient } from '@prisma/client';
import { GraphQLError, type GraphQLSchema } from 'graphql';
import { createSchema, createYoga, type YogaInitialContext } from 'graphql-yoga';
import { createGraphQLContext, type GraphQLContext } from '@/graphql/context';
import { resolvers } from '@/graphql/resolvers';
import { typeDefs } from '@/graphql/typeDefs';
import { prisma as defaultPrisma } from '@/lib/prisma';

export type YogaExecutionContext = YogaInitialContext & GraphQLContext;

export function buildExecutableSchema(
  customResolvers: typeof resolvers = resolvers
): GraphQLSchema {
  return createSchema<YogaExecutionContext>({
    typeDefs,
    resolvers: customResolvers,
  });
}

export const graphqlSchema: GraphQLSchema = buildExecutableSchema();

export function createGraphQLServer(options?: {
  prisma?: PrismaClient;
  customResolvers?: typeof resolvers;
}) {
  const prismaClient = options?.prisma ?? defaultPrisma;
  const schema = options?.customResolvers
    ? buildExecutableSchema(options.customResolvers)
    : graphqlSchema;

  return createYoga({
    schema,
    graphqlEndpoint: '/api/graphql',
    graphiql: process.env.NODE_ENV !== 'production',
    maskedErrors: {
      maskError(error, message) {
        if (error instanceof GraphQLError && typeof error.extensions?.code === 'string') {
          return error;
        }
        return new GraphQLError(message, {
          extensions: { code: 'INTERNAL_SERVER_ERROR' },
        });
      },
    },
    context: async ({ request }) =>
      createGraphQLContext({
        request,
        prisma: prismaClient,
      }),
  });
}
