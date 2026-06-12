# 2026 U.S. Open Pick Scoreboard

Static scoreboard site built for GitHub Pages. No build step, no backend, and all pool data lives in JSON files that are easy to edit.

## What it does

- Shows a pool standings table for your U.S. Open picks
- Shows drafted golfers on a Shinnecock-themed leaderboard
- Calculates pool standings using the best 4 golfers when nobody drafted the U.S. Open winner
- Automatically gives the pool win to any entry that drafted the actual U.S. Open champion
- Lets you import CSV or pasted leaderboard updates in the browser during tournament week
- Can publish refreshed shared data files for GitHub Pages

## Files to edit

- `data/picks.json`: your pool participants and their golfer selections
- `data/leaderboard.json`: current tournament leaderboard
- `data/leaderboard.js`: browser-ready copy of the current tournament leaderboard
- `data/config.json`: event title, dates, venue, and scoring rules

## GitHub Pages setup

1. Create a new GitHub repository.
2. Upload the contents of this folder to the repository root.
3. In GitHub, open `Settings` -> `Pages`.
4. Set the source to `Deploy from a branch`.
5. Choose your main branch and `/ (root)`.
6. Save, then wait for the Pages URL to publish.

## Live update workflow

1. Open the site on desktop.
2. Click `Update Data`.
3. Import a CSV or paste leaderboard rows.
4. Click `Publish data files`.
5. Save over:
   - `data/leaderboard.json`
   - `data/leaderboard.js`
6. Run:

```powershell
.\publish-scoreboard.ps1
```

That stages the two leaderboard files, creates a commit, and pushes to your current Git branch.

For a simpler Windows shortcut, you can also double-click:

```text
publish-scoreboard.bat
```

## CSV format

The importer recognizes `PLAYER` plus any of these columns:

- `TEE TIME`
- `POS`
- `TO PAR`
- `TODAY`
- `THRU`
- `STATUS`

Example:

```csv
PLAYER,TEE TIME,POS,TO PAR,TODAY,THRU,STATUS
Scottie Scheffler,8:02 AM,1,-5,-2,F,Final
Rory McIlroy,1:47 PM,T2,-4,-1,F,Final
```

## Leaderboard JSON format

```json
{
  "lastUpdated": "June 12, 2026 at 9:00 AM CT",
  "players": [
    {
      "name": "Scottie Scheffler",
      "position": "1",
      "toPar": "-5",
      "today": "-2",
      "thru": "F",
      "teeTime": "8:02 AM",
      "status": "Round 1",
      "madeCut": true,
      "isChampion": false
    }
  ]
}
```

## Notes

- The included leaderboard is set to a clean pre-tournament state.
- The official 2026 U.S. Open tournament dates are June 18-21, 2026.
- The 2026 championship is scheduled for Shinnecock Hills Golf Club in Southampton, New York.
- If you want live automatic scoring from a data feed later, we can add a lightweight backend or GitHub Action next.
