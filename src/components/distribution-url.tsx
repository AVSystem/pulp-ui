import { t } from '@lingui/core/macro';
import { Flex, FlexItem, Label } from '@patternfly/react-core';
import { ServedLabel } from '../framework/serving/served-label';
import {
  type ServedState,
  isNoteworthy,
} from '../framework/serving/served-state';
import { type RepositoryDistribution } from '../utilities/repository-distributions';
import { CopyURL } from './copy-url';

// A distribution as the screens of the framework show it: its URL and what it
// serves, decided by the framework's rules. The older screens that still have
// their own two-state answer pass `served` as a flag instead.
type DistributionShown =
  | Pick<RepositoryDistribution, 'url' | 'served'>
  | { url: string | null; state: ServedState };

// The URL a distribution is served at, as the server reports it. A
// distribution the content app answers 404 for, or one that serves an older
// version than the latest, says so next to its URL, so a copied URL that cannot
// work is not mistaken for a working one. A distribution that cannot be checked
// says that instead, never that it serves nothing.
export const DistributionURL = ({
  distribution,
}: {
  distribution: DistributionShown;
}) => (
  <Flex
    alignItems={{ default: 'alignItemsCenter' }}
    spaceItems={{ default: 'spaceItemsSm' }}
  >
    <FlexItem>
      {distribution.url ? <CopyURL url={distribution.url} /> : t`None`}
    </FlexItem>
    {'state' in distribution ? (
      isNoteworthy(distribution.state) ? (
        <FlexItem>
          <ServedLabel state={distribution.state} />
        </FlexItem>
      ) : null
    ) : distribution.served ? null : (
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
      <span
        style={{
          color: 'var(--pf-t--global--text--color--status--danger--default)',
        }}
      >
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
