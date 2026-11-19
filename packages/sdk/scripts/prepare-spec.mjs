// Prepares the committed Pulp schema for client generation, one application at
// a time. It is the single place where generation-specific changes to the
// schema live, so the committed file stays exactly what the Pulp image dumped
// (minus its host-specific parts).
//
// What it does:
//   - merges every schema source into one document (mergeSpecs),
//   - assigns every path to exactly one application (classifyPath) and keeps
//     only the paths of the application being generated, plus the component
//     schemas those paths reach,
//   - drops format "uri" everywhere. Pulp marks every relative object
//     reference (pulp_href, repository, remote, next, previous ...) with that
//     format, and the Zod generator turns it into an absolute-URL check that
//     rejects the relative paths the server actually sends,
//   - keeps only multipart for request bodies that carry a file. Pulp lists
//     JSON, URL-encoded and multipart for every write; the generator takes the
//     first listed type, and a file cannot travel in a URL-encoded body,
//   - drops the servers entry, so no generated code names a host.

export const APPS = [
  'core',
  'ansible',
  'certguard',
  'deb',
  'file',
  'maven',
  'npm',
  'python',
  'rpm',
];

// Plugin applications; every other path belongs to pulpcore.
const PLUGINS = APPS.filter((app) => app !== 'core');

const API_ROOT = '/pulp/api/v3/';

// URL families whose second segment names the plugin that owns the endpoint
// (/pulp/api/v3/repositories/rpm/rpm/). Without a plugin name the endpoint
// is the generic one of pulpcore.
const KINDS = new Set([
  'acs',
  'content',
  'contentguards',
  'distributions',
  'exporters',
  'importers',
  'publications',
  'remotes',
  'repositories',
]);

/**
 * Names the application that owns a path, or null when none does.
 * @param {string} path Path key of the schema.
 * @returns {string | null} One of APPS, or null.
 */
export function classifyPath(path) {
  if (path.startsWith('{')) {
    // Href mode: the first path segment is a parameter named after the model
    // ("{rpm_rpm_repository_href}"), whose first token is the plugin.
    const name = path.slice(1, path.indexOf('}'));
    return PLUGINS.find((app) => name.startsWith(`${app}_`)) ?? 'core';
  }
  if (path.startsWith(API_ROOT)) {
    const [kind, second] = path.slice(API_ROOT.length).split('/');
    if (kind !== undefined && PLUGINS.includes(kind)) {
      return kind;
    }
    if (kind === 'pulp_ansible') {
      return 'ansible';
    }
    if (
      kind !== undefined &&
      KINDS.has(kind) &&
      PLUGINS.includes(second ?? '')
    ) {
      return second;
    }
    return 'core';
  }
  return null;
}

const isObject = (value) => value !== null && typeof value === 'object';

/**
 * Merges schema documents into one. The first source provides info and
 * security; paths and every component section are united.
 * @param {Record<string, any>[]} specs Parsed schemas.
 * @returns {Record<string, any>} The merged schema.
 */
export function mergeSpecs(specs) {
  const [first, ...others] = specs;
  const merged = structuredClone(first);
  for (const spec of others) {
    Object.assign(merged.paths, structuredClone(spec.paths ?? {}));
    for (const [section, entries] of Object.entries(spec.components ?? {})) {
      merged.components[section] = {
        ...merged.components[section],
        ...structuredClone(entries),
      };
    }
  }
  return merged;
}

/**
 * Collects the component references a value holds, directly or through the
 * components it refers to.
 * @param {unknown} value Any part of a schema.
 * @param {(ref: string) => void} visit Called with every "#/components/..." reference.
 * @returns {void}
 */
function collectRefs(value, visit) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectRefs(item, visit));
  } else if (isObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (key === '$ref' && typeof item === 'string') {
        visit(item);
      } else {
        collectRefs(item, visit);
      }
    }
  }
}

