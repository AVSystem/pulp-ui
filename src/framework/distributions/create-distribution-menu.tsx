import { t } from '@lingui/core/macro';
import {
  Dropdown,
  DropdownItem,
  DropdownList,
  MenuToggle,
  type MenuToggleElement,
} from '@patternfly/react-core';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useAppContext } from 'src/app-context';
import type { DistributionPlugin } from 'src/entities/core/distribution/page';
import { PLUGIN_MANIFESTS } from '../manifest';
import { newDistributionPath } from '../route-patterns';
import { pluginLabel } from './plugin-label';

// The installed plugins a user may add a distribution to, by the add permission
// of each plugin's manifest. Presentation only; Pulp decides the request.
export function useCreatablePlugins(
  installed: readonly DistributionPlugin[],
): DistributionPlugin[] {
  const { hasPermission } = useAppContext();

  return installed.filter((plugin) =>
    PLUGIN_MANIFESTS.some(
      (manifest) =>
        manifest.plugin === plugin &&
        hasPermission(manifest.permissions.distribution.add),
    ),
  );
}

interface Props {
  // The plugins the user may add a distribution to.
  plugins: readonly DistributionPlugin[];
}

// The button that starts a new distribution from the list of every plugin's
// distributions: it asks for the plugin first.
export const CreateDistributionMenu = ({ plugins }: Props) => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  return (
    <Dropdown
      isOpen={open}
      onOpenChange={setOpen}
      onSelect={() => setOpen(false)}
      toggle={(toggleRef: React.Ref<MenuToggleElement>) => (
        <MenuToggle
          ref={toggleRef}
          variant='primary'
          isExpanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          {t`Create distribution`}
        </MenuToggle>
      )}
    >
      <DropdownList>
        {plugins.map((plugin) => {
          const label = pluginLabel(plugin);

          return (
            <DropdownItem
              key={plugin}
              onClick={() => navigate(newDistributionPath(plugin))}
            >
              {t`${label} distribution`}
            </DropdownItem>
          );
        })}
      </DropdownList>
    </Dropdown>
  );
};
