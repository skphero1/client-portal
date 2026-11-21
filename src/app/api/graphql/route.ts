import { createGraphQLServer } from '@/graphql/server';

const yoga = createGraphQLServer();

export async function GET(request: Request): Promise<Response> {
  return yoga.fetch(request);
}

export async function POST(request: Request): Promise<Response> {
  return yoga.fetch(request);
}

export async function OPTIONS(request: Request): Promise<Response> {
  return yoga.fetch(request);
}
