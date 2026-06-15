/* This file contains utility functions and constants for the docs-cli tool. */
import { z } from 'zod';

/** The name of the JSON file holding information about ShapeDiver models used as examples. */
export const FILE_NAME_EXAMPLES = 'examples.json';

/** The name of the Markdown file holding definitions for ShapeDiver models used as examples. */
export const FILE_NAME_DEFINITIONS = 'definitions.md';

/** The schema of the JSON file holding information about ShapeDiver models used as examples. */
export const SCHEMA_EXAMPLES = z.record(
    z.string(),
    z.object({
        /**
         * The name of the markdown comment that acts as a placeholder for a single table.
         * Format:
         *   `[anchor]: #`, where "anchor" is the name of the markdown comment.
         *   The markdown comment must be unique across all example definitions.
         */
        anchor: z.string().min(1),

        /** The slug of the ShapeDiver model. */
        slug: z.string(),

        /** The title of the ShapeDiver model. */
        title: z.string().min(1),

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

        /** The ShapeDiver documentation link for the example. */
        docLink: z.string(),

        /** The video link for the example. */
        videoLink: z.string(),

        /**
         * List of auxiliary Grasshopper files that are shown next to the model's GH file's download
         * link. Each key is a file description and each value is a file name.
         */
        ghFiles: z.record(z.string(), z.string()),

        /**
         * List of additional non-Grasshopper files, where each key is a file description and each
         * value is a file name.
         */
        files: z.record(z.string(), z.string()),
    })
);
export type Examples = z.infer<typeof SCHEMA_EXAMPLES>;

/** A regular expression to match markdown anchors in the format of `[anchor]: #`. */
export const MDBOOK_ANCHOR_REGEX = new RegExp(/^\[([^\]]+)\]: #$/, 'gm');
