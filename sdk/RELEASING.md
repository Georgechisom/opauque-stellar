# Releasing `@opaquecash/stellar`

Releases are automated by [`.github/workflows/sdk-release.yml`](../.github/workflows/sdk-release.yml).
Pushing an `sdk-v<version>` tag runs the **full quality gate** — lint, typecheck,
build, `publint` + `are-the-types-wrong`, tests, and the **clean-room install** —
and only then publishes to npm with **provenance** and creates a GitHub Release.
Never `npm publish` by hand; the tag-triggered workflow guarantees the gate runs
first, so a broken package can't ship.

## One-time setup

Add an **`NPM_TOKEN`** repository secret: an npm **granular/automation token** with
publish rights to the `@opaquecash` scope. (Provenance also requires the workflow's
`id-token: write` permission, already set.)

## Cutting a release

1. **Record the change** (per PR or before releasing):
   ```sh
   npm run changeset      # choose patch/minor/major, write a summary
   ```
   Commit the generated `.changeset/*.md`.

2. **Apply the version bump** (consumes changesets → updates `package.json` +
   `CHANGELOG.md`):
   ```sh
   npm run version
   ```
   `VERSION` in `src/index.ts` is injected from `package.json` at build time, so
   there is nothing else to keep in sync.

3. **Tag and push**:
   ```sh
   git commit -am "Release @opaquecash/stellar v$(node -p "require('./package.json').version")"
   git tag "sdk-v$(node -p "require('./package.json').version")"
   git push && git push --tags
   ```

4. The **SDK Release** workflow gates and publishes. Confirm the new version on npm
   and the GitHub Release that was created.

## Notes

- The tag version must match `package.json` (the workflow enforces this).
- To verify the package locally before tagging: `npm run check:exports && npm run smoke:install`.
