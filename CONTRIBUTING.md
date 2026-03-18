# Contributing

## Development

1. Install Node.js 20.11+.
2. Run `npm install`.
3. Start the TUI with `npm start`.
4. Run tests with `npm test`.

## Project standards

- Keep the runtime dependency set small and install-free.
- Prefer plain Node.js APIs over heavy abstractions.
- Keep the TUI keyboard-first and responsive in narrow terminals.
- Preserve the `opencode run` shell execution path. Do not add brittle screen-scraping integrations.

## Pull requests

- Describe the use case and the user-visible behavior change.
- Include screenshots or terminal captures for TUI changes when practical.
- Add or update docs when behavior changes.
