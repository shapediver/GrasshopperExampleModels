import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { FILE_NAME_EXAMPLES, SCHEMA_EXAMPLES } from './utils';

/**
 * Validate a file reference declared inside an examples.json file.
 *
 * All references are resolved relative to the examples.json file, may use `..`, must not be
 * absolute, must exist, must be regular files, and must not be symlinks.
 */
function validateReferencedFile(
    reference: string,
    fieldPath: string,
    examplesFilePath: string
): void {
    if (path.isAbsolute(reference)) {
        throw new Error(
            `Invalid absolute path in '${fieldPath}': '${reference}' in ${examplesFilePath}.`
        );
    }

    const absolutePath = path.resolve(path.dirname(examplesFilePath), reference);
    if (!fs.existsSync(absolutePath)) {
        throw new Error(
            `Missing referenced file in '${fieldPath}': '${reference}' in ${examplesFilePath}.`
        );
    }

    const stats = fs.lstatSync(absolutePath);
    if (stats.isSymbolicLink()) {
        throw new Error(
            `Referenced file must not be a symlink in '${fieldPath}': '${reference}' in ${examplesFilePath}.`
        );
    }

    if (!stats.isFile()) {
        throw new Error(
            `Referenced path is not a regular file in '${fieldPath}': '${reference}' in ${examplesFilePath}.`
        );
    }
}

(function () {
    // husky passes the absolute path of the mdbook directory as an argument
    const mdbookPath = process.argv[2];
    if (!fs.existsSync(mdbookPath)) {
        console.error(`Path to mdbook does not exist: ${mdbookPath}`);
        process.exit(1);
    }

    // Find all example files one level deep in mdbook directory
    const exampleFiles = fs
        .readdirSync(mdbookPath, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(mdbookPath, entry.name, FILE_NAME_EXAMPLES))
        .filter((filePath) => fs.existsSync(filePath));

    for (const filePath of exampleFiles) {
        try {
            const fileContent = fs.readFileSync(filePath, 'utf-8');
            const jsonData = JSON.parse(fileContent);

            // Validate JSON structure
            const parsedData = SCHEMA_EXAMPLES.parse(jsonData);

            // Validate all file references declared by each example entry.
            for (const [main, example] of Object.entries(parsedData)) {
                // The top-level key is the main Grasshopper file for the example.
                validateReferencedFile(main, main, filePath);

                // Auxiliary Grasshopper assets are declared as label -> relative file path.
                for (const [label, referencedFile] of Object.entries(example.ghFiles)) {
                    validateReferencedFile(referencedFile, `${main}.ghFiles.${label}`, filePath);
                }

                // Additional non-Grasshopper assets are declared as label -> relative file path.
                for (const [label, referencedFile] of Object.entries(example.files)) {
                    validateReferencedFile(referencedFile, `${main}.files.${label}`, filePath);
                }
            }
        } catch (e) {
            console.error(`ERROR: Validation failed for ${filePath}:`);
            if (e instanceof z.ZodError) {
                console.error(e.issues);
            } else if (e instanceof Error) {
                console.error(e.message);
            } else {
                console.error(e);
            }
            console.error('\nValidation failed. Please fix the errors above before committing.');
            process.exit(1);
        }
    }
})();
