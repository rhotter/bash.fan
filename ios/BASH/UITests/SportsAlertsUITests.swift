import XCTest

final class SportsAlertsUITests: XCTestCase {
    @MainActor func testNativeSportsLayouts() {
        let app = XCUIApplication()
        app.launchArguments = ["--sports-preview"]
        app.launch()
        XCTAssertTrue(app.staticTexts["Lock Screen live score"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["Expanded goal alert"].exists)
        XCTAssertTrue(app.staticTexts["Landsharks goal!"].exists)
        XCTAssertTrue(app.staticTexts["Assists: Player A, Player B"].firstMatch.exists)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Native Live Activity and expanded goal alert"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}
