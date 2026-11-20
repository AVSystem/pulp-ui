import type { MessageDescriptor } from '@lingui/core';
import type { ReactNode } from 'react';
import type {
  DistributionBase,
  DistributionEntity,
} from 'src/entities/plugin/distribution';
import type { RemoteBase, RepositoryBase } from 'src/entities/plugin/model';
import type { RemoteEntity } from 'src/entities/plugin/remote';
import type { RepositoryEntity } from 'src/entities/plugin/repository';
import type { RepositoryTab } from './route-patterns';

// What a plugin declares about its repositories and remotes, in the plugin's
// own chunk. The generic screens read everything they show and everything they
// send from here. Every member a plugin may lack is optional, so a plugin that
// has no publication endpoint, no sync or no distribution snippet states only
// what it has, and a plugin adds tabs and content types of its own without the
// generic code naming it.
//
// Labels are lingui message descriptors (`msg`), translated where they are
// drawn and never where they are declared: a module-level translation would
// stay in the language of the first load.

// The entities are typed by what a screen reads from them; the types of what a
// create or update sends belong to the plugin's own wiring.
type AnyRepositoryEntity<Row> = RepositoryEntity<
  Row,
  never,
  never,
  never,
  never
>;
type AnyRemoteEntity<Row> = RemoteEntity<Row, never, never>;
type AnyDistributionEntity<Row extends DistributionBase> = DistributionEntity<
  Row,
  never
>;

export type FieldKind =
  'text' | 'textarea' | 'integer' | 'boolean' | 'select' | 'url' | 'secret';

// One input of a create or edit form.
export interface FieldDef {
  // The name of the field in the request body.
  name: string;
  label: MessageDescriptor;
  kind: FieldKind;
  required?: boolean;
  help?: MessageDescriptor;
  // The choices of a select.
  options?: { value: string; label: MessageDescriptor }[];
}

// One labelled row of a Details tab.
export interface DetailRow<Row> {
  // Unique among the rows of one screen.
  id: string;
  label: MessageDescriptor;
  // Called while the screen renders, so it may translate with the message
  // macro.
  render: (row: Row) => ReactNode;
}

// One column of a list.
export interface ColumnDef<Row> {
  id: string;
  label: MessageDescriptor;
  render: (row: Row) => ReactNode;
  // The field the server orders by. A column the server cannot order by (a
  // value derived from other reads) declares none and never sorts.
  sortField?: string;
}

// One filter of a list.
export interface FilterDef {
  id: string;
  label: MessageDescriptor;
  // The query parameter the filter sets.
  param: string;
  kind: 'text' | 'select';
  options?: { value: string; label: MessageDescriptor }[];
}

// One tab of a repository's detail beside the ones every plugin has.
export interface TabDef<Row> {
  // The sub-path of the tab's address. Unique among the tabs of a plugin; a
  // plugin that needs another sub-path adds it to the route patterns first.
  id: RepositoryTab;
  label: MessageDescriptor;
  // The version number of a tab that opens one version (an address like
  // .../versions/3), null on the tab's own address.
  render: (props: { repository: Row; version: number | null }) => ReactNode;
}

// How a repository is synced. A plugin without a sync endpoint declares none.
export interface SyncDef {
  // The name of the task that does the work, to find a running one.
  taskName: string;
  // Options the sync dialog offers beyond the remote.
  options?: FieldDef[];
}

// The command a distribution's address is turned into for the plugin's own
// client (for example a pip install line).
export interface SnippetDef {
  label: MessageDescriptor;
  build: (input: { name: string; url: string }) => string;
}

// A kind of content a repository of the plugin holds.
export interface ContentTypeDef {
  id: string;
  label: MessageDescriptor;
}

export interface RepositoryKind<Row> {
  entity: AnyRepositoryEntity<Row>;
  // The rows of the Details tab, in order.
  detailRows: DetailRow<Row>[];
  fields?: FieldDef[];
  columns?: ColumnDef<Row>[];
  filters?: FilterDef[];
  tabs?: TabDef<Row>[];
  sync?: SyncDef;
  snippet?: SnippetDef;
}

export interface RemoteKind<Row> {
  entity: AnyRemoteEntity<Row>;
  detailRows?: DetailRow<Row>[];
  fields?: FieldDef[];
  columns?: ColumnDef<Row>[];
  filters?: FilterDef[];
}

export interface DistributionKind<Row extends DistributionBase> {
  entity: AnyDistributionEntity<Row>;
  columns?: ColumnDef<Row>[];
}

// A plugin that serves a repository through a publication. Absent for a plugin
// that has no publication endpoint.
export interface PublicationKind {
  // Whether a distribution serves the publication of its repository and not
  // the repository's latest version directly.
  servesFromPublication: boolean;
}

export interface PluginDescriptor<Row extends RepositoryBase = RepositoryBase> {
  repository: RepositoryKind<Row>;
  remote?: RemoteKind<RemoteBase>;
  distribution?: DistributionKind<DistributionBase>;
  publication?: PublicationKind;
  contentTypes?: ContentTypeDef[];
}