/**
 * Removes format "uri" from every schema object, in place.
 * @param {unknown} value Any part of a schema.
 * @returns {void}
 */
function dropUriFormat(value) {
  if (Array.isArray(value)) {
    value.forEach(dropUriFormat);
  } else if (isObject(value)) {
    if (value['format'] === 'uri') {
      delete value['format'];
    }
    Object.values(value).forEach(dropUriFormat);
  }
}

/**
 * Tells whether a schema holds a binary (file) field, following references.
 * @param {unknown} schema Schema object or reference.
 * @param {Record<string, any>} schemas Component schemas by name.
 * @param {Set<string>} seen Component names already visited.
 * @returns {boolean} True when a binary field is reachable.
 */
function hasBinaryField(schema, schemas, seen = new Set()) {
  if (!isObject(schema)) {
    return false;
  }
  if (typeof schema['$ref'] === 'string') {
    const name = schema['$ref'].split('/').pop();
    if (name === undefined || seen.has(name)) {
      return false;
    }
    seen.add(name);
    return hasBinaryField(schemas[name], schemas, seen);
  }
  if (schema['format'] === 'binary') {
    return true;
  }
  const nested = [
    ...Object.values(schema['properties'] ?? {}),
    schema['items'],
    ...(schema['allOf'] ?? []),
    ...(schema['oneOf'] ?? []),
    ...(schema['anyOf'] ?? []),
  ];
  return nested.some((part) => hasBinaryField(part, schemas, seen));
}

/**
 * Reduces the request bodies that carry a file to multipart, in place.
 * @param {Record<string, any>} spec Schema.
 * @returns {void}
 */
function keepMultipartForUploads(spec) {
  const schemas = spec.components?.schemas ?? {};
  for (const item of Object.values(spec.paths)) {
    for (const operation of Object.values(item)) {
      const content = operation?.requestBody?.content;
      const multipart = content?.['multipart/form-data'];
      if (multipart && hasBinaryField(multipart.schema, schemas)) {
        operation.requestBody.content = { 'multipart/form-data': multipart };
      }
    }
  }
}

/**
 * Keeps the components a set of paths reaches; securitySchemes stay whole.
 * @param {Record<string, any>} spec Schema whose paths are already filtered.
 * @returns {void}
 */
function pruneComponents(spec) {
  const components = spec.components ?? {};
  const keep = new Set();
  const pending = [];
  const visit = (ref) => {
    if (ref.startsWith('#/components/') && !keep.has(ref)) {
      keep.add(ref);
      pending.push(ref);
    }
  };
  collectRefs(spec.paths, visit);
  while (pending.length > 0) {
    const [, , section, name] = pending.pop().split('/');
    collectRefs(components[section]?.[name], visit);
  }
  for (const section of Object.keys(components)) {
    if (section === 'securitySchemes') {
      continue;
    }
    for (const name of Object.keys(components[section])) {
      if (!keep.has(`#/components/${section}/${name}`)) {
        delete components[section][name];
      }
    }
  }
}

/**
 * Prepares the schema for generating the clients of one application.
 * @param {Record<string, any> | Record<string, any>[]} specs One schema or a
 *   list of schemas; every source goes through the same merge.
 * @param {string} app One of APPS.
 * @returns {any} A new schema holding only that application, shaped as the
 *   generator's document type.
 */
export function prepareSpec(specs, app) {
  if (!APPS.includes(app)) {
    throw new Error(`Unknown application: ${app}`);
  }
  const spec = mergeSpecs(Array.isArray(specs) ? specs : [specs]);
  delete spec.servers;
  const paths = {};
  for (const [path, item] of Object.entries(spec.paths)) {
    if (classifyPath(path) === app) {
      paths[path] = item;
    }
  }
  spec.paths = paths;
  keepMultipartForUploads(spec);
  pruneComponents(spec);
  dropUriFormat(spec);
  return spec;
}
