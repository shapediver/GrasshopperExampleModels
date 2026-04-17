/* This file contains utility functions and constants for the docs-cli tool. */
import { z } from 'zod';

/** The name of the JSON file holding information about ShapeDiver models used as examples. */
export const FILE_NAME_EXAMPLES = 'examples.json';

/** The schema of the JSON file holding information about ShapeDiver models used as examples. */
export const SCHEMA_EXAMPLES = z.record(
    z.string(),
    z.object({
        anchor: z.string(),
        slug: z.string(),
        title: z.string(),
        modelLink: z.boolean(),
        appLink: z.boolean(),
        rating: z.number().min(1).max(3).int(),
        docLink: z.string(),
        videoLink: z.string(),
        files: z.array(z.string()),
    })
);
