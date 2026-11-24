import { msg } from '@lingui/core/macro';
import type { SnippetDef, SnippetInput } from 'src/framework/descriptor';
import { kotlinString, xmlText } from 'src/framework/snippets/quote';
import {
  TOKEN_PLACEHOLDER,
  USER_PLACEHOLDER,
  readUrl,
  writeUrl,
} from 'src/framework/snippets/urls';

// The id the build tool knows the distribution by when it reads, and the one
// it knows the deploy address by. They are different ids, so the credentials
// of a deploy are never sent to the address a build only reads.
const READ_ID = 'pulp';
const DEPLOY_ID = 'pulp-deploy';

// Where a deploy goes: the address the deployment names for it, or the
// deploy endpoint of the repository the distribution serves, which the server
// addresses by the name of the repository. Null when neither is known, and
// nothing can be deployed through the distribution then.
const deployUrl = (input: SnippetInput): string | null =>
  writeUrl(input) ??
  (input.repositoryName === null
    ? null
    : `${input.origin}/pulp/maven/${encodeURIComponent(input.repositoryName)}/`);

const canDeploy = (input: SnippetInput): boolean => deployUrl(input) !== null;

const deployUrlOf = (input: SnippetInput): string => deployUrl(input) as string;

const server = (id: string): string[] => [
  '    <server>',
  `      <id>${id}</id>`,
  `      <username>${xmlText(USER_PLACEHOLDER)}</username>`,
  `      <password>${xmlText(TOKEN_PLACEHOLDER)}</password>`,
  '    </server>',
];

const repositoryElement = (tag: string, url: string): string[] => [
  `        <${tag}>`,
  '          <id>central</id>',
  `          <url>${url}</url>`,
  '          <releases><enabled>true</enabled></releases>',
  '          <snapshots><enabled>true</enabled></snapshots>',
  `        </${tag}>`,
];

// A Gradle repository block. A guarded distribution gets credentials, sent
// at once: the content server answers a request without them with a refusal,
// not with the challenge Gradle would otherwise wait for.
const gradleRepository = (
  indent: string,
  url: string,
  credentials: boolean,
  name?: string,
): string[] => [
  `${indent}maven {`,
  ...(name === undefined ? [] : [`${indent}    name = ${kotlinString(name)}`]),
  `${indent}    url = uri(${kotlinString(url)})`,
  ...(credentials
    ? [
        `${indent}    credentials {`,
        `${indent}        username = ${kotlinString(USER_PLACEHOLDER)}`,
        `${indent}        password = ${kotlinString(TOKEN_PLACEHOLDER)}`,
        `${indent}    }`,
        `${indent}    authentication {`,
        `${indent}        create<BasicAuthentication>("basic")`,
        `${indent}    }`,
      ]
    : []),
  `${indent}}`,
];

// The client configuration of a maven distribution: how Maven and Gradle read
// from it and how they deploy to the repository it serves. Every address is
// written as text of an XML file or as a Kotlin string, as its format needs.
export const mavenSnippets: SnippetDef[] = [
  // The profile is needed because Maven asks a mirror of everything for
  // snapshots only from a repository declared with snapshots enabled.
  {
    id: 'settings',
    label: msg`settings.xml`,
    language: 'xml',
    build: (input) => {
      const url = xmlText(readUrl(input));
      const servers = [
        ...(input.guarded ? server(READ_ID) : []),
        ...(canDeploy(input) ? server(DEPLOY_ID) : []),
      ];

      return [
        '<!-- ~/.m2/settings.xml -->',
        '<settings>',
        '  <mirrors>',
        '    <mirror>',
        `      <id>${READ_ID}</id>`,
        '      <mirrorOf>*</mirrorOf>',
        `      <url>${url}</url>`,
        '    </mirror>',
        '  </mirrors>',
        ...(servers.length === 0
          ? []
          : ['  <servers>', ...servers, '  </servers>']),
        '  <profiles>',
        '    <profile>',
        `      <id>${READ_ID}</id>`,
        '      <repositories>',
        ...repositoryElement('repository', url),
        '      </repositories>',
        '      <pluginRepositories>',
        ...repositoryElement('pluginRepository', url),
        '      </pluginRepositories>',
        '    </profile>',
        '  </profiles>',
        '  <activeProfiles>',
        `    <activeProfile>${READ_ID}</activeProfile>`,
        '  </activeProfiles>',
        '</settings>',
      ].join('\n');
    },
  },
  {
    id: 'gradle',
    label: msg`Gradle`,
    language: 'text',
    build: (input) =>
      [
        '// settings.gradle.kts',
        'pluginManagement {',
        '    repositories {',
        ...gradleRepository('        ', readUrl(input), input.guarded),
        '    }',
        '}',
        'dependencyResolutionManagement {',
        '    repositories {',
        ...gradleRepository('        ', readUrl(input), input.guarded),
        '    }',
        '}',
      ].join('\n'),
  },
  {
    id: 'pom',
    label: msg`Deploy with Maven`,
    language: 'xml',
    when: canDeploy,
    build: (input) =>
      [
        '<!-- pom.xml; the credentials of the id are in settings.xml -->',
        '<distributionManagement>',
        '  <repository>',
        `    <id>${DEPLOY_ID}</id>`,
        `    <url>${xmlText(deployUrlOf(input))}</url>`,
        '  </repository>',
        '</distributionManagement>',
      ].join('\n'),
  },
  {
    id: 'gradle-publish',
    label: msg`Deploy with Gradle`,
    language: 'text',
    when: canDeploy,
    build: (input) =>
      [
        '// build.gradle.kts',
        'publishing {',
        '    repositories {',
        ...gradleRepository('        ', deployUrlOf(input), true, 'pulp'),
        '    }',
        '}',
      ].join('\n'),
  },
];
