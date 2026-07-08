/**
 * Ambient type shim for `pdf-parse` (the package ships no declarations).
 *
 * We import the library entry (`pdf-parse/lib/pdf-parse.js`) rather than the
 * package root, because the root's index.js runs a debug harness that reads a
 * bundled sample PDF when `!module.parent` and throws ENOENT in some runtimes.
 * Only the surface the artifact-type registry uses is declared here.
 */
declare module 'pdf-parse/lib/pdf-parse.js' {
  export interface PdfParseResult {
    /** Concatenated text of all pages. */
    text: string
    /** Number of pages in the document. */
    numpages: number
    /** Document info dictionary (Title, Author, …) or null. */
    info: Record<string, unknown> | null
  }

  const pdfParse: (data: Buffer, options?: Record<string, unknown>) => Promise<PdfParseResult>
  export default pdfParse
}
