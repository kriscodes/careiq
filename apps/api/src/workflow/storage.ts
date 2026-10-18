import { addBoundedPdfPage } from './pdf-limits.js';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inflateSync } from 'node:zlib';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { WorkflowError } from './policy.js';
const execFileAsync = promisify(execFile);
export const maximumFileBytes = 10 * 1024 * 1024;
const root = () => resolve(process.env.CAREIQ_PRIVATE_STORAGE_DIR || join(process.cwd(), '.local-review/private-documents'));
const safeKey = (key: string) => {
    if (!/^[a-f0-9-]{36}\.(?:bin|pdf|json)$/.test(key))
        throw new WorkflowError('INVALID_STORAGE_REFERENCE', 500);
    return key;
};
export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export async function storePrivate(key: string, bytes: Uint8Array) {
    await mkdir(root(), { recursive: true, mode: 0o700 });
    try {
        await writeFile(join(root(), safeKey(key)), bytes, { flag: 'wx', mode: 0o600 });
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
            throw error;
        const existing = await readPrivate(key);
        if (sha256(existing) !== sha256(bytes))
            throw new WorkflowError('IMMUTABLE_OBJECT_CONFLICT', 409);
    }
}
export const readPrivate = (key: string) => readFile(join(root(), safeKey(key)));
export function detectType(bytes: Buffer): string {
    if (bytes.subarray(0, 5).toString() === '%PDF-')
        return 'application/pdf';
    if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
        return 'image/png';
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
        return 'image/jpeg';
    throw new WorkflowError('UNSUPPORTED_FILE_TYPE', 422);
}
export async function scanPrivate(key: string): Promise<{
    verdict: 'clean' | 'unsafe' | 'error';
    scanner: string;
    failureCode?: string;
}> {
    const executable = process.env.CAREIQ_SCANNER_COMMAND;
    if (!executable)
        return { verdict: 'error', scanner: 'unconfigured', failureCode: 'SCANNER_UNAVAILABLE' };
    try {
        await execFileAsync(executable, ['--no-summary', join(root(), safeKey(key))], { timeout: 30000, maxBuffer: 4096 });
        return { verdict: 'clean', scanner: 'clamav-local' };
    }
    catch (error) {
        return { verdict: (error as {
                code?: number;
            }).code === 1 ? 'unsafe' : 'error', scanner: 'clamav-local', failureCode: (error as {
                code?: number;
            }).code === 1 ? 'UNSAFE_FILE' : 'SCANNER_UNAVAILABLE' };
    }
}
function printable(value: unknown) { return String(value ?? '').replace(/[^\x20-\x7e\n]/g, '?'); }
export async function renderTemplate(title: string, content: string, fields: Array<{
    key: string;
    label?: string | null;
}>, answers: Record<string, unknown>) {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    let page = addBoundedPdfPage(pdf);
    let y = page.getHeight() - 50;
    const line = (value: string, size = 11) => {
        for (const s of printable(value).split('\n')) {
            const chunks = s.match(/.{1,88}/g) || [''];
            for (const chunk of chunks) {
                if (y < 50) {
                    page = addBoundedPdfPage(pdf);
                    y = page.getHeight() - 50;
                }
                page.drawText(chunk, { x: 45, y, size, font, color: rgb(.1, .15, .2) });
                y -= size + 7;
            }
        }
    };
    line(title, 20);
    y -= 10;
    line(content);
    y -= 15;
    for (const field of fields)
        line(`${field.label || field.key}: ${answers[field.key] ?? ''}`);
    pdf.setTitle(printable(title));
    pdf.setProducer('CareIQ local template renderer v1');
    return Buffer.from(await pdf.save());
}
/** Validate bounds before the PNG decoder allocates pixels or walks untrusted chunks. */
function boundedSignaturePng(png: Buffer): Buffer {
    const invalid = () => { throw new WorkflowError('INVALID_SIGNATURE_IMAGE', 422); };
    if (png.length < 45 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return invalid();
    const chunks: Buffer[] = [png.subarray(0, 8)], compressed: Buffer[] = [];
    let offset = 8, expectedBytes = 0, ended = false, header = false, dataStarted = false;
    while (offset < png.length) {
        if (offset + 12 > png.length) return invalid();
        const length = png.readUInt32BE(offset), end = offset + length + 12, type = png.toString('ascii', offset + 4, offset + 8);
        if (end > png.length || !/^[A-Za-z]{4}$/.test(type)) return invalid();
        const data = png.subarray(offset + 8, end - 4);
        if (!header && type !== 'IHDR') return invalid();
        if (type === 'IHDR') {
            if (header || length !== 13) return invalid();
            const width = data.readUInt32BE(0), height = data.readUInt32BE(4), depth = data[8], color = data[9];
            const channels: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
            const depths = color === 0 ? [1, 2, 4, 8, 16] : color === 3 ? [1, 2, 4, 8] : [8, 16];
            if (!width || !height || width > 2048 || height > 1024 || width * height > 1048576 || !channels[color] || !depths.includes(depth) || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) return invalid();
            expectedBytes = (Math.ceil(width * channels[color] * depth / 8) + 1) * height;
            header = true; chunks.push(png.subarray(offset, end));
        } else if (type === 'IDAT') {
            dataStarted = true; compressed.push(data); chunks.push(png.subarray(offset, end));
        } else if (type === 'PLTE' || type === 'tRNS') {
            if (dataStarted || !length || (type === 'PLTE' ? length > 768 || length % 3 !== 0 : length > 256)) return invalid();
            chunks.push(png.subarray(offset, end));
        } else if (type === 'IEND') {
            if (length !== 0 || !dataStarted || end !== png.length) return invalid();
            chunks.push(png.subarray(offset, end)); ended = true;
        } else if (['acTL', 'fcTL', 'fdAT'].includes(type) || type[0] === type[0].toUpperCase()) return invalid();
        // Ancillary metadata is omitted before the decoder: pixels are the signature evidence.
        offset = end;
    }
    if (!ended) return invalid();
    try { if (inflateSync(Buffer.concat(compressed), { maxOutputLength: expectedBytes }).length !== expectedBytes) return invalid(); }
    catch { return invalid(); }
    return Buffer.concat(chunks);
}
export async function renderSigned(source: Buffer, evidence: Record<string, any>, fields: Array<{
    key: string;
    type: string;
    value: string;
}>) {
    const pdf = await PDFDocument.load(source, { ignoreEncryption: false });
    let page = addBoundedPdfPage(pdf);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const printable = (value: unknown) => Array.from(String(value ?? '')).map(character => {
        if (character === '\n') return character;
        try { font.encodeText(character); return character; }
        catch { throw new WorkflowError('PDF_UNSUPPORTED_CHARACTER', 422, { field: 'signature' }); }
    }).join('');
    let y = page.getHeight() - 50;
    const line = (value: string, size = 11) => {
        for (const paragraph of printable(value.replace(/\r\n?/g, '\n')).split('\n')) {
            const lines: string[] = []; let chunk = '';
            for (const character of paragraph) {
                if (chunk && font.widthOfTextAtSize(chunk + character, size) > page.getWidth() - 90) { lines.push(chunk); chunk = ''; }
                chunk += character;
            }
            lines.push(chunk);
            for (const text of lines) {
                if (y < 50) { page = addBoundedPdfPage(pdf); y = page.getHeight() - 50; }
                page.drawText(text, {x:45, y, size, font}); y -= size + 7;
            }
        }
    };
    line('CareIQ electronic signing record', 18);
    y -= 10;
    line('Electronic signature. No certificate-based PDF signature is applied.');
    line(`Completed: ${evidence.completedAt}`);
    line(`Source SHA-256: ${evidence.sourceSha256}`);
    line(`Consent version: ${evidence.consentTextVersion}`);
    line(`Verification: ${evidence.verificationMethod}`);
    line(`Request: ${evidence.requestId}`);
    y -= 10;
    for (const field of fields) {
        if (field.type === 'drawn_signature') {
            if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(field.value) || field.value.length > 150000)
                throw new WorkflowError('INVALID_SIGNATURE_IMAGE', 422);
            const png = Buffer.from(field.value.slice(field.value.indexOf(',') + 1), 'base64');
            const embedded = await pdf.embedPng(boundedSignaturePng(png));
            if (y < 140) { page = addBoundedPdfPage(pdf); y = page.getHeight() - 50; }
            page.drawImage(embedded, { x: 45, y: y - 70, width: 180, height: 60 });
            y -= 90;
            line(field.key);
        }
        else
            line(`${field.key}: ${field.value}`);
    }
    pdf.setProducer('CareIQ electronic signature renderer v1');
    return Buffer.from(await pdf.save());
}
