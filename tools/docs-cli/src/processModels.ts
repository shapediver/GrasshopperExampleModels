import {
    Configuration as GeometryConfiguration,
    ModelApi as GeometryModelApi,
    ReqModelFileType as GeometryReqModelFileType,
    ResGetModel as GeometryResModel,
    ResModelStatus as GeometryResModelStatus,
    ResponseError as GeometryResponseError,
    UtilsApi as GeometryUtilsApi,
    processError as processGeometryError,
} from '@shapediver/sdk.geometry-api-sdk-v2';
import {
    create,
    isPBForbiddenResponseError,
    isPBOAuthResponseError,
    isPBValidationResponseError,
    SdPlatformModelFileType,
    SdPlatformModelGetEmbeddableFields,
    SdPlatformModelStatus,
    SdPlatformModelTokenScopes,
    SdPlatformModelVisibility,
    SdPlatformRequestModelStatus,
    type SdPlatformResponseModelOwner,
    type SdPlatformResponseModelPublic,
} from '@shapediver/sdk.platform-api-sdk-v1';
import { execFileSync } from 'child_process';
import { randomBytes } from 'crypto';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { FILE_NAME_EXAMPLES, SCHEMA_EXAMPLES, type Examples } from './utils';

type NotificationLevel = 'success' | 'warning' | 'error';

type ProcessResult = {
    ok: boolean;
    fatal: boolean;
    deployDocs: boolean;
    notification: {
        level: NotificationLevel;
        message: string;
    };
};

type RepoExample = {
    slug: string;
    title: string;
    filePath: string;
    relativeFilePath: string;
    fileType: SdPlatformModelFileType;
    titlePrefix: string;
};

type PlatformClient = ReturnType<typeof create>;

type PreflightItem = {
    example: RepoExample;
    previousModel: SdPlatformResponseModelOwner | null;
};

type GeometryUploadContext = {
    config: GeometryConfiguration;
    geometryModel: GeometryResModel;
};

type ProcessingState = {
    changedCount: number;
    finalizedCount: number;
    waitingCount: number;
    openWipBySlug: Map<
        string,
        {
            modelId: string;
            status: SdPlatformModelStatus;
        }
    >;
    modelCache: Map<string, SdPlatformResponseModelOwner | null>;
};

type PlatformDecision =
    | {
          kind: 'finalize';
          model: SdPlatformResponseModelOwner;
      }
    | {
          kind: 'waiting';
          model: SdPlatformResponseModelOwner;
      };

const PLATFORM_CLIENT_ID = '827bcbdc-8a5c-481a-b09a-e498074d91ca';
const MODEL_CHECK_START_TIMEOUT_MS = 60 * 1000;
const MODEL_CHECK_POLL_INTERVAL_MS = 2500;
const VALID_SHA_REGEX = /^[0-9a-f]{7,40}$/i;
const TEMPORARY_SLUG_SUFFIX = '--wip';

void main();

