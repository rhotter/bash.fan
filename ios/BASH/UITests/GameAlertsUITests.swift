import XCTest

final class GameAlertsUITests: XCTestCase {
    @MainActor func testNotificationOpensRegularGamePage() {
        let app = XCUIApplication()
        app.launchArguments = ["-completedAlertOnboarding", "YES", "-pendingGame", "g208"]
        app.launch()
        XCTAssertTrue(app.buttons["gameTab-Summary"].waitForExistence(timeout: 30))
        XCTAssertTrue(app.tabBars.buttons["Scores"].isHittable)
        XCTAssertTrue(app.tabBars.buttons["Scores"].isSelected)
        XCTAssertFalse(app.buttons["Done"].exists)
        XCTAssertTrue(app.buttons["gameTab-Stats"].exists)
        XCTAssertTrue(app.staticTexts["Scoring by period"].firstMatch.waitForExistence(timeout: 30))
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Notification opens regular game page"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        app.navigationBars.buttons.firstMatch.tap()
        XCTAssertTrue(app.buttons["seasonPicker"].waitForExistence(timeout: 5))
    }

    @MainActor func testAlertOnboarding() {
        let app = XCUIApplication()
        app.launchArguments = ["-completedAlertOnboarding", "NO", "-pushTeams", "()", "-pushGames", "()"]
        app.launch()
        XCTAssertTrue(app.staticTexts["Which alerts do you want?"].waitForExistence(timeout: 40))
        XCTAssertTrue(app.switches["alertKind-goal"].exists)
        XCTAssertTrue(app.switches["alertKind-start"].exists)
        XCTAssertTrue(app.switches["alertKind-final"].exists)
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'alertTeam-'")).firstMatch.waitForExistence(timeout: 20))
        XCTAssertFalse(app.buttons["alertTeam-tbd"].exists)
        XCTAssertFalse(app.staticTexts["(TBD)"].exists)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Alert onboarding"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        app.buttons["Not now"].tap()
        XCTAssertTrue(app.tabBars.buttons["Scores"].waitForExistence(timeout: 10))
        app.terminate()
        app.launchArguments = []
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["Scores"].waitForExistence(timeout: 15))
        XCTAssertFalse(app.staticTexts["Which alerts do you want?"].exists)
    }

    @MainActor func testOnboardingSavesAlertTypes() {
        let app = XCUIApplication()
        app.launchArguments = ["-completedAlertOnboarding", "NO", "-pushTeams", "()", "-pushGames", "()"]
        app.launch()
        XCTAssertTrue(app.staticTexts["Which alerts do you want?"].waitForExistence(timeout: 40))
        for kind in ["goal", "start", "final"] {
            let toggle = app.switches["alertKind-\(kind)"]
            if toggle.value as? String == "1" {
                toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
            }
        }
        app.buttons["Continue"].tap()
        XCTAssertTrue(app.tabBars.buttons["Scores"].waitForExistence(timeout: 10))
        app.terminate()
        app.launchArguments = []
        app.launch()
        let menu = app.buttons["operatorMenu"].firstMatch
        XCTAssertTrue(menu.waitForExistence(timeout: 30))
        XCTAssertFalse(app.staticTexts["Which alerts do you want?"].exists)
        menu.tap()
        app.buttons["Game alerts"].tap()
        for kind in ["goal", "start", "final"] {
            let toggle = app.switches["alertKind-\(kind)"]
            XCTAssertTrue(toggle.waitForExistence(timeout: 10))
            XCTAssertEqual(toggle.value as? String, "0")
        }
    }

    @MainActor func testAlertSwitchContrast() {
        let app = XCUIApplication()
        app.launchArguments = ["-completedAlertOnboarding", "YES"]
        app.launch()
        let menu = app.buttons["operatorMenu"].firstMatch
        XCTAssertTrue(menu.waitForExistence(timeout: 30))
        menu.tap()
        app.buttons["Game alerts"].tap()
        let goals = app.switches["alertKind-goal"]
        XCTAssertTrue(goals.waitForExistence(timeout: 10))
        for enabled in [true, false] {
            if (goals.value as? String == "1") != enabled {
                goals.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
            }
            XCTAssertEqual(goals.value as? String, enabled ? "1" : "0")
            let screenshot = XCTAttachment(screenshot: app.screenshot())
            screenshot.name = "Alerts-\(enabled ? "on" : "off")"
            screenshot.lifetime = .keepAlways
            add(screenshot)
        }
        // Discard local changes without saving notification preferences.
        app.terminate()
    }

    @MainActor func testAlertsMenuAndTeams() {
        let app = XCUIApplication()
        app.launchArguments = ["-completedAlertOnboarding", "YES", "-pushTeams", "(tbd,seed-1,retired-team)"]
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
        XCTAssertFalse(app.buttons["alertTeam-tbd"].exists)
        XCTAssertFalse(app.buttons["alertTeam-seed-1"].exists)
        XCTAssertFalse(app.buttons["alertTeam-retired-team"].exists)
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
