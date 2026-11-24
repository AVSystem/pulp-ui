import { msg } from '@lingui/core/macro';
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginDescriptor, SnippetDef } from 'src/framework/descriptor';
import { renderWithProviders } from 'src/test-utils/render';
import { DistributionSnippets } from './distribution-snippets';
import { UnsafeValueError } from './quote';

const entryPointFor = vi.hoisted(() => vi.fn());

vi.mock('./entry-points', () => ({ entryPointFor }));

const ENTRY = {
  read: 'https://files.example.org/docs/',
  write: null,
  signingKey: null,
  suite: null,
  components: null,
};

const echo: SnippetDef = {
  id: 'echo',
  label: msg`Echo`,
  language: 'shell',
  build: ({ name, url, guarded, entry, basePath, repositoryName }) =>
    JSON.stringify({
      name,
      url,
      guarded,
      entry: entry?.read ?? null,
      basePath,
      repositoryName,
    }),
};

const second: SnippetDef = {
  id: 'second',
  label: msg`Second`,
  language: 'ini',
  build: ({ name }) => `[${name}]`,
};

function descriptorOf(
  snippets: SnippetDef[] | undefined,
  clientUrl: string | null = 'https://pulp.example.com/pulp/content/docs/',
): PluginDescriptor {
  return {
    distribution: {
      entity: { clientUrlOf: () => clientUrl },
      snippets,
    },
  } as unknown as PluginDescriptor;
}

const distribution = (over: Record<string, unknown> = {}) =>
  ({
    pulp_href: '/pulp/api/v3/distributions/file/file/1/',
    name: 'docs-dist',
    base_path: 'docs',
    base_url: 'https://pulp.example.com/pulp/content/docs/',
    content_guard: null,
    ...over,
  }) as never;

beforeEach(() => {
  entryPointFor.mockReset();
  entryPointFor.mockReturnValue(null);
});