async function main(): Promise<void> {
    const mdbookPath = process.argv[2];
    if (!mdbookPath || !(await fileExists(mdbookPath))) {
        log(`Path to mdbook does not exist: ${mdbookPath}`);
        process.exit(1);
    }

    const repoRoot = path.resolve(mdbookPath, '..');
    const state = createProcessingState();

    try {
        const platformUserId = requireEnv('SHAPEDIVER_PLATFORM_USER_ID');
        const accessKeyId = requireEnv('SHAPEDIVER_ACCESS_KEY_ID');
        const accessKeySecret = requireEnv('SHAPEDIVER_ACCESS_KEY_SECRET');
        const platformUrl = requireEnv('SHAPEDIVER_PLATFORM_URL', 'https://app.shapediver.com');
        const defaultBackendSystemAlias = requireEnv('DEFAULT_BACKEND_SYSTEM_ALIAS');
        const currentSha = requireEnv('GITHUB_SHA', getCurrentSha(repoRoot));
        const chapterFilter = process.env.PROCESS_MODELS_CHAPTER;

        log(`Platform user ID is '${platformUserId}'.`);
        log(`Default backend system alias is '${defaultBackendSystemAlias}'.`);
        log(`Current SHA is '${currentSha}'.`);

        if (chapterFilter) {
            log(`Limiting processing to chapter '${chapterFilter}'.`);
        }

        const examples = await loadRepoExamples(mdbookPath, repoRoot, chapterFilter);
        log(`Loaded ${examples.length} processable GH models from '${mdbookPath}'.`);

        const client = create({ clientId: PLATFORM_CLIENT_ID, baseUrl: platformUrl });
        await client.authorization.passwordGrant(accessKeyId, accessKeySecret);
        log(`Authenticated against ShapeDiver platform '${platformUrl}'.`);

        logSection('RESUME WIP-MODELS');
        for (const example of examples) {
            await resumeWipModel(client, example, platformUserId, state);
        }

        logSection('PREPARE PREFLIGHT MODELS');
        const preflight = await buildPreflightItems(
            client,
            examples,
            state,
            repoRoot,
            currentSha,
            platformUserId
        );

        logSection(`PROCESS ${preflight.length} QUEUED PREFLIGHT MODELS`);
        for (const item of preflight) {
            await processPreflightItem(
                client,
                item,
                currentSha,
                platformUserId,
                defaultBackendSystemAlias,
                state
            );
        }

        logSummary(state, false);
        printJson(buildResult(state, false));
    } catch (error) {
        const fatalMessage = await formatFailure(error);
        log(`Fatal error: ${fatalMessage}`);
        if (error instanceof Error && error.stack) {
            log(error.stack);
        }
        logSummary(state, true);
        printJson(buildResult(state, true));
        process.exitCode = 0; // Required to avoid additional tsx error output breaking the JSON.
    }
}

async function loadRepoExamples(
    mdbookPath: string,
    repoRoot: string,
    chapterFilter?: string
): Promise<RepoExample[]> {
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

    const examples: RepoExample[] = [];

    for (const examplesFilePath of exampleFiles) {
        const chapterDir = path.dirname(examplesFilePath);
        const fileContents = await fsPromises.readFile(examplesFilePath, 'utf-8');
        const parsed = SCHEMA_EXAMPLES.parse(JSON.parse(fileContents));
        examples.push(...extractProcessableExamples(parsed, chapterDir, repoRoot));
    }

    return examples.sort((left, right) => left.slug.localeCompare(right.slug));
}

function extractProcessableExamples(
    examples: Examples,
    chapterDir: string,
    repoRoot: string
): RepoExample[] {
    const repoExamples: RepoExample[] = [];

    for (const [mainFile, entry] of Object.entries(examples)) {
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

        repoExamples.push({
            slug: entry.slug,
            title: entry.title,
            filePath: resolvedFilePath,
            relativeFilePath: toRepoRelativePath(repoRoot, resolvedFilePath),
            fileType:
                extension === '.gh' ? SdPlatformModelFileType.GH : SdPlatformModelFileType.GHX,
            titlePrefix: path.basename(mainFile).split('-')[0],
        });
    }

    return repoExamples;
}

function createProcessingState(): ProcessingState {
    return {
        changedCount: 0,
        finalizedCount: 0,
        waitingCount: 0,
        openWipBySlug: new Map(),
        modelCache: new Map<string, SdPlatformResponseModelOwner | null>(),
    };
}

async function resumeWipModel(
    client: PlatformClient,
    example: RepoExample,
    platformUserId: string,
    state: ProcessingState
): Promise<void> {
    logModelBlock(example);
    const temporarySlug = getTemporarySlug(example.slug);

    const wipModel = await getPlatformModel(client, temporarySlug, state.modelCache);
    if (!wipModel) {
        log(`No resumable WIP model found for '${example.slug}'.`);
        return;
    }

    const ownerId = getOwnerId(wipModel);
    if (ownerId !== platformUserId) {
        throw new Error(
            `Temporary slug '${temporarySlug}' already exists on ShapeDiver but is owned by user '${ownerId ?? 'unknown'}', not '${platformUserId}'.`
        );
    }

    log(
        `Found WIP model '${temporarySlug}' as platform model '${wipModel.id}' with platform status '${wipModel.status}'.`
    );

    const previousModel = await getPlatformModel(client, example.slug, state.modelCache);
    if (previousModel && previousModel.id === wipModel.id) {
        log(
            `Stable slug '${example.slug}' already points to the WIP model '${wipModel.id}'. Treating this as a direct-finalization candidate.`
        );
    }

    if (previousModel && getOwnerId(previousModel) !== platformUserId) {
        throw new Error(
            `Slug '${example.slug}' already exists on ShapeDiver but is owned by user '${getOwnerId(previousModel) ?? 'unknown'}', not '${platformUserId}'.`
        );
    }

    await processOpenModel(client, example, wipModel, previousModel, state, 'resume');
}

