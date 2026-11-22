import {
  type APIRequestContext,
  type Locator,
  type Page,
  expect,
} from '@playwright/test';
import { getRepositoriesAnsibleAnsibleListUrl } from '@pulp-ui/sdk/ansible/repositories-ansible';
import { getRepositoriesContainerContainerListUrl } from '@pulp-ui/sdk/container/repositories-container';
import { getRepositoriesDebAptListUrl } from '@pulp-ui/sdk/deb/repositories-apt';
import { getRepositoriesFileFileListUrl } from '@pulp-ui/sdk/file/repositories-file';
import { getRepositoriesMavenMavenListUrl } from '@pulp-ui/sdk/maven/repositories-maven';
import { getRepositoriesNpmNpmListUrl } from '@pulp-ui/sdk/npm/repositories-npm';
import { getRepositoriesPythonPythonListUrl } from '@pulp-ui/sdk/python/repositories-python';
import { getRepositoriesRpmRpmListUrl } from '@pulp-ui/sdk/rpm/repositories-rpm';
import { type PulpObject, listAll } from './api';
import { title } from './sign-in';

// What the distribution specs share: the plugins and where each one's
// distributions and repositories live, and the steps of the screens the specs
// drive the way a person does.

export type DistributionPlugin =
  'file' | 'deb' | 'rpm' | 'python' | 'maven' | 'npm' | 'ansible' | 'container';

interface PluginFacts {
  // the name the plugin is shown under, as in the "Create distribution" menu
  label: string;
  // the path of the plugin's distribution and repository endpoints
  distributions: string;
  repositories: string;
}

export const PLUGINS: Record<DistributionPlugin, PluginFacts> = {
  file: {
    label: 'File',
    distributions: 'distributions/file/file/',
    repositories: getRepositoriesFileFileListUrl(),
  },
  deb: {
    label: 'deb',
    distributions: 'distributions/deb/apt/',
    repositories: getRepositoriesDebAptListUrl(),
  },
  rpm: {
    label: 'RPM',
    distributions: 'distributions/rpm/rpm/',
    repositories: getRepositoriesRpmRpmListUrl(),
  },
  python: {
    label: 'Python',
    distributions: 'distributions/python/pypi/',
    repositories: getRepositoriesPythonPythonListUrl(),
  },
  maven: {
    label: 'Maven',
    distributions: 'distributions/maven/maven/',
    repositories: getRepositoriesMavenMavenListUrl(),
  },
  npm: {
    label: 'npm',
    distributions: 'distributions/npm/npm/',
    repositories: getRepositoriesNpmNpmListUrl(),
  },
  ansible: {
    label: 'Ansible',
    distributions: 'distributions/ansible/ansible/',
    repositories: getRepositoriesAnsibleAnsibleListUrl(),
  },
  container: {
    label: 'Container',
    distributions: 'distributions/container/container/',
    repositories: getRepositoriesContainerContainerListUrl(),
  },
};

// The shared guard the lab's serving objects use. The specs read it and attach
// it to their own distributions; they never change it.
export const SERVING_GUARD = 'zz-synth-serving-guard';

const escape = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The pulp_href of an object found by exact name, or undefined.
export async function findByName(
  api: APIRequestContext,
  path: string,
  name: string,
): Promise<PulpObject | undefined> {
  const found = await listAll(api, path, { name });
  return found[0];
}

// The distributions of a plugin that carry a name, read from the server.
export async function distributionsNamed(
  api: APIRequestContext,
  plugin: DistributionPlugin,
  name: string,
): Promise<PulpObject[]> {
  return listAll(api, PLUGINS[plugin].distributions, { name });
}

// The result of choosing an option in one of the form's typeaheads: the text
// is typed into the field the placeholder names, and the option that carries it
// is clicked once the list shows it.
export async function pickFromTypeahead(
  page: Page,
  placeholder: string,
  text: string,
): Promise<void> {
  const box = page.getByRole('combobox', { name: placeholder });
  await box.click();
  await box.fill(text);
  await page
    .getByRole('option', { name: new RegExp(escape(text)) })
    .first()
    .click();
}

// Opens the form that creates a distribution of a plugin from the list of every
// plugin's distributions, through the "Create distribution" menu.
export async function openCreateForm(
  page: Page,
  plugin: DistributionPlugin,
): Promise<void> {
  await page.goto('distributions');
  await expect(title(page, 'Distributions')).toBeVisible();
  await page.getByRole('button', { name: 'Create distribution' }).click();
  await page
    .getByRole('menuitem', { name: `${PLUGINS[plugin].label} distribution` })
    .click();
  await expect(title(page, 'Create distribution')).toBeVisible();
}

export const createButton = (page: Page): Locator =>
  page.getByRole('button', { name: 'Create', exact: true });

// Chooses to protect the distribution with the content guard of the name.
export async function chooseGuard(page: Page, guard: string): Promise<void> {
  await page
    .getByRole('radio', { name: /Protected by a content guard/ })
    .check();
  await pickFromTypeahead(page, 'Select a content guard', guard);
}

// Chooses the explicit Public protection.
export async function choosePublic(page: Page): Promise<void> {
  await page.getByRole('radio', { name: /^Public/ }).check();
}

// Fills the name and the base path of the create form.
export async function fillNames(
  page: Page,
  name: string,
  basePath = name,
): Promise<void> {
  await page.locator('#name').fill(name);
  await page.locator('#base_path').fill(basePath);
}

// The row of the list of every plugin's distributions that carries a name.
export const listRow = (page: Page, name: string): Locator =>
  page.locator(`[data-cy="DistributionList-row-${name}"]`);

// Opens the list narrowed to the names that contain the text, once its rows are
// those of the address.
export async function openListFiltered(
  page: Page,
  text: string,
  extra = '',
): Promise<void> {
  await page.goto(
    `distributions?name__icontains=${encodeURIComponent(text)}${extra}`,
  );
  await expect(title(page, 'Distributions')).toBeVisible();
  await expect(
    page.locator('table[aria-label="Distributions"][data-rows-loaded="true"]'),
  ).toBeVisible();
}
