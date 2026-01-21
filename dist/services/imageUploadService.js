"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveImage = saveImage;
exports.ensureImageUrl = ensureImageUrl;
exports.normalizeImagesToUrls = normalizeImagesToUrls;
const crypto_1 = require("crypto");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const STORAGE_PROVIDER = (process.env.IMAGE_STORAGE_PROVIDER || 'local');
const LOCAL_UPLOAD_DIR = process.env.IMAGE_UPLOAD_DIR || path_1.default.resolve(process.cwd(), 'uploads');
const PUBLIC_BASE_URL = process.env.IMAGE_BASE_URL || '/uploads';
function ensureLocalDir() {
    if (!fs_1.default.existsSync(LOCAL_UPLOAD_DIR)) {
        fs_1.default.mkdirSync(LOCAL_UPLOAD_DIR, { recursive: true });
    }
}
function isDataUri(value) {
    return typeof value === 'string' && value.startsWith('data:');
}
function isLikelyAbsoluteUrl(value) {
    return typeof value === 'string' && (/^https?:\/\//i.test(value) || value.startsWith('/'));
}
function isLikelyBase64Payload(value) {
    return typeof value === 'string' &&
        value.length > 100 &&
        /^[A-Za-z0-9+/=]+$/.test(value);
}
function dataUriToBuffer(dataUri) {
    const matches = dataUri.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches)
        throw new Error('INVALID_DATA_URI');
    const mime = matches[1];
    const base64 = matches[2];
    return { buffer: Buffer.from(base64, 'base64'), mime };
}
/**
 * Pluggable image upload service.
 * - Default: local filesystem (no external deps)
 * - Returns a public URL (string)
 */
async function saveImage(dataUriOrBuffer, options) {
    if (STORAGE_PROVIDER !== 'local') {
        throw new Error(`Unsupported IMAGE_STORAGE_PROVIDER: ${STORAGE_PROVIDER}`);
    }
    ensureLocalDir();
    let buffer;
    let mime = 'application/octet-stream';
    if (typeof dataUriOrBuffer === 'string' && isDataUri(dataUriOrBuffer)) {
        const parsed = dataUriToBuffer(dataUriOrBuffer);
        buffer = parsed.buffer;
        mime = parsed.mime;
    }
    else if (Buffer.isBuffer(dataUriOrBuffer)) {
        buffer = dataUriOrBuffer;
    }
    else {
        throw new Error('Invalid image payload');
    }
    const ext = mime === 'image/png' ? 'png'
        : mime === 'image/webp' ? 'webp'
            : mime === 'image/gif' ? 'gif'
                : mime === 'image/svg+xml' ? 'svg'
                    : 'jpg';
    const filename = `${options?.filenamePrefix || 'img'}-${(0, crypto_1.randomUUID)()}.${ext}`;
    const filepath = path_1.default.join(LOCAL_UPLOAD_DIR, filename);
    await fs_1.default.promises.writeFile(filepath, buffer);
    const normalizedBase = PUBLIC_BASE_URL.endsWith('/') ? PUBLIC_BASE_URL.slice(0, -1) : PUBLIC_BASE_URL;
    return `${normalizedBase}/${filename}`;
}
/**
 * Best-effort migration helper: if a value is a base64 data URI, upload and return a URL.
 * If already a URL, return as-is.
 */
async function ensureImageUrl(value) {
    if (!value)
        return value;
    if (isDataUri(value)) {
        try {
            return await saveImage(value);
        }
        catch (err) {
            console.error('Image migration failed for value, keeping original data URI:', err?.message);
            return value;
        }
    }
    // Already a URL (http(s) or absolute path) – return as-is
    if (isLikelyAbsoluteUrl(value)) {
        return value;
    }
    // Legacy base64-without-data-uri: wrap into a JPEG data URI and upload
    if (isLikelyBase64Payload(value)) {
        const dataUri = `data:image/jpeg;base64,${value}`;
        try {
            return await saveImage(dataUri);
        }
        catch (err) {
            console.error('Image migration from bare base64 failed, keeping original value:', err?.message);
            return value;
        }
    }
    return value;
}
/**
 * Normalize an array of images (strings) to URLs, uploading data URIs as needed.
 */
async function normalizeImagesToUrls(images) {
    if (!images)
        return [];
    let list = images;
    // If it's a string, try to parse JSON or wrap it
    if (typeof images === 'string') {
        try {
            const parsed = JSON.parse(images);
            list = parsed;
        }
        catch {
            // If it's a single data URI or URL string, wrap it
            if (isDataUri(images) || isLikelyAbsoluteUrl(images) || isLikelyBase64Payload(images)) {
                list = [images];
            }
            else {
                return [];
            }
        }
    }
    // If it's an object (common legacy shapes), try to extract values.
    // Examples seen in the wild:
    // - { "0": "data:image/..", "1": "..." }
    // - { "url": "data:image/.." }
    // - { "images": [ ... ] }
    if (list && typeof list === 'object' && !Array.isArray(list)) {
        if (typeof list.url === 'string') {
            list = [list.url];
        }
        else if (Array.isArray(list.images)) {
            list = list.images;
        }
        else {
            // numeric-key objects (or other objects) → take values
            list = Object.values(list);
        }
    }
    if (!Array.isArray(list))
        return [];
    const results = [];
    for (const img of list) {
        if (typeof img === 'string') {
            results.push(await ensureImageUrl(img));
        }
        else if (img && typeof img.url === 'string') {
            results.push(await ensureImageUrl(img.url));
        }
    }
    return results;
}
