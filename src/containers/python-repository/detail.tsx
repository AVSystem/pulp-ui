import { msg, t } from '@lingui/core/macro';
import { pythonRepositoryDeleteAction } from 'src/actions/python-repository-delete';
import { pythonRepositoryEditAction } from 'src/actions/python-repository-edit';
import { pythonRepositorySyncAction } from 'src/actions/python-repository-sync';
import { PythonRemoteAPI, type PythonRemoteType } from 'src/api/python-remote';
import {
  PythonRepositoryAPI,
  type PythonRepositoryType,
} from 'src/api/python-repository';
import { PageWithTabs } from 'src/components';
import { Paths, formatPath } from 'src/paths';
import { parsePulpIDFromURL } from 'src/utilities/parse-pulp-id';
import {
  type RepositoryDistribution,
  distributionsLoadError,
  repositoryDistributions,
} from 'src/utilities/repository-distributions';
import { DetailsTab } from './tab-details';
import { DistributionsTab } from './tab-distributions';
import { PackagesTab } from './tab-packages';
import { RepositoryVersionsTab } from './tab-repository-versions';

const PythonRepositoryDetail = PageWithTabs<
  PythonRepositoryType & {
    distributions?: RepositoryDistribution[];
    distributionsError?: string | null;
    remote?: PythonRemoteType;
  }
>({
  breadcrumbs: ({ name, tab, params: { repositoryVersion } }) => {
    const crumbs = [
      { url: formatPath(Paths.python.repository.list), name: t`Repositories` },
      { url: formatPath(Paths.python.repository.detail, { name }), name },
    ];

    if (tab !== 'repository-versions') {
      return crumbs;
    }

    // Looking at a single version keeps a link back to the list of them.
    return repositoryVersion
      ? [
          ...crumbs,
          {
            url: formatPath(Paths.python.repository.detail, { name }, { tab }),
            name: t`Versions`,
          },
          { name: t`Version ${repositoryVersion}` },
        ]
      : [...crumbs, { name: t`Versions` }];
  },
  displayName: 'PythonRepositoryDetail',
  errorTitle: msg`Repository could not be displayed.`,
  headerActions: [
    pythonRepositoryEditAction,
    pythonRepositorySyncAction,
    pythonRepositoryDeleteAction,
  ],
  listUrl: formatPath(Paths.python.repository.list),
  query: ({ name }) =>
    PythonRepositoryAPI.list({ name, page_size: 1 })
      .then(({ data }) => data?.results?.[0])
      .then((repository) => {
        // There is no detail endpoint keyed by name, so a name matching nothing
        // answers 200 with an empty list. Turn that into the 404 the page already
        // knows how to render, instead of resolving with undefined.
        if (!repository) {
          return Promise.reject({ response: { status: 404 } });
        }

        return Promise.all([
          // a failed load reaches the page as a visible message, never as an
          // empty list
          repositoryDistributions('python', repository.pulp_href).then(
            (distributions) => ({ distributions, distributionsError: null }),
            (e) => {
              console.error(e);
              return {
                distributions: [] as RepositoryDistribution[],
                distributionsError: distributionsLoadError(e),
              };
            },
          ),
          repository.remote
            ? PythonRemoteAPI.get(parsePulpIDFromURL(repository.remote))
                .then(({ data }) => data)
                .catch(() => null)
            : null,
        ]).then(([{ distributions, distributionsError }, remote]) => ({
          ...repository,
          distributions,
          distributionsError,
          remote,
        }));
      }),
  renderTab: (tab, item, actionContext) =>
    ({
      details: <DetailsTab item={item} actionContext={actionContext} />,
      'repository-versions': (
        <RepositoryVersionsTab item={item} actionContext={actionContext} />
      ),
      distributions: (
        <DistributionsTab item={item} actionContext={actionContext} />
      ),
      packages: <PackagesTab item={item} actionContext={actionContext} />,
    })[tab],
  tabs: (tab, name) => [
    {
      active: tab === 'details',
      title: t`Details`,
      link: formatPath(
        Paths.python.repository.detail,
        { name },
        { tab: 'details' },
      ),
    },
    {
      active: tab === 'repository-versions',
      title: t`Versions`,
      link: formatPath(
        Paths.python.repository.detail,
        { name },
        { tab: 'repository-versions' },
      ),
    },
    {
      active: tab === 'distributions',
      title: t`Distributions`,
      link: formatPath(
        Paths.python.repository.detail,
        { name },
        { tab: 'distributions' },
      ),
    },
    {
      active: tab === 'packages',
      title: t`Packages`,
      link: formatPath(
        Paths.python.repository.detail,
        { name },
        { tab: 'packages' },
      ),
    },
  ],
});

export default PythonRepositoryDetail;
