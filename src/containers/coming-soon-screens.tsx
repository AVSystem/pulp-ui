import { t } from '@lingui/core/macro';
import { ComingSoon } from 'src/components/coming-soon';
import { Paths, formatPath } from 'src/paths';

// Screens that need an API this UI does not use yet. Each one tells the user
// so and points at the documentation of the feature.

const ANSIBLE_DOCS = 'https://pulpproject.org/pulp_ansible/';
const CONTAINER_DOCS = 'https://pulpproject.org/pulp_container/';

// Repositories are the screen of the Ansible plugin that works on a plain
// Pulp server.
const ansibleRepositories = () => ({
  label: t`Ansible repositories`,
  to: formatPath(Paths.ansible.repository.list),
});

export const CollectionsComingSoon = () => (
  <ComingSoon
    title={t`Collections`}
    counterpart={ansibleRepositories()}
    docs={ANSIBLE_DOCS}
  />
);

export const NamespacesComingSoon = () => (
  <ComingSoon
    title={t`Namespaces`}
    counterpart={ansibleRepositories()}
    docs={ANSIBLE_DOCS}
  />
);

export const SearchComingSoon = () => (
  <ComingSoon title={t`Search`} docs='https://pulpproject.org/pulp-cli/' />
);

export const ContainersComingSoon = () => (
  <ComingSoon title={t`Containers`} docs={CONTAINER_DOCS} />
);

export const RemoteRegistriesComingSoon = () => (
  <ComingSoon title={t`Remote registries`} docs={CONTAINER_DOCS} />
);
