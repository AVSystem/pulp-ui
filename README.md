<p align="center">
  <img src="https://raw.githubusercontent.com/pulp/pulp-ui/main/static/images/pulp_logo.png" alt="Pulp logo" width="150">
</p>

# PulpUI

[![License: Apache 2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](https://raw.githubusercontent.com/pulp/pulp-ui/main/LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.32.2-brightgreen)](https://raw.githubusercontent.com/pulp/pulp-ui/main/package.json)

PulpUI is a community driven single-page application that talks to a running [pulpcore](https://github.com/pulp/pulpcore) instance over its REST API, giving that content - across whichever plugins your Pulp deployment has installed - a shared, consistent web UI instead of requiring the CLI or raw API calls.

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Development](#development)
- [Configuration](#configuration)
- [Contributing & Help](#contributing--help)
- [License](#license)

## Features
### Core
- Task Management
- User / Group / Role management
- Content Signing Keys
- Cross-plugin search

### Plugins
- Ansible (repositories, remotes, collections, namespaces, approvals, imports)
- File (repositories, remotes)
- RPM (content)
- Container (execution environments, tags, manifests)

## Requirements
- Node.js >= 22.32.2
- npm >= 10 (macOS or Linux)
- Python 3 + pip (only for the optional `pulp-cli`)

## Quick start

### 1. Run a Pulp backend

Follow the [pulp-oci-images quickstart](https://pulpproject.org/pulp-oci-images/docs/admin/tutorials/quickstart/)

#### Setup

```sh
mkdir -p ~/pulp-backend-oci/{settings/certs,pulp_storage,pgsql,containers}
cd ~/pulp-backend-oci/
echo "
CONTENT_ORIGIN='http://$(hostname):8080'
ANSIBLE_API_HOSTNAME='http://$(hostname):8080'
ANSIBLE_CONTENT_HOSTNAME='http://$(hostname):8080/pulp/content'
" >> settings/settings.py
```
#### Run

```sh
cd ~/pulp-backend-oci/
podman run --publish 8080:80 \
           --replace --name pulp \
           --volume "$(pwd)/settings":/etc/pulp \
           --volume "$(pwd)/pulp_storage":/var/lib/pulp \
           --volume "$(pwd)/pgsql":/var/lib/pgsql \
           --volume "$(pwd)/containers":/var/lib/containers \
           docker.io/pulp/pulp
```
#### Check
```sh
curl localhost:8080/pulp/api/v3/status/ | jq
```
#### Change the admin password
```sh
podman exec -it pulp pulpcore-manager reset-admin-password --password admin
```
#### Configure `pulp-cli` (optional)
```sh
pip install pulp-cli[pygments]
pulp config create --username admin --base-url http://localhost:8080 --password admin

pulp --help
pulp user list
```

---

### 2. Run the frontend

Everything below works the same on macOS and Linux.

#### Clone and install
```sh
git clone https://github.com/pulp/pulp-ui
cd pulp-ui
npm ci
```

`npm ci` installs the exact versions of `package-lock.json` and also installs the git hooks
described under [Git hooks](#git-hooks). Use plain `npm ci`; no extra flags are needed.

#### Start
```sh
npm run start
```

Open http://localhost:8002/.

The dev server proxies the API paths (`/pulp/`, `/api/`, `/auth/`, `/assets/`, `/extensions/`,
`/v2/`, `/static/rest_framework/`) to a Pulp at `http://localhost:8080` unless `API_PROXY` says
otherwise. **Do NOT use the webpack proxy in production.**

## Development

### Run against any Pulp

Point the dev server at a Pulp that listens elsewhere, including one behind HTTPS:

```sh
API_PROXY=https://pulp.example.org npm start
```

- The proxy sends the target's own `Host` and presents the target's origin in the `Origin` and
  `Referer` headers. Pulp checks these for requests that change data after a browser sign-in
  (it refuses them with a CSRF error otherwise), so sign-in, reads, logout and writes all work
  through `http://localhost:8002/ui/`. The proxy adds no credential of its own.
- The dev server listens on all interfaces when the target is on your machine (the default
  `http://localhost:8080`), and on `127.0.0.1` only when `API_PROXY` names any other target. The
  proxy presents the target's own origin, so a dev server that anyone on your network could reach
  would be a relay to the target. Set `DEV_HOST` to choose the address yourself, for example
  `DEV_HOST=0.0.0.0` to expose it on purpose or `DEV_HOST=127.0.0.1` to keep a local target
  private.
- To use another port, for example when 8002 is taken: `npm start -- --port 8012`.
- Use Chrome or Firefox. A deployment that sets `Secure` cookies is reached over plain
  `http://localhost`, which these browsers accept for localhost; Safari does not.
- TLS certificates of the target are verified. For a lab with a self-signed certificate, trust
  it for Node instead of turning verification off:
  `NODE_EXTRA_CA_CERTS=/path/to/ca.pem API_PROXY=https://pulp.example.org npm start`.
- The dev server serves its own `pulp-ui-config.json` (the repository's default), not the one
  of the target deployment.

### Build

```sh
npm run build
```

The production build is written to `dist/`. It needs no environment variables inside a git
checkout.

### Unit tests

```sh
npm test
npm test -w @pulp-ui/sdk
```

The first runs the application's unit and component tests, the second the SDK's tests.

### End-to-end tests

The Playwright projects take their target and accounts from the environment only; no host or
credential is stored in the repository. `PULP_UI_E2E_BASE_URL` is the UI root and must end in
`/ui/`. Install the browser once with `npx playwright install chromium`.

The smoke project signs in with one account against a built UI served next to a throwaway Pulp
(this is what CI runs):

```sh
PULP_UI_E2E_BASE_URL=http://127.0.0.1:8002/ui/ \
PULP_UI_E2E_USERNAME=admin PULP_UI_E2E_PASSWORD=admin \
npx playwright test --project=smoke
```

The remote projects (`remote-admin` and `remote-viewer`) run against a deployment you own, with
an administrator and a limited account. The accounts come from a JSON file named by
`PULP_UI_E2E_ACCOUNTS`, shaped like

```json
{
  "admin": { "username": "...", "password": "..." },
  "viewer": { "username": "...", "password": "..." }
}
```

Keep the file outside the repository with mode `0600`. The tests create and delete only
objects named `zz-e2e-...`. The target is either a deployed UI or the dev server of the
previous section:

```sh
PULP_UI_E2E_ACCOUNTS=/path/to/accounts.json \
PULP_UI_E2E_BASE_URL=http://127.0.0.1:8002/ui/ \
npx playwright test --project=remote-admin --project=remote-viewer
```

Output of the remote projects (screenshots, the HTML report) can show data of that
deployment; keep it local. These projects record no Playwright trace, because a trace keeps the
headers of every request, including the sign-in request with the account's credential. The
smoke project, which runs against a throwaway local instance, keeps traces on failure.

### Git hooks

`npm ci` points git at the hooks in `.githooks`. They run `scripts/check-public.mjs`, which
refuses internal hostnames, private addresses and other details that must not be published,
before a commit and before a push; CI runs it again over the whole tree. You can add a private
denylist of your own terms in a file outside the repository, named by the
`PUBLIC_CHECK_DENYLIST` environment variable or by `git config publiccheck.denylist`. When it
is configured but unreadable, or holds no entry, the check fails instead of passing silently.
When none is configured, the hooks say so on every run: only the public rules ran, and internal
names that those rules cannot recognise are not checked.

## Configuration
A production build (`npm run build`) can be further configured by serving a `/pulp-ui-config.json` alongside the built UI, mapped at `/`. 

| Key                     | Default         | Purpose                                                                                 |
|-------------------------|-----------------|-----------------------------------------------------------------------------------------|
| `API_BASE_PATH`         | `/pulp/api/v3/` | Change when using domains or a different path                                           |
| `UI_BASE_PATH`          | `/ui/`          | Change when only serving index in a subdirectory, or want different browser path prefix |
| `UI_EXTERNAL_LOGIN_URI` | `null`          | Set to something like `/login/` when using SSO                                          |
| `EXTRA_VERSION`         | `""`            | An extra version string to display in about modal                                       |

## Contributing & Help
See the [Pulp developer guide](https://pulpproject.org/dev/) to contribute, or reach the community on [Discourse](https://discourse.pulpproject.org) / Matrix ([#pulp](https://matrix.to/#/#pulp:matrix.org), [#pulp-dev](https://matrix.to/#/#pulp-dev:matrix.org))

## License
[Apache-2.0](https://raw.githubusercontent.com/pulp/pulp-ui/main/LICENSE)
