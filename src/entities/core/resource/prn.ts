import { config } from 'src/ui-config';

// The kind of object a PRN or an address names, and the one place that reads
// them. Only whole, anchored shapes are understood: a PRN of three parts, or an
// address under the API base that ends in the object's id. Anything else is not
// a resource and answers null, so no part of an unknown value ever reaches a
// lookup or a request path.
export interface PulpResource {
  id: string;
  plugin: string;
  model: string;
  resource_label?: string;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

// An object address: the collection path, the id, an optional trailing slash.
const OBJECT_HREF = new RegExp(`^(.+?)/(${UUID})/?$`, 'i');
// prn:<app label>.<model label>:<id>
const PRN = /^prn:([a-z0-9_]+)\.([a-z0-9_]+):([^:]+)$/i;
// pdrn:<domain id>:<resource label>
const PDRN = /^pdrn:([^:]+):(.*)$/;

// An id is part of a request path, so nothing but an id is put into one.
const SAFE_ID = /^[0-9a-f-]+$/i;

// The collection paths below the API base, by the kind they hold. Looked up in
// maps, never in object literals: a segment named like an inherited property
// ("constructor") must find nothing.
const KINDS: [string, string][] = Object.entries({
  // core
  access_policies: 'core.accesspolicy',
  groups: 'core.group',
  domains: 'core.domain',
  artifacts: 'core.artifact',
  'signing-services': 'core.signingservice',
  workers: 'core.worker',
  tasks: 'core.task',
  'task-groups': 'core.taskgroup',
  'task-schedules': 'core.taskschedule',
  'exporters/core/filesystem': 'core.filesystemexporter',
  'exporters/core/pulp': 'core.pulpexporter',
  'importers/core/pulp': 'core.pulpimporter',
  'contentguards/core/rbac': 'core.rbaccontentguard',
  'contentguards/core/content_redirect': 'core.contentredirectcontentguard',
  'contentguards/core/header': 'core.headercontentguard',
  'contentguards/core/composite': 'core.compositecontentguard',
  'distributions/core/artifacts': 'core.artifactdistribution',
  uploads: 'core.upload',
  'upstream-pulps': 'core.upstreampulp',
  roles: 'core.grouprole',
  // gem
  'content/gem/gem': 'gem.gemcontent',
  'distributions/gem/gem': 'gem.gemdistribution',
  'publications/gem/gem': 'gem.gempublication',
  'remotes/gem/gem': 'gem.gemremote',
  'repositories/gem/gem': 'gem.gemrepository',
  // rpm
  'content/rpm/advisories': 'rpm.updaterecord',
  'content/rpm/packagegroups': 'rpm.packagegroup',
  'content/rpm/packagecategories': 'rpm.packagecategory',
  'content/rpm/packageenvironments': 'rpm.packageenvironment',
  'content/rpm/packagelangpacks': 'rpm.packagelangpacks',
  'content/rpm/repo_metadata_files': 'rpm.repometadatafile',
  'content/rpm/distribution_trees': 'rpm.distributiontree',
  'content/rpm/packages': 'rpm.package',
  'content/rpm/modulemds': 'rpm.modulemd',
  'content/rpm/modulemd_defaults': 'rpm.modulemddefaults',
  'content/rpm/modulemd_obsoletes': 'rpm.modulemdobsolete',
  'remotes/rpm/rpm': 'rpm.rpmremote',
  'remotes/rpm/uln': 'rpm.ulnremote',
  'repositories/rpm/rpm': 'rpm.rpmrepository',
  'publications/rpm/rpm': 'rpm.rpmpublication',
  'distributions/rpm/rpm': 'rpm.rpmdistribution',
  'acs/rpm/rpm': 'rpm.rpmalternatecontentsource',
  // ansible
  'content/ansible/roles': 'ansible.role',
  'ansible/collections': 'ansible.collection',
  'pulp_ansible/tags': 'ansible.tag',
  'content/ansible/collection_versions': 'ansible.collectionversion',
  'content/ansible/collection_marks': 'ansible.collectionversionmark',
  'content/ansible/collection_signatures': 'ansible.collectionversionsignature',
  'content/ansible/namespaces': 'ansible.ansiblenamespacemetadata',
  'remotes/ansible/role': 'ansible.roleremote',
  'remotes/ansible/collection': 'ansible.collectionremote',
  'remotes/ansible/git': 'ansible.gitremote',
  'content/ansible/collection_deprecations':
    'ansible.ansiblecollectiondeprecated',
  'repositories/ansible/ansible': 'ansible.ansiblerepository',
  'distributions/ansible/ansible': 'ansible.ansibledistribution',
  // container
  'content/container/blobs': 'container.blob',
  'content/container/manifests': 'container.manifest',
  'content/container/tags': 'container.tag',
  'content/container/signatures': 'container.manifestsignature',
  'pulp_container/namespaces': 'container.containernamespace',
  'remotes/container/container': 'container.containerremote',
  'remotes/container/pull-through': 'container.containerpullthroughremote',
  'repositories/container/container': 'container.containerrepository',
  'repositories/container/container-push': 'container.containerpushrepository',
  'distributions/container/pull-through':
    'container.containerpullthroughdistribution',
  'distributions/container/container': 'container.containerdistribution',
  // ostree
  'content/ostree/objects': 'ostree.ostreeobject',
  'content/ostree/commits': 'ostree.ostreecommit',
  'content/ostree/refs': 'ostree.ostreeref',
  'content/ostree/content': 'ostree.ostreecontent',
  'content/ostree/configs': 'ostree.ostreeconfig',
  'content/ostree/summaries': 'ostree.ostreesummary',
  'remotes/ostree/ostree': 'ostree.ostreeremote',
  'repositories/ostree/ostree': 'ostree.ostreerepository',
  'distributions/ostree/ostree': 'ostree.ostreedistribution',
  // python
  'distributions/python/pypi': 'python.pythondistribution',
  'content/python/packages': 'python.pythonpackagecontent',
  'publications/python/pypi': 'python.pythonpublication',
  'remotes/python/python': 'python.pythonremote',
  'repositories/python/python': 'python.pythonrepository',
  // maven
  'content/maven/artifact': 'maven.mavenartifact',
  'remotes/maven/maven': 'maven.mavenremote',
  'distributions/maven/maven': 'maven.mavendistribution',
  'repositories/maven/maven': 'maven.mavenrepository',
  // certguard
  'contentguards/certguard/rhsm': 'certguard.rhsmcertguard',
  'contentguards/certguard/x509': 'certguard.x509certguard',
  // file
  'content/file/files': 'file.filecontent',
  'remotes/file/file': 'file.fileremote',
  'repositories/file/file': 'file.filerepository',
  'publications/file/file': 'file.filepublication',
  'distributions/file/file': 'file.filedistribution',
  'acs/file/file': 'file.filealternatecontentsource',
  // deb
  'content/deb/packages': 'deb.package',
  'content/deb/installer_packages': 'deb.installerpackage',
  'content/deb/generic_contents': 'deb.genericcontent',
  'content/deb/source_packages': 'deb.sourcepackage',
  'content/deb/releases': 'deb.release',
  'content/deb/release_architectures': 'deb.releasearchitecture',
  'content/deb/release_components': 'deb.releasecomponent',
  'content/deb/package_release_components': 'deb.packagereleasecomponent',
  'content/deb/source_release_components': 'deb.sourcepackagereleasecomponent',
  'content/deb/release_files': 'deb.releasefile',
  'content/deb/package_indices': 'deb.packageindex',
  'content/deb/installer_file_indices': 'deb.installerfileindex',
  'content/deb/source_indices': 'deb.sourceindex',
  'publications/deb/verbatim': 'deb.verbatimpublication',
  'publications/deb/apt': 'deb.aptpublication',
  'distributions/deb/apt': 'deb.aptdistribution',
  'remotes/deb/apt': 'deb.aptremote',
  'repositories/deb/apt': 'deb.aptrepository',
});

const MODEL_LABEL_BY_COLLECTION = new Map(KINDS);
const COLLECTION_BY_MODEL_LABEL = new Map(
  KINDS.map(([collection, label]) => [label, collection]),
);

// What a PRN, a domain resource name or an address of the API names, or null
// when the value is none of them.
export function parsePulpResource(value: string): PulpResource | null {
  if (typeof value !== 'string') {
    return null;
  }

  if (value.startsWith(config.API_BASE_PATH)) {
    const match = OBJECT_HREF.exec(value.slice(config.API_BASE_PATH.length));
    const label = match && MODEL_LABEL_BY_COLLECTION.get(match[1]);
    if (!label) {
      return null;
    }
    const [plugin, model] = label.split('.');
    return { id: match[2], plugin, model, resource_label: undefined };
  }

  const prn = PRN.exec(value);
  if (prn) {
    return {
      id: prn[3],
      plugin: prn[1],
      model: prn[2],
      resource_label: undefined,
    };
  }

  const pdrn = PDRN.exec(value);
  if (pdrn) {
    return {
      id: pdrn[1],
      plugin: 'core',
      model: 'domain',
      resource_label: pdrn[2],
    };
  }

  return null;
}

// The address of a resource, or null for a kind this table does not know (an
// address is never built from "undefined") and for an id that is not safe to
// put into a path. A resource that came from a domain resource name has none.
export function resourceHref(resource: PulpResource): string | null {
  const collection = COLLECTION_BY_MODEL_LABEL.get(
    `${resource.plugin}.${resource.model}`,
  );
  if (!collection || !SAFE_ID.test(resource.id ?? '')) {
    return null;
  }
  return `${config.API_BASE_PATH}${collection}/${resource.id}/`;
}
