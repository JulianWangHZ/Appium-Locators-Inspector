export const DEFAULT_BACKEND_PORT = 8765;
export const DEFAULT_APPIUM_PORT = 4723;
export const DEFAULT_APPIUM_URL = `http://localhost:${DEFAULT_APPIUM_PORT}`;
export const NATIVE_HOST_NAME = 'com.appium_locators_inspector.host';
/** Chrome Web Store build of the extension. */
export const STORE_EXTENSION_ID = 'annejeomdlkidljonmpmhcdnekkadjfb';
export const NPM_PACKAGE_NAME = 'appium-locators-inspector';
export const START_COMMAND = `npx ${NPM_PACKAGE_NAME}`;
export const SETUP_COMMAND = `npx ${NPM_PACKAGE_NAME} setup`;

/** `setup` must allow the running extension's ID; the store build is allowed by default. */
export function setupCommandFor(extensionId: string): string {
    return extensionId === STORE_EXTENSION_ID ? SETUP_COMMAND : `${SETUP_COMMAND} --extension-id ${extensionId}`;
}
