import type { PDFDocument } from 'pdf-lib';
import { WorkflowError } from './policy.js';

export const maximumPdfPages = 100;

/** Stop local PDF expansion before another page and its content objects are allocated. */
export function addBoundedPdfPage(pdf: PDFDocument) {
    if (pdf.getPageCount() >= maximumPdfPages) throw new WorkflowError('PDF_PAGE_LIMIT_EXCEEDED', 422, { maximumPages: maximumPdfPages });
    return pdf.addPage();
}
