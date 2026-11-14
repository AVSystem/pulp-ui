import { t } from '@lingui/core/macro';
import { DropdownItem } from '@patternfly/react-core';
import ExternalLinkAltIcon from '@patternfly/react-icons/dist/esm/icons/external-link-alt-icon';
import OutlinedQuestionCircleIcon from '@patternfly/react-icons/dist/esm/icons/outlined-question-circle-icon';
import { useNavigate } from 'react-router';
import { StatefulDropdown } from 'src/components';
import { Paths, formatPath } from 'src/paths';

// The public documentation of the Pulp project.
const DOCUMENTATION_URL = 'https://docs.pulpproject.org/';

// Where to read about Pulp and this interface: the project's documentation,
// the About dialog of this interface and the page about the project.
export const HelpMenu = ({ showAbout }: { showAbout: () => void }) => {
  const navigate = useNavigate();

  return (
    <StatefulDropdown
      ariaLabel={t`Help`}
      data-cy='docs-dropdown'
      toggleClassName='pulp-topbar__button'
      defaultText={<OutlinedQuestionCircleIcon />}
      toggleType='icon'
      items={[
        <DropdownItem
          key='documentation'
          to={DOCUMENTATION_URL}
          target='_blank'
          rel='noopener noreferrer'
          icon={<ExternalLinkAltIcon />}
        >
          {t`Documentation`}
        </DropdownItem>,
        <DropdownItem key='about' onClick={() => showAbout()}>
          {t`About Pulp UI`}
        </DropdownItem>,
        <DropdownItem
          key='about-project'
          onClick={() => navigate(formatPath(Paths.meta.about))}
        >
          {t`About project`}
        </DropdownItem>,
      ]}
    />
  );
};
