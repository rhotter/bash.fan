# Automatic TestFlight deployments

The BASH TestFlight GitHub Actions workflow runs for iOS app changes pushed to `main` or `video`, and supports manual runs. Website-only changes do not deploy the app. It regenerates the Xcode project, runs unit tests, archives, uploads, waits for Apple processing, and distributes to **BASH Internal**. Live API UI tests are run locally rather than blocking releases on changing league fixtures.

To reduce release time, CI caches Swift package sources and compiles the unit tests while the simulator boots. It then runs those compiled tests before archiving and uploading. All unit tests remain required; app and test binaries are rebuilt for each revision.

Build numbers are the greater of the next TestFlight build and `CURRENT_PROJECT_VERSION` in `project.yml`. Uploads are serialized across branches. GitHub may replace an older pending run with a newer push; the running upload is never canceled.

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
