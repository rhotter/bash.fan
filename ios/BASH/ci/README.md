# Automatic TestFlight deployments

The BASH TestFlight GitHub Actions workflow automatically releases iOS changes pushed to `main`, the native app release branch. Other branches can be released explicitly with a manual run. Website-only changes do not deploy the app.

Both jobs use `macos-15-intel` to avoid the macOS ARM runner capacity shortages that prevented releases from starting on October 26, 2026. Xcode remains pinned to 26.1; compiler caches are separated by runner architecture.

Automatic deployment builds the signed release and then uploads it to TestFlight. Unit tests are run separately and do not gate deployment. The package job caches DerivedData, including compiled dependencies and Swift packages. Unchanged tracked sources get stable Git timestamps so a fresh checkout can reuse compiler work; Xcode still rebuilds changed inputs. Release builds no longer force a clean. Cache keys include Xcode, runner architecture, project settings, dependency locks, and the commit; a new commit restores the closest compatible cache. The first run is cold and will take longer. Bump the cache version or delete the caches to force a rebuild.

New runs cancel superseded package jobs on the same branch. Upload waits for **the package job to succeed** and uses a shared concurrency lock that never cancels an active upload. A stale push is skipped before uploading. Manual runs intentionally release the selected revision. Avoid concurrent manual releases from different branches; older build numbers are rejected if a newer build has already reached Apple.

CI build numbers are `1000 + GITHUB_RUN_NUMBER`, allocated before compilation without querying Apple's latest build number. Re-running the same workflow uses the same number; after a successful upload, trigger a new run for a new release. The upload lane verifies Apple processing and availability in **BASH Internal**. Local `beta` remains available and selects the next Apple build number; coordinate local uploads with CI to avoid number collisions.

Live API UI tests are run locally rather than blocking releases on changing league fixtures. Run unit tests locally when appropriate for the change. Compare Actions job timings on a cold run and a subsequent warm-cache run before claiming an improved release time.

Signing credentials were configured on October 25, 2026. The CI distribution certificate and provisioning profile expire on October 26, 2027; renew both repository secrets before then.

## One-time credentials

Add these repository secrets in GitHub Settings → Secrets and variables → Actions:

| Secret | Value |
| --- | --- |
| `BASH_ASC_KEY_ID` | App Store Connect team API key ID |
| `BASH_ASC_ISSUER_ID` | API key issuer ID |
| `BASH_ASC_KEY_P8_BASE64` | Base64 of the downloaded API `.p8` key |
| `BASH_DISTRIBUTION_P12_BASE64` | Base64 of an Apple Distribution certificate exported with its private key as `.p12` |
| `BASH_DISTRIBUTION_P12_PASSWORD` | Nonempty password protecting that export |
| `BASH_APPSTORE_PROFILE_BASE64` | Base64 of an App Store distribution profile for `fan.bash.league`, team `8GJXSBZAF8`, using that certificate |

Use an App Manager API key with access to BASH Hockey (App Store Connect ID `6826919308`) so the workflow can assign builds to the existing internal group. Keep keys and signing files outside the repository. For file secrets, pipe directly into GitHub without printing the encoded value:

```sh
base64 -i /secure/path/AuthKey.p8 | gh secret set BASH_ASC_KEY_P8_BASE64 --repo rhotter/bash.fan
base64 -i /secure/path/distribution.p12 | gh secret set BASH_DISTRIBUTION_P12_BASE64 --repo rhotter/bash.fan
base64 -i /secure/path/BASH.mobileprovision | gh secret set BASH_APPSTORE_PROFILE_BASE64 --repo rhotter/bash.fan
```

Set the other three secrets with interactive `gh secret set NAME --repo rhotter/bash.fan`. Renew the distribution profile/certificate before expiration. No Apple ID session, app-specific password, or Xcode login is used by CI.

## Verify a deployment

Run the workflow from Actions or push an iOS change. Check its upload step and then confirm the new build is available in BASH Internal. A passing compile alone does not establish TestFlight availability. A failed credentials check means no upload was attempted.

Local invocation, after installing the signing profile and configuring the same environment variables plus `BASH_PROFILE_UUID`:

```sh
cd ios/BASH
bundle install
xcodegen generate
bundle exec fastlane ios beta
```