async function buildPreflightItems(
    client: PlatformClient,
    examples: RepoExample[],
    state: ProcessingState,
    repoRoot: string,
    currentSha: string,
    platformUserId: string
): Promise<PreflightItem[]> {
    const preflight: PreflightItem[] = [];

    for (const example of examples) {
        logModelBlock(example);

        const openWip = state.openWipBySlug.get(example.slug);
        if (openWip) {
            log(
                `Skipping preflight because resume left WIP model '${openWip.modelId}' open with platform status '${openWip.status}'.`
            );
            continue;
        }

        const previousModel = await getPlatformModel(client, example.slug, state.modelCache);
        if (previousModel && getOwnerId(previousModel) !== platformUserId) {
            throw new Error(
                `Slug '${example.slug}' already exists on ShapeDiver but is owned by user '${getOwnerId(previousModel) ?? 'unknown'}', not '${platformUserId}'.`
            );
        }

        const storedSha = previousModel?.comment?.trim() || 'none';
        log(
            `Checking against stable model '${previousModel?.id ?? 'none'}' with stored SHA '${storedSha}'.`
        );

        const changeReason = detectChangeReason(
            repoRoot,
            previousModel,
            currentSha,
            example.relativeFilePath
        );

        if (changeReason) {
            state.changedCount += 1;
            log(`Model is changed relative to stable model: ${changeReason}`);
            preflight.push({ example, previousModel });
        } else {
            log(`Model is unchanged relative to stable model.`);
            continue;
        }
    }

    return preflight;
}

async function processPreflightItem(
    client: PlatformClient,
    item: PreflightItem,
    currentSha: string,
    platformUserId: string,
    defaultBackendSystemAlias: string,
    state: ProcessingState
): Promise<void> {
    logModelBlock(item.example);

    const wipModel = await createWipModel(
        client,
        item.example,
        item.previousModel,
        currentSha,
        platformUserId,
        defaultBackendSystemAlias
    );
    const geometryContext = await uploadGrasshopperFile(client, wipModel.id, item.example);
    await processOpenModel(
        client,
        item.example,
        wipModel,
        item.previousModel,
        state,
        'preflight',
        geometryContext
    );
}

async function createWipModel(
    client: PlatformClient,
    example: RepoExample,
    previousModel: SdPlatformResponseModelOwner | null,
    currentSha: string,
    platformUserId: string,
    defaultBackendSystemAlias: string
): Promise<SdPlatformResponseModelOwner> {
    const temporarySlug = getTemporarySlug(example.slug);
    const backendSystemAlias = getWipCreationBackendSystemAlias(
        example.slug,
        previousModel,
        defaultBackendSystemAlias
    );
    const userId = previousModel?.user?.id ?? platformUserId;
    await assertTemporarySlugAvailable(client, temporarySlug);

    log(
        `Creating private WIP model with previous model '${previousModel?.id ?? 'none'}', backend system '${backendSystemAlias}', and SHA '${currentSha}'.`
    );

    log(
        `Ensuring user '${userId}' uses backend system '${backendSystemAlias}' before model creation.`
    );
    await client.users.patch(userId, { backend_system_alias: backendSystemAlias });

    const response = await client.models.create({
        title: `${example.titlePrefix} - ${example.title}`,
        ftype: example.fileType,
        comment: currentSha,
        prev_id: previousModel?.id,
        backendaccess: previousModel?.backend_access ?? true,
        visibility: SdPlatformModelVisibility.Private,
        require_token: previousModel?.require_token,
    });

    const wipModel = await ensureExpectedSlug(client, response.data, temporarySlug);
    log(`Created WIP model '${wipModel.id}' with slug '${wipModel.slug}'.`);

    return wipModel;
}

function getWipCreationBackendSystemAlias(
    stableSlug: string,
    previousModel: SdPlatformResponseModelOwner | null,
    defaultBackendSystemAlias: string
): string {
    if (previousModel) {
        const previousBackendSystemAlias = previousModel.backend_system?.alias;
        if (!previousBackendSystemAlias) {
            throw new Error(
                `Cannot create WIP model for slug '${stableSlug}': previous model '${previousModel.id}' exists but has no backend system alias.`
            );
        }

        return previousBackendSystemAlias;
    }

    return defaultBackendSystemAlias;
}

