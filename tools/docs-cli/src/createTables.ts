import fs from 'fs';
import path from 'path';
import {
    Examples,
    FILE_NAME_DEFINITIONS,
    FILE_NAME_EXAMPLES,
    MDBOOK_ANCHOR_REGEX,
    SCHEMA_EXAMPLES,
} from './utils';

(function () {
    const mdbookPath = process.argv[2];
    if (!fs.existsSync(mdbookPath)) {
        console.error(`Path to mdbook does not exist: ${mdbookPath}`);
        process.exit(1);
    }

    // Find all folders one level deep in mdbook directory that contain an example file
    const foldersWithExampleFile = fs
        .readdirSync(mdbookPath, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .filter((entry) => fs.existsSync(path.join(mdbookPath, entry.name, FILE_NAME_EXAMPLES)));

    if (foldersWithExampleFile.length === 0) {
        console.warn('No example files found in mdbook directory - nothing to do.');
        process.exit(0);
    }

    for (const folderWithExampleFile of foldersWithExampleFile) {
        const dir = path.join(mdbookPath, folderWithExampleFile.name),
            tables: { [anchor: string]: Examples[] } = {};

        console.log('Processing folder:', dir);

        try {
            // Parse and validate examples JSON file
            const examplesFile = path.join(dir, FILE_NAME_EXAMPLES),
                fileContent = fs.readFileSync(examplesFile, 'utf-8'),
                jsonData = JSON.parse(fileContent),
                examplesData = SCHEMA_EXAMPLES.parse(jsonData);

            // Parse description markdown file
            const markdownFile = path.join(dir, FILE_NAME_DEFINITIONS),
                markdownData = fs.readFileSync(markdownFile, 'utf-8');

            // Group examples by their anchor property
            for (const [ghxName, example] of Object.entries(examplesData)) {
                const { anchor } = example;
                if (!tables[anchor]) tables[anchor] = [];
                tables[anchor].push({ [ghxName]: example });
            }

            // Validate anchor count matches
            const tableEntries = Object.entries(tables);
            const matches = [...markdownData.matchAll(MDBOOK_ANCHOR_REGEX)];
            if (matches.length !== tableEntries.length) {
                throw new Error(`Number of anchors in markdown file (${matches.length}) does not
match number of unique anchors in examples JSON (${tableEntries.length}).`);
            }

            // Replace each anchor line with its generated table
            const updatedMarkdown = markdownData.replace(MDBOOK_ANCHOR_REGEX, (_, anchor) =>
                createTable(tables[anchor] ?? [])
            );

            fs.writeFileSync(path.join(dir, FILE_NAME_DEFINITIONS), updatedMarkdown, 'utf-8');
        } catch (e) {
            console.error('ERROR:', e);
            process.exit(1);
        }
    }
})();

/** Converts a numeric rating (1-3) into a string of star characters. */
function ratingToStars(rating: number): string {
    return Array.from({ length: 3 }, (_, i) => (i < rating ? '★' : '☆')).join(' ');
}

/** Creates an optional markdown link for boolean-or-string example metadata fields. */
function createOptionalLink(icon: string, value: false | string): string {
    return value ? `[${icon}](${value})` : '';
}

/**
 * Creates a markdown table from the given examples, including conditional resources column if any
 * example has links.
 * @param examples The examples to include in the table, grouped by their anchor.
 */
function createTable(examples: Examples[]): string {
    const hasResources = examples.some((example) =>
        Object.values(example).some((e) => e.docLink || e.videoLink)
    );
    const hasFiles = examples.some((example) =>
        Object.values(example).some((e) => e.files && Object.keys(e.files).length > 0)
    );

    const columns = [
        'Ref',
        ...(hasResources ? ['Resources'] : []),
        'Description',
        'ShapeDiver links',
        'Grasshopper definition',
        ...(hasFiles ? ['Files'] : []),
        'Level&nbsp;&nbsp;&nbsp;&nbsp;',
    ];

    const header = `| ${columns.join(' | ')} |\n| ${columns.map(() => '---').join(' | ')} |\n`;

    const rows = examples.map((example) => {
        const [[ghxName, data]] = Object.entries(example);
        const ref = `**${ghxName.split('/').at(-1)!.split('-')[0]}**`;
        const resourceCell = hasResources
            ? [createOptionalLink('📖', data.docLink), createOptionalLink('🎥', data.videoLink)]
                  .filter(Boolean)
                  .join(' ')
            : null;
        const shapeDiverLinks = [
            data.modelLink ? `[Model](https://www.shapediver.com/app/m/${data.slug})` : '',
            typeof data.appLink === 'string'
                ? `[App](${data.appLink})`
                : data.appLink
                  ? `[App](https://www.shapediver.com/app/builder/v1/main/latest/?slug=${data.slug}&redirect=0)`
                  : '',
        ]
            .filter(Boolean)
            .join(' / ');
        const ghDefinitionCell = [
            `[Download](${ghxName})`,
            ...Object.entries(data.ghFiles).map(([name, path]) => `[${name}](${path})`),
        ].join(' / ');
        const filesCell = Object.entries(data.files)
            .map(([name, path]) => `[${name}](${path})`)
            .join(' / ');

        const cells = [
            ref,
            ...(resourceCell !== null ? [resourceCell] : []),
            data.description,
            shapeDiverLinks,
            ghDefinitionCell,
            ...(hasFiles ? [filesCell] : []),
            ratingToStars(data.rating),
        ];

        return `| ${cells.join(' | ')} |`;
    });

    return header + rows.join('\n') + '\n';
}
