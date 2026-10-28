#!/bin/sh
# Release build of the UI: runs the production build, removes every source map
# and packs the result into pulp-ui-<version>.tar.gz in the repository root.
#
# What it produces:
#   dist/                          index.html, pulp-ui-config.json, favicon.ico,
#                                  js/, css/, fonts/ - and no source maps
#   pulp-ui-<version>.tar.gz       the same files at the archive root
#
# Run it from a checkout, or from an unpacked source archive, of this
# repository with node_modules installed. The build stamps the full commit it
# was built from: that comes from git, so an unpacked archive (which has no git
# metadata) must provide PULP_UI_COMMIT, a 40-character lowercase commit hash.
# PULP_UI_DATE optionally overrides the commit date shown in the stamp.
# PULP_UI_CONFIG optionally names a pulp-ui-config.json to ship; it is read by
# the build configuration and only passed through the environment here.
#
# Source maps are not shipped: they would publish the complete source with its
# file paths and add several megabytes to every download.
set -eu

cd "$(dirname "$0")/.."

npm run build

rm -rf dist/sourcemaps
find dist -name '*.map' -type f -exec rm -f {} +

version=$(node -p "require('./package.json').version")
tarball="pulp-ui-${version}.tar.gz"

rm -f "$tarball"
tar -C dist -czf "$tarball" .

commit=${PULP_UI_COMMIT:-$(git rev-parse HEAD)}

echo "Wrote $tarball from commit $commit"
