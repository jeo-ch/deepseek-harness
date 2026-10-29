# Agent Note: Give installation-owned package names precedence over profile copies

Status: implemented

English | [中文](2026-10-29-installation-owned-package-precedence.zh.md)

## Problem

A Desktop installation ships the Harness packages and the Cordis runtime under `resources/app.asar.unpacked/dsh/node_modules`. A profile written by an earlier release can still hold a physical copy of the same name in its own `node_modules`: releases before [the cleanup removal](../simplification/2026-09-19-remove-desktop-profile-core-cleanup.md) installed the dsh peers there, and an upgrade replaces the installation while leaving the profile on disk. Node's ancestor lookup reaches the nearer profile copy first, so one process runs two versions of the same package.

The [lookup-order Note](2026-09-19-profile-resolution-lookup-order.md) made an installation entry occupy the name at `$DSH_HOME/profiles/node_modules`, but a profile copy at layer ① or ② still won, and `routeLocalPackage` skipped interception entirely for a package the profile declares directly. A Desktop upgrade from 0.2.1-rc.3 to 0.2.2-alpha.2 left `@deepseek-ai/dsh-session-projection@0.2.1-rc.3` in the profile; the compatibility preflight compared it against the 0.2.2 Host, disabled the plugin, and 39 plugins stayed pending until startup failed with `dsh: startup failed: 1 required plugin did not activate`. Startup never runs pnpm and does not edit installed user packages, so nothing downstream could repair the mix.

## Decision

### The installation-owned set

`installationOwnedName()` in [resolver.ts](../../../../packages/boot/app-boot/src/profile-resolution/resolver.ts) names packages whose module instances carry service registrations or shared state that the Host and every Loader plugin must share: `@deepseek-ai/dsh-*`, `@deepseek-ai/cordis`, `@deepseek-ai/cordis-*`, `@deepseek-ai/cosmokit`, and `@deepseek-ai/schemastery`. The rule matches names, not versions: a profile copy of one of these names is never selected while the installation supplies an entry for it, whether the copy is older, equal, or newer.

A name the installation does not supply keeps the profile copy. The installation closure omits optional Harness plugins the profile installs itself, such as `@deepseek-ai/dsh-subagent-claude-code` and `@deepseek-ai/dsh-subagent-codex`, so those continue to resolve from the profile at layer ②.

### Where precedence applies

The router answers an installation-owned name with an installation-scope entry at the interception route before it walks the physical search paths. `routeScoped` returns that route right after the self-reference check and the linked-layer branch, so ESM import, CommonJS require, `require.resolve`, and the `packageDir` metadata all name the installation copy. The memoized request cache records the answer the same way as a physical route.

`routeLocalPackage` no longer short-circuits an installation-owned name. That shortcut exists to save one directory probe for a direct profile dependency, but it bypasses the interception layer, so an installation-owned name falls through to the scoped lookup instead.

Two behaviors deliberately stay as they were. A linked root keeps `routeLinked`, so a developer repository's own packages still follow the [linked-root rules](2026-09-09-profile-resolution-generations.md). Explicit CommonJS `paths` still bypass interception, because a caller that names its search path asks for Node's own answer. The publication check in `compileResolution` still overwrites a mapping with an installation entry when both share a name; `dependencyClosure` reserves installation names, so a profile-scope entry can never reuse one and the overwrite is unreachable.

## Alternatives considered

**Delete the stale profile copies during startup.** Startup would have to decide which directories are obsolete and delete them from a user-owned profile, and a wrong deletion breaks an installation the user chose deliberately. Resolution can ignore the copy without touching disk, so no user package is modified.

**Give every installation closure entry absolute priority.** The closure also holds third-party libraries, and a plugin's own `zod`, `yaml`, or similar version would be replaced by the installation's, breaking the nearest-wins rule Node applies to third-party code. The [lookup-order Note](2026-09-19-profile-resolution-lookup-order.md) records this alternative as rejected; the shipped rule narrows it to names where duplicate module instances actually break a shared service.

**Compare versions and let the newer one win.** A version comparison needs a semver decision per request, and the two copies can be incomparable (a prerelease, a `file:` build, or a workspace version). The Host's own runtime is the authority on which package versions it can load, so the installation wins regardless of the version string.

**Leave resolution unchanged and require users to remove stale profile packages.** The failure surfaces as a fatal startup error with no recovery path in the UI, and every user who upgrades from an affected release would hit it. Requiring a reinstall or a manual cleanup contradicts the promise that an upgrade keeps the profile usable.

## Consequences

Gained: an installation upgrade no longer needs a matching profile rewrite; a profile copy installed by an earlier release cannot shadow the running Host or the Cordis runtime, and the single-instance guarantee covers the packages that share service registrations. Startup remains read-only with respect to user packages.

Paid: a profile that deliberately pins a Harness or Cordis version gets the installation's version instead, so those pins have no effect on resolution and must move to a matching installation. The installation-owned list is maintained by name: a new shared-state package must be added to `installationOwnedName()` or it keeps the old nearest-wins behavior. Third-party libraries, bundle-only packages, and profile-installed optional Harness plugins still resolve by Node's nearest-wins rule, so the lookup order is no longer uniform for every name.
