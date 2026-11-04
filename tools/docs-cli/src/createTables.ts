import fs from 'fs';
import path from 'path';
import {
    createAppUrl,
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

/** Converts a numeric rating (1-3) into a compact star marker with a text label. */
function ratingToStars(rating: number): string {
    const labels = ['', 'Beginner', 'Intermediate', 'Expert'];
    const filled = Math.min(Math.max(rating, 0), 3);
    const label = labels[filled] ?? '';
    const on = '★'.repeat(filled);
    const off = '☆'.repeat(3 - filled);
    return `<span class="level" title="${label}"><span class="on">${on}</span><span class="off">${off}</span></span>`;
}

/** Renders a short action link. Description prose stays ordinary markdown. */
function chip(label: string, href: string): string {
    const external = /^https?:/i.test(href);
    const extra = external ? ' target="_blank" rel="noopener noreferrer"' : '';
    const safeHref = href.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    return `<a class="chip" href="${safeHref}"${extra}>${label}</a>`;
}

/** Creates an optional action link for boolean-or-string example metadata fields. */
function createOptionalLink(label: string, value: false | string): string {
    return value ? chip(label, value) : '';
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
        'Level',
    ];

    const header = `| ${columns.join(' | ')} |\n| ${columns.map(() => '---').join(' | ')} |\n`;

    const rows = examples.map((example) => {
        const [[ghxName, data]] = Object.entries(example);
        const ref = `<span class="ref">${ghxName.split('/').at(-1)!.split('-')[0]}</span>`;
        const resourceCell = hasResources
            ? [createOptionalLink('Docs', data.docLink), createOptionalLink('Video', data.videoLink)]
                  .filter(Boolean)
                  .join(' ')
            : null;
        const appUrl = createAppUrl(data.slug, data.appLink);
        const shapeDiverLinks = [
            data.modelLink ? chip('Model', `https://www.shapediver.com/app/m/${data.slug}`) : '',
            appUrl ? chip('App', appUrl) : '',
        ]
            .filter(Boolean)
            .join(' ');
        const ghDefinitionCell = [
            chip('Download', ghxName),
            ...Object.entries(data.ghFiles).map(([name, path]) => chip(name, path)),
        ].join(' ');
        const filesCell = Object.entries(data.files)
            .map(([name, path]) => chip(name, path))
            .join(' ');

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
