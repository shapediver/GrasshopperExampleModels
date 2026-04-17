import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { FILE_NAME_EXAMPLES, SCHEMA_EXAMPLES } from './utils';

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

    let hasError = false;

    for (const filePath of exampleFiles) {
        try {
            const fileContent = fs.readFileSync(filePath, 'utf-8');
            const jsonData = JSON.parse(fileContent);

            // Validate JSON structure
            const parsedData = SCHEMA_EXAMPLES.parse(jsonData);

            const baseDir = path.dirname(filePath);

            // Validate physical files exist relative to the JSON file
            for (const ghxName of Object.keys(parsedData)) {
                const absolutePath = path.join(baseDir, ghxName);
                if (!fs.existsSync(absolutePath)) {
                    console.error(`ERROR: Missing referenced file '${ghxName}' in ${filePath}.`);
                    hasError = true;
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
            hasError = true;
        }
    }

    // Abort the commit if any errors were found
    if (hasError) {
        console.error('\nValidation failed. Please fix the errors above before committing.');
        process.exit(1);
    }
})();
