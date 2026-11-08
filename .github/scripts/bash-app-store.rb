require "spaceship"
require "json"
require "base64"

request = JSON.parse(File.read(File.expand_path("../app-store-release.json", __dir__)))
abort "Unsupported action" unless %w[inspect submit].include?(request.fetch("action"))

Spaceship::ConnectAPI.token = Spaceship::ConnectAPI::Token.create(
  key_id: ENV.fetch("ASC_KEY_ID"), issuer_id: ENV.fetch("ASC_ISSUER_ID"),
  key: Base64.strict_decode64(ENV.fetch("ASC_KEY_P8_BASE64")), in_house: false
)
app = Spaceship::ConnectAPI::App.find("fan.bash.league")
abort "Unexpected app" unless app&.id == "6826919308"
versions = app.get_app_store_versions(filter: { platform: "IOS" }, includes: "build,appStoreVersionLocalizations,appStoreReviewDetail")
builds = Spaceship::ConnectAPI::Build.all(app_id: app.id, version: request.fetch("version"), build_number: request.fetch("build"), platform: "IOS")

def refresh_version(id)
  Spaceship::ConnectAPI::AppStoreVersion.get(app_store_version_id: id, includes: "build,appStoreVersionLocalizations,appStoreReviewDetail")
end

if request.fetch("action") == "submit"
  abort "Expected exactly one processed build" unless builds.length == 1 && builds.first.processing_state == "VALID"
  build = builds.first
  source = versions.find { |v| v.version_string == request.fetch("source_version") }
  abort "Approved source version is missing" unless source && source.app_version_state == "READY_FOR_DISTRIBUTION"
  abort "Release preference changed" unless source.release_type == request.fetch("expected_release_type")
  target = versions.find { |v| v.version_string == request.fetch("version") }
  accepted_states = %w[WAITING_FOR_REVIEW IN_REVIEW PENDING_APPLE_RELEASE PENDING_DEVELOPER_RELEASE PROCESSING_FOR_DISTRIBUTION READY_FOR_DISTRIBUTION]
  if target && accepted_states.include?(target.app_version_state)
    abort "Submitted version has a different build" unless target.build&.id == build.id
    puts "Already submitted #{target.version_string} (#{build.version}): #{target.app_version_state}"
    exit 0
  end
  abort "Another review is in progress" if app.get_in_progress_review_submission(platform: "IOS")
  submission = app.get_ready_review_submission(platform: "IOS")
  items = submission ? Spaceship::ConnectAPI::ReviewSubmissionItem.all(review_submission_id: submission.id, includes: "appStoreVersion") : []
  abort "An unrelated review draft exists" unless items.empty? || (target && items.all? { |i| i.app_store_version&.id == target.id })

  unless target
    editable = versions.select { |v| %w[PREPARE_FOR_SUBMISSION DEVELOPER_REJECTED REJECTED METADATA_REJECTED READY_FOR_REVIEW].include?(v.app_version_state) }
    abort "An unrelated app version draft exists" unless editable.empty?
    target = Spaceship::ConnectAPI.post_app_store_version(app_id: app.id, attributes: {
      versionString: request.fetch("version"), platform: "IOS", releaseType: source.release_type
    }).to_models.first
  end
  target = refresh_version(target.id)
  abort "Version cannot be edited" unless %w[PREPARE_FOR_SUBMISSION READY_FOR_REVIEW].include?(target.app_version_state)

  unless target.app_version_state == "READY_FOR_REVIEW"
    target.update(attributes: { releaseType: source.release_type, copyright: source.copyright }.compact)
    source_localizations = source.get_app_store_version_localizations
    localizations = target.get_app_store_version_localizations
    abort "Unexpected localization; supply translated release notes first" unless source_localizations.map(&:locale) == ["en-US"]
    source_localizations.each do |previous|
      localization = localizations.find { |l| l.locale == previous.locale }
      attributes = {
        description: previous.description, keywords: previous.keywords, marketing_url: previous.marketing_url,
        promotional_text: previous.promotional_text, support_url: previous.support_url,
        whats_new: request.fetch("release_notes")
      }.compact
      if localization
        localization.update(attributes: attributes)
      else
        mapped = Spaceship::ConnectAPI::AppStoreVersionLocalization.reverse_attr_mapping(attributes.merge(locale: previous.locale))
        target.create_app_store_version_localization(attributes: mapped)
      end
    end

    previous_detail = source.app_store_review_detail
    abort "Approved reviewer information is incomplete" unless previous_detail && !previous_detail.contact_email.to_s.empty?
    fields = %i[contact_first_name contact_last_name contact_phone contact_email demo_account_name demo_account_password demo_account_required notes]
    review_attributes = fields.to_h { |field| [field, previous_detail.public_send(field)] }.compact
    unless review_attributes[:notes].to_s.include?("BASH-REVIEW-2026")
      review_attributes[:notes] = [review_attributes[:notes], File.read(File.expand_path("../../ios/BASH/APP_REVIEW.md", __dir__))].compact.join("\n\n")
    end
    abort "Reviewer notes exceed Apple's limit" if review_attributes[:notes].to_s.length > 4000
    if target.app_store_review_detail
      target.app_store_review_detail.update(attributes: review_attributes)
    else
      target.create_app_store_review_detail(attributes: review_attributes)
    end
    target.select_build(build_id: build.id)
  end

  target = refresh_version(target.id)
  abort "Selected build differs from request" unless target.build&.id == build.id
  locales = target.get_app_store_version_localizations
  screenshot_count = locales.sum { |l| l.get_app_screenshot_sets.sum { |set| (set.app_screenshots || []).length } }
  abort "Inherited App Store screenshots are missing" if screenshot_count.zero?
  submission ||= app.create_review_submission(platform: "IOS")
  submission.add_app_store_version_to_review_items(app_store_version_id: target.id) if items.empty?
  10.times do
    target = refresh_version(target.id)
    break if target.app_version_state == "READY_FOR_REVIEW"
    sleep 5
  end
  abort "App version did not become ready for review" unless target.app_version_state == "READY_FOR_REVIEW"
  submission.submit_for_review
  10.times do
    submission = Spaceship::ConnectAPI::ReviewSubmission.get(review_submission_id: submission.id)
    break if %w[WAITING_FOR_REVIEW IN_REVIEW COMPLETE].include?(submission.state)
    sleep 5
  end
  abort "Apple has not confirmed submission" unless %w[WAITING_FOR_REVIEW IN_REVIEW COMPLETE].include?(submission.state)
  target = refresh_version(target.id)
  confirmation = {
    app: app.name, app_id: app.id, version: target.version_string, build: build.version,
    version_id: target.id, version_state: target.app_version_state,
    submission_id: submission.id, submission_state: submission.state,
    release_type: target.release_type, screenshots: screenshot_count, release_notes: request.fetch("release_notes")
  }
  puts JSON.pretty_generate(confirmation)
  File.open(ENV.fetch("GITHUB_STEP_SUMMARY"), "a") { |f| f.puts("```json\n#{JSON.pretty_generate(confirmation)}\n```") }
  exit 0
end

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
