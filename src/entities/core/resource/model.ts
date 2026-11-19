import { z } from 'zod';

// What the task detail reads of a resource a task reserved: its name, when it
// has one. Content has none, and a later server version may add anything, so
// nothing else is required and unknown fields are kept.
const resourceSchema = z.looseObject({
  name: z.string().nullish(),
});

type Resource = z.infer<typeof resourceSchema>;

export { resourceSchema };
export type { Resource };
