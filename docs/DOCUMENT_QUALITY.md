# Document design and acceptance

Converge 1.9.9 separates document presentation from delivery and content review. Transferring a real file is necessary, but it does not establish that the file is readable, complete or correct.

## Choose a design

Open **Project studio → Brief → Document design**.

- **Academic math notes:** readable serif body and matching mathematical fonts, restrained teal/navy headings, numbered derivations and clear learning notes.
- **Match attached reference:** compare actual rendered reference pages and preserve their typography, spacing, page structure and visual hierarchy.
- **Editorial report:** a balanced report layout with strong section openers and legible figures.
- **Neutral document:** restrained printing layout with minimal decoration.

Use **Add a design reference** beside source attachments to upload an example. The same verified reference bytes reach the boss and both workers. References guide appearance only; their contents do not add lectures, topics or instructions to the task. Reference names in the Brief must match uploaded filenames exactly. Unavailable references remain visible in review evidence.

Design notes can specify the page size, font families, heading palette, equation numbering, callout design and figure treatment. The team is instructed to establish a representative text/derivation/figure sample, inspect it, reuse its design throughout the document, and review the final saved pages in bounded batches.

## Acceptance requirements

Explicit document production adds content and layout requirements in Automatic mode, even with local structural verification off. Selecting a reference adds a separate style comparison. Merely uploading or reading a source PDF does not add document-production requirements.

Final PDF reviews must identify each exact filename and file SHA-256; state its page count, rendered pages and visually inspected pages; and give concrete findings for typography, spacing, mathematics, figures and reference style. Missing coverage, generic checks, unresolved limitations or unavailable references cannot satisfy the visual review gate. Where the local parser ran, its exact-file page count is checked against the model's reported count.

Mathematics must use real fractions, scripts, integral/vector notation and aligned derivations. Literal caret/underscore notation or raw typesetting commands are unsuitable outside intentional code examples. Review signs, units, assumptions and boundary/limiting cases, and check that figure arrows and labels agree with the equations.

**Model reports remain model evidence.** The app cannot independently confirm what a model looked at. Successful PDF parsing/rasterization is labelled as such and does not count as aesthetic approval. Neither model agreement nor completing a fixed number of rounds guarantees correctness. A missing rendering capability must be reported honestly; captured draft files remain downloadable while acceptance is pending.

## CED comparison reviewed on 7 October 2026

The supplied references are `CED_Lectures_01-20_Expanded_Notes.pdf` and `CED_Lectures_21-42_Expanded_Notes.pdf`. Rendered cover, contents, derivation and figure pages show a consistent mathematical textbook design: Latin Modern body and math fonts, sans-serif headings, proper fractions and numbered equations, teal learning-note boxes, coherent margins, and labelled vector diagrams.

The first reference contains 169 pages: 95 digital pages and 74 embedded source-scan pages. The second contains 178 pages: 80 digital pages and 98 source scans. Total page count alone is therefore not a coverage comparison with the recovered 68-page draft.

The recovered draft has real figures, bookmarks and some mathematical fonts, but also literal notation such as `r^m`, `r^{-m}` and `(z²+a²)^(3/2)` in equations. Its page 5 dipole figure has a rightward net-field arrow while the stated geometry and equation require a leftward field. This comparison did not establish complete mathematical correctness or full topic coverage of either reference. The original supplied PDFs have not been modified.

For CED, retain the full requested lecture scope, a source-page coverage ledger, explicit intermediate derivation steps, beginner definitions and limitations. Source scans may be retained in an appendix; they must not replace expanded digital explanations.
