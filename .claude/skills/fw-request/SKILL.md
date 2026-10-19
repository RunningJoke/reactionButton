---
name: fw-request
description: Request a ReactPod firmware/API change that the Config App or the tools need, as a GitHub issue with the firmware-request form fields. Use when app work hits something the firmware does not provide.
---

# Firmware request (issue)

Do not change the firmware on the side. Open an issue instead (unless the user asks you to
implement it):

```sh
gh issue create --label "type: fw-request" --label "area: firmware" --title "<short API name>: <what>" --body-file <file>
```

The body follows `.github/ISSUE_TEMPLATE/fw-request.yml`:

```markdown
### What is missing
### Why the app (or tool) needs it
### Proposed API
(JSON request/response, `info.features` flag, block fields – as it would appear in
docs/firmware/config-api.md or programs.md)
### Fallback without the change
(how the app detects the feature via `info`, and what it does with older firmware)
### Acceptance test
```

Then:
- Link the issue from the app code or PR where the fallback lives (`// fw-request #n`).
- Add it to the matching milestone if one exists (`gh issue edit <n> --milestone "<name>"`).
- Tell the user the issue number.
