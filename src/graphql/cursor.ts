import { z } from 'zod';
import { badUserInputError } from '@/graphql/errors';

const cursorPayloadSchema = z.object({
  createdAt: z.string().refine((val) => !Number.isNaN(Date.parse(val)), {
    message: 'Invalid cursor timestamp',
  }),
  id: z.string().min(1),
});

export interface DecodedProjectCursor {
  createdAt: Date;
  id: string;
}

export function encodeProjectCursor(input: { createdAt: Date; id: string }): string {
  const json = JSON.stringify({
    createdAt: input.createdAt.toISOString(),
    id: input.id,
  });
  return Buffer.from(json, 'utf8').toString('base64url');
}

export function decodeProjectCursor(rawCursor: string): DecodedProjectCursor {
  try {
    const decodedText = Buffer.from(rawCursor, 'base64url').toString('utf8');
    const parsedJson: unknown = JSON.parse(decodedText);
    const validated = cursorPayloadSchema.parse(parsedJson);
    return {
      createdAt: new Date(validated.createdAt),
      id: validated.id,
    };
  } catch {
    throw badUserInputError('Invalid pagination cursor.');
  }
}
