## What and why

Closes #

## Checks

- [ ] App: `npm test`, `npx tsc` (in `app/`); UI change checked in a browser (360 px and desktop)
- [ ] Firmware: `pio run -d firmware -e NewBoard` builds; flash size: … %
- [ ] Programs: `python tools/validate_programs.py`
- [ ] API / block semantics changed: docs, `FW_VERSION_*`, `PROGRAM_FORMAT`, `info.features`, tools and app mirror updated
- [ ] UI texts in `en.json` and `de.json`
- [ ] Tested on real pods (acceptance tests in docs/app/acceptance-tests.md), or not needed