async function assertTemporarySlugAvailable(
    client: PlatformClient,
    temporarySlug: string
): Promise<void> {
    const existingModel = await getPlatformModel(client, temporarySlug, new Map());
    if (!existingModel) {
        log(`Temporary slug '${temporarySlug}' is available for a new WIP model.`);
        return;
    }

    throw new Error(
        `Cannot create a new WIP model because temporary slug '${temporarySlug}' is still occupied by platform model '${existingModel.id}' with status '${existingModel.status}'.`
    );
}

async function processOpenModel(
    client: PlatformClient,
    example: RepoExample,
    openModel: SdPlatformResponseModelOwner,
    previousModel: SdPlatformResponseModelOwner | null,
    state: ProcessingState,
    source: 'resume' | 'preflight',
    geometryContext?: GeometryUploadContext
): Promise<void> {
    log(`Processing ${source} model '${openModel.id}'.`);

    const resolvedGeometryContext =
        geometryContext ?? (await getGeometryUploadContext(client, openModel));
    const geometryModel = await waitForModelCheck(resolvedGeometryContext);
    log(`Model-check result polling ended with geometry status '${geometryModel.model.stat}'.`);

    const decision = await refreshAndClassifyPlatformModel(
        client,
        openModel.id,
        example,
        source,
        state
    );

    if (decision.kind === 'waiting') {
        state.openWipBySlug.set(example.slug, {
            modelId: decision.model.id,
            status: decision.model.status,
        });
        state.waitingCount += 1;
        log(
            `Leaving WIP model '${decision.model.id}' open because refreshed platform status is '${decision.model.status}'.`
        );
        return;
    }

    const finalizedModel = await finalizeModel(
        client,
        decision.model,
        previousModel,
        example.slug
    );
    state.finalizedCount += 1;
    state.modelCache.delete(example.slug);
    state.modelCache.delete(getTemporarySlug(example.slug));
    cachePlatformModel(state.modelCache, finalizedModel, finalizedModel.id);

    log(
        `Finalized ${source} model '${openModel.id}' into stable model '${finalizedModel.id}' with slug '${finalizedModel.slug}'.`
    );
}

async function getGeometryUploadContext(
    client: PlatformClient,
    model: SdPlatformResponseModelOwner
): Promise<GeometryUploadContext> {
    const freshModel = await getPlatformModel(client, model.id, new Map());
    if (!freshModel?.id) {
        throw new Error(
            `Platform model '${model.id}' could not be reloaded before geometry access.`
        );
    }
    if (!freshModel.guid) {
        throw new Error(`Platform model '${model.id}' is missing geometry backend guid.`);
    }

    const modelTokenResponse = await client.modelTokens.create({
        id: freshModel.id,
        scope: [SdPlatformModelTokenScopes.GroupOwner, SdPlatformModelTokenScopes.GroupView],
    });
    const geometryAccessToken = modelTokenResponse.data.access_token;
    const geometryModelViewUrl =
        modelTokenResponse.data.model_view_url ?? freshModel.backend_system?.model_view_url;

    if (!geometryAccessToken) {
        throw new Error(`Platform model '${model.id}' is missing geometry access token.`);
    }
    if (!geometryModelViewUrl) {
        throw new Error(`Platform model '${model.id}' is missing geometry model_view_url.`);
    }

    const config = new GeometryConfiguration({
        basePath: geometryModelViewUrl,
        accessToken: geometryAccessToken,
    });

    const geometryModel = (await new GeometryModelApi(config).getModel(freshModel.guid)).data;
    log(
        `Resolved geometry model '${geometryModel.model.id}' for platform model '${model.id}' with current geometry status '${geometryModel.model.stat}'.`
    );

    return { config, geometryModel };
}

