# Release Preparation

## Identity

- Display name: Image Manager Pro.
- Extension name: `image-manager-pro`.
- GitHub repository: `130040167/image-manager-pro`.
- The manifest still contains the upstream publisher `Minko`. Replace it with your own verified Marketplace publisher ID before publishing. `npm run publish:market` refuses to use the upstream identity.
- Version remains `3.3.10`; choose the first public version before release.
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

Marketplace publication requires the new owner's verified publisher ID and publishing credentials. The preparation scripts do not publish automatically.
