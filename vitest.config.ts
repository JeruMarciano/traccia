import { defineConfig } from 'vitest/config'

export default defineConfig({
  // .tsx is included so a component can be rendered in a test. Components are rendered to static
  // markup with react-dom/server rather than into a DOM: the assertions here are about what the
  // sheet says, no browser is needed for that, and the app carries no test-only dependency for it.
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
})
