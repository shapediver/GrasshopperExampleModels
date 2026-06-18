/* This file contains utility functions and constants for the docs-cli tool. */
import { z } from 'zod';

/** The name of the JSON file holding information about ShapeDiver models used as examples. */
export const FILE_NAME_EXAMPLES = 'examples.json';

/** The name of the Markdown file holding definitions for ShapeDiver models used as examples. */
export const FILE_NAME_DEFINITIONS = 'definitions.md';

/**
 * Strict string for metadata fields that are treated as user-authored identifiers or file paths.
 * Rejects empty strings, whitespace-only strings, and strings with leading/trailing whitespace.
 */
const SCHEMA_NON_EMPTY_TRIMMED_STRING = z
    .string()
    .min(1)
    .refine((value) => value.trim().length > 0, {
        message: 'String must not be empty or whitespace only.',
    })
    .refine((value) => value === value.trim(), {
        message: 'String must not have leading or trailing whitespace.',
    });

/** Optional documentation/video link fields are either disabled (`false`) or set explicitly. */
const SCHEMA_OPTIONAL_LINK = z.union([z.literal(false), SCHEMA_NON_EMPTY_TRIMMED_STRING]);

/**
 * Record schema that validates keys with detailed string errors instead of Zod's generic
 * "Invalid key in record" message.
 */
function createExamplesRecordSchema<T extends z.ZodTypeAny>(valueSchema: T) {
    return z.record(z.string(), valueSchema).superRefine((record, ctx) => {
        for (const key of Object.keys(record)) {
            const parsedKey = SCHEMA_NON_EMPTY_TRIMMED_STRING.safeParse(key);
            if (!parsedKey.success) {
                for (const issue of parsedKey.error.issues) {
                    ctx.addIssue({
                        ...issue,
                        path: [key, ...issue.path],
                    });
                }
            }
        }
    });
}

/** The schema of the JSON file holding information about ShapeDiver models used as examples. */
export const SCHEMA_EXAMPLES = createExamplesRecordSchema(
    z.object({
        /**
         * The name of the markdown comment that acts as a placeholder for a single table.
         * Format:
         *   `[anchor]: #`, where "anchor" is the name of the markdown comment.
         *   The markdown comment must be unique across all example definitions.
         */
        anchor: SCHEMA_NON_EMPTY_TRIMMED_STRING,

        /** The slug of the ShapeDiver model. */
        slug: z.string(),

        /** The title of the ShapeDiver model. */
        title: SCHEMA_NON_EMPTY_TRIMMED_STRING,

        /**
         * Indicates whether the model link should be included.
         * When `true`, the model link is generated from the slug.
         */
        modelLink: z.boolean(),

        /**
         * Indicates whether the ShapeDiver application link should be included. When `true`, the
         * AppBuilder link is generated from the slug. Alternatively, a string value can be provided
         * to directly specify the app link.
         */
        appLink: z.union([z.boolean(), z.string().min(1)]),

        /** The difficulty rating of the example. */
        rating: z.number().min(1).max(3).int(),

        /** Optional ShapeDiver documentation link for the example. */
        docLink: SCHEMA_OPTIONAL_LINK,

        /** Optional video link for the example. */
        videoLink: SCHEMA_OPTIONAL_LINK,

        /**
         * List of auxiliary Grasshopper files that are shown next to the model's GH file's download
         * link. Each key is a file description and each value is a file name.
         */
        ghFiles: createExamplesRecordSchema(SCHEMA_NON_EMPTY_TRIMMED_STRING),

        /**
         * List of additional non-Grasshopper files, where each key is a file description and each
         * value is a file name.
         */
        files: createExamplesRecordSchema(SCHEMA_NON_EMPTY_TRIMMED_STRING),
    })
);
export type Examples = z.infer<typeof SCHEMA_EXAMPLES>;

/** A regular expression to match markdown anchors in the format of `[anchor]: #`. */
export const MDBOOK_ANCHOR_REGEX = new RegExp(/^\[([^\]]+)\]: #$/, 'gm');
