# Rulebook Changelog Template

To add a new rulebook update, prepend a new entry object to the top of `public/rulebooks/changelog.json` (newest first).

The first entry in the array is shown as the latest revision in the **Rule Changelog** panel on `/rulebook`. All subsequent entries are automatically grouped under **Previous revisions (N)**.

## Standardized Entry Template

```json
{
  "version": "vYYYY.MM",
  "title": "Short Descriptive Title (e.g., 2027–2028 Rule Changes)",
  "date": "YYYY-MM-DD",
  "items": [
    {
      "ruleRef": "Rule 621(b)",
      "ruleAnchor": "rule-621-b",
      "text": "Clear summary of what changed in this rule.",
      "links": [
        {
          "label": "Optional external reference label",
          "url": "https://example.com/reference.pdf"
        }
      ]
    },
    {
      "ruleRef": "General",
      "text": "Optional general update that does not map to a single rule."
    }
  ]
}
```

## Field Reference

| Field | Required | Format / Notes |
| --- | --- | --- |
| `version` | Yes | `vYYYY.MM` (e.g., `v2026.11`) |
| `title` | Yes | Short human-readable title for the update |
| `date` | Yes | `YYYY-MM-DD` publication or announcement date |
| `items` | Yes | Array of individual rule updates rendered in a 2-column layout |
| `items[].ruleRef` | Yes | Left-column rule header/badge (e.g., `Rule 217(d)`, `Section Four`, `General`) |
| `items[].ruleAnchor` | No | In-page anchor ID so clicking `ruleRef` jumps directly to the rule/clause (e.g., `rule-217-d`, `rule-621`, or `section-four-officials-and-playing-rules`) |
| `items[].text` | Yes | Right-column description of the rule change |
| `items[].links` | No | Optional array of `{ "label": string, "url": string }` external links rendered beneath `text` |

## Validation

Run `pnpm test:run lib/__tests__/rulebook-parser.test.ts` after editing `changelog.json` to verify version formatting and confirm every `ruleAnchor` resolves to a valid section, rule, or clause in `public/bash_rulebook_current.md`.
