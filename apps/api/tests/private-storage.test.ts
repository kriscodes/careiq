import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, link, lstat, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { privateStorageRoot, verifyPrivateStorageDirectory } from '../src/workflow/storage-config.js';
import { readPrivate, storePrivate } from '../src/workflow/storage.js';

test('private storage preserves immutable bytes and rejects linked or overly permissive objects', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'careiq-private-storage-'));
    const previous = process.env.CAREIQ_PRIVATE_STORAGE_DIR;
    process.env.CAREIQ_PRIVATE_STORAGE_DIR = directory;
    const key = () => randomUUID() + '.pdf';
    try {
        const original = key(), bytes = Buffer.from('synthetic private bytes');
        await storePrivate(original, bytes); await storePrivate(original, bytes);
        assert.deepEqual(await readPrivate(original), bytes);
        assert.equal((await lstat(join(directory, original))).mode & 0o077, 0);
        await assert.rejects(storePrivate(original, Buffer.from('changed')), /IMMUTABLE_OBJECT_CONFLICT/);
        const symbolic = key(); await symlink(join(directory, original), join(directory, symbolic));
        await assert.rejects(readPrivate(symbolic)); await assert.rejects(storePrivate(symbolic, bytes));
        const hard = key(); await link(join(directory, original), join(directory, hard));
        await assert.rejects(readPrivate(hard), /PRIVATE_STORAGE_OBJECT_UNSAFE/);
        await assert.rejects(readPrivate(original), /PRIVATE_STORAGE_OBJECT_UNSAFE/);
        const exposed = key(); await writeFile(join(directory, exposed), bytes, {mode:0o600}); await chmod(join(directory, exposed), 0o644);
        await assert.rejects(readPrivate(exposed), /PRIVATE_STORAGE_OBJECT_UNSAFE/);
        assert.throws(() => readPrivate('../escape.pdf'));
        await chmod(directory, 0o755); await assert.rejects(storePrivate(key(), bytes), /owner-only/);
    } finally {
        if (previous === undefined) delete process.env.CAREIQ_PRIVATE_STORAGE_DIR; else process.env.CAREIQ_PRIVATE_STORAGE_DIR = previous;
        await rm(directory, {recursive:true,force:true});
    }
});

test('production storage preflight is read-only and rejects public paths and symlink directories', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'careiq-storage-preflight-'));
    const production = {NODE_ENV:'production', CAREIQ_PRIVATE_STORAGE_DIR:join(directory,'private')};
    try {
        await assert.rejects(verifyPrivateStorageDirectory(production), /owner-only/);
        await assert.rejects(lstat(production.CAREIQ_PRIVATE_STORAGE_DIR));
        await mkdir(production.CAREIQ_PRIVATE_STORAGE_DIR, {mode:0o700});
        assert.equal(await verifyPrivateStorageDirectory(production), production.CAREIQ_PRIVATE_STORAGE_DIR);
        const alias=join(directory,'alias'); await symlink(production.CAREIQ_PRIVATE_STORAGE_DIR, alias);
        await assert.rejects(verifyPrivateStorageDirectory({...production,CAREIQ_PRIVATE_STORAGE_DIR:alias}), /owner-only/);
        await chmod(production.CAREIQ_PRIVATE_STORAGE_DIR,0o500);
        await assert.rejects(verifyPrivateStorageDirectory(production), /owner-only/);
        await chmod(production.CAREIQ_PRIVATE_STORAGE_DIR,0o750);
        await assert.rejects(verifyPrivateStorageDirectory(production), /owner-only/);
        assert.throws(() => privateStorageRoot({NODE_ENV:'production'}), /owner-only/);
        assert.throws(() => privateStorageRoot({...production,CAREIQ_PRIVATE_STORAGE_DIR:new URL('../../../web/public',import.meta.url).pathname}), /owner-only/);
    } finally { await chmod(production.CAREIQ_PRIVATE_STORAGE_DIR,0o700).catch(() => {}); await rm(directory,{recursive:true,force:true}); }
});
