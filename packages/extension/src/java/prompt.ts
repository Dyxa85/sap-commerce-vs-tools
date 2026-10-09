/** Everything that decides whether to offer the Java setup; pure, so it can be tested without VS Code. */
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

export function shouldOfferJavaSetup(s: JavaPromptState): boolean {
  return (
    s.hasProject &&
    s.javaExtensionInstalled &&
    !s.alreadyConfigured &&
    !s.dismissed &&
    s.trusted &&
    !s.testMode
  );
}
