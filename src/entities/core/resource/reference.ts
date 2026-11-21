import { parsePulpResource, resourceHref } from './prn';

// How a task detail shows one entry of the resources a task reserved: either
// as text that needs no request, or as an object to read by its address.
export type ResourceReference =
  | { kind: 'text'; type: string; name: string }
  | { kind: 'read'; href: string; plugin: string; type: string };

const DOMAIN_RESOURCE = 'Domain Resource';

// Turns an entry of a task's reserved resources (a PRN, a domain resource name
// or an address, with an optional "shared:" prefix) into what the detail
// shows, or null when the entry names nothing the detail can show. A domain is
// never read: a viewer is not allowed to, and the entry is shown as text.
export function resourceReference(record: string): ResourceReference | null {
  const value = record.startsWith('shared:') ? record.slice(7) : record;
  const resource = parsePulpResource(value);
  if (!resource) {
    return null;
  }

  if (resource.resource_label) {
    return {
      kind: 'text',
      type: DOMAIN_RESOURCE,
      name: resource.resource_label,
    };
  }
  if (resource.plugin === 'core' && resource.model === 'domain') {
    return { kind: 'text', type: DOMAIN_RESOURCE, name: value };
  }

  const href = resourceHref(resource);
  return href
    ? { kind: 'read', href, plugin: resource.plugin, type: resource.model }
    : null;
}
