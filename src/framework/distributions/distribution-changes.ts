import {
  DISTRIBUTION_BINDINGS,
  type DistributionBase,
  type DistributionChanges,
  bindingChange,
} from 'src/entities/plugin/distribution';
import type { FrameworkPlugin } from '../manifest';
import type { Protection } from './protection-choice';
import { type ServesChoice, servesBinding } from './serves-field';

// Whether the binding names what the distribution already serves: each of the
// plugin's binding fields holds what the binding says, or is empty where it
// says nothing.
function isBoundTo(
  plugin: FrameworkPlugin,
  distribution: DistributionBase,
  binding: NonNullable<ReturnType<typeof servesBinding>>,
): boolean {
  return (DISTRIBUTION_BINDINGS[plugin] ?? []).every(
    (field) => (distribution[field] ?? null) === (binding[field] ?? null),
  );
}

interface Params {
  plugin: FrameworkPlugin;
  distribution: DistributionBase;
  basePath: string;
  // What the user chose to serve, or undefined while the user has not touched
  // it: a binding that was never offered for change is left as it is.
  serves: ServesChoice | undefined;
  // The protection the form holds, or undefined while it was not touched.
  protection: Protection | undefined;
  // The plugin gives the distribution its own guard: none is ever sent.
  managed: boolean;
}

// The body of a save: exactly the fields that differ from the distribution that
// was read, and no other. A change of what the distribution serves carries the
// new binding and null for each other binding field of the plugin. The content
// guard is null only for the explicit Public choice on a distribution that has
// one, and a plugin that manages the guard sends none. A field the form does
// not show is never part of it.
export function distributionChanges({
  plugin,
  distribution,
  basePath,
  serves,
  protection,
  managed,
}: Params): DistributionChanges {
  const changes: DistributionChanges = {};

  if (basePath !== distribution.base_path) {
    changes.base_path = basePath;
  }

  const binding = serves ? servesBinding(serves) : null;
  if (binding && !isBoundTo(plugin, distribution, binding)) {
    Object.assign(changes, bindingChange(plugin, binding));
  }

  if (!managed && protection !== undefined && protection !== null) {
    if (protection === 'public') {
      if (distribution.content_guard !== null) {
        changes.content_guard = null;
      }
    } else if (protection.guard !== distribution.content_guard) {
      changes.content_guard = protection.guard;
    }
  }

  return changes;
}
