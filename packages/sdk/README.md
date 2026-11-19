# @pulp-ui/sdk

Typed clients and Zod models for the Pulp REST API, generated from one committed
OpenAPI schema. The package is built to `dist` (`npm run build -w @pulp-ui/sdk`,
also run by the root `prepare` script) and imported per application and tag, for
example `@pulp-ui/sdk/core/status`.

Everything under `schema/` and `src/<app>/` is generated and committed. It is never
edited by hand: it changes only through the commands below, so a review of a
regeneration shows exactly what the schema change did to the clients.

## Layout

| Path | What |
|---|---|
| `schema/pulp.json` | The committed schema, normalised (no `servers` entry, object keys sorted) |
| `pulp-versions.json` | Application versions the schema declares and the source commits of the image it was dumped from; no timestamp |
| `scripts/import-schema.mjs` | Turns a dumped schema file into `schema/pulp.json` and `pulp-versions.json` |
| `scripts/prepare-spec.mjs` | The one transformer every generation run goes through (merge, split by application, fixes) |
| `scripts/schema-sources.mjs` | The list of schema files generation reads |
| `src/mutator/` | Hand-written request code the generated clients call (`pulpFetch`, `pulpFormData`) |
| `src/<app>/` | Generated clients (one file per tag) and `models/` Zod schemas |

## Where the schema comes from

The schema is the output of Pulp's own schema command (`pulpcore-manager openapi`),
run once inside a Pulp image without a network and without a database. It is never
fetched from a running installation, so the committed file describes the versions
the image carries and nothing about where a server runs. The versions of the
applications are read from the schema itself.

## Commands

```
npm run import-schema -w @pulp-ui/sdk -- <dumped schema file>
npm run generate -w @pulp-ui/sdk
```

`import-schema` writes `schema/pulp.json` and `pulp-versions.json`. Importing the
same dump twice gives identical bytes. It exits 2 without an argument and 1 when
the schema declares no application versions.

`generate` runs offline from the committed schema and writes `src/<app>/`. A
second run on an unchanged schema changes nothing.

## Applications

One generation project per application, one directory each: `core`, `ansible`,
`certguard`, `deb`, `file`, `maven`, `npm`, `python`, `rpm`. The transformer
assigns every path to exactly one of them:

- the management API by its URL (`/pulp/api/v3/repositories/rpm/rpm/` is `rpm`;
  a URL without a plugin name belongs to `core`),
- object paths by the plugin prefix of their href parameter
  (`{rpm_rpm_repository_href}` is `rpm`),
- the plugins' client-protocol paths: the Ansible galaxy and collection paths,
  the Python package index and the npm registry.

Each application keeps only the component schemas its own paths reach.

## What the transformer changes

- Format `uri` is removed everywhere. Pulp marks every relative object reference
  (`pulp_href` and the others) with it, and the Zod generator turns it into an
  absolute-URL check that rejects the relative paths the server sends.
- The `servers` entry is removed, so no generated code names a host.
- A request body that carries a file keeps only its multipart form; a file cannot
  travel in a URL-encoded body.
- A path that no application claims and that is not on the exclusion list stops
  generation, and so does a path or component that two schema sources define
  differently. A new endpoint is never dropped silently.

## Excluded paths

These paths are not generated. Each is listed with the reason in
`EXCLUDED_PATHS` of `scripts/prepare-spec.mjs`; a test keeps this list and the
code in step.

| Path | Reason |
|---|---|
| `/pulp/api/v3/docs/api.json` | The schema document itself (JSON), not an API. |
| `/pulp/api/v3/docs/api.yaml` | The schema document itself (YAML), not an API. |
| `/pulp_ansible/galaxy/{path}/api/v3/artifacts/collections/{path}/{filename}` | Two path parameters are both named path, so no valid client function can take them. |

## Schema sources

`scripts/schema-sources.mjs` lists the files generation reads. Today it is the one
committed schema. Another source is one more entry; the same merge applies to
every source.
