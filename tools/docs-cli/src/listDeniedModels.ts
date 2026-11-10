/**
 * Lists example models whose ShapeDiver Platform status is currently denied.
 *
 * Reads slugs from examples.json and GETs each stable model and its `--wip` model.
 * Does not upload, patch, or create anything.
 */
import {
    create,
    isPBOAuthResponseError,
    SdPlatformModelGetEmbeddableFields,
    SdPlatformModelStatus,
} from '@shapediver/sdk.platform-api-sdk-v1';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import { FILE_NAME_EXAMPLES, SCHEMA_EXAMPLES } from './utils';

const PLATFORM_CLIENT_ID = '827bcbdc-8a5c-481a-b09a-e498074d91ca';
const TEMPORARY_SLUG_SUFFIX = '--wip';

const PLATFORM_MODEL_SCHEMA = z.object({
    id: z.string().min(1),
    slug: z.string(),
    status: z.enum(SdPlatformModelStatus),
    backend_properties: z
        .object({
            msg: z
                .object({
                    deny_reason: z.string().optional(),
                    display_message: z.string().optional(),
                    user_message: z.string().optional(),
                })
                .nullish(),
        })
        .nullish(),
});

type PlatformModel = z.infer<typeof PLATFORM_MODEL_SCHEMA>;

type ExampleTarget = {
    slug: string;
    relativeFilePath: string;
};

type ModelPlace = 'stable' | 'wip';

type DeniedModel = {
    example: ExampleTarget;
    place: ModelPlace;
    id: string;
    platformSlug: string;
    denyReason: string | null;
    displayMessage: string | null;
    userMessage: string | null;
};

type LookupResult =
    | { kind: 'missing' }
    | { kind: 'found'; model: PlatformModel }
    | { kind: 'failed'; detail: string };

type LookupCounts = {
    missingStable: number;
    missingWip: number;
    failed: number;
};

void main();

async function main(): Promise<void> {
    const mdbookPath = process.argv[2];
    if (!mdbookPath || !(await fileExists(mdbookPath))) {
        log(`Path to mdbook does not exist: ${mdbookPath}`);
        process.exitCode = 1;
        return;
    }

    try {
        const accessKeyId = requireEnv('SHAPEDIVER_ACCESS_KEY_ID');
        const accessKeySecret = requireEnv('SHAPEDIVER_ACCESS_KEY_SECRET');
        const platformUrl = requireEnv('SHAPEDIVER_PLATFORM_URL', 'https://app.shapediver.com');
        const chapterFilter = process.env.PROCESS_MODELS_CHAPTER;
        const repoRoot = path.resolve(mdbookPath, '..');
        const examples = await loadExampleTargets(mdbookPath, repoRoot, chapterFilter);

        log(`Loaded ${examples.length} example slugs from '${mdbookPath}'.`);
        if (chapterFilter) {
            log(`Limiting the list to chapter '${chapterFilter}'.`);
        }

        const client = create({ clientId: PLATFORM_CLIENT_ID, baseUrl: platformUrl });
        await client.authorization.passwordGrant(accessKeyId, accessKeySecret);
        log(`Authenticated against ShapeDiver platform '${platformUrl}'.`);

        const denied: DeniedModel[] = [];
        const counts: LookupCounts = { missingStable: 0, missingWip: 0, failed: 0 };

        for (const example of examples) {
            log(`Checking '${example.slug}' (${example.relativeFilePath}).`);
            await collectDenied(
                client,
                example,
                'wip',
                `${example.slug}${TEMPORARY_SLUG_SUFFIX}`,
                denied,
                counts
            );
            await collectDenied(client, example, 'stable', example.slug, denied, counts);
        }

        writeReport(denied);
        log(
            `Checked ${examples.length} examples. Denied: ${denied.length}. Stable models missing: ${counts.missingStable}. Open WIP models missing: ${counts.missingWip}. Failed lookups: ${counts.failed}.`
        );
        if (counts.failed > 0) {
            process.exitCode = 1;
        }
    } catch (error) {
        log(formatError(error));
        process.exitCode = 1;
    }
}

async function collectDenied(
    client: ReturnType<typeof create>,
    example: ExampleTarget,
    place: ModelPlace,
    idOrSlug: string,
    denied: DeniedModel[],
    counts: LookupCounts
): Promise<void> {
    const lookup = await lookupModel(client, idOrSlug);
    if (lookup.kind === 'missing') {
        if (place === 'stable') {
            counts.missingStable += 1;
        } else {
            counts.missingWip += 1;
        }
        return;
    }
    if (lookup.kind === 'failed') {
        counts.failed += 1;
        log(`Failed to read ${place} model '${idOrSlug}': ${lookup.detail}`);
        return;
    }
    if (lookup.model.status !== SdPlatformModelStatus.Denied) {
        return;
    }

    const message = lookup.model.backend_properties?.msg;
    denied.push({
        example,
        place,
        id: lookup.model.id,
        platformSlug: lookup.model.slug,
        denyReason: message?.deny_reason ?? null,
        displayMessage: message?.display_message ?? null,
        userMessage: message?.user_message ?? null,
    });
}

async function lookupModel(
    client: ReturnType<typeof create>,
    idOrSlug: string
): Promise<LookupResult> {
    try {
        return await readModel(client, idOrSlug);
    } catch (error) {
        if (!isServerError(error)) {
            return classifyLookupError(error);
        }
        await sleep(1000);
        try {
            return await readModel(client, idOrSlug);
        } catch (retryError) {
            return classifyLookupError(retryError);
        }
    }
}

