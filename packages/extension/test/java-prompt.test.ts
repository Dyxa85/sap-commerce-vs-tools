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

import { explainJavaPrompt, needsJavaSetup } from '../src/java/prompt.js';

describe('needsJavaSetup (the hints that stay until Java is set up)', () => {
  it('is on in a restricted workspace and in tests, unlike the one-time notification', () => {
    expect(needsJavaSetup({ ...ready, trusted: false })).toBe(true);
    expect(needsJavaSetup({ ...ready, testMode: true })).toBe(true);
    expect(shouldOfferJavaSetup({ ...ready, trusted: false })).toBe(false);
  });

  it('goes away once configured, dismissed, or without the Java extension or a project', () => {
    for (const change of [
      { alreadyConfigured: true },
      { dismissed: true },
      { javaExtensionInstalled: false },
      { hasProject: false },
    ]) {
      expect(needsJavaSetup({ ...ready, ...change })).toBe(false);
    }
  });

  it('explains itself for the log', () => {
    expect(explainJavaPrompt(ready)).toMatch(/needed/);
    expect(
      explainJavaPrompt({ ...ready, javaExtensionInstalled: false, alreadyConfigured: true }),
    ).toMatch(/Red Hat Java extension not installed; java\.project\.sourcePaths already set/);
  });
});
