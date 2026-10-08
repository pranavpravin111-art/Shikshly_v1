# Shikshly launch data workflows

## Student import

The production student import is intentionally a two-phase workflow:

1. Owner/Principal uploads CSV content.
2. API parses and normalizes it without writing Student records.
3. The API validates required fields, academic year, class/section, duplicate admission numbers and row-level limits.
4. An `ImportJob` and `ImportRow` audit/staging record set is created.
5. The UI displays totals and row errors.
6. The user explicitly confirms the import.
7. The API commits only valid rows in bounded batches and records created/updated/failed counts.

Default mode is `create_only`. `update_existing` is explicit and matches on admission number only.

### Required CSV columns

- `admission_no`
- `name` (or `first_name`)
- `class`
- `academic_year`

The template also includes guardian, address, previous-school and admission-date fields.

The current launch implementation accepts CSV/TXT only. Excel users should save the workbook as UTF-8 CSV before importing. The API contract is deliberately file-format-neutral so an XLSX adapter can be added later without changing the import job or database design.

## Student export

`GET /api/school/students/export.csv` supports class, academic-year and status filters. Exports are capped at 25,000 rows per request and every export is audited. A request larger than the cap is rejected rather than silently truncating school data.

## Direct admissions

Owner and Principal can create an admission from the web at `POST /api/school/admissions/direct`. The API verifies that the selected class belongs to the selected academic year and rejects duplicate admission numbers.

## Design system

The web workspace uses layered surfaces, restrained motion, premium spacing and data-dense ERP patterns. GetLayers is used as visual direction only; proprietary source/template code is not copied into this repository. GetLayers' own documentation states that commercial use depends on the applicable plan/license and recommends extending layers rather than shipping them untouched.

## Pre-launch verification

The repository should pass all of the following in CI before production deployment:

- `npm ci`
- `npm test`
- `npm run build -w apps/web`
- `npm run verify`
- API smoke tests against a real MongoDB instance
- import tests at 1, 1,000 and 25,000 rows
- cross-school authorization tests
- duplicate admission-number tests
- interrupted import/retry tests
- export authorization tests
- backup + restore verification
