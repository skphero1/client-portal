import { GraphQLError } from 'graphql';

export type ErrorCode =
  | 'BAD_USER_INPUT'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INTERNAL_SERVER_ERROR';

export function createDomainError(message: string, code: ErrorCode): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code },
  });
}

export function badUserInputError(message: string): GraphQLError {
  return createDomainError(message, 'BAD_USER_INPUT');
}

export function unauthenticatedError(message = 'Authentication required.'): GraphQLError {
  return createDomainError(message, 'UNAUTHENTICATED');
}

export function forbiddenError(message = 'You do not have permission to perform this action.'): GraphQLError {
  return createDomainError(message, 'FORBIDDEN');
}

/**
 * Intentionally generic message: callers outside a tenant's scope receive the exact
 * same error as callers requesting a non-existent record ID.
 */
export function notFoundError(resourceLabel: 'Project' | 'Invoice' | 'Ticket'): GraphQLError {
  return createDomainError(`${resourceLabel} not found.`, 'NOT_FOUND');
}
