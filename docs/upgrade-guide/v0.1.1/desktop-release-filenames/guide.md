---
kind: upgrade-guide
description: "Desktop workflow installer filenames now include platform labels and a shared release timestamp."
---

# Desktop Release Installer Filenames

English | [中文](guide.zh.md)

## Change

GitHub Releases previously used `tflowbuddy-<version>-<os>-<arch>.<extension>`. The Desktop workflow now publishes `TFlowBuddy-<platform>-v<version>-YYYYMMDDhhmm.<extension>`, with `Win32`, `Win64`, and `MacOS` platform labels and one Beijing-time timestamp. Scripts that construct the old filenames must change. Application versions and local packaging outputs are unchanged.

## Migration

1. Update release download scripts to select the new asset names; map Windows ia32 to `Win32`, Windows x64 to `Win64`, and macOS ARM64 to `MacOS`.
2. For COS downloads, read `tflowbuddy/VERSION` without caching. Its trimmed contents are `<version>-YYYYMMDDhhmm`, without a leading `v`. Use that value in `tflowbuddy/TFlowBuddy-<platform>-v<VERSION>.<extension>`. Configure the CDN to exclude `/tflowbuddy/VERSION` from caching and purge existing responses.
3. Verify that all three GitHub assets and COS objects share the suffix recorded in `VERSION`. The [Desktop release reference](../../../../apps/desktop/README.md#release-versions) describes the GitHub Environment settings and publication failures.
