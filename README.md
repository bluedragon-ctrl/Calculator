# Inside the Calculator

An interactive web page that lets students fly from a pocket calculator down to individual transistors. See [DESIGN.md](DESIGN.md) for the full design and [CLAUDE.md](CLAUDE.md) for contributor rules.

## Develop

```sh
npm install
npm run dev      # local dev server
npm test         # unit tests (Vitest)
npm run build    # type-check + production build into dist/
```

## Deploy

Pushes to `main` run tests, build, and deploy to GitHub Pages via `.github/workflows/deploy.yml`.
One-time setup: in the repository's **Settings → Pages**, set **Source** to **GitHub Actions**.
