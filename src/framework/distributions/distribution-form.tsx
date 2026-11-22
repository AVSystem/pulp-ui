import { msg, t } from '@lingui/core/macro';
import {
  ActionGroup,
  Button,
  Content,
  Form,
  FormGroup,
  TextInput,
} from '@patternfly/react-core';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useAppContext } from 'src/app-context';
import {
  Alert,
  BaseHeader,
  Breadcrumbs,
  FormFieldHelper,
  Main,
  Spinner,
} from 'src/components';
import { useRepositoryByName } from 'src/entities/core/repository/queries';
import type { DistributionCreate as DistributionCreateBody } from 'src/entities/plugin/distribution';
import {
  basePathProblem,
  reservedPrefixFor,
} from 'src/utilities/base-path-rules';
import { isSessionEnd } from 'src/utilities/request-error';
import { taskAlert } from 'src/utilities/task-alert';
import { type FieldDef, type PluginDescriptor } from '../descriptor';
import { protectionDescription } from '../form/create-flow';
import {
  BasePathHelp,
  basePathMessage,
  reservedPrefixes,
} from '../form/distribution-option';
import {
  type FormValues,
  hasProblems,
  toCreateBody,
} from '../form/form-values';
import { LabelsField } from '../form/labels-field';
import { CreatePermissionGate } from '../form/permission-gate';
import { type SaveFailure, saveFailure } from '../form/save-errors';
import type { FrameworkPlugin } from '../manifest';
import {
  distributionListPath,
  distributionPath,
  repositoryPath,
} from '../route-patterns';
import { createDistribution } from './create-distribution';
import {
  BasePathGroup,
  NameGroup,
  SHOWN_FIELDS,
  ServerManagedGuard,
  withoutMessagesOf,
} from './distribution-fields';
import { pluginLabel } from './plugin-label';
import {
  type Protection,
  ProtectionChoice,
  contentGuardOf,
} from './protection-choice';
import {
  NO_SERVES,
  type ServesChoice,
  ServesField,
  servesBinding,
  servesComplete,
} from './serves-field';

// The labels of a new distribution as the form draws and sends them, through
// the same field definition every other form uses.
const LABELS_FIELD: FieldDef = {
  name: 'pulp_labels',
  label: msg`Labels`,
  kind: 'labels',
};

interface Props {
  plugin: FrameworkPlugin;
  descriptor: PluginDescriptor;
}

