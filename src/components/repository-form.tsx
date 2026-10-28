import { t } from '@lingui/core/macro';
import {
  ActionGroup,
  Button,
  Checkbox,
  Form,
  FormGroup,
  TextInput,
} from '@patternfly/react-core';
import { useEffect, useRef, useState } from 'react';
import { type AnsibleRepositoryType } from 'src/api';
import { AnsibleDistributionAPI } from 'src/api/ansible-distribution';
import { PulpStatusAPI } from 'src/api/pulp-status';
import {
  FormFieldHelper,
  HelpButton,
  LazyDistributions,
  PulpLabels,
  Spinner,
  Typeahead,
} from 'src/components';
import { config } from 'src/ui-config';
import {
  type ErrorMessagesType,
  errorMessage,
  plugin2api,
} from 'src/utilities';
import {
  basePathProblem,
  reservedPrefixFor,
  sanitizeBasePath,
} from 'src/utilities/base-path-rules';

interface IProps {
  allowEditName: boolean;
  errorMessages: ErrorMessagesType;
  // true on the create form, which alone may offer a distribution
  isNew: boolean;
  onCancel: () => void;
  // resolves when the save attempt is over; the form keeps Save disabled until then
  onSave: (options: {
    distribution: { basePath: string } | null;
  }) => void | Promise<void>;
  plugin: 'ansible' | 'deb' | 'file' | 'rpm';
  repository: AnsibleRepositoryType;
  updateRepository: (r) => void;
}

