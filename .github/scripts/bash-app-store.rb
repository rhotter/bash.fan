require "spaceship"
require "json"
require "base64"

request = JSON.parse(File.read(File.expand_path("../app-store-release.json", __dir__)))
abort "Unsupported action" unless request.fetch("action") == "inspect"

Spaceship::ConnectAPI.token = Spaceship::ConnectAPI::Token.create(
  key_id: ENV.fetch("ASC_KEY_ID"), issuer_id: ENV.fetch("ASC_ISSUER_ID"),
  key: Base64.strict_decode64(ENV.fetch("ASC_KEY_P8_BASE64")), in_house: false
)
app = Spaceship::ConnectAPI::App.find("fan.bash.league")
abort "Unexpected app" unless app&.id == "6826919308"
versions = app.get_app_store_versions(filter: { platform: "IOS" }, includes: "build,appStoreVersionLocalizations,appStoreReviewDetail")
builds = Spaceship::ConnectAPI::Build.all(app_id: app.id, version: request.fetch("version"), build_number: request.fetch("build"), platform: "IOS")
summary = {
  app: app.name, app_id: app.id,
  builds: builds.map { |b| { id: b.id, version: b.app_version, build: b.version, processing: b.processing_state, encryption: b.uses_non_exempt_encryption } },
  versions: versions.map do |v|
    detail = v.app_store_review_detail
    { id: v.id, version: v.version_string, state: v.app_store_state, version_state: v.app_version_state, release_type: v.release_type,
      build: v.build&.version, review_contact_present: !detail&.contact_email.to_s.empty?, review_notes_present: !detail&.notes.to_s.empty?,
      localizations: (v.app_store_version_localizations || []).map { |l| { locale: l.locale, whats_new: l.whats_new } } }
  end
}
puts JSON.pretty_generate(summary)
File.open(ENV.fetch("GITHUB_STEP_SUMMARY"), "a") { |f| f.puts("```json\n#{JSON.pretty_generate(summary)}\n```") }
