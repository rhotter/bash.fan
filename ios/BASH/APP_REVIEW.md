# App Review access

In App Store Connect, provide the following code and instructions in App Review Information before submitting this build. This file does not update App Store Connect automatically.

**Passcode:** `BASH-REVIEW-2026`

Scores, standings, stats, and player/game details are available without signing in. To review operator tools, open the three-dot menu on Scores or a game, choose **Scorekeeper** or **Record game**, enter the passcode above, and tap **Continue**. Use the same code for both tools; no username is needed.

- Scorekeeper opens sample players and a sample game. Scoring, penalties, roster changes, saving, and finalizing operate locally and never change league records. The sample resets when reopened.
- Record game opens the camera settings and local recorder. Camera/microphone permission and a physical iPhone with a rear ultra-wide camera are required to record. Rotate with the volume buttons facing up. Clips can be played in the recorder or managed in Files → BASH → Recordings. Review recordings never stream, upload, or send telemetry.
- Tap Done to leave either sample tool, then Cancel to return to league browsing. The code is not saved.

This code is a bundled, non-secret entry point to sample data, not an admin credential. It works in Release builds without authentication requests. Other passcodes continue through the existing server authentication. The reviewer code cannot grant access to live league mutations or the production recording service.

Review notes must disclose the local-only recording behavior; this path does not exercise live streaming or server uploads. If Apple needs to test those services, provide separate restricted backend access. No public “Try demo” controls are needed.