export const RepositoryForm = ({
  allowEditName,
  errorMessages,
  isNew,
  onCancel,
  onSave,
  plugin,
  repository,
  updateRepository,
}: IProps) => {
  const requiredFields = [];
  const disabledFields = allowEditName ? [] : ['name'];

  const formGroup = (fieldName, label, helperText, children) => (
    <FormGroup
      key={fieldName}
      fieldId={fieldName}
      label={
        helperText ? (
          <>
            {label} <HelpButton content={helperText} />
          </>
        ) : (
          label
        )
      }
      isRequired={requiredFields.includes(fieldName)}
    >
      {children}
      <FormFieldHelper
        variant={fieldName in errorMessages ? 'error' : 'default'}
      >
        {errorMessages[fieldName]}
      </FormFieldHelper>
    </FormGroup>
  );
  const inputField = (fieldName, label, helperText, props) =>
    formGroup(
      fieldName,
      label,
      helperText,
      <TextInput
        validated={fieldName in errorMessages ? 'error' : 'default'}
        isRequired={requiredFields.includes(fieldName)}
        isDisabled={disabledFields.includes(fieldName)}
        id={fieldName}
        value={repository[fieldName] || ''}
        onChange={(_event, value) =>
          updateRepository({ ...repository, [fieldName]: value })
        }
        {...props}
      />,
    );
  const stringField = (fieldName, label, helperText?) =>
    inputField(fieldName, label, helperText, { type: 'text' });
  const numericField = (fieldName, label, helperText?) =>
    inputField(fieldName, label, helperText, { type: 'number' });

  const isValid = !requiredFields.find((field) => !repository[field]);

  const [createDistribution, setCreateDistribution] = useState(false);
  // undefined until the user edits the field; until then the base path follows
  // the repository name
  const [typedBasePath, setTypedBasePath] = useState<string | undefined>();
  const basePath = typedBasePath ?? sanitizeBasePath(repository.name || '');
  const [urlPrefix, setUrlPrefix] = useState<string | null | undefined>();
  const [saving, setSaving] = useState(false);
  // a second click can arrive before the disabled button has rendered
  const savingRef = useRef(false);

  useEffect(() => {
    if (!isNew || !createDistribution) {
      return;
    }

    let current = true;
    loadUrlPrefix(plugin).then((prefix) => current && setUrlPrefix(prefix));
    return () => {
      current = false;
    };
  }, [isNew, createDistribution, plugin]);

  const problem = createDistribution ? basePathProblem(basePath) : null;
  const reserved = createDistribution
    ? reservedPrefixFor(basePath, config?.RESERVED_BASE_PATH_PREFIXES)
    : null;
  const basePathError =
    (problem === 'empty' && t`Enter a base path.`) ||
    (problem === 'slash' &&
      t`A base path cannot start or end with a slash or contain two slashes in a row.`) ||
    (problem === 'characters' &&
      t`A base path may contain only letters, digits, "-", "_" and "/".`) ||
    (reserved &&
      t`Base paths starting with "${reserved}" are reserved on this server. Choose another base path.`) ||
    errorMessages['base_path'] ||
    null;
  const blocked = !!(problem || reserved);

  const save = async () => {
    if (savingRef.current) {
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      await onSave({
        distribution: isNew && createDistribution ? { basePath } : null,
      });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const url = urlPrefix ? `${urlPrefix}${basePath}/` : null;
  const previewUrl =
    urlPrefix === undefined
      ? null
      : url
        ? t`URL (preview): ${url}`
        : t`The client URL is shown on the repository page once the distribution exists.`;

  const [remotes, setRemotes] = useState(null);
  const [remotesError, setRemotesError] = useState(null);
  const loadRemotes = (name?) => {
    setRemotesError(null);
    const { RemoteAPI } = plugin2api(plugin);
    RemoteAPI.list(name ? { name__icontains: name } : {})
      .then(({ data }) =>
        setRemotes(data.results.map((r) => ({ ...r, id: r.pulp_href }))),
      )
      .catch((e) => {
        const { status, statusText } = e.response;
        setRemotes([]);
        setRemotesError(errorMessage(status, statusText));
      });
  };

  useEffect(() => loadRemotes(), []);

  const selectedRemote = remotes?.find?.(
    ({ pulp_href }) => pulp_href === repository?.remote,
  );

  return (
    <Form>
      {stringField('name', t`Name`)}
      {stringField('description', t`Description`)}
      {numericField(
        'retain_repo_versions',
        t`Retained number of versions`,
        t`In order to retain all versions, leave this field blank.`,
      )}

      {formGroup(
        'distributions',
        t`Distributions`,
        t`Content in repositories without a distribution will not be visible to clients for sync, download or search.`,
        isNew ? (
          <>
            <Checkbox
              isChecked={createDistribution}
              onChange={(_event, value) => setCreateDistribution(value)}
              label={t`Create a distribution for this repository`}
              id='create_distribution'
            />
            {createDistribution ? (
              <FormGroup
                fieldId='base_path'
                label={t`Base path`}
                isRequired
                style={{ marginTop: 'var(--pf-v5-global--spacer--md)' }}
              >
                <TextInput
                  id='base_path'
                  isRequired
                  type='text'
                  validated={basePathError ? 'error' : 'default'}
                  value={basePath}
                  onChange={(_event, value) => setTypedBasePath(value)}
                />
                <FormFieldHelper variant={basePathError ? 'error' : 'default'}>
                  {basePathError || previewUrl}
                </FormFieldHelper>
                {basePathError && previewUrl ? (
                  <FormFieldHelper>{previewUrl}</FormFieldHelper>
                ) : null}
                <FormFieldHelper variant='warning'>
                  {t`The distribution will have no content guard: anyone who can reach this server can download this repository's content without signing in.`}
                </FormFieldHelper>
              </FormGroup>
            ) : null}
          </>
        ) : (
          <LazyDistributions
            plugin={plugin}
            emptyText={t`None`}
            repositoryHref={repository.pulp_href}
          />
        ),
      )}

      {formGroup(
        'pulp_labels',
        t`Labels`,
        t`Pulp labels in the form of 'key:value'.`,
        <>
          <div
            // prevents "N more" clicks from submitting the form
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <PulpLabels
              labels={repository.pulp_labels}
              updateLabels={(labels) =>
                updateRepository({ ...repository, pulp_labels: labels })
              }
            />
          </div>
        </>,
      )}

      {formGroup(
        'private',
        t`Make private`,
        t`Make the repository private.`,
        <Checkbox
          id='private'
          isChecked={repository.private}
          label={t`Make private`}
          onChange={(_event, value) =>
            updateRepository({ ...repository, private: value })
          }
        />,
      )}

      {formGroup(
        'remote',
        t`Remote`,
        t`Setting a remote allows a repository to sync from elsewhere.`,
        <>
          <div data-cy='remote'>
            {remotes ? (
              <Typeahead
                loadResults={loadRemotes}
                onClear={() =>
                  updateRepository({ ...repository, remote: null })
                }
                onSelect={(_event, value) =>
                  updateRepository({
                    ...repository,
                    remote: remotes.find(({ name }) => name === value)
                      ?.pulp_href,
                  })
                }
                placeholderText={t`Select a remote`}
                results={remotes}
                selections={
                  selectedRemote
                    ? [
                        {
                          name: selectedRemote.name,
                          id: selectedRemote.pulp_href,
                        },
                      ]
                    : []
                }
              />
            ) : null}
            {remotesError ? (
              <span
                style={{
                  color: 'var(--pf-v5-global--danger-color--200)',
                }}
              >
                {t`Failed to load remotes: ${remotesError}`}
              </span>
            ) : null}
            {!remotes && !remotesError ? <Spinner size='sm' /> : null}
          </div>
        </>,
      )}

      {errorMessages['__nofield'] ? (
        <span
          style={{
            color: 'var(--pf-v5-global--danger-color--200)',
          }}
        >
          {errorMessages['__nofield']}
        </span>
      ) : null}

      <ActionGroup key='actions'>
        <Button
          isDisabled={!isValid || blocked || saving}
          key='confirm'
          variant='primary'
          onClick={save}
        >
          {t`Save`}
        </Button>
        <Button key='cancel' variant='link' onClick={onCancel}>
          {t`Cancel`}
        </Button>
      </ActionGroup>
    </Form>
  );
};

// The URL every distribution of the plugin is served under, up to where the
// base path starts, or null when it cannot be derived. File, deb and rpm
// distributions are served from the content app's origin and path prefix; an
// ansible distribution reports its own client URL, so the prefix is that URL
// without the distribution's base path.
async function loadUrlPrefix(plugin: string): Promise<string | null> {
  try {
    if (plugin === 'ansible') {
      const {
        data: { results },
      } = await AnsibleDistributionAPI.list({ page_size: 1 });
      const { client_url, base_path } = results[0] || {};
      const trimmed = client_url?.replace(/\/+$/, '');
      return trimmed?.endsWith(base_path)
        ? trimmed.slice(0, trimmed.length - base_path.length)
        : null;
    }

    const {
      data: { content_settings },
    } = await PulpStatusAPI.get();
    const origin = (
      content_settings.content_origin || window.location.origin
    ).replace(/\/+$/, '');
    const prefix = content_settings.content_path_prefix.replace(
      /^\/+|\/+$/g,
      '',
    );
    return `${origin}/${prefix ? `${prefix}/` : ''}`;
  } catch {
    return null;
  }
}
