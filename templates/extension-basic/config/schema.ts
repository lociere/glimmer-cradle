import { z } from 'zod';

export const MyExtensionConfigSchema = z
  .object({
    commands: z
      .object({
        ping: z.boolean().default(true),
      })
      .default({}),
    messages: z
      .object({
        greeting: z.string().default('hello'),
      })
      .default({}),
  })
  .passthrough();

export type MyExtensionConfig = z.infer<typeof MyExtensionConfigSchema>;