async function uploadGrasshopperFile(
    client: PlatformClient,
    modelId: string,
    example: RepoExample
): Promise<GeometryUploadContext> {
    try {
        const uploadContext = await getGeometryUploadContext(
            client,
            await requirePlatformModel(client, modelId)
        );
        const uploadUrl = uploadContext.geometryModel.file?.upload;

        if (!uploadUrl) {
            throw new Error(
                `Geometry backend did not provide an upload URL for model '${modelId}'.`
            );
        }

        const contentType =
            uploadContext.geometryModel.setting.compute!.ftype ===
            GeometryReqModelFileType.GRASSHOPPER_BINARY
                ? 'application/octet-stream'
                : 'application/xml';

        log(
            `Uploading '${example.relativeFilePath}' to platform model '${modelId}' via geometry model '${uploadContext.geometryModel.model.id}' using content type '${contentType}'.`
        );

        const response = await new GeometryUtilsApi(uploadContext.config).upload(
            uploadUrl,
            await fsPromises.readFile(example.filePath),
            contentType
        );

        if (response.status !== 200) {
            throw new Error(
                `Uploading '${example.relativeFilePath}' failed with HTTP ${response.status} ${response.statusText}.`
            );
        }

        log(`Uploaded '${example.relativeFilePath}' to platform model '${modelId}'.`);
        return uploadContext;
    } catch (error) {
        throw new Error(
            `Failed to upload '${example.relativeFilePath}' to model '${modelId}': ${await formatGeometryError(error)}`,
            { cause: error }
        );
    }
}

async function waitForModelCheck(uploadContext: GeometryUploadContext): Promise<GeometryResModel> {
    const geometryModelApi = new GeometryModelApi(uploadContext.config);
    let geometryModel = uploadContext.geometryModel;

    if (!isInModelCheckQueue(geometryModel.model.stat)) {
        log(
            `Skipping model-check result polling: geometry model '${geometryModel.model.id}' is already '${geometryModel.model.stat}'.`
        );
        return geometryModel;
    }

    log(
        `Polling model-check results: geometry model '${geometryModel.model.id}' starts in '${geometryModel.model.stat}'.`
    );

    const startDeadline = Date.now() + MODEL_CHECK_START_TIMEOUT_MS;
    while (geometryModel.model.stat === GeometryResModelStatus.NOT_UPLOADED) {
        if (Date.now() > startDeadline) {
            throw new Error(
                `Model checking did not start within ${MODEL_CHECK_START_TIMEOUT_MS / 1000} seconds.`
            );
        }

        log(`Waiting for model-check to start (status='${geometryModel.model.stat}').`);
        await sleep(MODEL_CHECK_POLL_INTERVAL_MS);
        geometryModel = (await geometryModelApi.getModel(geometryModel.model.id)).data;
    }

    const maxComputationTimeMs = geometryModel.setting.compute!.max_comp_time;
    const completionDeadline = Date.now() + 2 * maxComputationTimeMs;
    log(
        `Model-check started with status '${geometryModel.model.stat}' and max computation time ${maxComputationTimeMs} ms.`
    );

    while (!isModelCheckTerminalStatus(geometryModel.model.stat)) {
        if (Date.now() > completionDeadline) {
            log(
                `Model-check timeout window reached after ${2 * maxComputationTimeMs} ms; continuing with last observed status '${geometryModel.model.stat}'.`
            );
            break;
        }

        log(`Waiting for model-check to finish (status='${geometryModel.model.stat}').`);
        await sleep(MODEL_CHECK_POLL_INTERVAL_MS);
        geometryModel = (await geometryModelApi.getModel(geometryModel.model.id)).data;
    }

    log(`Model-check finished with status '${geometryModel.model.stat}'.`);

    return geometryModel;
}

function isInModelCheckQueue(status: string | null | undefined): boolean {
    return (
        status === GeometryResModelStatus.NOT_UPLOADED ||
        status === GeometryResModelStatus.UPLOADED ||
        status === GeometryResModelStatus.PENDING
    );
}

function isModelCheckTerminalStatus(status: string | null | undefined): boolean {
    return (
        status === GeometryResModelStatus.CONFIRMED ||
        status === GeometryResModelStatus.DENIED ||
        status === GeometryResModelStatus.PENDING
    );
}

