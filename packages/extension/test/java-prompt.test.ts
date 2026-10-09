import { describe, expect, it } from 'vitest';
import { shouldOfferJavaSetup, type JavaPromptState } from '../src/java/prompt.js';

const ready: JavaPromptState = {
  hasProject: true,
  javaExtensionInstalled: true,
  alreadyConfigured: false,
  dismissed: false,
  trusted: true,
  testMode: false,
};

describe('shouldOfferJavaSetup', () => {
  it('offers the setup for a project with the Java extension and nothing configured', () => {
    expect(shouldOfferJavaSetup(ready)).toBe(true);
  });

  it.each([
    ['no project', { hasProject: false }],
    ['no Java extension', { javaExtensionInstalled: false }],
    ['already configured', { alreadyConfigured: true }],
    ['dismissed for this workspace', { dismissed: true }],
    ['untrusted workspace', { trusted: false }],
    ['extension-host tests', { testMode: true }],
  ])('stays quiet: %s', (_name, change) => {
    expect(shouldOfferJavaSetup({ ...ready, ...change })).toBe(false);
  });
});
