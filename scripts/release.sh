#!/usr/bin/env bash
# scripts/release.sh — keep package.json / git tag / GitHub release in lockstep.
#
# Assumes the version was already bumped and committed (e.g.
#   npm version minor --no-git-tag-version && git commit -am "chore: bump version to X.Y.Z"
# ). Reads the version from the working tree's package.json, tags HEAD, pushes
# the tag, and creates the GitHub release with auto-generated notes.
#
# Usage: scripts/release.sh [--title "TITLE"] [--notes-file PATH]
#   --title       release title (default: "v<version>")
#   --notes-file  explicit release notes file; without it, GitHub generates
#                 notes from the commits since the last release
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="$(node -p "require('./package.json').version")"
TAG="v$VERSION"

if ! git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  :
else
  echo "release.sh: tag $TAG already exists locally — nothing to do" >&2
  exit 1
fi

HEAD_VERSION="$(git show HEAD:package.json | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8')).version")"
if [ "$HEAD_VERSION" != "$VERSION" ]; then
  echo "release.sh: HEAD's package.json is $HEAD_VERSION but the working tree is $VERSION — commit the version bump before releasing" >&2
  exit 1
fi

if ! git diff --quiet; then
  echo "release.sh: warning: working tree has uncommitted changes; tagging HEAD as-is" >&2
fi

TITLE=""
NOTES_FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --title) TITLE="${2:-}"; shift 2 ;;
    --notes-file) NOTES_FILE="${2:-}"; shift 2 ;;
    *) echo "release.sh: unknown argument: $1" >&2; exit 2 ;;
  esac
done

git tag "$TAG"
git push origin "$TAG"

NOTES_ARGS=()
if [ -n "$NOTES_FILE" ]; then
  NOTES_ARGS=(--notes-file "$NOTES_FILE")
else
  NOTES_ARGS=(--generate-notes)
fi
if [ -n "$TITLE" ]; then
  TITLE_ARGS=(--title "$TITLE")
else
  TITLE_ARGS=(--title "$TAG")
fi

if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  :
else
  echo "release.sh: gh is not authenticated — the tag is pushed; create the release with:" >&2
  echo "  gh release create $TAG --latest ${NOTES_ARGS[*]} ${TITLE_ARGS[*]}" >&2
  exit 0
fi

gh release create "$TAG" --latest "${TITLE_ARGS[@]}" "${NOTES_ARGS[@]}"
echo "release.sh: $TAG tagged, pushed, and released"
