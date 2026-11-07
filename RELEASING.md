# Release Preparation

## Identity

- Display name: Image Manager Pro.
- Extension name: `image-manager-pro`.
- GitHub repository: `130040167/image-manager-pro`.
- Marketplace publisher: `lucymystery`. The extension identity is `lucymystery.image-manager-pro`.
- Initial public version: `3.3.10`, retaining the development version number.
- Commands and settings retain the `image-manager` namespace for compatibility.

## Descriptions

GitHub uses `README.md` / `README.zh.md`, including upstream acknowledgments.

The package and publish scripts select `MARKETPLACE.md` using VSCE's `--readme-path`, so the Marketplace listing focuses on functionality. All descriptions share five runtime screenshots in `screenshots/release/`: one gallery, two preview and two editor views.

## Build and Check

Use Node.js 22 LTS. The locally installed VSCE dependencies currently fail on Node.js 25 because of a removed `SlowBuffer` API.

```sh
npm ci
npm run type-check
npm run test:unit
npm run pack
```

`npm run build` generates third-party license files and compiles both bundles. Inspect the VSIX for `LICENSE`, `THIRD_PARTY_NOTICES.md`, `third-party-licenses/`, the selected Marketplace README and all five screenshots.

Before pushing, inspect untracked files. Local backups, planning files, `.env`, test output and diagnostic data must stay out of the public repository.

## Publish

Create the intended GitHub repository and confirm its URLs. Register or select your own Marketplace publisher, update `package.json`, authenticate VSCE, choose the release version and then run `npm run publish:market`.

The initial GitHub publication uses a clean current-source snapshot. Original development history remains in the local checkout because it includes local environment and diagnostic files. Local plans, environment files, and upstream automation requiring the original author's credentials are excluded from that snapshot.

Publish using the `lucymystery` account in the Marketplace management page, or authenticate VSCE with publishing credentials. The local preparation scripts do not publish automatically.

## Automatic Marketplace Updates

The `Publish to VS Code Marketplace` GitHub Actions workflow publishes the VSIX
attached to a published GitHub Release. Use a tag such as `v3.3.13` and attach
`image-manager-pro-3.3.13.vsix` before publishing the release. The workflow checks
the package identity and version, then uses VSCE 4.1.0 with OIDC.

In Marketplace, the `lucymystery` publisher's Trusted Publishing policy must
authorize repository owner `130040167`, repository `image-manager-pro` and workflow
`publish-marketplace.yml`. Leave Environment empty. No PAT or GitHub repository
secret is needed.

For an existing release, run the workflow manually with its tag. A successful
submission can still show `Verifying` in Marketplace; confirm the version is
publicly available before calling the release complete.
