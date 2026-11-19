import { t } from '@lingui/core/macro';
import {
  AboutModal,
  Content,
  ContentVariants,
  HelperText,
  HelperTextItem,
} from '@patternfly/react-core';
import { type ReactNode } from 'react';
import { Link } from 'react-router';
import { useAppContext } from 'src/app-context';
import { DateComponent, ExternalLink, MaybeLink } from 'src/components';
import {
  type VersionDifference,
  versionDifferences,
} from 'src/entities/core/status/generated-versions';
import { Paths, formatPath } from 'src/paths';
import { usePlugins } from 'src/plugins';
import { config } from 'src/ui-config';
import PulpLogo from 'static/images/pulp_logo.png';

// The fork's public repository; version tags and commits are linked from here.
const FORK_REPOSITORY_URL = 'https://github.com/AVSystem/pulp-ui';

const Label = ({ children }: { children: ReactNode }) => (
  <Content component={ContentVariants.dt}>{children}</Content>
);

const Value = ({ children }: { children: ReactNode }) => (
  <Content component={ContentVariants.dd}>{children}</Content>
);

const differenceText = ({
  name,
  kind,
  generated,
  running,
}: VersionDifference) => {
  switch (kind) {
    case 'different':
      return t`${name}: the interface was generated for ${generated}, this server runs ${running}`;
    case 'not-generated':
      return t`${name}: not part of the generated interface`;
    case 'not-installed':
      return t`${name}: generated in the interface, not installed on this server`;
  }
};

interface IProps {
  isOpen: boolean;
  onClose: () => void;
  username: string;
}

export const PulpAboutModal = ({ isOpen, onClose, username }: IProps) => {
  const plugins = usePlugins();
  const { isStaff, permissionsReady } = useAppContext();
  // e.g. 3.65.0; unknown until the server has answered and when it could not
  // be read
  const pulp_core_version =
    plugins.state === 'ready' ? plugins.versions.get('core') : undefined;

  // Helps an administrator notice that the typed client of the interface was
  // generated against other plugin versions than the server runs. It only
  // informs and blocks nothing; everyone else sees nothing, and nothing is
  // shown until both the permissions and the plugin versions are known.
  const differences =
    isStaff && permissionsReady && plugins.state === 'ready'
      ? versionDifferences(plugins.versions)
      : [];

  const ui_hash = UI_BUILD_INFO?.hash;
  const ui_sha = ui_hash?.slice(0, 12);
  const ui_date = UI_BUILD_INFO?.date;
  const ui_version = UI_BUILD_INFO?.version;
  const ui_extra = config.EXTRA_VERSION;

  // FIXME
  const user = { username, id: null, groups: [] };

  return (
    <AboutModal
      brandImageAlt={t`Pulp logo`}
      brandImageSrc={PulpLogo}
      isOpen={isOpen}
      onClose={onClose}
      productName='Pulp UI'
    >
      <Content>
        <Content component={ContentVariants.dl}>
          <Label>{t`Pulp core version`}</Label>
          <Value>
            {!pulp_core_version || pulp_core_version.includes('.dev') ? (
              pulp_core_version
            ) : (
              <ExternalLink
                href={`https://github.com/pulp/pulpcore/releases/tag/${pulp_core_version}`}
              >
                {pulp_core_version}
              </ExternalLink>
            )}
          </Value>

          <Label>{t`UI version`}</Label>
          <Value>
            {ui_version ? (
              <>
                <ExternalLink
                  href={`${FORK_REPOSITORY_URL}/tree/v${ui_version}`}
                >
                  {ui_version}
                </ExternalLink>{' '}
              </>
            ) : null}
            {ui_version ? '(' : null}
            <ExternalLink href={`${FORK_REPOSITORY_URL}/commit/${ui_hash}`}>
              {ui_sha}
            </ExternalLink>
            {ui_date ? (
              <>
                {', '}
                <DateComponent date={ui_date} />
              </>
            ) : null}
            {ui_version ? ')' : null}
            {ui_extra ? (
              <>
                <br />
                {ui_extra}
              </>
            ) : null}
          </Value>

          <Label>{t`Username`}</Label>
          <Value>
            <MaybeLink
              to={
                user.id
                  ? formatPath(Paths.core.user.detail, { user_id: user.id })
                  : null
              }
              title={username}
            >
              {username}
              {user?.username && user.username !== username ? (
                <> ({user.username})</>
              ) : null}
            </MaybeLink>
          </Value>

          <Label>{t`User groups`}</Label>
          <Value>
            {user.groups.map(({ id: group, name }, index) => (
              <>
                {index ? ', ' : null}
                <Link
                  key={group}
                  to={formatPath(Paths.core.group.detail, { group })}
                >
                  {name}
                </Link>
              </>
            ))}
          </Value>
        </Content>
        {differences.length ? (
          <HelperText component='ul'>
            {differences.map((difference) => (
              <HelperTextItem component='li' key={difference.name}>
                {differenceText(difference)}
              </HelperTextItem>
            ))}
          </HelperText>
        ) : null}
      </Content>
    </AboutModal>
  );
};
