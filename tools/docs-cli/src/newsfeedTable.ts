import fs from 'fs';
import path from 'path';
import { FILE_NAME_DEFINITIONS } from './utils';

type TableExtractionResult = { table: string; reason: null } | { table: null; reason: string };

function createFallbackTable(title: string, description: string, slug: string): string {
    // This table keeps Newsfeed entries usable when generated docs are unavailable.
    return `| Tutorial | Description |
| --- | --- |
| [${title}](https://www.shapediver.com/app/m/${slug}) | ${description} |`;
}

function extractTable(definitionsPath: string, ref: string): TableExtractionResult {
    if (!fs.existsSync(definitionsPath)) {
        return { table: null, reason: 'the definitions file does not exist' };
    }

    let lines: string[];
    try {
        lines = fs.readFileSync(definitionsPath, 'utf-8').split(/\r?\n/);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { table: null, reason: `the definitions file could not be read: ${message}` };
    }

    let header: string | null = null;
    let separator: string | null = null;
    let referenceTableCount = 0;

    for (const line of lines) {
        // A chapter can contain several generated reference tables; retain the current header.
        if (line.startsWith('| Ref |')) {
            header = line;
            separator = null;
            referenceTableCount++;
            continue;
        }

        if (header !== null && separator === null) {
            separator = line;
            continue;
        }

        if (header !== null && line.startsWith('|')) {
            if (isTableRowForRef(line, ref)) {
                return { table: `${header}\n${separator}\n${line}`, reason: null };
            }
            continue;
        }

        header = null;
        separator = null;
    }

    if (referenceTableCount === 0) {
        return { table: null, reason: "no generated table with a '| Ref |' header was found" };
    }

    return {
        table: null,
        reason: `reference '${ref}' was not found in ${referenceTableCount} generated table(s)`,
    };
}

function isTableRowForRef(line: string, ref: string): boolean {
    // Generated tables use bold references, while older tables may use plain references.
    const escapedRef = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^\\|\\s*(?:\\*\\*)?${escapedRef}(?:\\*\\*)?\\s*\\|`).test(line);
}

function makeLinksAbsolute(table: string, chapterPath: string, repositoryUrl: string): string {
    const baseUrl = repositoryUrl.replace(/\/+$/, '');
    let rewrittenLinkCount = 0;

    const tableWithAbsoluteLinks = table.replace(
        /\]\(([^)]+)\)/g,
        (match, destination: string) => {
            // Newsfeed does not resolve chapter-relative links as mdBook does.
            if (/^(?:[a-z][a-z\d+.-]*:|#|\/)/i.test(destination)) return match;

            const absolutePath = path.posix.normalize(path.posix.join(chapterPath, destination));
            rewrittenLinkCount++;
            return `](${baseUrl}/${absolutePath})`;
        }
    );

    console.error(
        `Resolved ${rewrittenLinkCount} chapter-relative link(s) against '${baseUrl}/${chapterPath}'.`
    );
    return tableWithAbsoluteLinks;
}

(function () {
    // The workflow passes model metadata after the mdBook source path.
    const [mdbookPath, relativeFilePath, title, description, slug, repositoryUrl] =
        process.argv.slice(2);
    if (!mdbookPath || !relativeFilePath || !title || !description || !slug || !repositoryUrl) {
        console.error(
            '::error:: Usage: newsfeed-table <mdbook-path> <relative-file-path> <title> <description> <slug> <repository-url>'
        );
        console.error(`Received arguments: ${JSON.stringify(process.argv.slice(2))}`);
        process.exit(1);
    }

    const chapterPath = path.dirname(relativeFilePath);
    const definitionFilename = path.basename(relativeFilePath);
    const ref = definitionFilename.split('-')[0];
    const definitionsPath = path.join(mdbookPath, chapterPath, FILE_NAME_DEFINITIONS);
    console.error(
        `Looking for reference '${ref}' in generated tables at '${definitionsPath}' for '${relativeFilePath}'.`
    );
    const extraction = extractTable(definitionsPath, ref);

    if (extraction.table) {
        console.error(`Extracted generated table row for reference '${ref}'.`);
        console.log(makeLinksAbsolute(extraction.table, chapterPath, repositoryUrl));
        return;
    }

    console.error(
        `::warning:: Could not extract generated table row for '${relativeFilePath}' from '${definitionsPath}': ${extraction.reason}. Using the fallback tutorial table.`
    );
    console.log(createFallbackTable(title, description, slug));
})();
