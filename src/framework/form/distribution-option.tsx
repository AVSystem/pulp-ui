import { t } from '@lingui/core/macro';
import { Checkbox, FormGroup, TextInput } from '@patternfly/react-core';
import { FormFieldHelper, HelpButton } from 'src/components';
import { type Status } from 'src/entities/core/status/model';
import { useStatus } from 'src/entities/core/status/queries';
import { config } from 'src/ui-config';
import {
  basePathProblem,
  reservedPrefixFor,
  sanitizeBasePath,
} from 'src/utilities/base-path-rules';
import {
  type Protection,
  ProtectionChoice,
} from '../distributions/protection-choice';
import type { DistributionRequest } from './create-flow';

// The part of the create form that offers a distribution beside the new
// repository. It is never on by itself: nothing is served unless the user ticks
// the box, and a ticked box still asks how the distribution is protected, with
// neither answer chosen, so a distribution is public only when someone chose
// Public.

// What the user has done with the option. The base path follows the
// repository's name until the user types one.
export interface DistributionDraft {
  ticked: boolean;
  // undefined until the user edits the field
  typedBasePath?: string;
  // How the distribution is protected; null or absent until the user decides
  protection?: Protection;
}

export const NO_DISTRIBUTION: DistributionDraft = { ticked: false };

// The deployment's list of reserved base path prefixes, or null when it is not
// known. It is known only when the configuration holds an array (an empty one
// reserves nothing); the form does not guess, so without it no distribution is
// offered. The server stays the authority on what is allowed.
export function reservedPrefixes(): string[] | null {
  const prefixes = (config as { RESERVED_BASE_PATH_PREFIXES?: unknown } | null)
    ?.RESERVED_BASE_PATH_PREFIXES;

  return Array.isArray(prefixes) ? (prefixes as string[]) : null;
}

// What the draft comes to for a repository of this name: the base path, why it
// cannot be used (a rule of the path or a reserved prefix), and the request the
// create sends, which is null while the box is not ticked or the protection is
// not chosen.
export interface ResolvedDistribution {
  basePath: string;
  problem: ReturnType<typeof basePathProblem>;
  reserved: string | null;
  // true while the ticked distribution has no protection chosen
  undecided: boolean;
  // true while the ticked distribution cannot be created as typed or chosen
  blocked: boolean;
  request: DistributionRequest | null;
}

export function resolveDistribution(
  name: string,
  draft: DistributionDraft,
  prefixes: readonly string[] | null,
  offered: boolean,
): ResolvedDistribution {
  const basePath = draft.typedBasePath ?? sanitizeBasePath(name);
  const ticked = offered && draft.ticked;
  const problem = ticked ? basePathProblem(basePath) : null;
  const reserved = ticked
    ? reservedPrefixFor(basePath, prefixes as string[] | null)
    : null;
  const protection = draft.protection ?? null;
  const undecided = ticked && protection === null;

  return {
    basePath,
    problem,
    reserved,
    undecided,
    blocked: problem !== null || reserved !== null || undecided,
    request: ticked && protection !== null ? { basePath, protection } : null,
  };
}

// The address every distribution of the plugin is served under, up to where the
// base path starts, or null when the server's answer does not say. A reduced
// answer carries no content settings.
export function contentUrlPrefix(status: Status | undefined): string | null {
  const settings = status?.content_settings;
  if (!settings) {
    return null;
  }
  const origin = (settings.content_origin || window.location.origin).replace(
    /\/+$/,
    '',
  );
  const prefix = (settings.content_path_prefix ?? '').replace(/^\/+|\/+$/g, '');

  return `${origin}/${prefix ? `${prefix}/` : ''}`;
}

// The reason a base path cannot be used, in words, or null when it can.
export function basePathMessage({
  problem,
  reserved,
}: Pick<ResolvedDistribution, 'problem' | 'reserved'>): string | null {
  switch (problem) {
    case 'empty':
      return t`Enter a base path.`;
    case 'slash':
      return t`A base path cannot start or end with a slash or contain two slashes in a row.`;
    case 'characters':
      return t`A base path cannot contain spaces, "?" or "#".`;
    case 'dots':
      return t`A base path cannot contain a "." or ".." segment.`;
    default:
      return reserved
        ? t`Base paths starting with "${reserved}" are reserved on this server. Choose another base path.`
        : null;
  }
}

interface Props {
  // The name typed for the repository: it names the distribution and is where
  // the base path starts from.
  name: string;
  draft: DistributionDraft;
  resolved: ResolvedDistribution;
  // The reserved prefixes are not known: the option is off.
  prefixesUnknown: boolean;
  // The message of the server or of the check for the base path, shown when the
  // path itself breaks no rule.
  error?: string;
  onChange: (draft: DistributionDraft) => void;
}

// The line under the base path: where the distribution will be served, as far
// as the server says it.
export const BasePathHelp = ({
  basePath,
  message,
}: {
  basePath: string;
  message: string | null;
}) => {
  const status = useStatus();
  const prefix = contentUrlPrefix(status.data);
  const url = prefix ? `${prefix}${basePath}/` : null;
  const preview = status.isPending
    ? null
    : url
      ? t`URL (preview): ${url}`
      : t`The client URL is shown on the repository page once the distribution exists.`;

  return (
    <>
      <FormFieldHelper variant={message ? 'error' : 'default'}>
        {message || preview}
      </FormFieldHelper>
      {message && preview ? <FormFieldHelper>{preview}</FormFieldHelper> : null}
    </>
  );
};

// The box that asks for a distribution, and once it is ticked the base path
// with the reason it is refused, a preview of the address and the choice of
// protection. The server's address settings are read only once the box is
// ticked.
export const DistributionOption = ({
  name,
  draft,
  resolved,
  prefixesUnknown,
  error,
  onChange,
}: Props) => {
  const message = basePathMessage(resolved) || error || null;

  return (
    <FormGroup
      fieldId='distributions'
      label={
        <>
          {t`Distributions`}{' '}
          <HelpButton
            content={t`Content in repositories without a distribution will not be visible to clients for sync, download or search.`}
          />
        </>
      }
    >
      <Checkbox
        id='create_distribution'
        isChecked={draft.ticked}
        isDisabled={prefixesUnknown}
        onChange={(_event, ticked) => onChange({ ...draft, ticked })}
        label={
          name
            ? t`Create a distribution "${name}" for this repository`
            : t`Create a distribution for this repository`
        }
      />
      {prefixesUnknown ? (
        <FormFieldHelper variant='warning'>
          {t`The reserved base paths of this server could not be read, so a distribution cannot be created here.`}
        </FormFieldHelper>
      ) : null}
      {draft.ticked ? (
        <FormGroup
          fieldId='base_path'
          label={t`Base path`}
          isRequired
          style={{ marginTop: 'var(--pf-t--global--spacer--md)' }}
        >
          <TextInput
            id='base_path'
            isRequired
            type='text'
            validated={message ? 'error' : 'default'}
            value={resolved.basePath}
            onChange={(_event, typedBasePath) =>
              onChange({ ...draft, typedBasePath })
            }
          />
          <BasePathHelp basePath={resolved.basePath} message={message} />
        </FormGroup>
      ) : null}
      {draft.ticked ? (
        <div style={{ marginTop: 'var(--pf-t--global--spacer--md)' }}>
          <ProtectionChoice
            value={draft.protection ?? null}
            onChange={(protection) => onChange({ ...draft, protection })}
          />
        </div>
      ) : null}
    </FormGroup>
  );
};
