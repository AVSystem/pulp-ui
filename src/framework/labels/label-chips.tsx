import { t } from '@lingui/core/macro';
import { Label } from '@patternfly/react-core';
import { LabelGroup } from 'src/components';

interface Props {
  // The labels of an object as the server returns them: a key and a value, or
  // a key with no value.
  labels?: Record<string, string | null> | null;
}

// The labels of an object as read-only chips, "key: value" or the key alone,
// or "None" when the object has no label. It holds no state and sends no
// request: an object's labels come with the object.
export const LabelChips = ({ labels }: Props) => {
  const entries = Object.entries(labels ?? {});

  if (entries.length === 0) {
    return <>{t`None`}</>;
  }

  return (
    <LabelGroup>
      {entries.map(([key, value]) => (
        <Label key={key}>{value ? `${key}: ${value}` : key}</Label>
      ))}
    </LabelGroup>
  );
};
