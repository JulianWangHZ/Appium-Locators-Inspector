// `npx appium-locators-inspector` entry point (bundled to cli.js in the npm package).
import { main } from './cli.js';

main(process.argv.slice(2), __dirname)
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
        console.error((error as Error).message);
        process.exit(1);
    });
