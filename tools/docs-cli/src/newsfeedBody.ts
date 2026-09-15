import fs from 'fs';
import path from 'path';
import { createAppUrl, FILE_NAME_EXAMPLES, SCHEMA_EXAMPLES } from './utils';

type NewsfeedExample = {
    description: string;
    slug: string;
    appLink: boolean | string;
    docLink: false | string;
};

type ExampleLookupResult =
    | { example: NewsfeedExample; reason: null }
    | { example: null; reason: string };

function createDefinitionUrl(relativeFilePath: string, repositoryUrl: string): string {
    const baseUrl = repositoryUrl.replace(/\/+$/, '');
    const posixPath = relativeFilePath.replace(/\\/g, '/');
    return `${baseUrl}/${path.posix.normalize(posixPath)}`;
}

function createNewsfeedParagraph(
    appUrl: string | null,
    definitionUrl: string,
    docLink: false | string
): string {
    const appPart = appUrl ? `Check out the App [here](${appUrl})` : null;
    const definitionPart = `download the definition [here](${definitionUrl})`;
    const docPart = docLink ? `read more about this feature [here](${docLink})` : null;

    if (appPart && docPart) {
        return `${appPart}, ${definitionPart} and ${docPart}.`;
    }
    if (appPart) {
        return `${appPart} and ${definitionPart}.`;
    }
    if (docPart) {
        return `Download the definition [here](${definitionUrl}) and ${docPart}.`;
    }
    return `Download the definition [here](${definitionUrl}).`;
}

function createNewsfeedBody(
    description: string,
    appUrl: string | null,
    definitionUrl: string,
    docLink: false | string
): string {
    return `${description}\n\n${createNewsfeedParagraph(appUrl, definitionUrl, docLink)}`;
}

function lookupExample(examplesPath: string, exampleFileName: string): ExampleLookupResult {
    if (!fs.existsSync(examplesPath)) {
        return { example: null, reason: 'the examples file does not exist' };
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(fs.readFileSync(examplesPath, 'utf-8'));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { example: null, reason: `the examples file could not be read: ${message}` };
    }

    const examplesResult = SCHEMA_EXAMPLES.safeParse(parsed);
    if (!examplesResult.success) {
        return { example: null, reason: 'the examples file is invalid' };
    }

    const example = examplesResult.data[exampleFileName];
    if (!example) {
        return {
            example: null,
            reason: `example '${exampleFileName}' was not found`,
        };
    }

    if (!example.slug) {
        return {
            example: null,
            reason: `example '${exampleFileName}' does not have a slug`,
        };
    }

    return {
        example: {
            description: example.description,
            slug: example.slug,
            appLink: example.appLink,
            docLink: example.docLink,
        },
        reason: null,
    };
}

(function () {
    const [mdbookPath, relativeFilePath, repositoryUrl] = process.argv.slice(2);
    if (!mdbookPath || !relativeFilePath || !repositoryUrl) {
        console.error(
            '::error:: Usage: newsfeed-body <mdbook-path> <relative-file-path> <repository-url>'
        );
        console.error(`Received arguments: ${JSON.stringify(process.argv.slice(2))}`);
        process.exit(1);
    }

    const chapterPath = path.dirname(relativeFilePath);
    const exampleFileName = path.basename(relativeFilePath);
    const examplesPath = path.join(mdbookPath, chapterPath, FILE_NAME_EXAMPLES);
    console.error(
        `Looking up example '${exampleFileName}' in '${examplesPath}' for '${relativeFilePath}'.`
    );

    const lookup = lookupExample(examplesPath, exampleFileName);
    if (!lookup.example) {
        console.error(
            `::error:: Could not build the Newsfeed body for '${relativeFilePath}' from '${examplesPath}': ${lookup.reason}.`
        );
        process.exit(1);
    }

    const appUrl = createAppUrl(lookup.example.slug, lookup.example.appLink);
    const definitionUrl = createDefinitionUrl(relativeFilePath, repositoryUrl);
    console.error(
        `Built Newsfeed body for '${exampleFileName}' with ${appUrl ? 'an App link' : 'no App link'} and ${lookup.example.docLink ? 'a documentation link' : 'no documentation link'}.`
    );
    console.log(
        createNewsfeedBody(
            lookup.example.description,
            appUrl,
            definitionUrl,
            lookup.example.docLink
        )
    );
})();
