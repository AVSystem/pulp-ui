import { t } from '@lingui/core/macro';
import { ComingSoon } from 'src/components/coming-soon';

// Screens that need an API this UI does not use yet. Each one tells the user
// so and points at the documentation of the feature.

export const SearchComingSoon = () => (
  <ComingSoon title={t`Search`} docs='https://pulpproject.org/pulp-cli/' />
);
