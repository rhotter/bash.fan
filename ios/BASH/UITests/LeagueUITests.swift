import XCTest

final class LeagueUITests: XCTestCase {
    @MainActor func testLiveLeagueNavigation() throws {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["Scores"].waitForExistence(timeout: 15))
        XCTAssertFalse(app.tabBars.buttons["Following"].exists)
        XCTAssertFalse(app.buttons["Results"].exists)
        XCTAssertFalse(app.buttons["My teams"].exists)
        // Exercise the actual API-backed screens, not bundled demo data.
        XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'game-'")).firstMatch.waitForExistence(timeout: 40))
        let weeks = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'week-'"))
        let selected = weeks.allElementsBoundByIndex.first(where: { $0.isSelected })
        XCTAssertNotNil(selected)
        let originalID = selected?.identifier ?? ""
        let other = weeks.allElementsBoundByIndex.first(where: { !$0.isSelected && $0.isHittable })
        XCTAssertNotNil(other)
        other?.tap()
        XCTAssertTrue(other?.isSelected ?? false)
        capture("Another week")
        app.buttons[originalID].tap()
        XCTAssertTrue(app.buttons[originalID].isSelected)
        capture("Scores")
        app.tabBars.buttons["Standings"].tap()
        XCTAssertTrue(app.staticTexts["PTS"].firstMatch.waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["seasonPicker"].exists)
        app.buttons["seasonPicker"].tap()
        XCTAssertTrue(app.buttons["Current season"].waitForExistence(timeout: 5))
        app.buttons["Current season"].tap()
        capture("Standings")
        app.tabBars.buttons["Stats"].tap()
        XCTAssertTrue(app.buttons["statSort"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.searchFields["playerSearch"].exists)
        app.buttons["statSort"].tap()
        app.buttons["Goals"].tap()
        XCTAssertEqual(app.buttons["statSort"].label, "Sort by: Goals")
        XCTAssertTrue(app.buttons["seasonPicker"].exists)
        app.buttons["seasonPicker"].tap()
        XCTAssertTrue(app.buttons["Current season"].waitForExistence(timeout: 5))
        app.buttons["Current season"].tap()
        XCTAssertTrue(app.buttons["teamFilter"].exists)
        app.buttons["teamFilter"].tap()
        app.buttons["Yetis"].tap()
        XCTAssertEqual(app.buttons["teamFilter"].label, "Team: Yetis")
        capture("Stats")
        app.staticTexts["Nicholas Koelzer"].tap()
        XCTAssertTrue(app.staticTexts["Season history"].waitForExistence(timeout: 25))
        XCTAssertTrue(app.staticTexts["Game log"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["player-log-g205"].exists)
        XCTAssertFalse(app.staticTexts["Swipe for more stats"].exists)
        capture("Player history")
        XCTAssertTrue(app.buttons["playerSeasonPicker"].exists)
        app.buttons["playerSeasonPicker"].tap()
        app.buttons["Summer 2026 · Dolo Minions"].tap()
        capture("Selected season")
        app.buttons["Playoffs"].tap()
        XCTAssertTrue(app.staticTexts["Summer 2026"].waitForExistence(timeout: 5))
        capture("Player playoffs")
        app.navigationBars.buttons.firstMatch.tap()
        XCTAssertTrue(app.searchFields["playerSearch"].waitForExistence(timeout: 5))
        app.searchFields["playerSearch"].tap()
        app.searchFields["playerSearch"].typeText("Yetis")
        XCTAssertTrue(app.staticTexts["No matching players"].waitForExistence(timeout: 5))

    }
    @MainActor func testAllTimeStats() throws {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["Stats"].waitForExistence(timeout: 15))
        app.tabBars.buttons["Stats"].tap()
        XCTAssertTrue(app.buttons["seasonPicker"].waitForExistence(timeout: 10))
        app.buttons["seasonPicker"].tap()
        app.buttons["All time"].tap()
        XCTAssertFalse(app.buttons["allTimeSeasonType"].exists)
        XCTAssertFalse(app.buttons["allTimeGameType"].exists)
        XCTAssertFalse(app.buttons["teamFilter"].exists)
        XCTAssertTrue(app.staticTexts["Matt Zilinskas"].waitForExistence(timeout: 30))
        capture("All time stats")
        app.tabBars.buttons["Scores"].tap()
        XCTAssertFalse(app.buttons["seasonPicker"].label.contains("All time"))
        app.tabBars.buttons["Stats"].tap()
        app.buttons["seasonPicker"].tap()
        app.buttons["Current season"].tap()
        XCTAssertTrue(app.buttons["teamFilter"].waitForExistence(timeout: 10))
    }
    @MainActor func testCurrentSeasonPlayerLog() throws {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["Stats"].waitForExistence(timeout: 15))
        app.tabBars.buttons["Stats"].tap()
        XCTAssertTrue(app.staticTexts["Nicholas Koelzer"].waitForExistence(timeout: 30))
        let name = app.staticTexts["Nicholas Koelzer"]
        // Tap the blank space between the name and the right-aligned metric.
        app.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: app.frame.width * 0.8, dy: name.frame.midY)).tap()
        XCTAssertTrue(app.staticTexts["Game log"].waitForExistence(timeout: 25))
        XCTAssertTrue(app.descendants(matching: .any)["player-log-g205"].exists)
        XCTAssertFalse(app.staticTexts["Swipe for more stats"].exists)
        capture("Player game log")
        app.buttons["Playoffs"].tap()
        XCTAssertTrue(app.staticTexts["No playoff games recorded this season."].exists)
        XCTAssertFalse(app.descendants(matching: .any)["player-log-g205"].exists)
    }
    @MainActor func testTeamGameRowLayout() throws {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["Standings"].waitForExistence(timeout: 15))
        app.tabBars.buttons["Standings"].tap()
        XCTAssertTrue(app.staticTexts["Yetis"].firstMatch.waitForExistence(timeout: 30))
        app.staticTexts["Yetis"].firstMatch.tap()
        XCTAssertTrue(app.navigationBars["Yetis"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["Season record"].exists)
        capture("Team game arrows")
        let game = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'game-'")).allElementsBoundByIndex.first { $0.isHittable && $0.frame.midY > 150 && $0.frame.midY < 650 }
        XCTAssertNotNil(game)
        game?.tap()
        XCTAssertTrue(app.buttons["gameTab-Summary"].waitForExistence(timeout: 10))
    }
    @MainActor func testNativeGameBoxScore() throws {
        let app = XCUIApplication()
        app.launch()
        let game = app.descendants(matching: .any)["game-g207"].firstMatch
        XCTAssertTrue(game.waitForExistence(timeout: 40))
        game.tap()
        XCTAssertTrue(app.staticTexts["Scoring by period"].waitForExistence(timeout: 25))
        XCTAssertFalse(app.staticTexts["Goals / shots"].exists)
        XCTAssertTrue(app.staticTexts["Shots on goal"].exists)
        XCTAssertFalse(app.buttons["gameTab-Plays"].exists)
        capture("Game summary")
        app.buttons["gameTab-Stats"].tap()
        XCTAssertTrue(app.segmentedControls["boxTeam"].waitForExistence(timeout: 5))
        app.segmentedControls["boxTeam"].buttons["Landsharks"].tap()
        XCTAssertTrue(app.staticTexts["Nicolas Peterson"].exists)
        capture("Game skater stats")
        app.staticTexts["Nicolas Peterson"].tap()
        XCTAssertTrue(app.staticTexts["Season history"].waitForExistence(timeout: 25))
        app.navigationBars.buttons.firstMatch.tap()
        XCTAssertFalse(app.segmentedControls["gameStatType"].exists)
        let goalie = app.staticTexts["Eric Crawford"]
        for _ in 0..<6 {
            if goalie.isHittable { break }
            app.swipeUp()
        }
        XCTAssertTrue(goalie.isHittable)
        capture("Skaters and goalies")
        app.staticTexts["Eric Crawford"].tap()
        app.swipeUp()
        XCTAssertTrue(app.staticTexts["Save percentage"].waitForExistence(timeout: 5))
        capture("Game goalie stats")
        app.buttons["gameTab-Summary"].tap()
        let firstGoal = app.staticTexts["Goal · Samuel Dobbs"]
        for _ in 0..<5 {
            if firstGoal.isHittable { break }
            app.swipeUp()
        }
        XCTAssertTrue(firstGoal.isHittable)
        XCTAssertTrue(app.staticTexts["Tripping · 2 min"].exists)
        capture("Game plays")
        app.navigationBars.buttons.firstMatch.tap()
        XCTAssertTrue(app.tabBars.buttons["Scores"].waitForExistence(timeout: 5))

    }
    @MainActor func testLoadingStatesOnSlowConnection() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--slow-network"]
        app.launch()
        let placeholder = app.descendants(matching: .any)["loadingPlaceholder"].firstMatch
        XCTAssertTrue(placeholder.waitForExistence(timeout: 5))
        capture("Loading scores")
        let game = app.descendants(matching: .any)["game-g207"].firstMatch
        XCTAssertTrue(game.waitForExistence(timeout: 25))
        game.tap()
        XCTAssertTrue(placeholder.waitForExistence(timeout: 3))
        XCTAssertFalse(app.staticTexts["No play-by-play"].exists)
        capture("Loading game")
        XCTAssertTrue(app.staticTexts["Scoring by period"].waitForExistence(timeout: 25))
        XCTAssertFalse(placeholder.exists)
        capture("Loaded game")
    }
    @MainActor private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
