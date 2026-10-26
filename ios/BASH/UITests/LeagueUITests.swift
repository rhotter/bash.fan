import XCTest

final class LeagueUITests: XCTestCase {
    @MainActor func testHeaderSeasonAlignment() throws {
        let app = XCUIApplication()
        app.launch()
        let season = app.buttons["seasonPicker"]
        XCTAssertTrue(season.waitForExistence(timeout: 15))
        let scoresY = season.frame.midY
        capture("Scores header")
        app.buttons["operatorMenu"].tap()
        XCTAssertTrue(app.buttons["Scorekeeper"].waitForExistence(timeout: 5))
        capture("Header menu")
        app.tap()
        for tab in ["Standings", "Stats"] {
            app.tabBars.buttons[tab].tap()
            XCTAssertTrue(season.waitForExistence(timeout: 10))
            XCTAssertEqual(season.frame.midY, scoresY, accuracy: 1)
            capture("\(tab) header")
        }
    }

    @MainActor func testReviewerScorekeeperCode() throws {
        try checkReviewerCode(tool: "Scorekeeper")
    }

    @MainActor func testReviewerRecorderCode() throws {
        try checkReviewerCode(tool: "Record game")
    }

    @MainActor private func checkReviewerCode(tool: String) throws {
        let app = XCUIApplication()
        app.launch()
        let menu = app.buttons["operatorMenu"].firstMatch
        XCTAssertTrue(menu.waitForExistence(timeout: 30))
        menu.tap()
        app.buttons[tool].tap()
        let passcode = app.secureTextFields["adminPasscode"]
        XCTAssertTrue(passcode.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Try demo"].exists)
        XCTAssertFalse(app.buttons["Continue"].isEnabled)
        capture("Reviewer - \(tool) passcode")
        passcode.tap()
        passcode.typeText("BASH-REVIEW-2026")
        app.buttons["Continue"].tap()
        let destination = tool == "Scorekeeper" ? app.buttons["recordGoal"] : app.buttons["Open camera"]
        XCTAssertTrue(destination.waitForExistence(timeout: 10))
        capture("Reviewer - \(tool) unlocked")
        app.buttons["Done"].firstMatch.tap()
        XCTAssertTrue(passcode.waitForExistence(timeout: 5))
        XCTAssertEqual(passcode.value as? String, "Admin passcode")
        app.buttons["Cancel"].tap()
        XCTAssertTrue(menu.waitForExistence(timeout: 5))
        app.terminate()
    }


    @MainActor func testAboutLinks() throws {
        let app = XCUIApplication()
        app.launch()
        let menu = app.buttons["operatorMenu"].firstMatch
        XCTAssertTrue(menu.waitForExistence(timeout: 30))
        menu.tap()
        XCTAssertFalse(app.buttons["Privacy policy"].exists)
        XCTAssertFalse(app.buttons["App support"].exists)
        capture("Game tools with About BASH")
        app.buttons["About BASH"].tap()
        XCTAssertTrue(app.navigationBars["About BASH"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Privacy policy"].exists)
        XCTAssertTrue(app.buttons["App support"].exists)
        capture("About BASH privacy and support")
        app.buttons["Done"].tap()
        XCTAssertTrue(menu.waitForExistence(timeout: 5))
    }

    @MainActor func testGoalieStatsSorting() throws {
        let app = XCUIApplication()
        app.launch()
        app.tabBars.buttons["Stats"].tap()
        app.buttons["Goalies"].tap()
        let player = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'player-'")).firstMatch
        XCTAssertTrue(player.waitForExistence(timeout: 30))
        XCTAssertTrue(app.buttons["statSort"].label.contains("Save percentage"))
        app.buttons["statSort"].tap()
        app.buttons["Goals against average"].tap()
        XCTAssertTrue(app.buttons["statSort"].label.contains("Goals against average"))
        capture("Goalie stats sorted by GAA")
    }

    @MainActor func testSwipeWeeksAndGameTabs() throws {
        let app = XCUIApplication()
        app.launch()
        let game = app.descendants(matching: .any)["game-g207"].firstMatch
        XCTAssertTrue(game.waitForExistence(timeout: 40))
        let weeks = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'week-'" )).allElementsBoundByIndex
        let index = try XCTUnwrap(weeks.firstIndex(where: { $0.isSelected }))
        XCTAssertGreaterThan(weeks.count, 1)
        let forward = index + 1 < weeks.count
        let next = weeks[forward ? index + 1 : index - 1]
        let start = app.coordinate(withNormalizedOffset: CGVector(dx: forward ? 0.85 : 0.15, dy: 0.55))
        let end = app.coordinate(withNormalizedOffset: CGVector(dx: forward ? 0.15 : 0.85, dy: 0.55))
        start.press(forDuration: 0.05, thenDragTo: end)
        XCTAssertTrue(next.isSelected)
        capture("Scores after swiping to another week")
        end.press(forDuration: 0.05, thenDragTo: start)
        XCTAssertTrue(weeks[index].isSelected)
        app.swipeUp()
        XCTAssertTrue(weeks[index].isSelected, "Vertical scrolling must not change weeks")
        app.swipeDown()
        XCTAssertTrue(game.isHittable)
        game.tap()
        XCTAssertTrue(app.buttons["gameTab-Summary"].waitForExistence(timeout: 25))
        let right = app.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.6))
        let left = app.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.6))
        right.press(forDuration: 0.05, thenDragTo: left)
        XCTAssertTrue(app.buttons["gameTab-Stats"].isSelected)
        XCTAssertTrue(app.segmentedControls["boxTeam"].waitForExistence(timeout: 10))
        capture("Game stats after swiping")
        left.press(forDuration: 0.05, thenDragTo: right)
        XCTAssertTrue(app.buttons["gameTab-Summary"].isSelected)
        XCTAssertTrue(app.tabBars.buttons["Scores"].isHittable)
        capture("Game summary after swiping back")
    }

    @MainActor func testScoresPullToRefreshPreservesWeek() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--slow-network"]
        app.launch()
        let game = app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier BEGINSWITH 'game-'")).firstMatch
        XCTAssertTrue(game.waitForExistence(timeout: 30))
        XCTAssertFalse(app.buttons["refreshScores"].exists)
        let originalY = game.frame.minY
        let selectedWeek = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'week-'"))
            .allElementsBoundByIndex.first(where: { $0.isSelected })
        XCTAssertNotNil(selectedWeek)
        let weekY = selectedWeek?.frame.minY ?? 0

        let list = app.collectionViews["scoresList"]
        list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.05))
            .press(forDuration: 0.1, thenDragTo: list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.83)),
                   withVelocity: XCUIGestureVelocity(rawValue: 300), thenHoldForDuration: 0.2)
        XCTAssertEqual(list.value as? String, "Refreshing")
        XCTAssertGreaterThan(game.frame.minY, originalY + 20)
        assertRefreshIndicator(in: list, app: app)
        capture("Scores while refreshing")
        let finished = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == 'Ready'"), object: list)
        XCTAssertEqual(XCTWaiter.wait(for: [finished], timeout: 20), .completed)
        XCTAssertEqual(selectedWeek?.frame.minY ?? 0, weekY, accuracy: 2)
        let settled = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in abs(game.frame.minY - originalY) < 2 }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [settled], timeout: 3), .completed)
        XCTAssertTrue(selectedWeek?.isSelected ?? false)
        capture("Scores after pull-to-refresh")
    }

    @MainActor func testRefreshStandingsAndStats() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--slow-network"]
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier BEGINSWITH 'game-'")).firstMatch.waitForExistence(timeout: 40))
        for (tab, identifier) in [("Standings", "standingsList"), ("Stats", "statsList")] {
            app.tabBars.buttons[tab].tap()
            let list = app.collectionViews[identifier]
            XCTAssertTrue(list.waitForExistence(timeout: 10))
            let season = app.buttons["seasonPicker"]
            let originalY = season.frame.minY
            list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4))
                .press(forDuration: 0.1,
                       thenDragTo: list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.95)),
                       withVelocity: XCUIGestureVelocity(rawValue: 300), thenHoldForDuration: 0.2)
            XCTAssertEqual(list.value as? String, "Refreshing")
            XCTAssertEqual(season.frame.minY, originalY, accuracy: 2, "The fixed header must not move during refresh")
            assertRefreshIndicator(in: list, app: app)
            capture("\(tab) while refreshing")
            let finished = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == 'Ready'"), object: list)
            XCTAssertEqual(XCTWaiter.wait(for: [finished], timeout: 20), .completed)
            let settled = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                abs(season.frame.minY - originalY) < 2
            }, object: nil)
            XCTAssertEqual(XCTWaiter.wait(for: [settled], timeout: 5), .completed)
            capture("\(tab) after pull-to-refresh")
        }
    }

    @MainActor private func assertRefreshIndicator(in list: XCUIElement, app: XCUIApplication) {
        let indicator = app.activityIndicators["refreshIndicator"]
        XCTAssertTrue(indicator.exists)
        guard indicator.exists else { return }
        XCTAssertEqual(indicator.frame.width, 20, accuracy: 1)
        XCTAssertEqual(indicator.frame.height, 20, accuracy: 1)
        XCTAssertEqual(indicator.frame.midX, list.frame.midX, accuracy: 1)
        XCTAssertEqual(indicator.frame.midY, list.frame.minY + 30, accuracy: 2)
    }

    @MainActor func testNativeScorekeeper() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--native-scorekeeper-preview"]
        app.launch()
        XCTAssertTrue(app.buttons["recordGoal"].waitForExistence(timeout: 10))
        XCTAssertEqual(app.webViews.count, 0)
        capture("Native scorekeeper")
        app.buttons["recordGoal"].tap()
        XCTAssertTrue(app.navigationBars["Record goal"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["saveScoringEvent"].isEnabled)
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Scorer'")).firstMatch.tap()
        app.buttons["Alex Lee"].tap()
        capture("Native goal entry")
        app.buttons["saveScoringEvent"].tap()
        XCTAssertTrue(app.staticTexts["Alex Lee"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Save"].exists)
        XCTAssertFalse(app.staticTexts["Saved"].exists)
        app.buttons["Game options"].tap()
        app.buttons["editRostersMenu"].tap()
        XCTAssertTrue(app.navigationBars["Rosters"].waitForExistence(timeout: 5))
        capture("Native attendance")
    }

    @MainActor func testGuidedScorekeeperSetupAndFinish() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--native-scorekeeper-preview", "--pregame"]
        app.launch()
        let next = app.buttons["setupContinue"]
        XCTAssertTrue(next.waitForExistence(timeout: 10))
        XCTAssertFalse(next.isEnabled)
        XCTAssertFalse(app.buttons["recordGoal"].exists)
        capture("Setup - away roster")
        app.buttons["Mark all present"].tap()
        next.tap()
        XCTAssertFalse(next.isEnabled)
        app.buttons["Mark all present"].tap()
        capture("Setup - home roster")
        next.tap()
        XCTAssertFalse(next.isEnabled)
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Seals' AND label CONTAINS 'Select goalie'")).firstMatch.tap()
        app.buttons["Sam Chen"].tap()
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Landsharks' AND label CONTAINS 'Select goalie'")).firstMatch.tap()
        app.buttons["Jamie Park"].tap()
        capture("Setup - ready for faceoff")
        XCTAssertTrue(next.isEnabled)
        next.tap()
        XCTAssertTrue(app.buttons["recordGoal"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["setupContinue"].exists)
        XCTAssertTrue(app.buttons["Start clock"].exists)
        capture("Live scoring - automatic sync")
        app.buttons["Game options"].tap()
        app.buttons["reviewGameMenu"].tap()
        XCTAssertTrue(app.buttons["finalizeGame"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Start clock"].exists)
        capture("Finish - review result")
        app.buttons["finalizeGame"].tap()
        app.buttons.matching(NSPredicate(format: "label == 'Finalize game'")).allElementsBoundByIndex.last!.tap()
        XCTAssertTrue(app.buttons["Edit final result"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["finalizeGame"].exists)
        capture("Final result")
        app.buttons["Edit final result"].tap()
        XCTAssertTrue(app.buttons["recordGoal"].waitForExistence(timeout: 5))
        app.buttons["Game options"].tap()
        app.buttons["reviewGameMenu"].tap()
        XCTAssertTrue(app.buttons["finalizeGame"].waitForExistence(timeout: 5))
        capture("Review final correction")
    }

    @MainActor func testPeriodEndGuidesTiedGameToOvertime() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--native-scorekeeper-preview", "--period-end"]
        app.launch()
        XCTAssertTrue(app.buttons["Start overtime"].waitForExistence(timeout: 10))
        capture("Period end - overtime prompt")
        app.buttons["Start overtime"].tap()
        XCTAssertTrue(app.staticTexts["Overtime"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["5:00"].exists)
    }

    @MainActor func testOperatorMenuRequiresPasscode() throws {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.buttons["operatorMenu"].waitForExistence(timeout: 15))
        XCTAssertEqual(app.tabBars.buttons.count, 3)
        app.buttons["operatorMenu"].tap()
        XCTAssertTrue(app.buttons["Scorekeeper"].exists)
        XCTAssertTrue(app.buttons["Record game"].exists)
        capture("Game tools menu")
        app.buttons["Record game"].tap()
        XCTAssertTrue(app.secureTextFields["adminPasscode"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Continue"].isEnabled)
        XCTAssertFalse(app.buttons["Open camera"].exists)
        capture("Record game passcode")
        app.buttons["Cancel"].tap()
        app.buttons["operatorMenu"].tap()
        app.buttons["Scorekeeper"].tap()
        XCTAssertTrue(app.secureTextFields["adminPasscode"].waitForExistence(timeout: 5))
        capture("Keep score passcode")
        app.secureTextFields["adminPasscode"].tap()
        app.secureTextFields["adminPasscode"].typeText("preview-only")
        XCTAssertTrue(app.buttons["Continue"].isEnabled)
        XCTAssertTrue(app.buttons["Continue"].isHittable)
        capture("Keep score continue button")
        app.buttons["Cancel"].tap()
        let game = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'game-'" )).firstMatch
        XCTAssertTrue(game.waitForExistence(timeout: 40))
        game.tap()
        XCTAssertTrue(app.buttons["operatorMenu"].waitForExistence(timeout: 10))
        app.buttons["operatorMenu"].tap()
        XCTAssertTrue(app.buttons["Share game"].exists)
        capture("Game detail tools")
    }

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
        let other = weeks.allElementsBoundByIndex.first(where: { !$0.isSelected && app.frame.contains($0.frame) })
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
        XCTAssertTrue(app.segmentedControls["careerCompetition"].waitForExistence(timeout: 25))
        XCTAssertTrue(app.staticTexts["Game log"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["player-log-g205"].exists)
        XCTAssertFalse(app.staticTexts["Swipe for more stats"].exists)
        capture("Player history")
        XCTAssertFalse(app.buttons["playerSeasonPicker"].exists)
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
        let log = app.buttons["player-log-g205"]
        for _ in 0..<5 where !log.isHittable { app.swipeUp() }
        XCTAssertTrue(log.isHittable)
        log.tap()
        XCTAssertTrue(app.buttons["gameTab-Summary"].waitForExistence(timeout: 25))
        XCTAssertTrue(app.staticTexts["Scoring by period"].waitForExistence(timeout: 25))
        capture("Game opened from player log")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.staticTexts["Game log"].waitForExistence(timeout: 10))
        app.swipeDown()
        app.buttons["Playoffs"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["player-log-g205"].exists)
        XCTAssertFalse(app.staticTexts["Games played"].exists)
        capture("Player playoff history with combined game log")
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
    @MainActor func testGameStarsAndScoringLogos() throws {
        let app = XCUIApplication()
        app.launch()
        let game = app.descendants(matching: .any)["game-g207"].firstMatch
        XCTAssertTrue(game.waitForExistence(timeout: 40))
        game.tap()
        XCTAssertTrue(app.staticTexts["Scoring by period"].waitForExistence(timeout: 25))
        capture("Team logos in period totals")
        let star = app.descendants(matching: .any)["game-star-1"].firstMatch
        for _ in 0..<5 {
            if star.isHittable { break }
            app.swipeUp()
        }
        XCTAssertTrue(star.isHittable)
        XCTAssertTrue(star.label.contains("PTS") || star.label.contains("SV%"))
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.76))
            .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.46)))
        capture("Three stars with team logos and game stats")
        app.swipeUp()
        capture("Team logos in scoring summary")
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
        XCTAssertTrue(app.tabBars.buttons["Scores"].isHittable)
        XCTAssertTrue(app.tabBars.buttons["Stats"].isHittable)
        capture("Game summary")
        app.buttons["gameTab-Stats"].tap()
        XCTAssertTrue(app.segmentedControls["boxTeam"].waitForExistence(timeout: 5))
        app.segmentedControls["boxTeam"].buttons["Landsharks"].tap()
        XCTAssertTrue(app.staticTexts["Nicolas Peterson"].exists)
        capture("Game skater stats")
        app.staticTexts["Nicolas Peterson"].tap()
        XCTAssertTrue(app.segmentedControls["careerCompetition"].waitForExistence(timeout: 25))
        XCTAssertTrue(app.tabBars.buttons["Standings"].isHittable)
        capture("Player with tab bar")
        app.navigationBars.buttons.firstMatch.tap()
        XCTAssertFalse(app.segmentedControls["gameStatType"].exists)
        let goalie = app.staticTexts["Eric Crawford"]
        for _ in 0..<6 {
            if goalie.isHittable { break }
            app.swipeUp()
        }
        XCTAssertTrue(goalie.isHittable)
        capture("Skaters and goalies")
        // The entire goalie breakdown is visible without expanding a disclosure.
        XCTAssertTrue(app.staticTexts["SV%"].isHittable)
        XCTAssertTrue(app.staticTexts["SA"].isHittable)
        XCTAssertTrue(app.staticTexts["GA"].isHittable)
        XCTAssertTrue(app.staticTexts["TOI"].isHittable)
        XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'goalie-stats-'")).firstMatch.isHittable)
        capture("Game goalie stats")
        app.buttons["gameTab-Summary"].tap()
        let firstGoal = app.staticTexts["Samuel Dobbs"]
        for _ in 0..<5 {
            if firstGoal.isHittable { break }
            app.swipeUp()
        }
        XCTAssertTrue(firstGoal.isHittable)
        capture("Scoring summary")
        let penalty = app.staticTexts["Tripping · 2 min"]
        for _ in 0..<5 {
            if penalty.isHittable { break }
            app.swipeUp()
        }
        XCTAssertTrue(app.staticTexts["Tripping · 2 min"].exists)
        XCTAssertTrue(app.staticTexts["No penalties"].firstMatch.exists)
        capture("Penalty summary")
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
