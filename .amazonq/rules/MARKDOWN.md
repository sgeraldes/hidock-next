# Concise Markdown Style Guide

## Headings

* Use ATX-style headings with hash signs (`#`) and a space after (`# Heading`)
* Increment headings by one level only (don't skip from `#` to `###`)
* No duplicate heading text among siblings
* One top-level (`#`) heading per document as the first line
* No punctuation at end of headings
* Surround with single blank line before other content

## Text Formatting

* Line length: maximum 120 characters
* Use consistent emphasis: `*italic*` and `**bold**`
* No spaces inside emphasis markers
* Use single blank lines between sections
* Files end with a single newline
* No trailing spaces (except two spaces for line breaks)
* Use spaces for indentation, not tabs

## Lists

* Unordered lists: use consistent marker (preferably `-`)
* Ordered lists: either sequential numbers or all `1.`
* List indentation: 2 spaces for unordered, 3 for ordered
* One space after list markers
* Surround lists with blank lines

## Code

* Use fenced code blocks (```) with language specified
* For inline code, use backticks without internal spaces (`` `code` ``)
* Don't use `$` before commands unless showing output too
* Surround code blocks with blank lines

## Links & Images

* Format: `[text](url)` for links, `![alt text](image.jpg)` for images
* No empty link text
* Enclose URLs in angle brackets or format as links
* No spaces inside link brackets
* Ensure link fragments point to valid headings

## Other Elements

* Blockquotes: use `>` with one space after
* Tables: consistent pipe style with equal column count
* Horizontal rules: three hyphens `---` on a separate line
* Avoid inline HTML when possible
* Maintain proper capitalization for product names

## General Guidelines

* Use consistent styling throughout
* Prioritize clarity and readability
* Validate with a Markdown linter
