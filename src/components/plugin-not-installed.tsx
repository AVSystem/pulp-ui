import { t } from '@lingui/core/macro';
import { Button } from '@patternfly/react-core';
import { Link } from 'react-router';
import { Paths, formatPath } from 'src/paths';
import { BaseHeader } from './base-header';
import { EmptyStateCustom } from './empty-state-custom';
import { Main } from './main';

// A router link that looks like a button.
const StatusLink = (props) => (
  <Link {...props} to={formatPath(Paths.core.status)} />
);

interface IProps {
  // The component name the server reports for the plugin. It comes from the
  // route table, never from the address.
  plugin: string;
}

// Shown in the place of a screen of a plugin the server does not report. The
// Status page lists what is installed.
export const PluginNotInstalled = ({ plugin }: IProps) => (
  <>
    <BaseHeader title={t`Plugin not installed`} />
    <Main>
      <section className='pulp-section'>
        <EmptyStateCustom
          title={t`Plugin not installed`}
          description={t`The ${plugin} plugin is not installed on this Pulp server.`}
          button={
            <Button variant='primary' component={StatusLink}>
              {t`Status`}
            </Button>
          }
        />
      </section>
    </Main>
  </>
);
