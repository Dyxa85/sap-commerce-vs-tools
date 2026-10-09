/** Everything that decides whether to point the user to the Java setup; pure, so it can be tested without VS Code. */
export interface JavaPromptState {
  /** An SAP Commerce project was found. */
  hasProject: boolean;
  /** The Red Hat Java extension is installed. */
  javaExtensionInstalled: boolean;
  /** `java.project.sourcePaths` is already set (by us or by hand). */
  alreadyConfigured: boolean;
  /** The user chose "Don't ask again" for this workspace. */
  dismissed: boolean;
  trusted: boolean;
  /** Extension-host tests run with this switched off. */
  testMode: boolean;
}

/** The Java setup is missing and would help: show the persistent hints (status bar, view message, quick fix). */
export function needsJavaSetup(s: JavaPromptState): boolean {
  return s.hasProject && s.javaExtensionInstalled && !s.alreadyConfigured && !s.dismissed;
}

/** Additionally ask once with a notification (never in a restricted workspace or in tests). */
export function shouldOfferJavaSetup(s: JavaPromptState): boolean {
  return needsJavaSetup(s) && s.trusted && !s.testMode;
}

/** Why the hint is (not) shown, for the log. */
export function explainJavaPrompt(s: JavaPromptState): string {
  const reasons = [
    s.hasProject ? undefined : 'no SAP Commerce project found',
    s.javaExtensionInstalled ? undefined : 'Red Hat Java extension not installed',
    s.alreadyConfigured ? 'java.project.sourcePaths already set' : undefined,
    s.dismissed ? 'dismissed for this workspace' : undefined,
  ].filter(Boolean);
  return reasons.length > 0
    ? `not needed (${reasons.join('; ')})`
    : 'needed: Java is not set up for this project';
}
