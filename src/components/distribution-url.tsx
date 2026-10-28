import { t } from '@lingui/core/macro';
import { Flex, FlexItem, Label } from '@patternfly/react-core';
import { type RepositoryDistribution } from '../utilities/repository-distributions';
import { CopyURL } from './copy-url';

// The URL a distribution is served at, as the server reports it. A
// distribution the content app answers 404 for says so next to its URL, so a
// copied URL that cannot work is not mistaken for a working one.
export const DistributionURL = ({
  distribution,
}: {
  distribution: Pick<RepositoryDistribution, 'url' | 'served'>;
}) => (
  <Flex
    alignItems={{ default: 'alignItemsCenter' }}
    spaceItems={{ default: 'spaceItemsSm' }}
  >
    <FlexItem>
      {distribution.url ? <CopyURL url={distribution.url} /> : t`None`}
    </FlexItem>
    {distribution.served ? null : (
      <FlexItem>
        <Label color='orange'>{t`Not served: no publication`}</Label>
      </FlexItem>
    )}
  </Flex>
);

// The URLs of all distributions serving a repository. A failed load shows its
// reason, so a missing distribution is never mistaken for none.
export const DistributionURLs = ({
  distributions,
  error,
}: {
  distributions?: RepositoryDistribution[];
  error?: string | null;
}) => {
  if (error) {
    return (
      <span className='pf-v5-u-danger-color-100'>
        {t`Distributions could not be loaded: ${error}`}
      </span>
    );
  }

  if (!distributions?.length) {
    return <>{t`None`}</>;
  }

  return (
    <>
      {distributions.map((distribution) => (
        <div key={distribution.pulp_href}>
          {distributions.length > 1 ? (
            <strong>{distribution.name}</strong>
          ) : null}
          <DistributionURL distribution={distribution} />
        </div>
      ))}
    </>
  );
};