describe(
  'Integration: the client snippet panel',
  { tags: ['integration'] },
  () => {
    it('shows one tab per snippet, the first selected, with the code of the first', async () => {
      const { user } = renderWithProviders(
        <DistributionSnippets
          plugin='file'
          descriptor={descriptorOf([echo, second])}
          distribution={distribution()}
          repositoryName='docs-repo'
        />,
      );

      expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
        'Echo',
        'Second',
      ]);
      expect(screen.getByRole('tab', { name: 'Echo' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(JSON.parse(screen.getByText(/"name"/).textContent ?? '')).toEqual({
        name: 'docs-dist',
        url: 'https://pulp.example.com/pulp/content/docs/',
        guarded: false,
        entry: null,
        basePath: 'docs',
        repositoryName: 'docs-repo',
      });

      await user.click(screen.getByRole('tab', { name: 'Second' }));
      expect(screen.getByText('[docs-dist]')).toBeVisible();
      expect(screen.queryByText(/"name"/)).toBeNull();
    });

    it('copies the code of the selected snippet', async () => {
      const { user } = renderWithProviders(
        <DistributionSnippets
          plugin='file'
          descriptor={descriptorOf([echo, second])}
          distribution={distribution()}
        />,
      );

      await user.click(screen.getByRole('tab', { name: 'Second' }));
      await user.click(
        screen.getByRole('button', { name: /copy to clipboard/i }),
      );

      expect(await navigator.clipboard.readText()).toBe('[docs-dist]');
    });

    it('asks the deployment for the entry point of this plugin and base path and hands it to the builders', () => {
      entryPointFor.mockReturnValue(ENTRY);

      renderWithProviders(
        <DistributionSnippets
          plugin='file'
          descriptor={descriptorOf([echo])}
          distribution={distribution()}
        />,
      );

      expect(entryPointFor).toHaveBeenCalledWith(
        'file',
        'docs',
        expect.any(String),
      );
      expect(
        JSON.parse(screen.getByText(/"name"/).textContent ?? '').entry,
      ).toBe('https://files.example.org/docs/');
    });

    it('still shows the snippets of a distribution the server gave no URL when an entry point names one', () => {
      entryPointFor.mockReturnValue(ENTRY);

      renderWithProviders(
        <DistributionSnippets
          plugin='file'
          descriptor={descriptorOf([echo], null)}
          distribution={distribution()}
        />,
      );

      expect(JSON.parse(screen.getByText(/"name"/).textContent ?? '').url).toBe(
        ENTRY.read,
      );
    });

    it('says there is nothing to show for a distribution with neither a URL nor an entry point', () => {
      renderWithProviders(
        <DistributionSnippets
          plugin='file'
          descriptor={descriptorOf([echo], null)}
          distribution={distribution()}
        />,
      );

      expect(screen.queryByRole('tab')).toBeNull();
      expect(
        screen.getByText(
          /The server reports no client URL for this distribution/,
        ),
      ).toBeVisible();
    });

    it('shows nothing for a plugin that declares no snippets', () => {
      const { container } = renderWithProviders(
        <DistributionSnippets
          plugin='file'
          descriptor={descriptorOf(undefined)}
          distribution={distribution()}
        />,
      );

      expect(container).toBeEmptyDOMElement();
    });

    it('tells the reader that a guarded distribution needs credentials and where they go, and says nothing of it for a public one', () => {
      const { rerender } = renderWithProviders(
        <DistributionSnippets
          plugin='file'
          descriptor={descriptorOf([echo])}
          distribution={distribution({
            content_guard: '/pulp/api/v3/contentguards/core/rbac/1/',
          })}
        />,
      );

      expect(screen.getByText(/Replace <user> and <token>/)).toBeVisible();
      expect(
        JSON.parse(screen.getByText(/"name"/).textContent ?? '').guarded,
      ).toBe(true);

      rerender(
        <DistributionSnippets
          plugin='file'
          descriptor={descriptorOf([echo])}
          distribution={distribution()}
        />,
      );
      expect(screen.queryByText(/Replace <user> and <token>/)).toBeNull();
    });

    it('counts a distribution whose guard was not answered as guarded, never as public', () => {
      renderWithProviders(
        <DistributionSnippets
          plugin='file'
          descriptor={descriptorOf([echo])}
          distribution={distribution({ content_guard: undefined })}
        />,
      );

      expect(
        JSON.parse(screen.getByText(/"name"/).textContent ?? '').guarded,
      ).toBe(true);
    });

    it('leaves out a snippet that does not apply to the distribution', () => {
      const onlyGuarded: SnippetDef = {
        ...second,
        id: 'only-guarded',
        label: msg`Only guarded`,
        when: ({ guarded }) => guarded,
      };

      renderWithProviders(
        <DistributionSnippets
          plugin='file'
          descriptor={descriptorOf([echo, onlyGuarded])}
          distribution={distribution()}
        />,
      );

      expect(screen.getAllByRole('tab')).toHaveLength(1);
    });

    it('shows the text of a hostile name as text', () => {
      renderWithProviders(
        <DistributionSnippets
          plugin='file'
          descriptor={descriptorOf([second])}
          distribution={distribution({ name: '<img src=x onerror=alert(1)>' })}
        />,
      );

      expect(screen.getByText('[<img src=x onerror=alert(1)>]')).toBeVisible();
      expect(document.querySelector('img')).toBeNull();
    });

    it('says a snippet cannot be written when a value would break its format, and keeps the others', async () => {
      const refusing: SnippetDef = {
        id: 'refusing',
        label: msg`Refusing`,
        language: 'ini',
        build: () => {
          throw new UnsafeValueError('a line break');
        },
      };

      const { user } = renderWithProviders(
        <DistributionSnippets
          plugin='file'
          descriptor={descriptorOf([refusing, second])}
          distribution={distribution()}
        />,
      );

      expect(
        screen.getByText(/cannot be written safely.*a line break/),
      ).toBeVisible();
      expect(
        screen.queryByRole('button', { name: /copy to clipboard/i }),
      ).toBeNull();
      await user.click(screen.getByRole('tab', { name: 'Second' }));
      expect(screen.getByText('[docs-dist]')).toBeVisible();
    });
  },
);