async function refreshAndClassifyPlatformModel(
    client: PlatformClient,
    modelId: string,
    example: RepoExample,
    source: 'resume' | 'preflight',
    state: ProcessingState
): Promise<PlatformDecision> {
    log(
        `Refreshing platform status from ${source} model '${modelId}' before finalization decision.`
    );

    const refreshedByPatch = (await client.models.patch(modelId, {}))
        .data as SdPlatformResponseModelOwner;
    cachePlatformModel(state.modelCache, refreshedByPatch);

    const refreshedModel = await requirePlatformModel(client, modelId, new Map());
    cachePlatformModel(state.modelCache, refreshedModel);
    log(`Refreshed platform status is '${refreshedModel.status}'.`);

    if (
        refreshedModel.status === SdPlatformModelStatus.Confirmed ||
        refreshedModel.status === SdPlatformModelStatus.Done
    ) {
        return { kind: 'finalize', model: refreshedModel };
    }

    if (
        refreshedModel.status === SdPlatformModelStatus.Waiting ||
        refreshedModel.status === SdPlatformModelStatus.Pending
    ) {
        return { kind: 'waiting', model: refreshedModel };
    }

    throw new Error(
        `Model '${example.slug}' cannot continue after ${source}: refreshed platform status for model '${refreshedModel.id}' is '${refreshedModel.status}', expected one of 'confirmed', 'done', 'waiting', or 'pending'.`
    );
}

async function finalizeModel(
    client: PlatformClient,
    model: SdPlatformResponseModelOwner,
    previousModel: SdPlatformResponseModelOwner | null,
    stableSlug: string
): Promise<SdPlatformResponseModelOwner> {
    let finalizedModel = model;

    if (finalizedModel.status !== SdPlatformModelStatus.Done) {
        log(`Setting platform model '${finalizedModel.id}' to status 'done'.`);
        finalizedModel = (
            await client.models.patch(finalizedModel.id, {
                status: SdPlatformRequestModelStatus.Done,
            })
        ).data as SdPlatformResponseModelOwner;
    }

    if (previousModel && previousModel.id !== finalizedModel.id) {
        finalizedModel = await transferStableSlug(
            client,
            finalizedModel,
            previousModel,
            stableSlug
        );

        if (
            previousModel.visibility_nominal !== SdPlatformModelVisibility.Private &&
            previousModel.visibility !== SdPlatformModelVisibility.Private
        ) {
            log(
                `Setting visibility for previous platform model '${previousModel.id}' to private.`
            );
            await client.models.patch(previousModel.id, {
                visibility: SdPlatformModelVisibility.Private,
            });
        }
    } else {
        finalizedModel = await ensureExpectedSlug(client, finalizedModel, stableSlug);
    }

    if (
        finalizedModel.visibility_nominal !== SdPlatformModelVisibility.Public &&
        finalizedModel.visibility !== SdPlatformModelVisibility.Public
    ) {
        log(`Setting visibility for platform model '${finalizedModel.id}' to public.`);
        finalizedModel = (
            await client.models.patch(finalizedModel.id, {
                visibility: SdPlatformModelVisibility.Public,
            })
        ).data as SdPlatformResponseModelOwner;
    }

    log(
        `Finalization completed for platform model '${finalizedModel.id}': status='${finalizedModel.status}', slug='${finalizedModel.slug}', visibility='${finalizedModel.visibility ?? finalizedModel.visibility_nominal}'.`
    );

    return await requirePlatformModel(client, finalizedModel.id);
}

async function transferStableSlug(
    client: PlatformClient,
    newModel: SdPlatformResponseModelOwner,
    previousModel: SdPlatformResponseModelOwner,
    stableSlug: string
): Promise<SdPlatformResponseModelOwner> {
    if (newModel.slug === stableSlug) {
        log(
            `New model '${newModel.id}' already has stable slug '${stableSlug}'; no slug transfer from previous model '${previousModel.id}' is required.`
        );
        return newModel;
    }

    const previousModelReplacementSlug = `${stableSlug}-${randomBytes(4).toString('hex')}`;

    log(
        `Transferring stable slug '${stableSlug}' from previous model '${previousModel.id}' to new model '${newModel.id}' and assigning previous model slug '${previousModelReplacementSlug}'.`
    );

    try {
        const response = await client.models.swapSlug(newModel.id, {
            other: previousModel.id,
            other_slug: previousModelReplacementSlug,
        });
        log(
            `Transferred stable slug '${stableSlug}' to new model '${newModel.id}'. Swap response: ${JSON.stringify(response.data)}.`
        );
        return await requirePlatformModel(client, newModel.id);
    } catch (error) {
        throw new Error(
            `Failed to transfer stable slug '${stableSlug}' from previous model '${previousModel.id}' to new model '${newModel.id}': ${formatPlatformError(error)}`,
            { cause: error }
        );
    }
}