// The form that makes a new distribution of one plugin: its name, the base path
// it is served under, what it serves (a repository of the plugin, or one of the
// repository's publications), how it is protected and its labels. A plugin that
// manages the guard itself is not asked for one. Opened from a repository, the
// repository is chosen already and cannot be changed. Only the permission to
// add a distribution opens the form; Pulp decides every request.
export const DistributionCreate = ({ plugin, descriptor }: Props) => {
  const kind = descriptor.distribution;
  if (!kind) {
    throw new Error(
      `The ${plugin} descriptor declares no distributions, which their create form needs`,
    );
  }
  const managed = kind.guardManagedByServer === true;
  const typeName = pluginLabel(plugin);
  const [searchParams] = useSearchParams();
  const fixedName = searchParams.get('repository');
  const fixed = useRepositoryByName(plugin, fixedName);

  const [name, setName] = useState('');
  const [basePath, setBasePath] = useState('');
  const [chosen, setChosen] = useState<ServesChoice>(NO_SERVES);
  const [protection, setProtection] = useState<Protection>(null);
  const [labels, setLabels] = useState<FormValues>({ pulp_labels: [] });
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  const [saving, setSaving] = useState(false);
  // A second press can arrive before the disabled button has rendered.
  const sending = useRef(false);
  // Ends the wait for the task when the screen is left.
  const left = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    left.current = controller;
    return () => controller.abort();
  }, []);

  const { queueAlert } = useAppContext();
  const navigate = useNavigate();

  // The repository the form was opened from, once it is read, is what is served.
  const lockedRepository = fixed.data
    ? { href: fixed.data.pulp_href, name: fixed.data.name }
    : null;
  const serves: ServesChoice =
    fixedName === null ? chosen : { ...chosen, repository: lockedRepository };

  const trimmedName = name.trim();
  const prefixes = reservedPrefixes();
  const problem = basePathProblem(basePath);
  const reserved = reservedPrefixFor(basePath, prefixes);
  const message =
    basePath === '' ? null : basePathMessage({ problem, reserved });
  const complete =
    trimmedName !== '' &&
    basePath !== '' &&
    problem === null &&
    reserved === null &&
    prefixes !== null &&
    servesComplete(serves) &&
    (managed || protection !== null) &&
    !hasProblems([LABELS_FIELD], labels);

  const clearFailure = (...fields: string[]) =>
    setFailure((current) => withoutMessagesOf(current, fields));

  const save = async () => {
    if (sending.current || !complete) {
      return;
    }
    sending.current = true;
    setSaving(true);
    setFailure(null);
    const signal = left.current?.signal;
    try {
      const body: DistributionCreateBody = {
        name: trimmedName,
        base_path: basePath,
        // Null is sent for the explicit Public choice and for nothing else; a
        // plugin that manages the guard is sent none at all.
        ...(managed
          ? {}
          : {
              content_guard: contentGuardOf(
                protection as NonNullable<Protection>,
              ),
            }),
        ...(servesBinding(serves) as NonNullable<
          ReturnType<typeof servesBinding>
        >),
        ...(toCreateBody([LABELS_FIELD], labels) as Pick<
          DistributionCreateBody,
          'pulp_labels'
        >),
      };
      const outcome = await createDistribution({
        entity: kind.entity,
        body,
        signal,
      });

      if (outcome.kind === 'blocked') {
        setFailure({ fields: outcome.fields, general: outcome.general });
        return;
      }
      const end = outcome.distribution;
      const title = t`Created distribution "${trimmedName}"`;

      switch (end.state) {
        case 'created': {
          // What the server protected the distribution with, from the
          // distribution itself.
          const description =
            managed && !end.guardSet
              ? undefined
              : protectionDescription(
                  protection === null ? 'public' : protection,
                  end.guardSet,
                );
          queueAlert({
            variant: managed || !description ? 'success' : description.variant,
            title,
            ...(description ? { description: description.text } : {}),
          });
          if (!signal?.aborted) {
            navigate(distributionPath(plugin, trimmedName));
          }
          break;
        }
        case 'failed':
          setFailure({ fields: {}, general: end.reason });
          break;
        case 'unknown':
          queueAlert(
            taskAlert(
              end.task,
              t`The outcome of creating the distribution "${trimmedName}" is unknown, because the task status could not be read. Check the task.`,
              'warning',
            ),
          );
          navigate(distributionListPath());
          break;
        case 'pending':
          queueAlert(
            taskAlert(
              end.task,
              t`The distribution "${trimmedName}" is still being created and is not served yet.`,
              'warning',
            ),
          );
          break;
        default:
          // The session ended: the sign-in dialog explains it and the form
          // keeps what was typed.
          break;
      }
    } catch (error) {
      if (!isSessionEnd(error)) {
        setFailure(saveFailure(error, SHOWN_FIELDS));
      }
    } finally {
      sending.current = false;
      setSaving(false);
    }
  };

  const backPath =
    fixedName === null
      ? distributionListPath()
      : repositoryPath(plugin, fixedName, 'distributions');
  const title = t`Create distribution`;

  return (
    <CreatePermissionGate
      plugin={plugin}
      permission={(permissions) => permissions.distribution.add}
      title={title}
    >
      <BaseHeader
        title={title}
        subTitle={
          <Content component='p'>{t`${typeName} distribution`}</Content>
        }
        breadcrumbs={
          <Breadcrumbs
            links={[
              fixedName === null
                ? { url: distributionListPath(), name: t`Distributions` }
                : { url: backPath, name: fixedName },
              { name: t`Create` },
            ]}
          />
        }
      />
      <Main>
        <section className='pulp-section' data-cy='DistributionCreate'>
          <Form onSubmit={(event) => event.preventDefault()}>
            <NameGroup
              value={name}
              error={failure?.fields['name']}
              onChange={(next) => {
                setName(next);
                clearFailure('name');
              }}
            />
            <BasePathGroup
              value={basePath}
              message={message}
              error={failure?.fields['base_path']}
              onChange={(next) => {
                setBasePath(next);
                clearFailure('base_path');
              }}
            />
            {prefixes === null ? (
              <FormFieldHelper variant='warning'>
                {t`The reserved base paths of this server could not be read, so a distribution cannot be created here.`}
              </FormFieldHelper>
            ) : null}
            <ServesField
              plugin={plugin}
              descriptor={descriptor}
              value={serves}
              onChange={(next) => {
                setChosen(next);
                clearFailure('repository', 'publication');
              }}
              locked={
                fixedName === null
                  ? undefined
                  : {
                      name: fixedName,
                      found: fixed.isPending ? null : lockedRepository !== null,
                    }
              }
              error={
                failure?.fields['repository'] ?? failure?.fields['publication']
              }
            />
            {managed ? (
              <ServerManagedGuard created />
            ) : (
              <ProtectionChoice value={protection} onChange={setProtection} />
            )}
            <FormGroup label={t`Labels`} fieldId='pulp_labels'>
              <LabelsField
                id='pulp_labels'
                rows={(labels['pulp_labels'] as never) ?? []}
                isDisabled={false}
                onChange={(rows) => setLabels({ pulp_labels: rows })}
              />
            </FormGroup>
            {failure?.general ? (
              <Alert
                variant='danger'
                isInline
                isLiveRegion
                title={t`Distribution could not be created`}
                className='pulp-break-anywhere'
              >
                {failure.general}
              </Alert>
            ) : null}
            <ActionGroup>
              <Button
                variant='primary'
                isDisabled={saving || !complete}
                onClick={save}
              >
                {t`Create`}
                {saving && <Spinner size='sm' />}
              </Button>
              <Button variant='link' onClick={() => navigate(backPath)}>
                {t`Cancel`}
              </Button>
            </ActionGroup>
          </Form>
        </section>
      </Main>
    </CreatePermissionGate>
  );
};

export { DistributionEdit } from './distribution-edit';
