# Commit Message Standard

Use Conventional Commits to keep messages consistent and machine-readable.

## Format

`<type>(<scope>): <summary>`

- `type`: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `chore`, `build`, `ci`, or `revert`.
- `scope`: optional affected area, such as `api`, `storage`, or `deploy`.
- `summary`: imperative English, at most 72 characters.

## Examples

- `feat(api): add resource artifact download`
- `fix(deploy): wait for embedded postgres`
- `docs(changelog): record first release`

Use a `BREAKING CHANGE:` footer when needed.