async function ensureExpectedSlug(
    client: PlatformClient,
    model: SdPlatformResponseModelOwner,
    expectedSlug: string
): Promise<SdPlatformResponseModelOwner> {
    if (model.slug === expectedSlug) {
        return model;
    }

    if (expectedSlug.length < 5) {
        throw new Error(`Expected slug '${expectedSlug}' is too short to patch on ShapeDiver.`);
    }

    log(`Patching slug for model '${model.id}' from '${model.slug}' to '${expectedSlug}'.`);
    const response = await client.models.patch(model.id, { slug: expectedSlug });
    return response.data as SdPlatformResponseModelOwner;
}

async function getPlatformModel(
    client: PlatformClient,
    idOrSlug: string,
    cache: Map<string, SdPlatformResponseModelOwner | null>
): Promise<SdPlatformResponseModelOwner | null> {
    if (cache.has(idOrSlug)) {
        return cache.get(idOrSlug) ?? null;
    }

    try {
        const response = await client.models.get(idOrSlug, [
            SdPlatformModelGetEmbeddableFields.User,
            SdPlatformModelGetEmbeddableFields.BackendSystem,
            SdPlatformModelGetEmbeddableFields.PreviousModel,
        ]);
        const model = response.data as SdPlatformResponseModelOwner;
        cachePlatformModel(cache, model, idOrSlug);
        return model;
    } catch (error) {
        if (isNotFoundError(error)) {
            cache.set(idOrSlug, null);
            return null;
        }
        throw error;
    }
}

async function requirePlatformModel(
    client: PlatformClient,
    idOrSlug: string,
    cache: Map<string, SdPlatformResponseModelOwner | null> = new Map()
): Promise<SdPlatformResponseModelOwner> {
    const model = await getPlatformModel(client, idOrSlug, cache);
    if (!model) {
        throw new Error(`Platform model '${idOrSlug}' was not found.`);
    }
    return model;
}

function detectChangeReason(
    repoRoot: string,
    previousModel: SdPlatformResponseModelOwner | null,
    currentSha: string,
    repoRelativeFilePath: string
): string | null {
    if (!previousModel) {
        return 'Stable slug not found on ShapeDiver; treating as a new model.';
    }

    const storedSha = previousModel.comment?.trim();
    if (!storedSha) {
        return `Stable model '${previousModel.id}' has no stored commit SHA.`;
    }

    if (!VALID_SHA_REGEX.test(storedSha)) {
        return `Stable model '${previousModel.id}' has invalid stored SHA '${storedSha}'.`;
    }

    if (!gitCommitExists(repoRoot, storedSha)) {
        return `Stored SHA '${storedSha}' on stable model '${previousModel.id}' does not exist in local git history.`;
    }

    if (!gitDiffHasChanges(repoRoot, storedSha, currentSha, repoRelativeFilePath)) {
        return null;
    }

    return `Grasshopper file changed since stable model '${previousModel.id}' stored SHA '${storedSha}'.`;
}

function gitCommitExists(repoRoot: string, sha: string): boolean {
    try {
        execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], {
            cwd: repoRoot,
            stdio: 'ignore',
        });
        return true;
    } catch {
        return false;
    }
}

function gitDiffHasChanges(
    repoRoot: string,
    fromSha: string,
    toSha: string,
    filePath: string
): boolean {
    try {
        execFileSync('git', ['diff', '--quiet', `${fromSha}..${toSha}`, '--', filePath], {
            cwd: repoRoot,
            stdio: 'ignore',
        });
        return false;
    } catch {
        return true;
    }
}

function getCurrentSha(repoRoot: string): string {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: repoRoot,
        encoding: 'utf-8',
    }).trim();
}

function getTemporarySlug(stableSlug: string): string {
    return `${stableSlug}${TEMPORARY_SLUG_SUFFIX}`;
}

function getOwnerId(
    model: SdPlatformResponseModelPublic | SdPlatformResponseModelOwner
): string | null {
    return model.user?.id ?? null;
}

function buildResult(state: ProcessingState, fatal: boolean): ProcessResult {
    const deployDocs = !fatal && state.waitingCount === 0;
    const level = fatal ? 'error' : state.waitingCount > 0 ? 'warning' : 'success';

    return {
        ok: !fatal,
        fatal,
        deployDocs,
        notification: {
            level,
            message: buildNotificationMessage(level, state, fatal),
        },
    };
}

