import { i18n } from '@lingui/core';
import { msg, t } from '@lingui/core/macro';
import { Title } from '@patternfly/react-core';
import { Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { useMemo, useState } from 'react';
import { Table } from 'src/components';
import type { RepositoryVersion } from 'src/entities/plugin/model';
import type { ContentTypeDef, PluginDescriptor } from '../descriptor';
import {
  ContentList,
  type ContentListConfig,
  type VersionSection,
} from './content-tab';

const SECTIONS: readonly VersionSection[] = ['present', 'added', 'removed'];

// A kind of content a version's summary names, with what to list it with.
// `declared` is the plugin's own declaration of the type; a type the summary
// names that no descriptor declares has none.
interface SummaryType {
  pulpType: string;
  declared: ContentTypeDef | undefined;
}

// How many units of a type a version holds, added or removed, as its summary
// counts them; a type the summary does not name for that part is zero.
function countOf(
  version: RepositoryVersion,
  section: VersionSection,
  pulpType: string,
): number {
  const entry = version.content_summary?.[section]?.[pulpType];

  return entry?.count ?? 0;
}

// The types a version's summary names, those the plugin declares first in the
// order it declares them and the others after them by name.
function typesOf(
  version: RepositoryVersion,
  declared: readonly ContentTypeDef[],
): SummaryType[] {
  const named = new Set(
    SECTIONS.flatMap((section) =>
      Object.keys(version.content_summary?.[section] ?? {}),
    ),
  );
  const known = declared
    .filter(({ pulpType }) => named.has(pulpType))
    .map((type) => ({ pulpType: type.pulpType, declared: type }));
  const others = Array.from(named)
    .filter((pulpType) => !declared.some((type) => type.pulpType === pulpType))
    .sort()
    .map((pulpType) => ({ pulpType, declared: undefined }));

  return [...known, ...others];
}

const labelOf = ({ pulpType, declared }: SummaryType): string =>
  declared ? i18n._(declared.label) : pulpType;

// The titles of the three parts of a version's content, and the line said when
// a part has nothing to list.
const SECTION_TITLE: Record<VersionSection, () => string> = {
  present: () => t`Content in this version`,
  added: () => t`Added since the earlier version`,
  removed: () => t`Removed since the earlier version`,
};

const SECTION_EMPTY: Record<VersionSection, () => string> = {
  present: () => t`This version holds none.`,
  added: () => t`Nothing was added.`,
  removed: () => t`Nothing was removed.`,
};

// The name of a list's table for assistive technology: the type and the part.
const tableLabel = (type: string, section: VersionSection): string => {
  switch (section) {
    case 'added':
      return t`${type} added`;
    case 'removed':
      return t`${type} removed`;
    default:
      return t`${type} present`;
  }
};

// What a content type declares, as a list of one repository version needs it.
function listConfig(type: ContentTypeDef): ContentListConfig<{
  pulp_href: string;
}> {
  return {
    entity: type.entity,
    fields: type.fields,
    columns: type.columns,
    filters: type.filters ?? [],
    title: type.label,
    errorTitle: msg`Content could not be displayed.`,
    emptyTitle: msg`No content`,
    emptyDescription: msg`There is no content of this kind to show.`,
    defaultPageSize: 20,
    defaultSort: type.defaultSort,
  };
}

interface SectionListProps {
  summaryType: SummaryType;
  section: VersionSection;
  version: string;
}

// One part of one kind of content as a server-paged list. Its page, order and
// filters are its own, so paging one list leaves the others where they are.
const SectionList = ({ summaryType, section, version }: SectionListProps) => {
  const [search, setSearch] = useState('');
  const { declared } = summaryType;
  const config = useMemo(
    () => (declared ? listConfig(declared) : null),
    [declared],
  );

  if (!config) {
    return null;
  }

  return (
    <ContentList
      config={config}
      version={version}
      section={section}
      label={tableLabel(labelOf(summaryType), section)}
      address={{ search, onChange: setSearch }}
    />
  );
};

interface Props {
  descriptor: PluginDescriptor;
  version: RepositoryVersion;
}

// What one repository version holds and what it changed against the version
// before it: a count per kind of content for each of the three, then for each
// kind of content a server-paged list of what the version holds, what it added
// and what it removed. A part with nothing in it says so and asks the server
// for nothing. Version 0 has no version before it, so it has no change to
// show.
export const VersionContent = ({ descriptor, version }: Props) => {
  const types = typesOf(version, descriptor.contentTypes ?? []);
  const hasEarlier = version.number > 0;

  if (types.length === 0) {
    return (
      <div data-cy='VersionContent'>
        <Title headingLevel='h2' size='lg'>
          {t`Content`}
        </Title>
        <p>{t`This version holds no content.`}</p>
      </div>
    );
  }

  return (
    <div data-cy='VersionContent'>
      <Title headingLevel='h2' size='lg'>
        {t`Content`}
      </Title>
      <Table aria-label={t`Content summary`} variant='compact'>
        <Thead>
          <Tr>
            <Th>{t`Content type`}</Th>
            <Th>{t`Present`}</Th>
            {hasEarlier ? <Th>{t`Added`}</Th> : null}
            {hasEarlier ? <Th>{t`Removed`}</Th> : null}
          </Tr>
        </Thead>
        <Tbody>
          {types.map((type) => (
            <Tr key={type.pulpType}>
              <Td>{labelOf(type)}</Td>
              <Td>{countOf(version, 'present', type.pulpType)}</Td>
              {hasEarlier ? (
                <Td>{countOf(version, 'added', type.pulpType)}</Td>
              ) : null}
              {hasEarlier ? (
                <Td>{countOf(version, 'removed', type.pulpType)}</Td>
              ) : null}
            </Tr>
          ))}
        </Tbody>
      </Table>
      {types.map((type) => (
        <section key={type.pulpType} aria-label={labelOf(type)}>
          <Title headingLevel='h3' size='md'>
            {labelOf(type)}
          </Title>
          {SECTIONS.map((section) => {
            const empty =
              section !== 'present' && !hasEarlier
                ? t`No earlier version`
                : countOf(version, section, type.pulpType) === 0
                  ? SECTION_EMPTY[section]()
                  : null;

            return (
              <div key={section}>
                <Title headingLevel='h4' size='md'>
                  {SECTION_TITLE[section]()}
                </Title>
                {empty !== null ? (
                  <p>{empty}</p>
                ) : (
                  <SectionList
                    summaryType={type}
                    section={section}
                    version={version.pulp_href}
                  />
                )}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
};
