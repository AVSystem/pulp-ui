import { msg, t } from '@lingui/core/macro';
import { Toolbar, ToolbarContent, ToolbarItem } from '@patternfly/react-core';
import { BaseHeader, Main } from 'src/components';
import type { PluginDescriptor } from '../descriptor';
import {
  ContentList,
  ContentTypeChoice,
  tabConfig,
  useContentType,
} from '../detail/content-tab';
import {
  type FrameworkPlugin,
  PLUGIN_MANIFESTS,
  type PluginManifest,
} from '../manifest';

// A list of a plugin's content reads fifty rows at a time, like every other
// list of the application.
const PAGE_SIZE = 50;

interface Props {
  plugin: FrameworkPlugin;
  descriptor: PluginDescriptor;
}

// All the content of a plugin that the user may see, one kind of content at a
// time (a choice between them when the plugin declares several), whichever
// repository holds it. The list asks for no repository version and adds no
// filter of its own: what the server returns for the user is what is shown.
// Rows have the type's columns, filters and labels, and a user who may manage
// content labels edits them here too; the list changes nothing else.
export const GlobalContentList = ({ plugin, descriptor }: Props) => {
  const types = descriptor.contentTypes ?? [];
  if (types.length === 0) {
    throw new Error(
      `The ${plugin} descriptor declares no content type, which a list of its content needs`,
    );
  }
  const manifest = PLUGIN_MANIFESTS.find(
    (candidate) => candidate.plugin === plugin,
  ) as PluginManifest;
  const { type, listAddress } = useContentType(types);
  const config = {
    ...tabConfig(type),
    defaultPageSize: PAGE_SIZE,
    emptyTitle: msg`No content to show`,
    emptyDescription: msg`There is no content of this kind that you may see.`,
  };
  const name = manifest.label;

  return (
    <>
      <BaseHeader title={t`${name} content`} />
      <Main>
        {types.length > 1 ? (
          <Toolbar>
            <ToolbarContent>
              <ToolbarItem>
                <ContentTypeChoice types={types} type={type} />
              </ToolbarItem>
            </ToolbarContent>
          </Toolbar>
        ) : null}
        <ContentList
          key={type.id}
          config={config}
          version={undefined}
          unscoped
          address={listAddress}
          labelled={type.entity.setLabel !== undefined}
        />
      </Main>
    </>
  );
};