function buildNotificationMessage(
    level: NotificationLevel,
    state: ProcessingState,
    fatal: boolean
): string {
    if (fatal) {
        return '❌ Dynamic deployment failed. Check the GitHub Action logs.';
    }

    if (level === 'warning') {
        return `⚠️ Dynamic deployment paused: ${state.waitingCount} model(s) are still waiting for ShapeDiver processing. Docs deployment was skipped. Check the GitHub Action logs.`;
    }

    if (state.changedCount === 0) {
        return '✅ Dynamic deployment: no changed Grasshopper models detected; proceeding with docs deployment.';
    }

    return `✅ Dynamic deployment: processed ${state.changedCount} changed model(s), finalized ${state.finalizedCount}. Proceeding with docs deployment.`;
}

function logSummary(state: ProcessingState, fatal: boolean): void {
    log(
        `Summary: changed=${state.changedCount}, finalized=${state.finalizedCount}, waiting=${state.waitingCount}, openWipSlugs=${state.openWipBySlug.size}, deployDocs=${!fatal && state.waitingCount === 0}, fatal=${fatal}`
    );
}

function printJson(result: ProcessResult): void {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function isNotFoundError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) {
        return false;
    }

    const maybeError = error as { http_status_code?: number };
    return maybeError.http_status_code === 404;
}

function cachePlatformModel(
    cache: Map<string, SdPlatformResponseModelOwner | null>,
    model: SdPlatformResponseModelOwner,
    requestedKey?: string
): void {
    if (requestedKey) {
        cache.set(requestedKey, model);
    }
    if (model.id) {
        cache.set(model.id, model);
    }
    if (model.slug) {
        cache.set(model.slug, model);
    }
}

function formatUnknownError(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    if (typeof error === 'string') {
        return error;
    }
    return JSON.stringify(error);
}

function formatPlatformError(error: unknown): string {
    if (isPBValidationResponseError(error)) {
        return `${error.message} (${JSON.stringify(error.fields)})`;
    }

    if (isPBForbiddenResponseError(error)) {
        return `${error.error}: ${error.error_description}`;
    }

    if (isPBOAuthResponseError(error)) {
        return `${error.error}: ${error.error_description}`;
    }

    return formatUnknownError(error);
}

async function formatGeometryError(error: unknown): Promise<string> {
    const geometryError = await Promise.resolve(processGeometryError(error as Error));

    if (geometryError instanceof GeometryResponseError) {
        return [
            geometryError.status,
            geometryError.type,
            geometryError.message,
            geometryError.description,
        ]
            .filter((value) => value !== undefined && value !== null && value !== '')
            .join(' ');
    }

    return formatUnknownError(geometryError);
}

async function formatFailure(error: unknown): Promise<string> {
    if (
        isPBValidationResponseError(error) ||
        isPBForbiddenResponseError(error) ||
        isPBOAuthResponseError(error)
    ) {
        return formatPlatformError(error);
    }

    return formatUnknownError(error);
}

function toRepoRelativePath(repoRoot: string, filePath: string): string {
    return path.relative(repoRoot, filePath).split(path.sep).join('/');
}

function requireEnv(name: string, defaultValue?: string): string {
    const value = process.env[name];
    if (value !== undefined) return value;
    if (defaultValue !== undefined) return defaultValue;
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

async function sleep(milliseconds: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function logSection(title: string): void {
    log(buildPaddedSeparator(title, '='));
}

function logSubsection(title: string): void {
    log(buildPaddedSeparator(title, '-'));
}

function buildPaddedSeparator(title: string, fillCharacter: '=' | '-'): string {
    const totalLength = 120;
    const paddedTitle = ` ${title} `;
    const remainingLength = totalLength - paddedTitle.length;

    if (remainingLength <= 0) {
        return paddedTitle;
    }

    const prefixLength = Math.floor(remainingLength / 2);
    const suffixLength = Math.ceil(remainingLength / 2);

    return `${fillCharacter.repeat(prefixLength)}${paddedTitle}${fillCharacter.repeat(suffixLength)}`;
}

function logModelBlock(example: RepoExample): void {
    logSubsection(`${example.slug} (${example.relativeFilePath})`);
}

function log(message: string): void {
    // We use stderr for logs to avoid mixing with stdout JSON output.
    process.stderr.write(`${message}\n`);
}
