import { t } from '@lingui/core/macro';
import { Button, Flex, FlexItem } from '@patternfly/react-core';
import DownloadIcon from '@patternfly/react-icons/dist/esm/icons/download-icon';
import { useState } from 'react';
import { FileUpload } from 'src/components';
import { downloadString } from 'src/utilities/download-data';

interface Props {
  id: string;
  // The PEM text the field holds.
  value: string;
  onChange: (value: string) => void;
  isDisabled: boolean;
  hasError: boolean;
  // What the field is called where it is announced, for the download button.
  label: string;
  // False for a value the server never returns (a private key): there is
  // nothing stored to download, only what was typed or taken from a file.
  canDownload: boolean;
}

// A certificate or key as PEM text: it is typed or pasted into the text box, or
// taken from a file, and the text box shows what will be sent either way. The
// text can be downloaded again, so a certificate stored on a remote can be
// copied to another place. Nothing here checks the certificate: it is sent as
// the text it is and Pulp refuses a malformed one with a message under the field.
export const CertificateField = ({
  id,
  value,
  onChange,
  isDisabled,
  hasError,
  label,
  canDownload,
}: Props) => {
  // The name of the file the text came from; it is only shown and is empty for
  // text that was typed or that the server stored.
  const [filename, setFilename] = useState('');

  return (
    <Flex alignItems={{ default: 'alignItemsFlexStart' }}>
      <FlexItem grow={{ default: 'grow' }}>
        <FileUpload
          id={id}
          type='text'
          value={value}
          filename={filename}
          allowEditingUploadedText
          isDisabled={isDisabled}
          validated={hasError ? 'error' : 'default'}
          onFileInputChange={(_event, file) => setFilename(file.name)}
          onDataChange={(_event, data) => onChange(data)}
          onTextChange={(_event, text) => onChange(text)}
          onClearClick={() => {
            setFilename('');
            onChange('');
          }}
        />
      </FlexItem>
      {canDownload ? (
        <FlexItem>
          <Button
            variant='plain'
            icon={<DownloadIcon />}
            isDisabled={value === ''}
            aria-label={t`Download ${label}`}
            onClick={() => downloadString(value, `${id}.pem`)}
          />
        </FlexItem>
      ) : null}
    </Flex>
  );
};
