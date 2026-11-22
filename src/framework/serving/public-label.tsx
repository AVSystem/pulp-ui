import { t } from '@lingui/core/macro';
import { Label } from '@patternfly/react-core';

// The mark of a distribution that has no content guard: anyone who knows its
// address may download from it.
export const PublicLabel = () => (
  <Label color='blue' variant='outline'>{t`Public`}</Label>
);
