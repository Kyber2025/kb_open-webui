# Gateway PDF update - 2026-11-11

The customer Code-page guides now require disabling telemetry and error reporting,
and direct both new and existing users to the r5 one-click configurator.

- macOS: 13 pages; Windows: 14 pages; CLI: 11 pages.
- Each cover explains r5 download, privacy update, restart, and per-computer setup.
- The appended checklist distinguishes privacy updates from the MCP-only action.
- CLI page 4 includes `DISABLE_TELEMETRY="1"` and `DISABLE_ERROR_REPORTING="1"`
  inside the existing `env` object, alongside the gateway and device settings.
- Existing screenshot pages retain their numbering; footer totals are refreshed.
- Download filenames and subscriber authentication remain unchanged.

The instructions were checked against the shipped r5 package. Desktop sets
`disableNonessentialTelemetry` and `disableEssentialTelemetry` to true; the CLI
uses the two environment values above. The r5 ZIP itself is unchanged.

`scripts/update-gateway-pdf-r5.py` regenerates the three regular-customer PDFs
from commit `1037de5fe6a11c89af394843fb1e72624e9e6861`. It requires reportlab,
pypdf, PyMuPDF, and `/Library/Fonts/Arial Unicode.ttf`. Copies are written to
`../output/pdf` relative to the repository root and to `public/gateway`.

Verification: all pages rendered and reviewed, required text and clickable Code
page links checked, and original screenshot-page body content preserved. Release
as a PDF-only image layer over the exact running Chat image; verify file hashes
on both nodes after the normal ALB rolling restart.
