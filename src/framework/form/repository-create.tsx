import { t } from '@lingui/core/macro';
import { ActionGroup, Button } from '@patternfly/react-core';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAppContext } from 'src/app-context';
import { BaseHeader, Breadcrumbs, Main, Spinner } from 'src/components';
import { entityKeys } from 'src/entities/plugin/queries';
import type { PluginDescriptor } from '../descriptor';
import type { FrameworkPlugin } from '../manifest';
import { PLUGIN_MANIFESTS, type PluginManifest } from '../manifest';
import { repositoryListPath, repositoryPath } from '../route-patterns';
import { createAlerts, createRepositoryWithDistribution } from './create-flow';
import { DescriptorForm } from './descriptor-form';
import {
  type DistributionDraft,
  DistributionOption,
  NO_DISTRIBUTION,
  reservedPrefixes,
  resolveDistribution,
} from './distribution-option';
import {
  type FormValues,
  hasProblems,
  toCreateBody,
  toForm,
} from './form-values';
import { CreatePermissionGate } from './permission-gate';
import { NAME_FIELD, repositoryFields } from './repository-fields';
import { type SaveFailure, saveFailure } from './save-errors';

interface Props {
  plugin: FrameworkPlugin;
  descriptor: PluginDescriptor;
}

// The form that makes a new repository, drawn from the plugin's descriptor: the
// fields every repository has and the ones the plugin adds, starting from the
// descriptor's create defaults, and an option to create a distribution with it.
// Only the permission to add a repository opens the form, and only the
// permission to add a distribution offers the option; Pulp decides every
// request.
export const RepositoryCreate = ({ plugin, descriptor }: Props) => {
  const { entity } = descriptor.repository;
  const distributionEntity = descriptor.distribution?.entity;
  const fields = useMemo(() => repositoryFields(descriptor), [descriptor]);
  const shownNames = useMemo(() => fields.map(({ name }) => name), [fields]);
  // The screen owns what is typed, so it survives the form being hidden while
  // the permissions are read again.
  const [values, setValues] = useState<FormValues>(() => ({
    ...toForm(fields, {}),
    ...descriptor.repository.createDefaults,
  }));
  const [draft, setDraft] = useState<DistributionDraft>(NO_DISTRIBUTION);
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  const [saving, setSaving] = useState(false);
  // A second press can arrive before the disabled button has rendered.
  const sending = useRef(false);
  // Ends the wait for the distribution's task when the screen is left.
  const left = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    left.current = controller;
    return () => controller.abort();
  }, []);

  const { hasPermission, queueAlert } = useAppContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const manifest = PLUGIN_MANIFESTS.find(
    (candidate) => candidate.plugin === plugin,
  ) as PluginManifest;

  const name = String(values[NAME_FIELD] ?? '');
  // The option is offered only to a user who may add a distribution of the
  // plugin and only for a plugin that has distributions.
  const offered =
    distributionEntity !== undefined &&
    hasPermission(manifest.permissions.repository.addDistribution);
  const prefixes = reservedPrefixes();
  const resolved = resolveDistribution(name, draft, prefixes, offered);

  const clearFailure = (field: string) =>
    setFailure((current) => {
      if (!current || !(field in current.fields)) {
        return current;
      }
      return {
        ...current,
        fields: Object.fromEntries(
          Object.entries(current.fields).filter(([key]) => key !== field),
        ),
      };
    });

  const change = (field: string, value: unknown) => {
    setValues((current) => ({ ...current, [field]: value }));
    clearFailure(field);
  };

  const save = async () => {
    if (sending.current) {
      return;
    }
    sending.current = true;
    setSaving(true);
    setFailure(null);
    const signal = left.current?.signal;
    try {
      const outcome = await createRepositoryWithDistribution({
        repository: entity,
        distributions: distributionEntity,
        body: { ...toCreateBody(fields, values), name },
        distribution: resolved.request,
        signal,
      });

      if (outcome.kind === 'blocked') {
        setFailure({ fields: outcome.fields, general: outcome.general });
        return;
      }

      for (const alert of createAlerts(
        name,
        resolved.request,
        outcome.distribution,
      )) {
        queueAlert(alert);
      }
      // A screen that was left while the distribution's task ran reports it
      // and stays where the user went.
      if (!signal?.aborted) {
        navigate(repositoryPath(plugin, name));
      }
    } catch (error) {
      setFailure(saveFailure(error, shownNames));
    } finally {
      sending.current = false;
      setSaving(false);
      // The server may have changed something whatever the answer was.
      void queryClient.invalidateQueries({ queryKey: entityKeys(entity).all });
      if (distributionEntity) {
        void queryClient.invalidateQueries({
          queryKey: entityKeys(distributionEntity).all,
        });
      }
    }
  };

  const listPath = repositoryListPath(plugin);

  return (
    <CreatePermissionGate
      plugin={plugin}
      permission={(permissions) => permissions.repository.add}
      title={t`Add new repository`}
    >
      <BaseHeader
        title={t`Add new repository`}
        breadcrumbs={
          <Breadcrumbs
            links={[{ url: listPath, name: t`Repositories` }, { name: t`Add` }]}
          />
        }
      />
      <Main>
        <section className='pulp-section' data-cy='RepositoryCreate'>
          <DescriptorForm
            fields={fields}
            values={values}
            errors={failure?.fields ?? {}}
            remotes={descriptor.remote?.entity}
            failure={failure?.general}
            failureTitle={t`Repository could not be created`}
            onChange={change}
            onSubmit={save}
            extra={
              offered ? (
                <DistributionOption
                  name={name}
                  draft={draft}
                  resolved={resolved}
                  prefixesUnknown={prefixes === null}
                  error={failure?.fields['base_path']}
                  onChange={(next) => {
                    setDraft(next);
                    clearFailure('base_path');
                  }}
                />
              ) : null
            }
          >
            <ActionGroup>
              <Button
                variant='primary'
                isDisabled={
                  saving ||
                  name === '' ||
                  resolved.blocked ||
                  hasProblems(fields, values)
                }
                onClick={save}
              >
                {t`Save`}
                {saving && <Spinner size='sm' />}
              </Button>
              <Button variant='link' onClick={() => navigate(listPath)}>
                {t`Cancel`}
              </Button>
            </ActionGroup>
          </DescriptorForm>
        </section>
      </Main>
    </CreatePermissionGate>
  );
};
