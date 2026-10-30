---
name: fw-request
description: Request a ReactPod firmware/API change that the Config App or the tools need, as a GitHub issue with the firmware-request form fields. Use when app work hits something the firmware does not provide.
---

# Firmware request (issue)

Do not change the firmware on the side (unless the user asks). Open an issue:

```sh
gh issue create --label "type: fw-request" --label "area: firmware" --title "<short API name>: <what>" --body-file <file>
```

Body (fields of `.github/ISSUE_TEMPLATE/fw-request.yml`):

```markdown
### What is missing
### Why the app (or tool) needs it
### Proposed API
(JSON request/response, `info.features` flag, block fields – as in docs/firmware/config-api.md or programs.md)
### Fallback without the change
(how the app detects it via `info`, what it does with older firmware)
### Acceptance test
```

Then link the issue where the fallback lives (`// fw-request #n`), add it to a matching milestone
(`gh issue edit <n> --milestone "<name>"`) and tell the user the number.
