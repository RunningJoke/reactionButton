## What and why

Closes #

## Checks

- [ ] App: `npm test`, `npx tsc` (in `app/`); UI change checked in a browser (360 px and desktop, both themes)
- [ ] Firmware: `pio run -d firmware -e NewBoard` builds; flash size: … %
- [ ] Programs: `python tools/validate_programs.py`
- [ ] API / block semantics changed: `/fw-api-change` done (docs, `FW_VERSION_*`, `PROGRAM_FORMAT`, `info.features`, tools, app mirror)
- [ ] UI texts in `en.json` and `de.json`
- [ ] Tested on real pods (docs/app/acceptance-tests.md, docs/firmware/testing.md), or not needed
