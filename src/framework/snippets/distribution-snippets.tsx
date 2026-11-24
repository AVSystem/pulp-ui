import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import {
  CodeBlock,
  CodeBlockAction,
  CodeBlockCode,
  Content,
  Tab,
  TabTitleText,
  Tabs,
} from '@patternfly/react-core';
import { useState } from 'react';
import { PulpCopyButton } from 'src/components';
import type { DistributionBase } from 'src/entities/plugin/distribution';
import type { PluginDescriptor, SnippetDef, SnippetInput } from '../descriptor';
import type { FrameworkPlugin } from '../manifest';
import { entryPointFor } from './entry-points';
import { UnsafeValueError } from './quote';

interface Props {
  plugin: FrameworkPlugin;
  descriptor: PluginDescriptor;
  distribution: DistributionBase;
  // The repository the distribution serves, when the screen knows it.
  repositoryName?: string | null;
}

type Written =
  { text: string; refusal?: undefined } | { text?: undefined; refusal: string };

// The text of a snippet, or why it cannot be written: a builder that is given a
// value it cannot write safely says so, and the panel shows that instead of
// text that would change meaning when pasted.
function write(snippet: SnippetDef, input: SnippetInput): Written {
  try {
    return { text: snippet.build(input) };
  } catch (error) {
    if (error instanceof UnsafeValueError) {
      return { refusal: error.message };
    }
    throw error;
  }
}

const SnippetCode = ({
  snippet,
  input,
}: {
  snippet: SnippetDef;
  input: SnippetInput;
}) => {
  const written = write(snippet, input);

  if (written.text === undefined) {
    return (
      <Content component='p'>
        {t`This snippet cannot be written safely, because a value of the distribution holds ${written.refusal}.`}
      </Content>
    );
  }

  return (
    <CodeBlock
      actions={
        <CodeBlockAction>
          <PulpCopyButton text={written.text} />
        </CodeBlockAction>
      }
    >
      <CodeBlockCode data-language={snippet.language}>
        {written.text}
      </CodeBlockCode>
    </CodeBlock>
  );
};

// The client configuration of a distribution, one tab per snippet the plugin
// declares, each with a copy button. The addresses are the deployment's entry
// point for the distribution when it names one and the address the server
// reports otherwise. A guarded distribution's snippets carry placeholders where
// the credentials go.
export const DistributionSnippets = ({
  plugin,
  descriptor,
  distribution,
  repositoryName = null,
}: Props) => {
  const kind = descriptor.distribution;
  const [selected, setSelected] = useState<string | null>(null);

  if (!kind?.snippets || kind.snippets.length === 0) {
    return null;
  }

  const origin = window.location.origin;
  const entry = entryPointFor(plugin, distribution.base_path, origin);
  const url = kind.entity.clientUrlOf(distribution) ?? entry?.read ?? null;

  if (url === null) {
    return (
      <Content component='p'>
        {t`The server reports no client URL for this distribution, so there is no client configuration to show.`}
      </Content>
    );
  }

  // Only the server's own answer makes a distribution public.
  const guarded = distribution.content_guard !== null;
  const input: SnippetInput = {
    name: distribution.name,
    basePath: distribution.base_path,
    url,
    guarded,
    entry,
    origin,
    repositoryName,
  };
  const snippets = kind.snippets.filter(
    (snippet) => snippet.when === undefined || snippet.when(input),
  );
  const active =
    snippets.find(({ id }) => id === selected) ?? snippets[0] ?? null;

  if (active === null) {
    return null;
  }

  return (
    <div data-cy='DistributionSnippets'>
      {guarded ? (
        <Content component='small'>
          {t`Replace <user> and <token> with an account that may read this distribution.`}
        </Content>
      ) : null}
      <Tabs
        activeKey={active.id}
        onSelect={(_event, key) => setSelected(String(key))}
        aria-label={t`Client configuration`}
        mountOnEnter
        unmountOnExit
      >
        {snippets.map((snippet) => (
          <Tab
            key={snippet.id}
            eventKey={snippet.id}
            title={<TabTitleText>{i18n._(snippet.label)}</TabTitleText>}
          >
            <SnippetCode snippet={snippet} input={input} />
          </Tab>
        ))}
      </Tabs>
    </div>
  );
};
