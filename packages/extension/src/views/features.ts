// Pure data (no `vscode` import) so that tests can check it against the manifest.

/** One clickable entry of the Features view. */
export interface FeatureAction {
  kind: 'action';
  label: string;
  /** Where it also lives: a shortcut, a menu, a file type. */
  description: string;
  tooltip: string;
  icon: string;
  command: string;
  args?: unknown[];
}

export interface FeatureGroup {
  kind: 'group';
  label: string;
  icon: string;
  description?: string;
  expanded?: boolean;
  children: FeatureAction[];
}

export type FeatureNode = FeatureGroup | FeatureAction;

const action = (
  label: string,
  command: string,
  icon: string,
  description: string,
  tooltip: string,
  args?: unknown[],
): FeatureAction => ({ kind: 'action', label, command, icon, description, tooltip, args });

/**
 * Everything the extension can do, grouped by what you want to achieve, with the place where each feature also lives.
 * It is the "where do I find it" page of the extension, so it is data, kept in one place and covered by a test.
 */
export const FEATURES: readonly FeatureGroup[] = [
  {
    kind: 'group',
    label: 'Run on an instance (needs a connection)',
    icon: 'server-environment',
    description: 'hAC',
    expanded: true,
    children: [
      action(
        'Run FlexibleSearch query',
        'sapcommerce.flexsearch.run',
        'play',
        'Cmd/Ctrl+Enter, editor title button',
        'Runs the selection (or the whole file) and shows the rows as a table. ?parameters are asked for.',
      ),
      action(
        'Run SQL query',
        'sapcommerce.sql.run',
        'database',
        '.sql files: context menu',
        "Raw SQL against the instance's database.",
      ),
      action(
        'Run Groovy script (rollback)',
        'sapcommerce.groovy.run',
        'debug-start',
        '.groovy files: context menu',
        'Runs a script on the instance and rolls everything back. The commit variant asks first.',
      ),
      action(
        'Validate ImpEx',
        'sapcommerce.impex.validate',
        'check',
        'Cmd/Ctrl+Alt+V, editor title button',
        'Asks the hAC to validate the file or selection.',
      ),
      action(
        'Import ImpEx…',
        'sapcommerce.impex.import',
        'cloud-upload',
        'editor title button, context menu',
        'Imports the file or selection after you confirm.',
      ),
      action(
        'Analyze PK',
        'sapcommerce.pk.analyze',
        'search',
        'Command Palette',
        'Shows which item a PK belongs to.',
      ),
      action(
        'Change log level…',
        'sapcommerce.logger.set',
        'list-flat',
        'Command Palette',
        'Lists the loggers of the instance and changes one level.',
      ),
      action(
        'Show query & script history',
        'sapcommerce.history.show',
        'history',
        'Command Palette',
        'Re-open earlier queries, scripts and imports.',
      ),
      action(
        'Open hAC in browser',
        'sapcommerce.connection.openHac',
        'link-external',
        'connection list, inline button',
        'Opens the hybris Administration Console of the active connection.',
      ),
    ],
  },
  {
    kind: 'group',
    label: 'Write code',
    icon: 'edit',
    description: 'editors',
    expanded: true,
    children: [
      action(
        'New ImpEx file',
        'sapcommerce.file.newImpex',
        'new-file',
        '.impex files',
        'Highlighting, diagnostics that follow the importer, completion for types and attributes, formatter.',
      ),
      action(
        'New FlexibleSearch file',
        'sapcommerce.file.newFlexSearch',
        'new-file',
        '.fxs .flexsearch .flexibleSearch',
        'Highlighting, diagnostics for hAC pitfalls (-- comments, ;), alias completion, formatter.',
      ),
      action(
        'Items, beans, Spring, process XML',
        'sapcommerce.project.goToExtension',
        'symbol-class',
        '*-items.xml, *-beans.xml, *-spring.xml',
        'These files get diagnostics, completion, hover and go-to-definition automatically when they are part of an extension of your project. Opens the extension picker.',
      ),
    ],
  },
  {
    kind: 'group',
    label: 'Explore the project',
    icon: 'symbol-structure',
    description: 'types, diagrams',
    children: [
      action(
        'Go to type, attribute or enum value…',
        'sapcommerce.types.search',
        'search',
        'Cmd/Ctrl+Alt+T',
        'Searches item types, enums, relations, attributes, enum values and beans of all loaded extensions.',
      ),
      action(
        'Show type',
        'sapcommerce.types.show',
        'symbol-class',
        'cursor on a type name',
        'Preview with inheritance, attributes, subtypes and relations.',
      ),
      action(
        'Type diagram',
        'sapcommerce.diagram.type',
        'type-hierarchy',
        'items.xml context menu',
        'Inheritance and references around a type. Click a node to open it.',
      ),
      action(
        'Extension dependency diagram',
        'sapcommerce.diagram.modules',
        'graph',
        'Command Palette',
        'Custom extensions and what they require, or the dependencies/dependents of one extension.',
      ),
      action(
        'Business process diagram',
        'sapcommerce.diagram.process',
        'git-merge',
        '*-process.xml context menu',
        'The process as a graph; refreshed when you save.',
      ),
      action(
        'Go to extension…',
        'sapcommerce.project.goToExtension',
        'package',
        'Commerce Project view',
        'Jump to any extension of the platform.',
      ),
      action(
        'Show index information',
        'sapcommerce.index.info',
        'info',
        'Command Palette',
        'How many extensions, item types and beans were indexed.',
      ),
    ],
  },
  {
    kind: 'group',
    label: 'Build, run, debug',
    icon: 'tools',
    description: 'Ant, server',
    children: [
      action(
        'Run Ant target…',
        'sapcommerce.ant.run',
        'tools',
        'also Terminal → Run Task',
        'build, clean, unittests, … or your own target with -D properties.',
      ),
      action(
        'Build (ant build)',
        'sapcommerce.ant.build',
        'package',
        'Terminal → Run Task',
        'Compiles all loaded extensions; compiler errors show up in the Problems panel.',
      ),
      action(
        'Start server',
        'sapcommerce.server.start',
        'play-circle',
        'Command Palette',
        'Starts the platform with its own script.',
      ),
      action(
        'Start server in debug mode',
        'sapcommerce.server.startDebug',
        'debug-alt',
        'Command Palette',
        'Starts the platform with the Java debug port open.',
      ),
      action(
        'Attach debugger',
        'sapcommerce.server.attachDebugger',
        'debug',
        'Command Palette',
        'Attaches the Java debugger to the port from your platform configuration.',
      ),
      action(
        'Stop server',
        'sapcommerce.server.stop',
        'stop-circle',
        'Command Palette',
        'Stops a server that was started from this window.',
      ),
      action(
        'Configure Java for this project…',
        'sapcommerce.java.configure',
        'coffee',
        'Command Palette',
        'Writes the settings the Red Hat Java extension needs to understand your extensions.',
      ),
    ],
  },
  {
    kind: 'group',
    label: 'Help & settings',
    icon: 'question',
    children: [
      action(
        'Get started (walkthrough)',
        'sapcommerce.getStarted',
        'rocket',
        'Welcome page',
        'A short guided tour with buttons for the first steps.',
      ),
      action(
        'Connection settings',
        'sapcommerce.connections.open',
        'gear',
        'Connections view, gear button',
        'Add, edit, test and remove connections on one page.',
      ),
      action(
        'All settings',
        'workbench.action.openSettings',
        'settings-gear',
        'Settings → "sapcommerce"',
        'Formatter, diagnostics severities, hidden folders, Java and AI options.',
        ['sapcommerce'],
      ),
      action(
        'Show log',
        'sapcommerce.showLog',
        'output',
        'Output → SAP Commerce',
        'What the extension did; secrets are masked.',
      ),
      action(
        'About',
        'sapcommerce.about',
        'info',
        'Command Palette',
        'Version and target platform.',
      ),
    ],
  },
];
