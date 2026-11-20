import type { MessageDescriptor } from '@lingui/core';
import type { ReactNode } from 'react';
import type { AlertType } from 'src/components';
import type {
  DistributionBase,
  DistributionCreate,
  DistributionEntity,
} from 'src/entities/plugin/distribution';
import type { RemoteBase, RepositoryBase } from 'src/entities/plugin/model';
import type {
  PublicationBase,
  PublicationEntity,
} from 'src/entities/plugin/publication';
import type { RemoteEntity } from 'src/entities/plugin/remote';
import type {
  RepositoryChanges,
  RepositoryCreate,
  RepositoryEntity,
  RevertBody,
} from 'src/entities/plugin/repository';
import type { FrameworkPlugin } from './manifest';
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

// The entities are typed by what a screen reads from them. A create and an edit
// send the fields of the descriptor's form, a sync the remote and the options
// of the descriptor and a content change a revert to a version, so those bodies
// are typed.
type AnyRepositoryEntity<Row> = RepositoryEntity<
  Row,
  RepositoryCreate,
  RepositoryChanges,
  SyncBody,
  RevertBody
>;
type AnyRemoteEntity<Row> = RemoteEntity<Row, never, never>;
type AnyDistributionEntity<Row extends DistributionBase> = DistributionEntity<
  Row,
  DistributionCreate,
  never
>;

// What a sync sends: the remote to sync from and the options the plugin's
// descriptor declares, under the names the plugin's own request uses.
export type SyncBody = { remote?: string } & Record<string, unknown>;

// The kind of a field is the kind of value it holds: `integer` is a whole
// number that may be left blank, `labels` the pairs of a key and an optional
// value, and `remote` the address of a remote or none.
export type FieldKind =
  | 'text'
  | 'textarea'
  | 'integer'
  | 'boolean'
  | 'select'
  | 'url'
  | 'secret'
  | 'labels'
  | 'remote';

// What a plugin's own input of a field is given. `value` and `onChange` use the
// representation of the field's kind in a form (see form-values).
export interface FieldWidgetProps {
  id: string;
  value: unknown;
  onChange: (value: unknown) => void;
  isDisabled: boolean;
  error?: string;
}

// One input of a create or edit form.
export interface FieldDef {
  // The name of the field in the request body.
  name: string;
  label: MessageDescriptor;
  kind: FieldKind;
  required?: boolean;
  help?: MessageDescriptor;
  // The text beside the box of a `boolean` field, which says what ticking it
  // does; the label above names the setting.
  boxLabel?: MessageDescriptor;
  // The choices of a select.
  options?: { value: string; label: MessageDescriptor }[];
  // A plugin's own input for a value its kind does not suit. It replaces the
  // input the kind would draw and holds the value in the kind's form.
  widget?: (props: FieldWidgetProps) => ReactNode;
}

// One labelled row of a Details tab. The tab draws the rows every repository
// has (name, description, where it is served, labels, remote); a plugin
// declares only the rows it adds, and they are drawn after the description.
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
  // How the sort control reads: text sorts from A to Z, numbers and dates from
  // low to high. Text when omitted.
  sortKind?: 'alpha' | 'numeric';
  // The fields of the row the column reads. The list asks the server for these
  // and the few every list needs, and for nothing else, so a column that reads
  // a field names it here.
  fields?: string[];
}

// One filter of a list.
export interface FilterDef {
  id: string;
  label: MessageDescriptor;
  // The query parameter the filter sets.
  param: string;
  // `text` is a search box (several text filters share one box with a choice
  // between them), `labels` the key and value filter of labels, `remote` the
  // choice of one of the plugin's remotes or of none, `select` a choice among
  // `options`.
  kind: 'text' | 'select' | 'labels' | 'remote';
  options?: { value: string; label: MessageDescriptor }[];
}

// One tab of a repository's detail beside the ones every plugin has.
export interface TabDef<Row> {
  // The sub-path of the tab's address. Unique among the tabs of a plugin; a
  // plugin that needs another sub-path adds it to the route patterns first.
  id: RepositoryTab;
  label: MessageDescriptor;
  // The version number of a tab that opens one version (an address like
  // .../versions/3), null on the tab's own address. `descriptor` is the
  // descriptor of the plugin the tab belongs to, for a tab that reads what
  // the plugin declares (its distribution entity, its snippet), and `plugin`
  // names it for the addresses the tab links to. `addAlert` puts an alert on
  // the screen above the tab, where it stays while the user moves between the
  // repository's tabs.
  render: (props: {
    repository: Row;
    version: number | null;
    plugin: FrameworkPlugin;
    descriptor: PluginDescriptor;
    addAlert: (alert: AlertType) => void;
  }) => ReactNode;
}

// One option of the sync dialog, besides the remote the sync reads from. The
// value is sent under `name` in the body of the sync request.
export interface SyncOptionDef<Row> {
  name: string;
  label: MessageDescriptor;
  // `boolean` is a switch, `select` a choice among `options`.
  kind: 'boolean' | 'select';
  help?: MessageDescriptor;
  // The text beside the switch of a `boolean` option, which says what turning
  // it on does; the label above names the option.
  boxLabel?: MessageDescriptor;
  options?: { value: string; label: MessageDescriptor }[];
  // What the option holds before the user touches it, which may depend on the
  // repository. Called while the dialog renders.
  initial: (repository: Row) => unknown;
  // A reason the server would refuse the option for this repository: the
  // option is then held at the given value, cannot be changed, and the dialog
  // says why. Null when the option is free. Called while the dialog renders,
  // so the reason may be translated with the message macro.
  fixed?: (repository: Row) => { value: unknown; reason: string } | null;
}

// How a repository is synced. A plugin without a sync endpoint declares none.
export interface SyncDef<Row> {
  // The name of the task that does the work, to tell a running sync from any
  // other task that holds the repository.
  taskName: string;
  // The options the sync dialog offers beyond the remote, in order.
  options?: SyncOptionDef<Row>[];
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
  // What the create form holds for a field before the user touches it, by the
  // field's name and in the form's representation of the value (see
  // form-values). A field with no entry starts blank, as its kind says.
  createDefaults?: Record<string, unknown>;
  columns?: ColumnDef<Row>[];
  filters?: FilterDef[];
  tabs?: TabDef<Row>[];
  sync?: SyncDef<Row>;
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
  // Reads the publications that publication-bound distributions point at, to
  // find the repository each one serves.
  entity: PublicationEntity<PublicationBase>;
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
