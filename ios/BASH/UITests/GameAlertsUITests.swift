import XCTest

final class GameAlertsUITests: XCTestCase {
    @MainActor func testAlertsMenuAndTeams() {
        let app = XCUIApplication()
        app.launch()
        let menu = app.buttons["operatorMenu"].firstMatch
        XCTAssertTrue(menu.waitForExistence(timeout: 30))
        menu.tap()
        app.buttons["Game alerts"].tap()
        XCTAssertTrue(app.navigationBars["Game alerts"].waitForExistence(timeout: 10))
        let goals = app.switches["alertKind-goal"]
        XCTAssertTrue(goals.exists)
        XCTAssertTrue(app.switches["alertKind-start"].exists)
        XCTAssertTrue(app.switches["alertKind-final"].exists)
        let originalGoals = goals.value as? String
        goals.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        XCTAssertNotEqual(goals.value as? String, originalGoals)
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "value == 'Not following'")).firstMatch.waitForExistence(timeout: 20))
        let team = app.buttons.matching(NSPredicate(format: "value == 'Not following'")).firstMatch
        let teamLabel = team.label
        team.tap()
        let selectedTeam = app.buttons[teamLabel].firstMatch
        XCTAssertEqual(selectedTeam.value as? String, "Following")
        XCTAssertTrue(selectedTeam.isEnabled)
        XCTAssertFalse(app.progressIndicators.firstMatch.exists)
        XCTAssertFalse(XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.firstMatch.exists)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "BASH Game alerts team preferences"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        goals.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        XCTAssertEqual(goals.value as? String, originalGoals)
        selectedTeam.tap()
        XCTAssertEqual(selectedTeam.value as? String, "Not following")
        app.buttons["Done"].tap()
        XCTAssertTrue(app.tabBars.buttons["Scores"].isHittable)
    }
}
