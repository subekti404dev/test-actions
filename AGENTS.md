# Repository Guidelines

## Project Structure & Module Organization
- `.github/workflows/*.yml`: CI/CD workflows (Android builds, rclone, utilities).
- `.github/actions/*/action.yml`: Composite actions (e.g., `setup-rclone`, `upload-*`).
- `scripts/*.js`: Node 18+/20 utilities invoked by workflows (`find-video.js`, `rclone-*.js`).
- `README.md`: High-level entry points and pointers.

## Build, Test, and Development Commands
- Run scripts locally:
  - `node scripts/find-video.js "My Movie.mkv"`
  - `RCLONE_GETTER_URL=... node scripts/rclone-getter.js`
  - `RCLONE_SETTER_URL=... node scripts/rclone-setter.js`
- Validate workflow YAML: `yamllint .github/workflows` (or use an editor YAML linter).
- Optional workflow dry-run: `act -j <job> -W .github/workflows/<file>.yml`.

## Coding Style & Naming Conventions
- YAML: 2-space indent; kebab-case filenames (`build-apk.yml`); Title Case `name:`; job ids kebab-case; step names imperative (“Setup RClone”).
- JS: 2-space indent, semicolons, `const/let`, camelCase; script filenames kebab-case (`rclone-getter.js`). Prefer small, pure helpers.

## Testing Guidelines
- Workflows: prefer echo/dry-runs; mask sensitive values. Validate job logic with `act` when feasible.
- Scripts: run locally with controlled env vars; print concise diagnostics. No formal coverage required, but keep functions testable and side effects isolated.

## Commit & Pull Request Guidelines
- Commits: follow Conventional Commits (`feat:`, `fix:`, `chore:`, `ci:`, `docs:`). Optional scope, e.g., `ci(rclone): ...`.
- PRs: include a clear summary, linked issue (if any), affected workflows/scripts, sample output or `act` logs, and any required secrets/inputs. Add screenshots only when UI artifacts are involved.

## Security & Configuration Tips
- Never print secrets. Use GitHub masking (`::add-mask::`) as done in `scripts/*`. Write large values via `GITHUB_ENV` with `<<EOF` blocks. Consume secrets via `${{ secrets.* }}` only.
- For rclone: prefer base64 transfer; respect `RCLONE_CONFIG` if present; avoid persisting credentials to disk unless necessary.

## Adding/Updating Actions
- Place new composite actions in `.github/actions/<name>/action.yml`. Document inputs/outputs, minimal permissions, and include an example usage snippet in the referencing workflow.