async function readModel(
    client: ReturnType<typeof create>,
    idOrSlug: string
): Promise<LookupResult> {
    const response = await client.models.get(idOrSlug, [
        SdPlatformModelGetEmbeddableFields.BackendProperties,
    ]);
    const parsed = PLATFORM_MODEL_SCHEMA.safeParse(response.data);
    if (!parsed.success) {
        return {
            kind: 'failed',
            detail: `Platform model '${idOrSlug}' did not match the expected owner payload: ${parsed.error.message}`,
        };
    }
    return { kind: 'found', model: parsed.data };
}

function classifyLookupError(error: unknown): LookupResult {
    if (isPBOAuthResponseError(error)) {
        throw error;
    }
    if (isNotFoundError(error)) {
        return { kind: 'missing' };
    }
    return { kind: 'failed', detail: formatError(error) };
}

async function loadExampleTargets(
    mdbookPath: string,
    repoRoot: string,
    chapterFilter: string | undefined
): Promise<ExampleTarget[]> {
    const chapterDirectories = (await fsPromises.readdir(mdbookPath, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .filter((entry) => !chapterFilter || entry.name === chapterFilter);

    if (chapterFilter && chapterDirectories.length === 0) {
        throw new Error(`Chapter '${chapterFilter}' was not found in '${mdbookPath}'.`);
    }

    const exampleFiles = chapterDirectories
        .map((entry) => path.join(mdbookPath, entry.name, FILE_NAME_EXAMPLES))
        .filter((filePath) => fs.existsSync(filePath));

    if (chapterFilter && exampleFiles.length === 0) {
        throw new Error(`Chapter '${chapterFilter}' does not contain '${FILE_NAME_EXAMPLES}'.`);
    }

    const examples: ExampleTarget[] = [];
    for (const examplesFilePath of exampleFiles) {
        const chapterDir = path.dirname(examplesFilePath);
        const fileContents = await fsPromises.readFile(examplesFilePath, 'utf-8');
        const parsed: unknown = JSON.parse(fileContents);
        const entries = SCHEMA_EXAMPLES.parse(parsed);

        for (const [mainFile, entry] of Object.entries(entries)) {
            if (!entry.slug) {
                continue;
            }
            const resolvedFilePath = path.resolve(chapterDir, mainFile);
            const extension = path.extname(mainFile).toLowerCase();
            if (
                (extension !== '.gh' && extension !== '.ghx') ||
                path.dirname(resolvedFilePath) !== chapterDir
            ) {
                continue;
            }
            examples.push({
                slug: entry.slug,
                relativeFilePath: toRepoRelativePath(repoRoot, resolvedFilePath),
            });
        }
    }

    return examples.sort((left, right) => {
        const bySlug = left.slug.localeCompare(right.slug);
        if (bySlug !== 0) {
            return bySlug;
        }
        return left.relativeFilePath.localeCompare(right.relativeFilePath);
    });
}

function writeReport(denied: DeniedModel[]): void {
    if (denied.length === 0) {
        process.stdout.write('No denied example models.\n');
        return;
    }

    const blocks = denied.map((model) => {
        const lines = [
            model.example.relativeFilePath,
            `slug: ${model.example.slug}`,
            `lookup: ${model.place}`,
            `platform id: ${model.id}`,
            `platform slug: ${model.platformSlug}`,
            `deny reason: ${model.denyReason ?? 'unavailable'}`,
            `message: ${oneLine(model.displayMessage) ?? 'unavailable'}`,
        ];
        const userMessage = oneLine(model.userMessage);
        if (userMessage) {
            lines.push(`detail: ${userMessage}`);
        }
        return lines.join('\n');
    });
    process.stdout.write(`${blocks.join('\n\n')}\n`);
}

function oneLine(value: string | null): string | null {
    if (!value) {
        return null;
    }
    const collapsed = value.replace(/\s+/g, ' ').trim();
    return collapsed.length > 0 ? collapsed : null;
}

function isNotFoundError(error: unknown): boolean {
    return httpStatus(error) === 404;
}

function isServerError(error: unknown): boolean {
    const status = httpStatus(error);
    return status !== null && status >= 500;
}

function httpStatus(error: unknown): number | null {
    if (typeof error !== 'object' || error === null || !('http_status_code' in error)) {
        return null;
    }
    return typeof error.http_status_code === 'number' ? error.http_status_code : null;
}

function formatError(error: unknown): string {
    const status = httpStatus(error);
    const message = errorMessage(error);
    return status === null ? message : `${message} (HTTP ${status})`;
}

function errorMessage(error: unknown): string {
    if (error instanceof Error && error.message.length > 0) {
        return error.message;
    }
    if (typeof error === 'object' && error !== null && 'message' in error) {
        const message = error.message;
        if (typeof message === 'string' && message.length > 0) {
            return message;
        }
    }
    return String(error);
}

function sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function requireEnv(name: string, defaultValue?: string): string {
    const value = process.env[name];
    if (value !== undefined && value.length > 0) {
        return value;
    }
    if (defaultValue !== undefined) {
        return defaultValue;
    }
    throw new Error(`Missing environment variable '${name}'.`);
}

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fsPromises.access(filePath);
        return true;
    } catch {
        return false;
    }
}

function toRepoRelativePath(repoRoot: string, filePath: string): string {
    return path.relative(repoRoot, filePath).split(path.sep).join('/');
}

function log(message: string): void {
    process.stderr.write(`${message}\n`);
}
