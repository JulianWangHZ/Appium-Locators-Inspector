import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['tests/**/*.test.ts'],
        environment: 'node',
        testTimeout: 20000,
        coverage: {
            include: ["src/**"],
            // Type-only modules and process entry points (covered by e2e tests that spawn them).
            exclude: ["src/**/types.ts", "src/shared/protocol.ts", "src/backend/server.ts", "src/native-host/launcher.ts"],
            thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 }
        }
    }
});
